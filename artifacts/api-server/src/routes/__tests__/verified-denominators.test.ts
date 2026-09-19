import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq, gte, sql } from "drizzle-orm";
import {
  db,
  companiesTable,
  promptsTable,
  promptRunsTable,
  citationsTable,
} from "@workspace/db";
import { dashboardTotals } from "../../lib/dashboardTotals";
import { companyStats } from "../companies";
import { utcWindowStart } from "../../lib/timeWindow";

/**
 * Regression: verified-citation denominators must count ONLY runs with
 * confirmed citation eligibility (citation_eligible IS TRUE), and verified
 * retrieval counts ONLY provider-returned citations. Legacy (NULL) and
 * tool-rejected (FALSE) runs are reported separately and never dilute or
 * inflate verified metrics. Also: dashboard aggregate totals reconcile
 * exactly with company summaries over the same shared UTC window.
 */
describe("verified citation denominators and aggregate reconciliation", () => {
  const DOMAIN = "verified-denominators-test.example";
  let companyId: number;
  let promptId: number;

  beforeAll(async () => {
    const [company] = await db
      .insert(companiesTable)
      .values({ name: "Denominator Test Co", domain: DOMAIN })
      .returning();
    companyId = company!.id;
    const [prompt] = await db
      .insert(promptsTable)
      .values({ companyId, text: "test prompt", topic: "test" })
      .returning();
    promptId = prompt!.id;

    const runs = await db
      .insert(promptRunsTable)
      .values([
        // Eligible run with one provider-verified citation.
        { promptId, model: "perplexity/sonar", answerText: "a", brandMentioned: true, citationEligible: true },
        // Tool-rejected / search-ineligible run.
        { promptId, model: "openai/gpt-5.2", answerText: "b", brandMentioned: false, citationEligible: false },
        // Legacy run (unknown provenance) with a prose-parsed citation.
        { promptId, model: "perplexity/sonar", answerText: "c", brandMentioned: false, citationEligible: null },
      ] as (typeof promptRunsTable.$inferInsert)[])
      .returning();
    await db.insert(citationsTable).values([
      {
        runId: runs[0]!.id,
        url: "https://example.com/a",
        domain: "example.com",
        domainType: "other",
        position: 1,
        provenance: "provider",
      },
      {
        runId: runs[2]!.id,
        url: "https://example.com/b",
        domain: "example.com",
        domainType: "other",
        position: 1,
        provenance: null,
      },
      // Adversarial fixtures: provider-provenance citations attached to a
      // tool-rejected run and a legacy run — must NEVER count as verified.
      {
        runId: runs[1]!.id,
        url: "https://example.com/c",
        domain: "example.com",
        domainType: "other",
        position: 1,
        provenance: "provider",
      },
      {
        runId: runs[2]!.id,
        url: "https://example.com/d",
        domain: "example.com",
        domainType: "other",
        position: 2,
        provenance: "provider",
      },
    ] as (typeof citationsTable.$inferInsert)[]);
  });

  afterAll(async () => {
    await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
  });

  function filterForCompany() {
    return and(
      eq(promptsTable.companyId, companyId),
      gte(promptRunsTable.createdAt, sql`${utcWindowStart(30).toISOString()}::timestamptz`),
    );
  }

  it("legacy and tool-rejected runs never enter verified denominators", async () => {
    const t = await dashboardTotals(filterForCompany());
    expect(t.runs).toBe(3);
    expect(t.eligibleRuns).toBe(1); // only citation_eligible IS TRUE
    expect(t.ineligibleRuns).toBe(1);
    expect(t.legacyRuns).toBe(1);
    expect(t.retrievals).toBe(4); // raw stored citations, incl. legacy rows
    // Verified requires provider provenance AND a confirmed-eligible run:
    // the provider-provenance citations on the rejected/legacy runs are out.
    expect(t.verifiedRetrievals).toBe(1);
    // avg = verified citations / eligible runs — the legacy citation and
    // the legacy/rejected runs must not appear on either side.
    expect(t.avgCitationsPerRun).toBe(1);
  });

  it("dashboard totals reconcile exactly with company summaries for the same window", async () => {
    const t = await dashboardTotals(filterForCompany());
    const s = (await companyStats([companyId], 30)).get(companyId)!;
    expect(s.runCount).toBe(t.runs);
    // Company summaries report VERIFIED retrievals — provider provenance on
    // confirmed-eligible runs — so they reconcile with verified totals.
    expect(s.retrievals).toBe(t.verifiedRetrievals);
  });
});
