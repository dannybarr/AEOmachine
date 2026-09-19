import assert from "node:assert/strict";
import test from "node:test";
import { aggregateModelCitationSources } from "./modelCitationSources";

test("aggregates sources by model, counts repeated retrievals, and deduplicates answer mentions", () => {
  const result = aggregateModelCitationSources([
    { runId: 1, model: "model-a", brandMentioned: true, domain: "a.example", domainType: "editorial", url: "https://a.example/one", position: 1 },
    { runId: 1, model: "model-a", brandMentioned: true, domain: "a.example", domainType: "editorial", url: "https://a.example/one", position: 3 },
    { runId: 2, model: "model-a", brandMentioned: false, domain: "a.example", domainType: "editorial", url: "https://a.example/two", position: 2 },
    { runId: 2, model: "model-a", brandMentioned: false, domain: "b.example", domainType: "ugc", url: null, position: 1 },
    { runId: 3, model: "model-b", brandMentioned: true, domain: "a.example", domainType: "editorial", url: "https://a.example/one", position: 4 },
  ]);

  assert.deepEqual(result.get("model-a"), [
    {
      domain: "a.example",
      domainType: "editorial",
      topUrl: "https://a.example/one",
      retrievals: 3,
      sharePct: 75,
      avgPosition: 2,
      associatedAnswers: 2,
      businessMentionedAnswers: 1,
      businessMentionRatePct: 50,
    },
    {
      domain: "b.example",
      domainType: "ugc",
      topUrl: null,
      retrievals: 1,
      sharePct: 25,
      avgPosition: 1,
      associatedAnswers: 1,
      businessMentionedAnswers: 0,
      businessMentionRatePct: 0,
    },
  ]);
  assert.equal(result.get("model-b")?.[0]?.retrievals, 1);
  assert.equal(result.has("model-c"), false);
});

test("uses deterministic ranking and representative URL tie-breaking", () => {
  const result = aggregateModelCitationSources([
    { runId: 1, model: "m", brandMentioned: false, domain: "z.example", domainType: "other", url: "https://z.example/b", position: 2 },
    { runId: 2, model: "m", brandMentioned: false, domain: "z.example", domainType: "other", url: "https://z.example/a", position: 2 },
    { runId: 3, model: "m", brandMentioned: false, domain: "a.example", domainType: "other", url: null, position: 2 },
    { runId: 4, model: "m", brandMentioned: false, domain: "a.example", domainType: "other", url: null, position: 2 },
  ]);
  assert.equal(result.get("m")?.[0]?.domain, "a.example");
  assert.equal(result.get("m")?.[1]?.topUrl, "https://z.example/a");
});