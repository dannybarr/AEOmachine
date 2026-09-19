import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Mocked end-to-end stream tests for runSimulation: every truthful outcome
 * state, provider response-shape drift, tool rejection fallback, redirect
 * resolution, and error propagation — no live provider calls.
 */

interface FakeChunk {
  choices?: Array<{ delta?: Record<string, unknown>; message?: Record<string, unknown> }>;
  citations?: unknown;
  search_results?: unknown;
}

// Script of behaviors consumed by successive client.chat.completions.create calls.
type CreateBehavior =
  | { kind: "stream"; chunks: FakeChunk[] }
  | { kind: "error"; status?: number; message?: string };

const script: CreateBehavior[] = [];
const createCalls: Array<Record<string, unknown>> = [];

vi.mock("openai", () => {
  class FakeOpenAI {
    chat = {
      completions: {
        create: async (args: Record<string, unknown>) => {
          createCalls.push(args);
          const behavior = script.shift();
          if (!behavior) throw new Error("test script exhausted");
          if (behavior.kind === "error") {
            const err = new Error(behavior.message ?? "provider error") as Error & {
              status?: number;
            };
            err.status = behavior.status;
            throw err;
          }
          return (async function* () {
            for (const chunk of behavior.chunks) yield chunk;
          })();
        },
      },
    };
  }
  return { default: FakeOpenAI };
});

const safeFetchMock = vi.fn();
vi.mock("../safeFetch", () => ({
  safeFetch: (...args: unknown[]) => safeFetchMock(...args),
}));

import { isUsableModelAnswer, runSimulation } from "../simulate";
import { enabledModels } from "../modelRegistry";

const SEARCH_MODEL = "perplexity/sonar";
const NO_SEARCH_MODEL = "moonshot/kimi-k3";

function textChunk(content: string): FakeChunk {
  return { choices: [{ delta: { content } }] };
}

beforeEach(() => {
  script.length = 0;
  createCalls.length = 0;
  safeFetchMock.mockReset();
});

