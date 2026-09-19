import { describe, it, expect } from "vitest";
import {
  detectBrandMention,
  extractDeltaCitations,
  extractChunkCitations,
  classifySearchOutcome,
  newCollector,
  emptyDiagnostics,
  type SearchDelta,
  type Collector,
} from "../simulate";
import {
  resolveModelStrict,
  UnknownModelError,
  getRegistry,
  enabledModels,
} from "../modelRegistry";

function run(deltas: SearchDelta[]): Collector {
  const c = newCollector();
  for (const d of deltas) extractDeltaCitations(d, c);
  c.diagnostics.extracted = c.sources.length;
  return c;
}

describe("extractDeltaCitations (provider response fixtures)", () => {
  it("extracts url_citation annotations (Perplexity/Anthropic shape)", () => {
    const c = run([
      {
        annotations: [
          { type: "url_citation", url_citation: { url: "https://www.example.com/a" } },
          { type: "url_citation", url_citation: { url: "https://docs.foo.io/b" } },
        ],
      },
    ]);
    expect(c.sources.map((s) => s.domain)).toEqual(["example.com", "docs.foo.io"]);
    expect(c.sources[0]!.metadata).toMatchObject({ type: "url_citation" });
    expect(c.diagnostics.metadataEvents).toBe(2);
    expect(c.diagnostics.invalidUrls).toBe(0);
  });

  it("extracts web_search.content results (Gemini shape)", () => {
    const c = run([{ web_search: { content: [{ url: "https://news.site.com/story" }] } }]);
    expect(c.sources).toHaveLength(1);
    expect(c.sources[0]!.domain).toBe("news.site.com");
  });

  it("handles the xAI shape carrying BOTH annotation and web_search metadata, deduped, provider order preserved", () => {
    const c = run([
      {
        annotations: [{ type: "url_citation", url_citation: { url: "https://x.example/one" } }],
        web_search: { content: [{ url: "https://x.example/one" }, { url: "https://y.example/two" }] },
      },
    ]);
    expect(c.sources.map((s) => s.url)).toEqual(["https://x.example/one", "https://y.example/two"]);
    expect(c.diagnostics.metadataEvents).toBe(3); // duplicates still counted as events
  });

  it("emits NO source for malformed or non-http(s) URLs, counting them as invalid", () => {
    const c = run([
      {
        annotations: [
          { type: "url_citation", url_citation: { url: "not a url" } },
          { type: "url_citation", url_citation: { url: "javascript:alert(1)" } },
          { type: "url_citation", url_citation: { url: "data:text/html,<script>1</script>" } },
          { type: "url_citation", url_citation: { url: "mailto:a@b.com" } },
        ],
        web_search: { content: [{ url: "javascript:alert(1)" }, { url: "ftp://files.example.com/x" }] },
      },
    ]);
    expect(c.sources).toHaveLength(0);
    expect(c.diagnostics.invalidUrls).toBe(6);
  });

  it("records unknown annotation types and structureless entries as shape drift, never fabricating citations", () => {
    const c = run([
      {
        annotations: [
          { type: "file_citation" },
          { type: "file_citation" }, // repeats collapse
          { type: "grounding_v2" },
          {} as never, // annotation with no type
          { type: "url_citation" }, // url_citation missing url payload
        ],
        web_search: { content: [{}] }, // entry with no url
      },
    ]);
    expect(c.sources).toHaveLength(0);
    expect(c.diagnostics.unknownAnnotationTypes).toEqual(["file_citation", "grounding_v2"]);
    // no-type annotation + missing-url citation + missing-url web_search entry
    expect(c.diagnostics.unknownShapes).toBe(3);
  });

  it("records non-array annotations payloads (object/string/null) as unknown shapes without throwing", () => {
    const c = run([
      { annotations: { type: "url_citation" } as never },
      { annotations: "citation text" as never },
      { annotations: null as never },
    ]);
    expect(c.sources).toHaveLength(0);
    // object + string count as drift; null is treated as absent by ?? — but
    // must still never throw.
    expect(c.diagnostics.unknownShapes).toBe(3);
  });

  it("records a non-array web_search.content as an unknown shape", () => {
    const c = run([{ web_search: { content: { url: "https://a.b/c" } as never } }]);
    expect(c.sources).toHaveLength(0);
    expect(c.diagnostics.unknownShapes).toBe(1);
  });

  it("still accepts plain http URLs with a host", () => {
    const c = run([{ web_search: { content: [{ url: "http://example.org/page" }] } }]);
    expect(c.sources.map((s) => s.domain)).toEqual(["example.org"]);
  });

  it("returns zero sources and zero events for a plain answer (honest zero-citation state)", () => {
    const c = run([{}, { annotations: [] }]);
    expect(c.sources).toHaveLength(0);
    expect(c.diagnostics.metadataEvents).toBe(0);
    expect(c.diagnostics.unknownShapes).toBe(0);
  });

  it("never scrapes URLs out of answer prose", () => {
    const c = run([{ content: "Read https://evil.example/page and www.also-evil.test/x" } as SearchDelta]);
    expect(c.sources).toHaveLength(0);
    expect(c.diagnostics.metadataEvents).toBe(0);
  });
});

