import OpenAI from "openai";
import { safeFetch } from "./safeFetch";
import { getModel, resolveModelStrict } from "./modelRegistry";

/**
 * Truthful per-run search/citation outcome model.
 *
 * provider_cited      — provider performed web search AND ≥1 verified citation
 *                       was extracted from its structured metadata.
 * search_no_citations — search was performed (tool accepted) but the provider
 *                       returned no citation metadata at all. Honest zero:
 *                       still citation-eligible (counts in denominators).
 * extraction_failed   — the provider streamed citation metadata but none of it
 *                       could be safely extracted (malformed URLs / unknown
 *                       shapes). NOT citation-eligible: we cannot verify what
 *                       the provider actually cited, so the run must not enter
 *                       verified denominators as a clean zero.
 * tool_rejected       — the provider rejected the web_search tool at request
 *                       time; degraded to a plain answer. Not eligible.
 * unsupported         — this model performs no web search via Requesty
 *                       (answer-only). Not eligible.
 *
 * Legacy stored value "provider_search" (pre-outcome-model) remains readable
 * in the DB and APIs; it means "search performed, citation count unknown
 * granularity" and stays citation-eligible per its stored flag.
 */
export type SearchStatus =
  | "provider_cited"
  | "search_no_citations"
  | "extraction_failed"
  | "unsupported"
  | "tool_rejected";

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
  /** Annotation `type` values seen that are not url_citation (shape drift signal). */
  unknownAnnotationTypes: string[];
  /** Annotations/web_search entries whose structure carried no recognizable URL. */
  unknownShapes: number;
  /** Grounding-redirect URLs successfully resolved to their real source. */
  redirectsResolved: number;
  /** Grounding-redirect URLs that could not be resolved (kept as provider URL). */
  redirectsFailed: number;
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
  };
}

export interface SimulationOutput {
  answerText: string;
  /** Provider-verified sources only — never URLs parsed from answer prose. */
  sources: VerifiedSource[];
  searchStatus: SearchStatus;
  /** True only when this run legitimately belongs in verified-citation denominators. */
  citationEligible: boolean;
  diagnostics: CitationDiagnostics;
  durationMs: number;
}

// Re-exported so existing callers keep working with the strict registry.
export { resolveModelStrict as resolveModel, UnknownModelError } from "./modelRegistry";

const baseURL = process.env["OPENAI_BASE_URL"];

export function isConfigured(): boolean {
  return Boolean(process.env["OPENAI_API_KEY"]);
}

const SEARCH_INSTRUCTIONS =
  "You are a consumer-facing AI assistant. Answer the user's question exactly as you would for a real user: concise, direct, naming specific products, companies, and websites where relevant. Use web search to ground your answer.";
const ANSWER_ONLY_INSTRUCTIONS =
  "You are a consumer-facing AI assistant. Answer the user's question directly and substantively using your existing knowledge, naming specific products, companies, and websites where relevant. You cannot browse in this run: do not promise to search, browse, look anything up, or answer later. Qualify uncertainty when current information may have changed.";
const ANSWER_ONLY_RETRY_INSTRUCTIONS =
  `${ANSWER_ONLY_INSTRUCTIONS} Your previous response was empty or only promised future research. Return the useful answer itself now.`;

// NOTE: tracked visibility simulations must stay UNPRIMED — never inject
// company profile context here. Editable profile text in the system message
// would steer answers and invalidate metric comparability. Profile context
// belongs only in discovery/analyst workflows (see companyContext.ts).

interface StreamCitation {
  url?: string;
}

/** Shapes Requesty attaches to streamed deltas for web search results. */
export interface SearchDelta {
  web_search?: { content?: { url?: string }[] };
  annotations?: { type?: string; url_citation?: StreamCitation }[];
}

export interface Collector {
  seen: Set<string>;
  sources: VerifiedSource[];
  diagnostics: CitationDiagnostics;
}

export function newCollector(): Collector {
  return { seen: new Set(), sources: [], diagnostics: emptyDiagnostics() };
}

const MAX_UNKNOWN_TYPES = 8;

