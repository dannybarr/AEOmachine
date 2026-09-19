import { eq, sql, type SQL } from "drizzle-orm";
import {
  db,
  companiesTable,
  promptsTable,
  promptRunsTable,
  citationsTable,
} from "@workspace/db";

/**
 * Run/citation totals shared by the dashboard route and reconciliation tests.
 *
 * Verified-citation policy: `eligibleRuns` counts only runs whose stored
 * provenance confirms citation eligibility (`citation_eligible IS TRUE`);
 * legacy rows (NULL) and search-ineligible rows (FALSE) are reported
 * separately and never enter the verified denominator. `verifiedRetrievals`
 * counts only provider-returned citations (`provenance = 'provider'`) that
 * belong to those confirmed-eligible runs — a provider-provenance citation
 * attached to a legacy or ineligible run can never enter verified metrics.
 * `retrievals` is the raw stored count including legacy rows.
 */
export interface DashboardTotals {
  runs: number;
  mentions: number;
  eligibleRuns: number;
  ineligibleRuns: number;
  legacyRuns: number;
  retrievals: number;
  verifiedRetrievals: number;
  avgCitationsPerRun: number | null;
}

export async function dashboardTotals(
  runFilter: SQL | undefined,
): Promise<DashboardTotals> {
  const [totalsRow] = await db
    .select({
      runs: sql<number>`count(*)::int`,
      mentions: sql<number>`count(*) filter (where ${promptRunsTable.brandMentioned})::int`,
      eligibleRuns: sql<number>`count(*) filter (where ${promptRunsTable.citationEligible} is true)::int`,
      ineligibleRuns: sql<number>`count(*) filter (where ${promptRunsTable.citationEligible} is false)::int`,
      legacyRuns: sql<number>`count(*) filter (where ${promptRunsTable.citationEligible} is null)::int`,
    })
    .from(promptRunsTable)
    .innerJoin(promptsTable, eq(promptsTable.id, promptRunsTable.promptId))
    .innerJoin(companiesTable, eq(companiesTable.id, promptsTable.companyId))
    .where(runFilter);

  const [retrievalRow] = await db
    .select({
      retrievals: sql<number>`count(*)::int`,
      verifiedRetrievals: sql<number>`count(*) filter (where ${citationsTable.provenance} = 'provider' and ${promptRunsTable.citationEligible} is true)::int`,
    })
    .from(citationsTable)
    .innerJoin(promptRunsTable, eq(promptRunsTable.id, citationsTable.runId))
    .innerJoin(promptsTable, eq(promptsTable.id, promptRunsTable.promptId))
    .innerJoin(companiesTable, eq(companiesTable.id, promptsTable.companyId))
    .where(runFilter);

  const eligibleRuns = totalsRow?.eligibleRuns ?? 0;
  const verifiedRetrievals = retrievalRow?.verifiedRetrievals ?? 0;
  return {
    runs: totalsRow?.runs ?? 0,
    mentions: totalsRow?.mentions ?? 0,
    eligibleRuns,
    ineligibleRuns: totalsRow?.ineligibleRuns ?? 0,
    legacyRuns: totalsRow?.legacyRuns ?? 0,
    retrievals: retrievalRow?.retrievals ?? 0,
    verifiedRetrievals,
    avgCitationsPerRun:
      eligibleRuns > 0
        ? Math.round((verifiedRetrievals / eligibleRuns) * 10) / 10
        : null,
  };
}
