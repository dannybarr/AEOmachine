/**
 * Provider-metadata citation extraction.
 *
 * Citations are taken only from structured Requesty/provider fields — never
 * scraped from answer prose. Unknown shapes are recorded, not guessed.
 *
 * Documented Requesty Chat Completions shape:
 *   delta.web_search.content[] = { url, title }
 * Documented Requesty Responses shape (sometimes appears on chat deltas):
 *   annotations[] = { type: "url_citation", url, title, start_index, end_index }
 * Historical nested Chat Completions shape:
 *   annotations[] = { type: "url_citation", url_citation: { url } }
 * Provider-native fields forwarded on the chunk (not the delta):
 *   chunk.citations[] / chunk.search_results[]
 *   choices[].message.annotations
 * Gemini Vertex grounding:
 *   grounding_metadata.grounding_chunks[].web.uri
 */

export interface VerifiedSource {
  domain: string;
  url: string | null;
  /** Raw provider-returned metadata that produced this citation (audit trail). */
  metadata: unknown;
}

/** Structured extraction diagnostics captured for every run (audit trail). */
export interface CitationDiagnostics {
  /** Citation-metadata items observed on the stream (annotations + web_search entries). */
  metadataEvents: number;
  /** Verified citations successfully extracted (post-dedupe). */
  extracted: number;
  /** Metadata items rejected for malformed / non-http(s) URLs. */
  invalidUrls: number;
  /** Annotation `type` values seen that are not a recognized citation type. */
  unknownAnnotationTypes: string[];
  /** Annotations/web_search entries whose structure carried no recognizable URL. */
  unknownShapes: number;
  /** Grounding-redirect URLs successfully resolved to their real source. */
  redirectsResolved: number;
  /** Grounding-redirect URLs that could not be resolved (kept as provider URL). */
  redirectsFailed: number;
  /**
   * Recognized citation shapes that produced at least one metadata event
   * (e.g. "delta.web_search.content", "chunk.citations").
   */
  observedShapes: string[];
  /**
   * Citation-related keys observed on the stream, including empty payloads.
   * Distinguishes "provider never sent citation fields" from "sent empty lists".
   */
  seenCitationKeys: string[];
  /**
   * Citation-like keys whose structure could not be parsed into URLs
   * (shape drift). Distinct from an honest empty list.
   */
  unparsedCitationKeys: string[];
}

export function emptyDiagnostics(): CitationDiagnostics {
  return {
    metadataEvents: 0,
    extracted: 0,
    invalidUrls: 0,
    unknownAnnotationTypes: [],
    unknownShapes: 0,
    redirectsResolved: 0,
    redirectsFailed: 0,
    observedShapes: [],
    seenCitationKeys: [],
    unparsedCitationKeys: [],
  };
}

/** Shapes Requesty attaches to streamed deltas for web search results. */
export interface SearchDelta {
  web_search?: { content?: { url?: string; uri?: string; title?: string }[] };
  annotations?: { type?: string; url_citation?: { url?: string }; url?: string; uri?: string }[];
  citations?: unknown;
  search_results?: unknown;
  grounding_metadata?: unknown;
  groundingMetadata?: unknown;
  content?: unknown;
}

export interface Collector {
  seen: Set<string>;
  sources: VerifiedSource[];
  diagnostics: CitationDiagnostics;
}

export function newCollector(): Collector {
  return { seen: new Set(), sources: [], diagnostics: emptyDiagnostics() };
}

const MAX_DIAG_LIST = 16;
const CITATION_ANNOTATION_TYPES = new Set([
  "url_citation",
  "web_search_result_location",
  "web_search_result",
]);

function noteList(list: string[], value: string): void {
  if (!value || list.includes(value) || list.length >= MAX_DIAG_LIST) return;
  list.push(value);
}

function noteSeen(key: string, c: Collector): void {
  noteList(c.diagnostics.seenCitationKeys, key);
}

function noteShape(shape: string, c: Collector): void {
  noteList(c.diagnostics.observedShapes, shape);
}

function noteUnparsed(key: string, c: Collector): void {
  noteList(c.diagnostics.unparsedCitationKeys, key);
}

