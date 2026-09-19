import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import {
  audienceRecommendationsTable,
  companiesTable,
  db,
  websiteAssessmentJobsTable,
  websiteAuditFindingsTable,
  websiteAuditQuickWinPromotionsTable,
  strategyIdeasTable,
  strategyItemsTable,
} from "@workspace/db";

/**
 * Real-DB invariant coverage. Migrations must be applied before this suite,
 * matching the other integration tests in this package.
 */
test("assessment active-job and recommendation dedup guards are company scoped", async () => {
  const suffix = `${Date.now()}-${Math.random()}`;
  const companies = await db
    .insert(companiesTable)
    .values([
      { name: `assessment-a-${suffix}`, domain: `a-${suffix}.example.com` },
      { name: `assessment-b-${suffix}`, domain: `b-${suffix}.example.com` },
    ])
    .returning();
  const [a, b] = companies;
  try {
    const attempts = await Promise.allSettled([
      db.insert(websiteAssessmentJobsTable).values({ companyId: a!.id }).returning(),
      db.insert(websiteAssessmentJobsTable).values({ companyId: a!.id }).returning(),
    ]);
    assert.equal(attempts.filter((result) => result.status === "fulfilled").length, 1);
    const [jobA] = await db
      .select()
      .from(websiteAssessmentJobsTable)
      .where(eq(websiteAssessmentJobsTable.companyId, a!.id));
    const [jobB] = await db
      .insert(websiteAssessmentJobsTable)
      .values({ companyId: b!.id })
      .returning();

    const recommendation = {
      question: "Which plan is best for a growing team?",
      normalizedQuestion: "which plan is best for a growing team?",
      moneyTopic: "Plan selection",
      persona: "Operations lead",
      intent: "Commercial investigation",
      rationale: "The buyer needs to compare plans before purchasing.",
    };
    const duplicateAttempts = await Promise.allSettled([
      db.insert(audienceRecommendationsTable).values({
        ...recommendation,
        jobId: jobA!.id,
        companyId: a!.id,
      }),
      db.insert(audienceRecommendationsTable).values({
        ...recommendation,
        jobId: jobA!.id,
        companyId: a!.id,
      }),
    ]);
    assert.equal(duplicateAttempts.filter((result) => result.status === "fulfilled").length, 1);
    await db.insert(audienceRecommendationsTable).values({
      ...recommendation,
      jobId: jobB!.id,
      companyId: b!.id,
    });
    const companyBRows = await db
      .select()
      .from(audienceRecommendationsTable)
      .where(eq(audienceRecommendationsTable.companyId, b!.id));
    assert.equal(companyBRows.length, 1);
    assert.equal(companyBRows[0]!.companyId, b!.id);

    const [audit] = await db.insert(websiteAuditFindingsTable).values({
      jobId: jobA!.id,
      companyId: a!.id,
      score: 63,
      categoryScores: { crawlability: 80 },
      counts: { findings: 1 },
      pagesScanned: 1,
      methodology: ["deterministic bounded crawl"],
      findings: [{ code: "answerability.no_lists", evidence: "0 of 1 pages." }],
      quickWins: [{ code: "add-list-content", title: "Add list-based content" }],
    }).returning();
    assert.equal(audit!.score, 63);
    const [idea] = await db.insert(strategyIdeasTable).values({
      title: `audit-list-${suffix}`,
      category: "on_page",
      playType: "Website Audit Quick Win",
      description: "Add semantic lists.",
      rationale: "Improve extractability.",
    }).returning();
    const [item] = await db.insert(strategyItemsTable).values({
      ideaId: idea!.id,
      companyId: a!.id,
      brief: { auditId: audit!.id, evidence: "0 of 1 pages." },
    }).returning();
    const promotions = await Promise.allSettled([
      db.insert(websiteAuditQuickWinPromotionsTable).values({
        auditId: audit!.id, companyId: a!.id, quickWinCode: "add-list-content", strategyItemId: item!.id,
        baseline: { windowStart: new Date(0).toISOString(), windowEnd: new Date(1).toISOString(), eligibleRuns: 0, citedRuns: 0, totalRuns: 0, visibleRuns: 0, models: [] },
      }),
      db.insert(websiteAuditQuickWinPromotionsTable).values({
        auditId: audit!.id, companyId: a!.id, quickWinCode: "add-list-content", strategyItemId: item!.id,
        baseline: { windowStart: new Date(0).toISOString(), windowEnd: new Date(1).toISOString(), eligibleRuns: 0, citedRuns: 0, totalRuns: 0, visibleRuns: 0, models: [] },
      }),
    ]);
    assert.equal(promotions.filter((result) => result.status === "fulfilled").length, 1);
  } finally {
    await db.delete(companiesTable).where(eq(companiesTable.id, a!.id));
    await db.delete(companiesTable).where(eq(companiesTable.id, b!.id));
  }
});