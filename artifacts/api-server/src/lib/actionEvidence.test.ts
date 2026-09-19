import { test } from "node:test";
import assert from "node:assert/strict";
import type { GapEvidence } from "@workspace/db";
import {
  pickBestEvidenceRow,
  evidenceFromGapRow,
  evidenceFromProvenanceSnapshot,
  resolveSnapshotExample,
} from "./actionEvidence";
import { SIGNAL_EVIDENCE_SEEDS } from "../data/signalEvidence";
import { ListSignalsResponse } from "@workspace/api-zod";

function row(overrides: Partial<GapEvidence>): GapEvidence {
  return {
    id: 1,
    findingId: 10,
    sourcePageId: null,
    canonicalUrl: "https://example.com/best-tools",
    domain: "example.com",
    channel: "editorial",
    isCompetitor: false,
    citationCount: 3,
    runCount: 2,
    avgPosition: null,
    bestPosition: null,
    models: ["gpt-4o"],
    runIds: [1, 2],
    answerContext: null,
    lastSeenAt: null,
    pageFetchStatus: null,
    pageHttpStatus: null,
    pageTitle: null,
    pageSnippet: null,
    pageSignals: null,
    pageFetchedAt: null,
    ...overrides,
  } as GapEvidence;
}

test("pickBestEvidenceRow returns null for empty input", () => {
  assert.equal(pickBestEvidenceRow([]), null);
});

test("pickBestEvidenceRow prefers competitor-owned rows, then citation count", () => {
  const a = row({ id: 1, citationCount: 9, isCompetitor: false });
  const b = row({ id: 2, citationCount: 2, isCompetitor: true });
  const c = row({ id: 3, citationCount: 5, isCompetitor: true });
  assert.equal(pickBestEvidenceRow([a, b, c])!.id, 3);
  // Without competitors, highest citation count wins.
  const d = row({ id: 4, citationCount: 1 });
  assert.equal(pickBestEvidenceRow([a, d])!.id, 1);
});

test("pickBestEvidenceRow cannot substitute evidence outside the recommendation support", () => {
  const supporting = row({
    id: 5,
    canonicalUrl: "https://example.com/supporting",
    channel: "ugc",
    citationCount: 2,
  });
  const wrongChannel = row({
    id: 6,
    canonicalUrl: "https://example.com/supporting",
    channel: "competitor_owned",
    isCompetitor: true,
    citationCount: 20,
  });
  const wrongUrl = row({
    id: 7,
    canonicalUrl: "https://example.com/decoy",
    channel: "ugc",
    citationCount: 30,
  });
  assert.equal(
    pickBestEvidenceRow([wrongChannel, wrongUrl, supporting], {
      evidenceUrls: ["https://example.com/supporting"],
      channel: "ugc",
    })?.id,
    5,
  );
  assert.equal(
    pickBestEvidenceRow([wrongChannel, wrongUrl], {
      evidenceUrls: ["https://example.com/supporting"],
      channel: "ugc",
    }),
    null,
  );
});

test("evidenceFromGapRow builds an observed, factual evidence value", () => {
  const observedAt = new Date("2026-08-01T00:00:00Z");
  const e = evidenceFromGapRow(
    row({
      domain: "rival.io",
      channel: "competitor_owned",
      isCompetitor: true,
      citationCount: 4,
      runCount: 3,
      models: ["gpt-4o", "claude"],
      answerContext: "Rival is often recommended…",
      lastSeenAt: observedAt,
      pageTitle: "Rival — pricing guide",
    }),
    "Qualified rationale from research.",
  );
  assert.equal(e.company, "rival.io");
  assert.equal(e.evidenceType, "competitor_owned");
  assert.equal(e.confidence, "observed");
  assert.match(e.observation, /cited 4× across 3 stored answer runs/);
  assert.match(e.observation, /gpt-4o, claude/);
  assert.match(e.observation, /Rival is often recommended/);
  assert.equal(e.sourceTitle, "Rival — pricing guide");
  assert.equal(e.sourceUrl, "https://example.com/best-tools");
  assert.equal(e.observedAt, observedAt.toISOString());
  assert.equal(e.rationale, "Qualified rationale from research.");
});

test("evidenceFromGapRow can name the surfaced competitor separately from its source", () => {
  const e = evidenceFromGapRow(
    row({ domain: "publisher.example", channel: "editorial" }),
    "Qualified interpretation.",
    "Surfaced Rival",
  );
  assert.equal(e.company, "Surfaced Rival");
  assert.match(e.observation, /^publisher\.example was cited/);
  assert.equal(e.evidenceType, "editorial");
});

test("evidenceFromGapRow degrades cleanly with sparse rows", () => {
  const e = evidenceFromGapRow(row({ models: [], pageTitle: null }), null);
  assert.equal(e.sourceTitle, "example.com");
  assert.equal(e.observedAt, null);
  assert.equal(e.rationale, null);
  assert.doesNotMatch(e.observation, /on $/);
});

test("an explicit null peer snapshot never falls back to mutable evidence", () => {
  assert.deepEqual(resolveSnapshotExample({ example: null }), {
    isExplicit: true,
    evidence: null,
  });
  assert.deepEqual(resolveSnapshotExample({ rationale: "legacy snapshot" }), {
    isExplicit: false,
    evidence: null,
  });
});

test("legacy provenance cannot turn a high-count decoy row into action evidence", () => {
  const legacySnapshot = {
    rationale: "Historical rationale",
    evidenceUrls: ["https://example.com/supporting"],
    runIds: [1, 2, 3],
  };
  const decoy = row({
    canonicalUrl: "https://example.com/decoy",
    channel: "competitor_owned",
    isCompetitor: true,
    citationCount: 99,
    runCount: 99,
  });

  assert.equal(evidenceFromProvenanceSnapshot(legacySnapshot), null);
  assert.equal(
    evidenceFromProvenanceSnapshot({
      ...legacySnapshot,
      unrelatedEvidence: evidenceFromGapRow(decoy, "Unbound context"),
    }),
    null,
  );
});

test("a one-run peer example remains a factual immutable snapshot", () => {
  const evidence = evidenceFromGapRow(
    row({
      isCompetitor: true,
      channel: "competitor_owned",
      citationCount: 1,
      runCount: 1,
    }),
    "Observed once; no causal claim.",
  );
  const resolved = resolveSnapshotExample({ example: evidence });
  assert.equal(resolved.isExplicit, true);
  assert.equal(resolved.evidence?.evidenceType, "competitor_owned");
  assert.match(resolved.evidence?.observation ?? "", /1 stored answer run\b/);
});

test("curated signal evidence seeds conform to the ActionEvidence contract", () => {
  for (const [name, seed] of Object.entries(SIGNAL_EVIDENCE_SEEDS)) {
    const parsed = ListSignalsResponse.safeParse([
      {
        id: 1,
        name,
        category: "on_page",
        description: "d",
        weight: 3,
        status: "monitor",
        recommendation: null,
        guidance: null,
        evidence: seed,
      },
    ]);
    assert.ok(parsed.success, `seed for "${name}" violates contract: ${parsed.error?.message ?? ""}`);
    // Grounding rules: qualified interpretation must exist separately, and a
    // curated/observed claim must carry a source URL.
    if (seed.confidence !== "hypothesis") {
      assert.ok(seed.sourceUrl, `seed for "${name}" lacks a source URL`);
    }
  }
});
