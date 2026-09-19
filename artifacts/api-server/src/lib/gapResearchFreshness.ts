import { and, desc, eq, gte } from "drizzle-orm";
import {
  db,
  gapResearchJobsTable,
  promptRunsTable,
  promptsTable,
} from "@workspace/db";
import { ANALYSIS_VERSION } from "./gapAnalysis";

export const GAP_RESEARCH_MAX_AGE_MS = 45 * 24 * 60 * 60 * 1_000;

export interface GapResearchFreshness {
  isFresh: boolean;
  staleReason: string | null;
}

export async function getLatestCompatibleGapResearchJob(companyId: number) {
  const [job] = await db
    .select({
      id: gapResearchJobsTable.id,
      createdAt: gapResearchJobsTable.createdAt,
      finishedAt: gapResearchJobsTable.finishedAt,
    })
    .from(gapResearchJobsTable)
    .where(
      and(
        eq(gapResearchJobsTable.companyId, companyId),
        eq(gapResearchJobsTable.status, "completed"),
        gte(gapResearchJobsTable.analysisVersion, ANALYSIS_VERSION),
      ),
    )
    .orderBy(desc(gapResearchJobsTable.id))
    .limit(1);
  return job ?? null;
}

export function evaluateGapResearchFreshness(
  observedAt: Date,
  latestEligibleRunAt: Date | null,
  now = new Date(),
): GapResearchFreshness {
  const ageExpired =
    now.getTime() - observedAt.getTime() > GAP_RESEARCH_MAX_AGE_MS;
  const newerEligibleRun =
    latestEligibleRunAt !== null &&
    latestEligibleRunAt.getTime() > observedAt.getTime();
  return {
    isFresh: !ageExpired && !newerEligibleRun,
    staleReason: ageExpired
      ? "the snapshot is more than 45 days old"
      : newerEligibleRun
        ? "newer eligible tracking runs are available"
        : null,
  };
}

export async function getGapResearchFreshness(
  companyId: number,
  observedAt: Date,
): Promise<GapResearchFreshness> {
  const [latestEligibleRun] = await db
    .select({ createdAt: promptRunsTable.createdAt })
    .from(promptRunsTable)
    .innerJoin(promptsTable, eq(promptRunsTable.promptId, promptsTable.id))
    .where(
      and(
        eq(promptsTable.companyId, companyId),
        eq(promptRunsTable.citationEligible, true),
      ),
    )
    .orderBy(desc(promptRunsTable.createdAt))
    .limit(1);
  return evaluateGapResearchFreshness(
    observedAt,
    latestEligibleRun?.createdAt ?? null,
  );
}