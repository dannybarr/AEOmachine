import { and, eq, gte, lt, sql } from "drizzle-orm";
import {
  citationsTable,
  db,
  promptsTable,
  promptRunsTable,
} from "@workspace/db";

export const IMPACT_WINDOW_DAYS = 14;

export type ImpactMeasurement = {
  windowStart: string;
  windowEnd: string;
  eligibleRuns: number;
  citedRuns: number;
  totalRuns: number;
  visibleRuns: number;
  models: string[];
};

export async function measureCompanyImpact(
  companyId: number,
  windowStart: Date,
  windowEnd: Date,
): Promise<ImpactMeasurement> {
  const [summary] = await db
    .select({
      eligibleRuns: sql<number>`count(distinct ${promptRunsTable.id}) filter (where ${promptRunsTable.citationEligible} = true)::int`,
      citedRuns: sql<number>`count(distinct ${promptRunsTable.id}) filter (
        where ${promptRunsTable.citationEligible} = true
          and exists (
            select 1 from ${citationsTable}
            where ${citationsTable.runId} = ${promptRunsTable.id}
              and ${citationsTable.domainType} = 'you'
              and ${citationsTable.provenance} = 'provider'
          )
      )::int`,
      totalRuns: sql<number>`count(distinct ${promptRunsTable.id})::int`,
      visibleRuns: sql<number>`count(distinct ${promptRunsTable.id}) filter (where ${promptRunsTable.brandMentioned})::int`,
      models: sql<string[]>`coalesce(array_agg(distinct ${promptRunsTable.model}), '{}'::text[])`,
    })
    .from(promptRunsTable)
    .innerJoin(promptsTable, eq(promptsTable.id, promptRunsTable.promptId))
    .where(and(
      eq(promptsTable.companyId, companyId),
      gte(promptRunsTable.createdAt, windowStart),
      lt(promptRunsTable.createdAt, windowEnd),
    ));

  return {
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    eligibleRuns: summary?.eligibleRuns ?? 0,
    citedRuns: summary?.citedRuns ?? 0,
    totalRuns: summary?.totalRuns ?? 0,
    visibleRuns: summary?.visibleRuns ?? 0,
    models: summary?.models ?? [],
  };
}

export function impactRate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Math.round((numerator / denominator) * 1000) / 10 : null;
}