describe("extractChunkCitations (Requesty / provider stream fixtures)", () => {
  function runChunks(chunks: unknown[]): Collector {
    const c = newCollector();
    for (const chunk of chunks) extractChunkCitations(chunk, c);
    c.diagnostics.extracted = c.sources.length;
    return c;
  }

  it("extracts Requesty Chat Completions web_search.content", async () => {
    const { requestyChatCompletionsWebSearchChunk } = await import("./fixtures/requesty-citation-chunks");
    const c = runChunks([requestyChatCompletionsWebSearchChunk]);
    expect(c.sources.map((s) => s.url)).toEqual(["https://example.com/news"]);
    expect(c.diagnostics.observedShapes).toContain("delta.web_search.content");
  });

  it("extracts Responses-style flat url_citation.url annotations", async () => {
    const { requestyResponsesStyleAnnotationChunk } = await import("./fixtures/requesty-citation-chunks");
    const c = runChunks([requestyResponsesStyleAnnotationChunk]);
    expect(c.sources.map((s) => s.url)).toEqual(["https://example.com/ai-news"]);
    expect(c.diagnostics.observedShapes).toContain("delta.annotations.url");
  });

  it("extracts nested url_citation payloads", async () => {
    const { nestedUrlCitationChunk } = await import("./fixtures/requesty-citation-chunks");
    const c = runChunks([nestedUrlCitationChunk]);
    expect(c.sources.map((s) => s.domain)).toEqual(["example.com"]);
  });

  it("extracts Perplexity-style root citations on a terminal empty-delta chunk", async () => {
    const { perplexityRootCitationsChunk } = await import("./fixtures/requesty-citation-chunks");
    const c = runChunks([perplexityRootCitationsChunk]);
    expect(c.sources.map((s) => s.domain)).toEqual(["bankrate.com", "nerdwallet.com"]);
    expect(c.diagnostics.observedShapes).toEqual(
      expect.arrayContaining(["chunk.citations", "chunk.search_results"]),
    );
  });

  it("extracts citations from a trailing chunk with empty choices", async () => {
    const { citationsOnEmptyChoicesChunk } = await import("./fixtures/requesty-citation-chunks");
    const c = runChunks([citationsOnEmptyChoicesChunk]);
    expect(c.sources).toHaveLength(1);
    expect(c.sources[0]!.domain).toBe("docs.perplexity.ai");
  });

  it("extracts non-delta message.annotations", async () => {
    const { messageAnnotationsChunk } = await import("./fixtures/requesty-citation-chunks");
    const c = runChunks([messageAnnotationsChunk]);
    expect(c.sources.map((s) => s.domain)).toEqual(["ft.com"]);
    expect(c.diagnostics.seenCitationKeys).toContain("message.annotations");
  });

  it("extracts Gemini grounding_metadata.web.uri and records bare type:annotation as drift", async () => {
    const { geminiGroundingMetadataChunk } = await import("./fixtures/requesty-citation-chunks");
    const c = runChunks([geminiGroundingMetadataChunk]);
    expect(c.sources.map((s) => s.domain)).toEqual(["moneyhelper.org.uk"]);
    expect(c.diagnostics.unknownAnnotationTypes).toEqual(["annotation"]);
    expect(c.diagnostics.extracted).toBe(1);
  });

  it("extracts web_search content uri aliases", async () => {
    const { geminiWebSearchUriChunk } = await import("./fixtures/requesty-citation-chunks");
    const c = runChunks([geminiWebSearchUriChunk]);
    expect(c.sources[0]!.domain).toBe("vertexaisearch.cloud.google.com");
  });

  it("extracts Anthropic web_search_result_location annotations", async () => {
    const { anthropicWebSearchResultLocationChunk } = await import("./fixtures/requesty-citation-chunks");
    const c = runChunks([anthropicWebSearchResultLocationChunk]);
    expect(c.sources.map((s) => s.url)).toEqual(["https://example.com/ai-news"]);
  });

  it("extracts xAI dual shapes with dedupe", async () => {
    const { xaiDualShapeChunk } = await import("./fixtures/requesty-citation-chunks");
    const c = runChunks([xaiDualShapeChunk]);
    expect(c.sources.map((s) => s.url)).toEqual(["https://x.example/one", "https://y.example/two"]);
  });

  it("extracts annotations nested on array content parts", async () => {
    const { contentPartAnnotationsChunk } = await import("./fixtures/requesty-citation-chunks");
    const c = runChunks([contentPartAnnotationsChunk]);
    expect(c.sources.map((s) => s.domain)).toEqual(["bankofengland.co.uk"]);
  });

  it("extracts web_search.results alias", async () => {
    const { webSearchResultsAliasChunk } = await import("./fixtures/requesty-citation-chunks");
    const c = runChunks([webSearchResultsAliasChunk]);
    expect(c.sources.map((s) => s.domain)).toEqual(["which.co.uk"]);
    expect(c.diagnostics.observedShapes).toContain("delta.web_search.results");
  });
});

