import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Company, Prompt, Signal } from "@workspace/db";
import { buildActionRecommendation } from "./actionRecommendations";

const company = {
  id: 7,
  name: "Acme",
  domain: "acme.example",
  industry: "B2B software",
  objective: "Win more agency customers",
  targetAudience: "Independent agencies",
  productsServices: "Citation monitoring software",
  positioning: null,
  geography: "United Kingdom",
  notes: null,
  profileUpdatedAt: null,
  autoTrackDaily: false,
  createdAt: new Date(),
} satisfies Company;

const signal = {
  id: 1,
  name: "Editorial coverage and listicles",
  category: "off_page",
  description: "old generic claim",
  weight: 86,
  status: "critical",
  recommendation: "old generic action",
  evidence: null,
} satisfies Signal;

const prompts = [
  {
    id: 11,
    companyId: company.id,
    moneyTopicId: null,
    text: "What are the best citation monitoring platforms for agencies?",
    topic: "Commercial comparison",
    tags: [],
    models: [],
    active: true,
    createdAt: new Date(),
  },
] satisfies Prompt[];

describe("company-grounded action recommendations", () => {
  it("separates general practice from contextual fit without inventing research", () => {
    const result = buildActionRecommendation(signal, company, prompts, null);
    assert.equal(result.guidance.basis, "company_context");
    assert.equal(result.guidance.evidenceLevel, "conditional_practice");
    assert.match(result.guidance.companyRationale ?? "", new RegExp(prompts[0]!.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(result.guidance.nextStep, /Citation monitoring software/);
    assert.match(
      result.guidance.companyRationale ?? "",
      /not evidence that the action has already improved/,
    );
    assert.notEqual(result.recommendation, signal.recommendation);
    assert.ok(result.weight <= 5);
  });

  it("uses an exact verified finding as the strongest basis and qualifies causality", () => {
    const result = buildActionRecommendation(signal, company, prompts, {
      findingId: 99,
      promptId: prompts[0]!.id,
      promptText: prompts[0]!.text,
      topic: prompts[0]!.topic,
      competitorName: "Rival",
      observedAt: "2026-08-30T10:00:00.000Z",
      isFresh: true,
      staleReason: null,
    });
    assert.equal(result.guidance.basis, "verified_research");
    assert.equal(result.guidance.evidenceLevel, "verified_observation");
    assert.equal(result.guidance.findingId, 99);
    assert.match(result.guidance.companyRationale ?? "", /Rival surfaced/);
    assert.match(result.guidance.companyRationale ?? "", /does not prove/);
    assert.equal(result.weight, 5);
    assert.equal(result.status, "research gap");
  });

  it("does not call unrelated profile-only templating company fit", () => {
    const result = buildActionRecommendation(
      { ...signal, name: "Wikipedia and reference presence" },
      company,
      [],
      null,
    );
    assert.equal(result.guidance.basis, "general_strategy");
    assert.equal(result.guidance.companyRationale, null);
    assert.equal(result.status, "foundation");
  });

  it("downgrades stale findings and withholds their finding id", () => {
    const result = buildActionRecommendation(signal, company, prompts, {
      findingId: 99,
      promptId: prompts[0]!.id,
      promptText: prompts[0]!.text,
      topic: prompts[0]!.topic,
      competitorName: "Rival",
      observedAt: "2026-01-01T10:00:00.000Z",
      isFresh: false,
      staleReason: "newer eligible tracking runs are available",
    });
    assert.equal(result.guidance.basis, "research_refresh_needed");
    assert.equal(result.guidance.evidenceLevel, "historical_observation");
    assert.equal(result.guidance.findingId, null);
    assert.match(result.guidance.companyRationale ?? "", /Refresh research/);
    assert.equal(result.status, "refresh research");
  });

  it("labels llms.txt as experimental rather than a proven ranking factor", () => {
    const llmsSignal = { ...signal, name: "llms.txt file" };
    const result = buildActionRecommendation(
      llmsSignal,
      {
        ...company,
        productsServices: null,
        objective: null,
        targetAudience: null,
        industry: null,
        geography: null,
      },
      [],
      null,
    );
    assert.equal(result.guidance.basis, "general_strategy");
    assert.equal(result.guidance.evidenceLevel, "experimental");
    assert.match(
      result.guidance.generalPrinciple,
      /not a proven ranking/,
    );
    assert.equal(result.status, "test");
  });
});