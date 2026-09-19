import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findApprovedAuditQuickWin,
  serializeStoredAudit,
} from "./auditSerialization";
import { type WebsiteAuditFinding } from "@workspace/db";

test("legacy audits remain reusable after grouped evidence contract upgrade", () => {
  const serialized = serializeStoredAudit({
    id: 1,
    jobId: 2,
    companyId: 3,
    auditVersion: "1.0",
    context: {},
    score: 70,
    categoryScores: { metadata: 72 },
    categoryNarratives: {},
    counts: { findings: 1 },
    pagesScanned: 1,
    methodology: ["legacy"],
    findings: [{
      id: "old",
      code: "metadata.missing_title",
      category: "metadata",
      severity: "high",
      title: "Missing title",
      explanation: "Missing.",
      evidence: "No title.",
      pageUrl: "https://example.com/",
      recommendation: "Add title.",
      effort: "low",
      impact: "high",
    }],
    quickWins: [
      {
        code: "add-list-content",
        title: "Add useful lists",
        recommendation: "Add semantic lists where useful.",
        evidence: "No lists.",
        pageUrl: "https://example.com/",
        findingCodes: ["metadata.missing_title"],
        effort: "low",
        impact: "high",
      },
      {
        code: "add-page-titles",
        title: "Add page titles",
        recommendation: "Add titles.",
        evidence: "No title.",
        pageUrl: "https://example.com/",
        findingCodes: ["metadata.missing_title"],
        effort: "low",
        impact: "high",
        family: "metadata_hygiene",
      },
    ],
    generatedAt: new Date("2026-01-01T00:00:00Z"),
  } satisfies WebsiteAuditFinding);

  assert.deepEqual(serialized.findings[0]?.representativeUrls, ["https://example.com/"]);
  assert.equal(serialized.findings[0]?.confidence, "low");
  assert.equal(serialized.quickWins[0]?.family, "answer_first_passages_lists");
  assert.equal(serialized.quickWins[0]?.rank, 1);
  assert.equal(serialized.quickWins.length, 1);
  assert.equal(findApprovedAuditQuickWin(
    serialized.quickWins,
    "add-page-titles",
  ), null);
  assert.equal(findApprovedAuditQuickWin(
    [{
      code: "restore-public-crawl-access",
      title: "Restore access",
      family: "legacy",
    }],
    "restore-public-crawl-access",
  )?.["family"], "crawl_index_access");
  const narrative = serialized.categoryNarratives["metadata"] as Record<string, unknown>;
  assert.equal(narrative["score"], 72);
  assert.match(String(narrative["scoreRationale"]), /predates prevalence-adjusted scoring/);
});