describe("runSimulation outcome states (mocked streams)", () => {
  it("provider_cited: search + verified metadata, verbatim answer, provider order preserved", async () => {
    script.push({
      kind: "stream",
      chunks: [
        textChunk("Answer "),
        {
          choices: [
            {
              delta: {
                content: "text.",
                annotations: [
                  { type: "url_citation", url_citation: { url: "https://b.example/two" } },
                ],
              },
            },
          ],
        },
        {
          choices: [
            {
              delta: {
                web_search: { content: [{ url: "https://a.example/one" }] },
              },
            },
          ],
        },
      ],
    });
    const out = await runSimulation("test prompt", SEARCH_MODEL);
    expect(out.searchStatus).toBe("provider_cited");
    expect(out.citationEligible).toBe(true);
    expect(out.answerText).toBe("Answer text.");
    expect(out.sources.map((s) => s.url)).toEqual([
      "https://b.example/two",
      "https://a.example/one",
    ]);
    expect(out.diagnostics.extracted).toBe(2);
    // Search tool was requested and output is bounded (cost control).
    expect(createCalls[0]!["tools"]).toEqual([{ type: "web_search" }]);
    expect(createCalls[0]!["max_completion_tokens"]).toBe(1500);
  });

  it("search_no_citations: tool accepted, zero citation metadata — stays citation-eligible", async () => {
    script.push({ kind: "stream", chunks: [textChunk("No sources here.")] });
    const out = await runSimulation("p", SEARCH_MODEL);
    expect(out.searchStatus).toBe("search_no_citations");
    expect(out.citationEligible).toBe(true);
    expect(out.sources).toHaveLength(0);
    expect(out.diagnostics.metadataEvents).toBe(0);
  });

  it("does not duplicate a paid search when the provider returns no answer", async () => {
    script.push({ kind: "stream", chunks: [] });
    await expect(runSimulation("p", SEARCH_MODEL)).rejects.toThrow(
      "returned no substantive answer",
    );
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0]!["tools"]).toEqual([{ type: "web_search" }]);
  });

  it("extraction_failed: metadata present but all malformed — ineligible, zero sources", async () => {
    script.push({
      kind: "stream",
      chunks: [
        {
          choices: [
            {
              delta: {
                content: "x",
                annotations: [
                  { type: "url_citation", url_citation: { url: "javascript:alert(1)" } },
                ],
              },
            },
          ],
        },
      ],
    });
    const out = await runSimulation("p", SEARCH_MODEL);
    expect(out.searchStatus).toBe("extraction_failed");
    expect(out.citationEligible).toBe(false);
    expect(out.sources).toHaveLength(0);
    expect(out.diagnostics.invalidUrls).toBe(1);
  });

  it("extraction_failed: unknown annotation types (response-shape drift) are recorded, never guessed", async () => {
    script.push({
      kind: "stream",
      chunks: [
        textChunk("Answer."),
        { choices: [{ delta: { annotations: [{ type: "grounding_v2", data: { u: "https://x.y/z" } }] } }] },
      ],
    });
    const out = await runSimulation("p", SEARCH_MODEL);
    expect(out.searchStatus).toBe("extraction_failed");
    expect(out.sources).toHaveLength(0);
    expect(out.diagnostics.unknownAnnotationTypes).toEqual(["grounding_v2"]);
  });

  it("extraction_failed: non-array annotations payloads never throw — the run completes with diagnostics", async () => {
    script.push({
      kind: "stream",
      chunks: [
        { choices: [{ delta: { content: "hi", annotations: { type: "url_citation" } } }] },
        { choices: [{ delta: { annotations: "some citation text" } }] },
      ],
    });
    const out = await runSimulation("p", SEARCH_MODEL);
    expect(out.searchStatus).toBe("extraction_failed");
    expect(out.citationEligible).toBe(false);
    expect(out.answerText).toBe("hi");
    expect(out.sources).toHaveLength(0);
    expect(out.diagnostics.unknownShapes).toBe(2);
  });

  it("tool_rejected: 400 on the search request falls back to a plain answer, honestly labeled", async () => {
    script.push({ kind: "error", status: 400, message: "web_search tool not supported" });
    script.push({ kind: "stream", chunks: [textChunk("Plain answer.")] });
    const out = await runSimulation("p", SEARCH_MODEL);
    expect(out.searchStatus).toBe("tool_rejected");
    expect(out.citationEligible).toBe(false);
    expect(out.answerText).toBe("Plain answer.");
    expect(out.sources).toHaveLength(0);
    // Fallback request must not carry the tool.
    expect(createCalls[1]!["tools"]).toBeUndefined();
  });

  it("retryable failures (429/5xx/network) are rethrown, never mislabeled as tool rejection", async () => {
    script.push({ kind: "error", status: 429, message: "rate limited" });
    await expect(runSimulation("p", SEARCH_MODEL)).rejects.toThrow("rate limited");
    script.push({ kind: "error", status: 503, message: "upstream down" });
    await expect(runSimulation("p", SEARCH_MODEL)).rejects.toThrow("upstream down");
  });

  it("unsupported: no-search model never receives the tool and is citation-ineligible", async () => {
    script.push({ kind: "stream", chunks: [textChunk("Answer only.")] });
    const out = await runSimulation("p", NO_SEARCH_MODEL);
    expect(out.searchStatus).toBe("unsupported");
    expect(out.citationEligible).toBe(false);
    expect(createCalls[0]!["tools"]).toBeUndefined();
    expect(createCalls[0]!["max_completion_tokens"]).toBe(4000);
    const messages = createCalls[0]!["messages"] as Array<{ content: string }>;
    expect(messages[0]?.content).toContain("cannot browse");
    expect(messages[0]?.content).not.toContain("Use web search");
  });

  it("retries empty answer-only streams once with a direct-answer correction", async () => {
    script.push({ kind: "stream", chunks: [] });
    script.push({ kind: "stream", chunks: [textChunk("A substantive answer with named options.")] });
    const out = await runSimulation("p", NO_SEARCH_MODEL);
    expect(out.answerText).toBe("A substantive answer with named options.");
    expect(createCalls).toHaveLength(2);
    const retryMessages = createCalls[1]!["messages"] as Array<{ content: string }>;
    expect(retryMessages[0]?.content).toContain("previous response was empty");
  });

  it("retries a short future-search placeholder and rejects two unusable attempts", async () => {
    expect(
      isUsableModelAnswer("I'll search for current information to give you an accurate answer."),
    ).toBe(false);
    script.push({
      kind: "stream",
      chunks: [textChunk("I'll search for current information to give you an accurate answer.")],
    });
    script.push({ kind: "stream", chunks: [textChunk("Let me look that up first.")] });
    await expect(runSimulation("p", NO_SEARCH_MODEL)).rejects.toThrow(
      "returned no substantive answer after one retry",
    );
  });

  it("resolves Google grounding redirects to the real cited domain and records resolution", async () => {
    script.push({
      kind: "stream",
      chunks: [
        textChunk("Answer."),
        {
          choices: [
            {
              delta: {
                web_search: {
                  content: [{ url: "https://vertexaisearch.cloud.google.com/grounding/abc" }],
                },
              },
            },
          ],
        },
      ],
    });
    safeFetchMock.mockResolvedValue({
      res: { body: { cancel: async () => undefined }, status: 200 },
      finalUrl: "https://www.realsource.org/article",
    });
    const out = await runSimulation("p", SEARCH_MODEL);
    expect(out.searchStatus).toBe("provider_cited");
    expect(out.sources[0]).toMatchObject({
      domain: "realsource.org",
      url: "https://www.realsource.org/article",
    });
    expect(out.sources[0]!.metadata).toMatchObject({ resolvedFrom: "grounding_redirect" });
    expect(out.diagnostics.redirectsResolved).toBe(1);
  });

  it("keeps the provider URL when redirect resolution fails (honest failure, counted)", async () => {
    script.push({
      kind: "stream",
      chunks: [
        textChunk("Answer."),
        {
          choices: [
            {
              delta: {
                web_search: {
                  content: [{ url: "https://vertexaisearch.cloud.google.com/grounding/dead" }],
                },
              },
            },
          ],
        },
      ],
    });
    safeFetchMock.mockRejectedValue(new Error("unresolvable"));
    const out = await runSimulation("p", SEARCH_MODEL);
    expect(out.sources[0]!.domain).toBe("vertexaisearch.cloud.google.com");
    expect(out.diagnostics.redirectsFailed).toBe(1);
  });

  it("a truncated stream (no terminal chunk) still yields an honest partial answer", async () => {
    script.push({
      kind: "stream",
      chunks: [textChunk("Partial ans")], // stream ends mid-answer
    });
    const out = await runSimulation("p", SEARCH_MODEL);
    expect(out.answerText).toBe("Partial ans");
    expect(out.searchStatus).toBe("search_no_citations");
  });

  it("captures Perplexity-style root citations on a trailing empty-choices chunk", async () => {
    script.push({
      kind: "stream",
      chunks: [
        textChunk("Rates from Bankrate."),
        {
          citations: ["https://www.bankrate.com/banking/savings/"],
          choices: [],
        },
      ],
    });
    const out = await runSimulation("p", SEARCH_MODEL);
    expect(out.searchStatus).toBe("provider_cited");
    expect(out.citationEligible).toBe(true);
    expect(out.sources.map((s) => s.domain)).toEqual(["bankrate.com"]);
    expect(out.diagnostics.observedShapes).toContain("chunk.citations");
  });

  it("captures Responses-style flat annotation URLs on the delta", async () => {
    script.push({
      kind: "stream",
      chunks: [
        {
          choices: [
            {
              delta: {
                content: "Cited.",
                annotations: [{ type: "url_citation", url: "https://example.com/ai-news" }],
              },
            },
          ],
        },
      ],
    });
    const out = await runSimulation("p", SEARCH_MODEL);
    expect(out.searchStatus).toBe("provider_cited");
    expect(out.sources[0]!.url).toBe("https://example.com/ai-news");
  });

  it("covers every enabled registry model with an explicit outcome (default coverage regression)", async () => {
    for (const m of enabledModels()) {
      script.push({ kind: "stream", chunks: [textChunk("a")] });
      const out = await runSimulation("p", m.id);
      if (m.supportsSearch) {
        expect(out.searchStatus).toBe("search_no_citations");
        expect(out.citationEligible).toBe(true);
      } else {
        expect(out.searchStatus).toBe("unsupported");
        expect(out.citationEligible).toBe(false);
      }
    }
  });
});