function collectSource(url: unknown, metadata: unknown, c: Collector): void {
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

/**
 * Extract provider-returned citation metadata from one streamed delta.
 * Pure over the collector so provider fixtures can test it directly.
 * Two shapes exist across families:
 *  - delta.annotations[].url_citation (Perplexity, Anthropic, xAI)
 *  - delta.web_search.content[] (Gemini, xAI)
 * Anything else is recorded as an unknown shape — never guessed at, and
 * never parsed out of answer prose.
 */
export function extractDeltaCitations(delta: SearchDelta, c: Collector): void {
  // Guard the container itself: a non-array annotations payload (object,
  // string, ...) is shape drift, recorded — never iterated, never thrown.
  if (delta.annotations !== undefined && !Array.isArray(delta.annotations)) {
    c.diagnostics.unknownShapes += 1;
    delta = { ...delta, annotations: undefined };
  }
  for (const ann of delta.annotations ?? []) {
    if (!ann || typeof ann !== "object") {
      c.diagnostics.unknownShapes += 1;
      continue;
    }
    if (ann.type === "url_citation") {
      collectSource(ann.url_citation?.url, ann, c);
    } else if (typeof ann.type === "string") {
      // Unknown annotation type: shape drift — record, never fabricate.
      if (
        !c.diagnostics.unknownAnnotationTypes.includes(ann.type) &&
        c.diagnostics.unknownAnnotationTypes.length < MAX_UNKNOWN_TYPES
      ) {
        c.diagnostics.unknownAnnotationTypes.push(ann.type);
      }
    } else {
      c.diagnostics.unknownShapes += 1;
    }
  }
  const content = delta.web_search?.content;
  if (content !== undefined && !Array.isArray(content)) {
    c.diagnostics.unknownShapes += 1;
  } else {
    for (const result of content ?? []) {
      collectSource(result?.url, result, c);
    }
  }
}

export interface StreamResult {
  answerText: string;
  sources: VerifiedSource[];
  diagnostics: CitationDiagnostics;
}

async function streamCompletion(
  client: OpenAI,
  promptText: string,
  model: string,
  withSearch: boolean,
  directRetry = false,
): Promise<StreamResult> {
  const stream = await client.chat.completions.create({
    model,
    messages: [
      {
        role: "system",
        content: withSearch
          ? SEARCH_INSTRUCTIONS
          : directRetry
            ? ANSWER_ONLY_RETRY_INSTRUCTIONS
            : ANSWER_ONLY_INSTRUCTIONS,
      },
      { role: "user", content: promptText },
    ],
    ...(withSearch ? { tools: [{ type: "web_search" } as never] } : {}),
    // Reasoning-capable answer-only models count hidden reasoning against this
    // budget; 1,500 can leave GPT/Kimi with no visible answer. Search-capable
    // runs remain tightly bounded because their providers emit direct answers.
    max_completion_tokens: withSearch ? 1500 : 4000,
    stream: true,
  });

  let answerText = "";
  const collector = newCollector();

  for await (const chunk of stream) {
    const delta = chunk.choices?.[0]?.delta as
      | (typeof chunk.choices[0]["delta"] & SearchDelta)
      | undefined;
    if (!delta) continue;
    if (delta.content) answerText += delta.content;
    extractDeltaCitations(delta, collector);
  }

  const sources = await resolveRedirectSources(
    collector.sources.slice(0, 16),
    collector.diagnostics,
  );
  collector.diagnostics.extracted = sources.length;
  return { answerText, sources, diagnostics: collector.diagnostics };
}

export function isUsableModelAnswer(answerText: string): boolean {
  const normalized = answerText.trim().replace(/\s+/g, " ");
  if (!normalized) return false;
  if (normalized.length > 260) return true;
  return !/^(?:(?:i(?:'|’)ll|i will|let me|i need to|i can|i(?:'|’)m going to)\s+(?:search|browse|look|check|research|find)\b|searching\b)/i.test(
    normalized,
  );
}

class UnusableModelAnswerError extends Error {
  readonly status = 424;

  constructor(model: string, retried = false) {
    super(`${model} returned no substantive answer${retried ? " after one retry" : ""}`);
    this.name = "UnusableModelAnswerError";
  }
}

async function streamAnswerOnlyCompletionWithRetry(
  client: OpenAI,
  promptText: string,
  model: string,
): Promise<StreamResult> {
  const first = await streamCompletion(client, promptText, model, false);
  if (isUsableModelAnswer(first.answerText)) return first;
  const second = await streamCompletion(client, promptText, model, false, true);
  if (isUsableModelAnswer(second.answerText)) return second;
  throw new UnusableModelAnswerError(model, true);
}

const REDIRECT_HOSTS = new Set(["vertexaisearch.cloud.google.com"]);

/**
 * Gemini cites via Google's grounding redirect service rather than the real
 * source URL. Follow each redirect (bounded, in parallel) so citations are
 * attributed to the actual cited domain. The original provider URL is kept
 * inside the citation metadata; unresolvable entries are kept as-is and
 * counted in diagnostics.
 */
async function resolveRedirectSources(
  sources: VerifiedSource[],
  diagnostics: CitationDiagnostics,
): Promise<VerifiedSource[]> {
  const resolved = await Promise.all(
    sources.map(async (s) => {
      if (!s.url) return s;
      let host: string;
      try {
        host = new URL(s.url).hostname.replace(/^www\./, "");
      } catch {
        return s;
      }
      if (!REDIRECT_HOSTS.has(host)) return s;
      try {
        // safeFetch follows redirects manually and validates every hop
        // against private/loopback address space (SSRF guard).
        const { res, finalUrl } = await safeFetch(s.url, {
          method: "GET",
          signal: AbortSignal.timeout(6000),
        });
        // Do not download the body; we only need the final URL.
        await res.body?.cancel();
        const finalHost = new URL(finalUrl).hostname.replace(/^www\./, "");
        if (finalHost && !REDIRECT_HOSTS.has(finalHost)) {
          diagnostics.redirectsResolved += 1;
          return {
            domain: finalHost,
            url: finalUrl,
            metadata: { providerUrl: s.url, resolvedFrom: "grounding_redirect", raw: s.metadata },
          };
        }
        diagnostics.redirectsFailed += 1;
        return s;
      } catch {
        diagnostics.redirectsFailed += 1;
        return s;
      }
    }),
  );
  // Re-dedupe after resolution (different redirects can land on one URL).
  const seen = new Set<string>();
  return resolved.filter((s) => {
    const key = `${s.domain}|${s.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Classify a completed search run into its truthful outcome.
 * Exported for direct unit testing.
 */
export function classifySearchOutcome(d: CitationDiagnostics): {
  searchStatus: SearchStatus;
  citationEligible: boolean;
} {
  if (d.extracted > 0) return { searchStatus: "provider_cited", citationEligible: true };
  if (d.metadataEvents > 0 || d.unknownShapes > 0 || d.unknownAnnotationTypes.length > 0) {
    // Provider streamed citation metadata but none could be verified —
    // never mislabel this as a clean zero-citation search run.
    return { searchStatus: "extraction_failed", citationEligible: false };
  }
  return { searchStatus: "search_no_citations", citationEligible: true };
}

/**
 * Run a test prompt against a real model via Requesty and capture (a) the
 * answer a user would actually receive and (b) the web sources the provider
 * cited while writing it. Nothing is fabricated locally: answers are stored
 * verbatim and only provider-attached citation metadata is recorded.
 * Unknown model ids are rejected (never silently substituted).
 */
export async function runSimulation(
  promptText: string,
  model: string,
): Promise<SimulationOutput> {
  const resolved = resolveModelStrict(model);
  const registryEntry = getModel(resolved);
  const client = new OpenAI({
    apiKey: process.env["OPENAI_API_KEY"],
    ...(baseURL ? { baseURL } : {}),
  });

  const started = Date.now();
  const supportsSearch = registryEntry?.supportsSearch ?? false;

  if (supportsSearch) {
    try {
      const out = await streamCompletion(client, promptText, resolved, true);
      if (!isUsableModelAnswer(out.answerText)) {
        throw new UnusableModelAnswerError(resolved);
      }
      const outcome = classifySearchOutcome(out.diagnostics);
      return {
        answerText: out.answerText,
        // extraction_failed keeps zero verified sources — unverifiable
        // metadata never becomes a citation row.
        sources: outcome.searchStatus === "provider_cited" ? out.sources : [],
        searchStatus: outcome.searchStatus,
        citationEligible: outcome.citationEligible,
        diagnostics: out.diagnostics,
        durationMs: Date.now() - started,
      };
    } catch (err) {
      // If this provider rejects the web_search tool, degrade to a plain
      // answer — recorded honestly as tool_rejected / citation-ineligible.
      const status = (err as { status?: number }).status;
      if (status !== 400 && status !== 404 && status !== 422) throw err;
      const out = await streamAnswerOnlyCompletionWithRetry(client, promptText, resolved);
      return {
        answerText: out.answerText,
        sources: [],
        searchStatus: "tool_rejected",
        citationEligible: false,
        diagnostics: out.diagnostics,
        durationMs: Date.now() - started,
      };
    }
  }
  const out = await streamAnswerOnlyCompletionWithRetry(client, promptText, resolved);
  return {
    answerText: out.answerText,
    sources: [],
    searchStatus: "unsupported",
    citationEligible: false,
    diagnostics: out.diagnostics,
    durationMs: Date.now() - started,
  };
}

/** Exact, case-insensitive brand mention detection with word position. */
export function detectBrandMention(
  answerText: string,
  brandName: string,
): { mentioned: boolean; position: number | null } {
  const normalizedName = brandName.trim();
  if (!normalizedName) return { mentioned: false, position: null };
  const escaped = normalizedName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Avoid substring false positives such as "Acme" in "Acmeology". Lookarounds
  // preserve names containing spaces or punctuation better than wrapping the
  // whole expression in \b (whose behavior is ASCII/word-character based).
  const match = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu").exec(
    answerText,
  );
  if (!match) return { mentioned: false, position: null };
  const idx = match.index;
  const before = answerText.slice(0, idx);
  const position = before.split(/\s+/).filter(Boolean).length + 1;
  return { mentioned: true, position };
}
