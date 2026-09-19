import assert from "node:assert/strict";
import test from "node:test";
import type {
  GapEvidenceItem,
  GapResearchFinding,
  Signal,
  StrategyIdea,
} from "@workspace/api-client-react";
import {
  calculateObservedShare,
  getSignalIdeaMapping,
  selectDeploymentFinding,
} from "./actionResearchEvidence";

const mappedSignal = {
  id: 1,
  name: "Reddit and community presence",
  category: "off_page",
  description: "Build useful community participation.",
  recommendation: "Participate where customers ask questions.",
  weight: 4,
  status: "warning",
} as Signal;

function evidence(
  overrides: Partial<GapEvidenceItem> = {},
): GapEvidenceItem {
  return {
    id: 1,
    canonicalUrl: "https://example.com/thread",
    domain: "example.com",
    channel: "ugc",
    isCompetitor: true,
    citationCount: 3,
    runCount: 2,
    models: ["openai/gpt-5"],
    runIds: [1, 2],
    ...overrides,
  };
}

function finding(
  overrides: Partial<GapResearchFinding> = {},
): GapResearchFinding {
  return {
    id: 10,
    promptId: 2,
    promptText: "Which provider should I use?",
    topic: "provider",
    gapType: "full",
    runCount: 10,
    eligibleRunCount: 10,
    mentionCount: 0,
    citationCount: 3,
    modelCoverage: [],
    competitors: [
      {
        domain: "rival.example",
        name: "Rival Example",
        runsSurfaced: 5,
      },
    ],
    recommendation: {
      status: "proposed",
      category: "off_page",
      suggestedIdeaTitle: "Reddit AMA on your money topics",
      evidenceUrls: ["https://example.com/thread"],
    },
    evidence: [evidence()],
    promotion: null,
    ...overrides,
  };
}

test("uses only the strongest exact recommendation-supporting source", () => {
  const weaker = finding({
    id: 11,
    eligibleRunCount: 10,
    evidence: [evidence({ id: 11, domain: "weak.example", runCount: 2 })],
  });
  const stronger = finding({
    id: 12,
    eligibleRunCount: 8,
    evidence: [
      evidence({
        id: 12,
        canonicalUrl: "https://example.com/decoy",
        channel: "competitor_owned",
        runCount: 8,
      }),
      evidence({
        id: 13,
        domain: "strong.example",
        channel: "ugc",
        runCount: 5,
      }),
    ],
  });
  const wrongCategory = finding({
    id: 13,
    recommendation: {
      status: "proposed",
      category: "on_page",
      suggestedIdeaTitle: "Reddit AMA on your money topics",
      evidenceUrls: [],
    },
    evidence: [evidence({ id: 14, runCount: 8 })],
  });

  const match = getSignalIdeaMapping(
    mappedSignal,
    [weaker, wrongCategory, stronger],
    [],
  );

  assert.equal(match.finding?.id, 12);
  assert.equal(match.evidence?.domain, "strong.example");
  assert.equal(match.competitor?.name, "Rival Example");
  assert.equal(match.initialFindingId, 12);
  assert.equal(match.initialIdeaTitle, "Reddit AMA on your money topics");
});

test("uses the server-selected finding for evidence and deployment provenance", () => {
  const higherShare = finding({
    id: 21,
    eligibleRunCount: 5,
    evidence: [evidence({ id: 21, runCount: 4 })],
  });
  const serverSelected = finding({
    id: 22,
    eligibleRunCount: 20,
    evidence: [evidence({ id: 22, runCount: 5 })],
  });
  const match = getSignalIdeaMapping(
    mappedSignal,
    [higherShare, serverSelected],
    [],
    22,
  );
  assert.equal(match.finding?.id, 22);
  assert.equal(match.evidence?.id, 22);
  assert.equal(match.initialFindingId, 22);
});

test("withholds research evidence when the server marks it stale", () => {
  const match = getSignalIdeaMapping(mappedSignal, [finding()], [], null);
  assert.equal(match.finding, null);
  assert.equal(match.evidence, null);
  assert.equal(match.initialFindingId, undefined);
});

test("strict deployment selection never infers a stale or different finding", () => {
  const candidate = finding();
  const idea = {
    title: "Reddit AMA on your money topics",
    category: "off_page",
  } as StrategyIdea;
  assert.equal(
    selectDeploymentFinding([candidate], idea, undefined, false),
    null,
  );
  assert.equal(selectDeploymentFinding([candidate], idea, 999, false), null);
  assert.equal(
    selectDeploymentFinding([candidate], idea, candidate.id, false)?.id,
    candidate.id,
  );
});

test("server-selected evidence can render without inventing a surfaced competitor", () => {
  const exact = finding({ id: 31, competitors: [] });
  const match = getSignalIdeaMapping(mappedSignal, [exact], [], 31);
  assert.equal(match.finding?.id, 31);
  assert.equal(match.competitor, null);
  assert.equal(match.initialFindingId, 31);
});

test("rejects a high-scoring source outside the recommendation URL and channel", () => {
  const unsupported = finding({
    evidence: [
      evidence({
        canonicalUrl: "https://example.com/unrelated",
        channel: "competitor_owned",
        runCount: 9,
      }),
    ],
  });

  const match = getSignalIdeaMapping(mappedSignal, [unsupported], []);

  assert.equal(match.finding, null);
  assert.equal(match.evidence, null);
  assert.equal(match.competitor, null);
  assert.equal(match.initialFindingId, undefined);
});

test("does not attach evidence to an action without an explicit mapping", () => {
  const signal = {
    ...mappedSignal,
    id: 2,
    name: "Crawler access",
    category: "on_page",
  } as Signal;

  const match = getSignalIdeaMapping(signal, [finding()], []);

  assert.equal(match.finding, null);
  assert.equal(match.evidence, null);
  assert.equal(match.mappedTitle, undefined);
  assert.equal(match.initialCustomIdea?.title, "Crawler access");
  assert.equal(match.initialCustomIdea?.category, "on_page");
});

test("reuses an exact existing library idea instead of creating a duplicate", () => {
  const signal = {
    ...mappedSignal,
    id: 3,
    name: "Crawler access",
    category: "on_page",
  } as Signal;
  const idea = {
    id: 91,
    title: "Crawler access",
    category: "on_page",
  } as StrategyIdea;

  const match = getSignalIdeaMapping(signal, [], [idea]);

  assert.equal(match.initialIdeaTitle, "Crawler access");
  assert.equal(match.initialCustomIdea, undefined);
});

test("does not reuse a same-titled idea from the opposite category", () => {
  const signal = {
    ...mappedSignal,
    id: 4,
    name: "Crawler access",
    category: "on_page",
  } as Signal;
  const idea = {
    id: 92,
    title: "Crawler access",
    category: "off_page",
  } as StrategyIdea;

  const match = getSignalIdeaMapping(signal, [], [idea]);

  assert.equal(match.initialIdeaTitle, undefined);
  assert.equal(match.initialCustomIdea?.category, "on_page");
});

test("calculates frequency from observed runs and a valid eligible denominator", () => {
  assert.deepEqual(calculateObservedShare(5, 9), {
    observedRunCount: 5,
    sharePct: 56,
  });
  assert.deepEqual(calculateObservedShare(12, 9), {
    observedRunCount: 9,
    sharePct: 100,
  });
  assert.equal(calculateObservedShare(5, 0), null);
});