export function collectSource(url: unknown, metadata: unknown, c: Collector): void {
  c.diagnostics.metadataEvents += 1;
  if (typeof url !== "string" || url.length === 0) {
    c.diagnostics.unknownShapes += 1;
    return;
  }
  try {
    const u = new URL(url);
    // Only http(s) URLs with a real host qualify as verified citations —
    // anything else (javascript:, data:, mailto:, ...) is unsafe to render
    // as an external link and never provider search output.
    if ((u.protocol !== "http:" && u.protocol !== "https:") || !u.hostname) {
      c.diagnostics.invalidUrls += 1;
      return;
    }
    const domain = u.hostname.replace(/^www\./, "");
    const key = `${domain}|${url}`;
    if (!c.seen.has(key)) {
      c.seen.add(key);
      // Provider ordering is preserved: sources are appended in stream order.
      c.sources.push({ domain, url, metadata });
    }
  } catch {
    // malformed citation URLs never become verified citations — but they are
    // counted so an all-malformed stream is reported as extraction_failed.
    c.diagnostics.invalidUrls += 1;
  }
}

/** Pull a URL out of a structured citation object — never from free text. */
export function urlFromCitationItem(item: unknown): unknown {
  if (typeof item === "string") return item;
  if (!item || typeof item !== "object") return undefined;
  const o = item as Record<string, unknown>;
  if (typeof o.url === "string") return o.url;
  if (typeof o.uri === "string") return o.uri;
  if (typeof o.link === "string") return o.link;
  if (o.url_citation && typeof o.url_citation === "object") {
    const nested = (o.url_citation as Record<string, unknown>).url;
    if (typeof nested === "string") return nested;
  }
  if (o.web && typeof o.web === "object") {
    const web = o.web as Record<string, unknown>;
    if (typeof web.uri === "string") return web.uri;
    if (typeof web.url === "string") return web.url;
  }
  return undefined;
}

function extractCitationList(list: unknown, path: string, c: Collector): void {
  if (list === undefined) return;
  if (typeof list === "string") {
    const before = c.sources.length;
    collectSource(list, { path, value: list }, c);
    if (c.sources.length > before) noteShape(path, c);
    return;
  }
  if (!Array.isArray(list)) {
    c.diagnostics.unknownShapes += 1;
    noteUnparsed(path, c);
    return;
  }
  if (list.length === 0) return;
  const beforeEvents = c.diagnostics.metadataEvents;
  const beforeSources = c.sources.length;
  for (const item of list) {
    collectSource(urlFromCitationItem(item), item, c);
  }
  if (c.sources.length > beforeSources || c.diagnostics.metadataEvents > beforeEvents) {
    noteShape(path, c);
  }
}

function extractAnnotations(annotations: unknown, prefix: string, c: Collector): void {
  if (annotations !== undefined && !Array.isArray(annotations)) {
    c.diagnostics.unknownShapes += 1;
    noteUnparsed(`${prefix}.annotations`, c);
    return;
  }
  for (const ann of annotations ?? []) {
    if (!ann || typeof ann !== "object") {
      c.diagnostics.unknownShapes += 1;
      continue;
    }
    const rec = ann as Record<string, unknown>;
    const type = typeof rec.type === "string" ? rec.type : undefined;
    if (type && CITATION_ANNOTATION_TYPES.has(type)) {
      const nested =
        rec.url_citation && typeof rec.url_citation === "object"
          ? (rec.url_citation as Record<string, unknown>).url
          : undefined;
      const url = nested ?? rec.url ?? rec.uri;
      const before = c.sources.length;
      collectSource(url, ann, c);
      if (typeof nested === "string") {
        noteShape(`${prefix}.annotations.url_citation`, c);
      } else if (c.sources.length > before || typeof url === "string") {
        noteShape(`${prefix}.annotations.url`, c);
      }
    } else if (type === "annotation") {
      // Gemini sometimes emits type:"annotation" alongside web_search.
      // Extract only when a structured URL field is present — never from text.
      const url = urlFromCitationItem(ann);
      if (typeof url === "string" && url.length > 0) {
        collectSource(url, ann, c);
        noteShape(`${prefix}.annotations.annotation`, c);
      } else if (
        !c.diagnostics.unknownAnnotationTypes.includes(type) &&
        c.diagnostics.unknownAnnotationTypes.length < MAX_DIAG_LIST
      ) {
        c.diagnostics.unknownAnnotationTypes.push(type);
      }
    } else if (typeof type === "string") {
      if (
        !c.diagnostics.unknownAnnotationTypes.includes(type) &&
        c.diagnostics.unknownAnnotationTypes.length < MAX_DIAG_LIST
      ) {
        c.diagnostics.unknownAnnotationTypes.push(type);
      }
    } else {
      c.diagnostics.unknownShapes += 1;
    }
  }
}

