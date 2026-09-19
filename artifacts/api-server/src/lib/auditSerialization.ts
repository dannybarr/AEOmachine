import { type WebsiteAuditFinding } from "@workspace/db";

const APPROVED_LEGACY_QUICK_WIN_FAMILIES: Record<string, string> = {
  "restore-public-crawl-access": "crawl_index_access",
  "repair-crawl-failures": "crawl_index_access",
  "review-noindex-pages": "crawl_index_access",
  "lead-with-direct-answers": "answer_first_passages_lists",
  "add-list-content": "answer_first_passages_lists",
  "cite-material-claims": "claim_evidence_primary_research",
  "publish-original-research": "claim_evidence_primary_research",
  "faq-money-topics": "high_value_topic_gaps_faqs",
  "answer-audience-questions": "high_value_topic_gaps_faqs",
  "helpdesk-questions-to-content": "high_value_topic_gaps_faqs",
  "add-content-accountability": "freshness_accountability_new_content",
  "consolidate-overlapping-pages": "consolidation_weak_overlapping_pages",
  "consolidate-weak-pages": "consolidation_weak_overlapping_pages",
};
const APPROVED_QUICK_WIN_FAMILIES = new Set(Object.values(APPROVED_LEGACY_QUICK_WIN_FAMILIES));

export function normalizeApprovedAuditQuickWin(
  item: Record<string, unknown>,
  rank = 1,
): Record<string, unknown> | null {
  const code = typeof item["code"] === "string" ? item["code"] : null;
  if (!code) return null;
  const mappedFamily = APPROVED_LEGACY_QUICK_WIN_FAMILIES[code];
  const storedFamily = typeof item["family"] === "string" && APPROVED_QUICK_WIN_FAMILIES.has(item["family"])
    ? item["family"]
    : null;
  const family = mappedFamily ?? storedFamily;
  if (!family) return null;
  return {
    ...item,
    family,
    rationale: String(item["rationale"] ?? "Recommended by a previous deterministic website audit; review the retained evidence before acting."),
    affectedCount: Number(item["affectedCount"] ?? 1),
    representativeUrls: Array.isArray(item["representativeUrls"])
      ? item["representativeUrls"]
      : typeof item["pageUrl"] === "string" ? [item["pageUrl"]] : [],
    rank: Number(item["rank"] ?? rank),
  };
}

export function findApprovedAuditQuickWin(
  quickWins: Array<Record<string, unknown>>,
  code: string,
): Record<string, unknown> | null {
  const item = quickWins.find((candidate) => candidate["code"] === code);
  return item ? normalizeApprovedAuditQuickWin(item) : null;
}

/** Normalizes durable v1 rows so contract upgrades do not strand old audits. */
export function serializeStoredAudit(row: WebsiteAuditFinding) {
  const findings = row.findings.map((item) => {
    const pageUrl = typeof item["pageUrl"] === "string" ? item["pageUrl"] : null;
    const evidence = String(item["evidence"] ?? "Evidence was not retained by this legacy audit.");
    const severity = item["severity"] === "critical" || item["severity"] === "high"
      || item["severity"] === "medium" || item["severity"] === "low" ? item["severity"] : "low";
    return {
      ...item,
      id: String(item["id"] ?? `legacy:${String(item["code"] ?? "finding")}`),
      affectedCount: Number(item["affectedCount"] ?? 1),
      prevalence: Number(item["prevalence"] ?? Math.min(1, 1 / Math.max(1, row.pagesScanned))),
      representativeUrls: Array.isArray(item["representativeUrls"]) ? item["representativeUrls"] : pageUrl ? [pageUrl] : [],
      representativeEvidence: Array.isArray(item["representativeEvidence"]) ? item["representativeEvidence"] : [evidence],
      scoreRationale: String(item["scoreRationale"] ?? `Legacy ${severity} finding; the original scoring rationale was not retained.`),
      impactExplanation: String(item["impactExplanation"] ?? item["explanation"] ?? "The original audit did not retain a separate impact explanation."),
      confidence: item["confidence"] === "high" || item["confidence"] === "medium" || item["confidence"] === "low"
        ? item["confidence"] : "low",
      limitations: Array.isArray(item["limitations"]) ? item["limitations"] : ["This finding predates grouped audit metadata."],
    };
  });
  const quickWins = row.quickWins
    .map((item, index) => normalizeApprovedAuditQuickWin(item, index + 1))
    .filter((item): item is Record<string, unknown> => item !== null);
  const categoryNarratives = Object.keys(row.categoryNarratives).length
    ? row.categoryNarratives
    : Object.fromEntries(Object.entries(row.categoryScores).map(([category, score]) => {
      const categoryFindings = findings.filter((finding) =>
        (finding as Record<string, unknown>)["category"] === category);
      const evidence = categoryFindings
        .flatMap((finding) => Array.isArray(finding.representativeEvidence) ? finding.representativeEvidence : [])
        .slice(0, 5);
      const weaknesses = categoryFindings.map((finding) => {
        const record = finding as Record<string, unknown>;
        return String(record["title"] ?? record["code"]);
      }).slice(0, 5);
      return [category, {
        category,
        score,
        conclusion: weaknesses.length
          ? `${weaknesses.length} distinct ${category.replace(/_/g, " ")} weakness(es) were retained in this saved assessment.`
          : `No ${category.replace(/_/g, " ")} weakness was retained in this saved assessment.`,
        summary: `Saved legacy category score: ${score}/100.`,
        strengths: weaknesses.length
          ? ["No additional weakness was retained for the other applicable checks in this category."]
          : ["No applicable negative signal was retained for this category."],
        weaknesses,
        risks: weaknesses,
        scoreRationale: "This assessment predates prevalence-adjusted scoring, so the original category score is preserved rather than recalculated.",
        impact: weaknesses.length
          ? "The retained weaknesses may affect discovery, interpretation, verification, or reuse. The saved evidence does not guarantee a ranking or citation outcome."
          : "No impact was detected in the retained checks, but this older bounded assessment cannot prove site-wide performance.",
        evidence,
        confidence: "low",
        limitations: ["This saved assessment predates richer category narratives and grouped prevalence metadata; rescan only when fresher website evidence is genuinely needed."],
      }];
    }));
  return {
    ...row,
    categoryNarratives,
    findings,
    quickWins,
    generatedAt: row.generatedAt.toISOString(),
  };
}