describe("classifySearchOutcome (truthful outcome model)", () => {
  it("labels runs with extracted citations provider_cited and eligible", () => {
    const d = { ...emptyDiagnostics(), metadataEvents: 3, extracted: 3 };
    expect(classifySearchOutcome(d)).toEqual({
      searchStatus: "provider_cited",
      citationEligible: true,
    });
  });

  it("labels a metadata-free search run search_no_citations and KEEPS it eligible (honest zero)", () => {
    expect(classifySearchOutcome(emptyDiagnostics())).toEqual({
      searchStatus: "search_no_citations",
      citationEligible: true,
    });
  });

  it("labels metadata-present-but-unverifiable runs extraction_failed and INELIGIBLE (never a clean zero)", () => {
    const d = { ...emptyDiagnostics(), metadataEvents: 2, invalidUrls: 2, extracted: 0 };
    expect(classifySearchOutcome(d)).toEqual({
      searchStatus: "extraction_failed",
      citationEligible: false,
    });
  });

  it("treats unknown annotation types alone as extraction failure, not a verified zero", () => {
    const d = { ...emptyDiagnostics(), unknownAnnotationTypes: ["grounding_v2"] };
    expect(classifySearchOutcome(d).searchStatus).toBe("extraction_failed");
  });

  it("treats unknown shapes alone as extraction failure", () => {
    const d = { ...emptyDiagnostics(), unknownShapes: 1 };
    expect(classifySearchOutcome(d).searchStatus).toBe("extraction_failed");
  });
});

describe("detectBrandMention", () => {
  it("matches a complete company name case-insensitively", () => {
    expect(detectBrandMention("Try ACME Labs for this.", "Acme Labs")).toEqual({
      mentioned: true,
      position: 2,
    });
  });

  it("does not count a brand embedded inside another word", () => {
    expect(detectBrandMention("Acmeology is unrelated.", "Acme")).toEqual({
      mentioned: false,
      position: null,
    });
  });

  it("treats regex punctuation in a company name literally", () => {
    expect(detectBrandMention("One option is A.C.M.E. (Europe).", "A.C.M.E.")).toEqual({
      mentioned: true,
      position: 4,
    });
  });
});

describe("model registry strictness & capability contract", () => {
  it("normalizes legacy un-prefixed ids", () => {
    expect(resolveModelStrict("gpt-5")).toBe("openai/gpt-5");
    expect(resolveModelStrict("gpt-5-mini")).toBe("openai/gpt-5-mini");
  });

  it("accepts canonical registry ids unchanged", () => {
    expect(resolveModelStrict("perplexity/sonar")).toBe("perplexity/sonar");
  });

  it("rejects unknown model ids instead of silently falling back", () => {
    expect(() => resolveModelStrict("openai/gpt-99")).toThrow(UnknownModelError);
    expect(() => resolveModelStrict("")).toThrow(UnknownModelError);
  });

  it("covers all seven requested providers in stable order", () => {
    const providers = new Set(getRegistry().map((m) => m.provider));
    for (const p of ["OpenAI", "Anthropic", "Google", "Perplexity", "xAI", "Moonshot", "Meta"]) {
      expect(providers.has(p)).toBe(true);
    }
    const orders = getRegistry().map((m) => m.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  it("every registry model declares an explicit, consistent capability contract", () => {
    for (const m of getRegistry()) {
      // Availability and fallback behavior must be explicit.
      expect(typeof m.supportsSearch).toBe("boolean");
      expect(typeof m.available).toBe("boolean");
      if (!m.available) expect(m.unavailableReason).toBeTruthy();
      // Extraction mode must match search capability: search-capable models
      // extract from streamed metadata; the rest declare no extraction.
      expect(m.extraction).toBe(m.supportsSearch ? "streamed_metadata" : "none");
    }
  });

  it("search-unsupported models are flagged citation-ineligible via supportsSearch=false", () => {
    const noSearch = enabledModels().filter((m) => !m.supportsSearch).map((m) => m.id);
    expect(noSearch).toContain("moonshot/kimi-k3");
    expect(noSearch).toContain("deepinfra/meta-llama/Llama-3.3-70B-Instruct");
  });
});