function extractWebSearch(webSearch: unknown, prefix: string, c: Collector): void {
  if (Array.isArray(webSearch)) {
    extractCitationList(webSearch, `${prefix}.web_search`, c);
    return;
  }
  if (!webSearch || typeof webSearch !== "object") {
    c.diagnostics.unknownShapes += 1;
    noteUnparsed(`${prefix}.web_search`, c);
    return;
  }
  const ws = webSearch as Record<string, unknown>;
  if (ws.content !== undefined) {
    if (!Array.isArray(ws.content)) {
      c.diagnostics.unknownShapes += 1;
      noteUnparsed(`${prefix}.web_search.content`, c);
    } else {
      extractCitationList(ws.content, `${prefix}.web_search.content`, c);
    }
  }
  if (ws.results !== undefined) {
    extractCitationList(ws.results, `${prefix}.web_search.results`, c);
  }
}

function extractGrounding(grounding: unknown, path: string, c: Collector): void {
  if (!grounding || typeof grounding !== "object") {
    c.diagnostics.unknownShapes += 1;
    noteUnparsed(path, c);
    return;
  }
  const g = grounding as Record<string, unknown>;
  const chunks = g.groundingChunks ?? g.grounding_chunks;
  if (chunks === undefined) {
    // Present but not the documented chunks list — record drift, don't guess.
    c.diagnostics.unknownShapes += 1;
    noteUnparsed(path, c);
    return;
  }
  extractCitationList(chunks, path, c);
}

/**
 * Extract citation metadata from one streamed delta (legacy entry point).
 * New call sites should use extractChunkCitations so non-delta fields are
 * not dropped.
 */
export function extractDeltaCitations(delta: SearchDelta, c: Collector): void {
  extractFromContainer(delta as unknown as Record<string, unknown>, "delta", c);
}

function extractFromContainer(
  container: unknown,
  prefix: string,
  c: Collector,
): void {
  if (!container || typeof container !== "object" || Array.isArray(container)) return;
  const obj = container as Record<string, unknown>;

  if (obj.annotations !== undefined) {
    noteSeen(`${prefix}.annotations`, c);
    extractAnnotations(obj.annotations, prefix, c);
  }
  if (obj.web_search !== undefined) {
    noteSeen(`${prefix}.web_search`, c);
    extractWebSearch(obj.web_search, prefix, c);
  }
  if (obj.citations !== undefined) {
    noteSeen(`${prefix}.citations`, c);
    extractCitationList(obj.citations, `${prefix}.citations`, c);
  }
  if (obj.search_results !== undefined) {
    noteSeen(`${prefix}.search_results`, c);
    extractCitationList(obj.search_results, `${prefix}.search_results`, c);
  }
  if (obj.grounding_metadata !== undefined) {
    noteSeen(`${prefix}.grounding_metadata`, c);
    extractGrounding(obj.grounding_metadata, `${prefix}.grounding_metadata`, c);
  }
  if (obj.groundingMetadata !== undefined) {
    noteSeen(`${prefix}.groundingMetadata`, c);
    extractGrounding(obj.groundingMetadata, `${prefix}.groundingMetadata`, c);
  }
  if (Array.isArray(obj.content)) {
    for (const part of obj.content) {
      if (part && typeof part === "object") {
        extractFromContainer(part, `${prefix}.content_part`, c);
      }
    }
  }
}

/**
 * Extract provider-returned citation metadata from one streamed chat chunk.
 * Looks at the chunk root, each choice delta, and the non-delta `message`
 * payload some providers emit on the terminal chunk. Empty `choices` arrays
 * (usage-only trailing chunks) are still scanned for root `citations`.
 */
export function extractChunkCitations(chunk: unknown, c: Collector): void {
  if (!chunk || typeof chunk !== "object") return;
  const obj = chunk as Record<string, unknown>;
  extractFromContainer(obj, "chunk", c);
  const choices = obj.choices;
  if (choices !== undefined && !Array.isArray(choices)) {
    c.diagnostics.unknownShapes += 1;
    noteUnparsed("chunk.choices", c);
    return;
  }
  for (const choice of choices ?? []) {
    if (!choice || typeof choice !== "object") continue;
    const ch = choice as Record<string, unknown>;
    extractFromContainer(ch.delta, "delta", c);
    extractFromContainer(ch.message, "message", c);
  }
}

/** Concatenate streamed text content without coercing arrays via toString(). */
export function deltaContentText(chunk: unknown): string {
  if (!chunk || typeof chunk !== "object") return "";
  const choices = (chunk as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") return "";
  const delta = (choices[0] as { delta?: { content?: unknown } }).delta;
  return contentToText(delta?.content);
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  let out = "";
  for (const part of content) {
    if (typeof part === "string") {
      out += part;
    } else if (part && typeof part === "object") {
      const rec = part as Record<string, unknown>;
      if (typeof rec.text === "string") out += rec.text;
      else if (typeof rec.content === "string") out += rec.content;
    }
  }
  return out;
}
