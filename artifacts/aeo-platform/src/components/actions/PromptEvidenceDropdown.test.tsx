import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  GapEvidenceItem,
  GapResearchFinding,
} from "@workspace/api-client-react";
import { PromptEvidenceDropdown } from "./PromptEvidenceDropdown";

test("renders verified source evidence without inventing a surfaced competitor", () => {
  const finding = {
    id: 44,
    promptId: 9,
    promptText: "Which monitoring source should an agency trust?",
    topic: "Sources",
    gapType: "full",
    runCount: 5,
    eligibleRunCount: 5,
    mentionCount: 0,
    citationCount: 3,
    modelCoverage: [],
    competitors: [],
    recommendation: {
      status: "proposed",
      category: "off_page",
      suggestedIdeaTitle: "Reddit AMA on your money topics",
      evidenceUrls: ["https://source.example/thread"],
      rationale: "A community source was repeatedly cited for this prompt.",
    },
    evidence: [],
    promotion: null,
  } as GapResearchFinding;
  const evidence = {
    id: 51,
    canonicalUrl: "https://source.example/thread",
    domain: "source.example",
    channel: "ugc",
    isCompetitor: false,
    citationCount: 3,
    runCount: 3,
    models: ["perplexity/sonar"],
    runIds: [1, 2, 3],
    page: { title: "Independent community discussion" },
  } as GapEvidenceItem;

  const html = renderToStaticMarkup(
    <PromptEvidenceDropdown
      signalId={7}
      finding={finding}
      evidence={evidence}
      competitor={null}
      mappedTitle="Reddit AMA on your money topics"
      researchLoading={false}
      researchError={false}
      hasResearchSnapshot
      defaultOpen
    />,
  );

  assert.match(html, /Observed supporting source/);
  assert.match(html, /Independent community discussion/);
  assert.match(html, /Which monitoring source should an agency trust/);
  assert.match(html, /does not identify a surfaced company/);
  assert.doesNotMatch(html, /No exact competitor precedent/);
  assert.doesNotMatch(html, />surfaced company</);
});