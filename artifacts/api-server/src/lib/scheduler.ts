import { eq } from "drizzle-orm";
import { db, companiesTable, trackingJobsTable } from "@workspace/db";
import { isConfigured } from "./simulate";
import {
  startTrackingBatch,
  hasJobToday,
  isBatchRunning,
  anyBatchCapacity,
  waitForJobCompletion,
} from "./trackingRunner";
import { cleanupOrphanedResearchJobs } from "./gapResearchRunner";
import { cleanupOrphanedCaseStudyJobs } from "./caseStudyRunner";
import { cleanupOrphanedAssessmentJobs } from "./websiteAssessmentRunner";
import { logger } from "./logger";

const CHECK_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Daily auto-tracking: every 15 minutes, run a full prompt batch for each
 * company that has auto-tracking enabled and has not yet been tracked today
 * (UTC). Companies run one at a time to keep model-API load bounded, and a
 * DB-level unique index guarantees at most one scheduled batch per company
 * per day even across server instances.
 *
 * Note: in the development workspace this only fires while the server is
 * awake; a published deployment keeps it running around the clock.
 */
export function startDailyTrackingScheduler(): void {
  // A restart of this single-instance server kills any in-flight batch;
  // mark orphaned rows so they do not read as running forever.
  void db
    .update(trackingJobsTable)
    .set({ status: "failed", error: "Interrupted by server restart", finishedAt: new Date() })
    .where(eq(trackingJobsTable.status, "running"))
    .then(() => undefined)
    .catch((err: unknown) => logger.error({ err }, "Failed to clean up orphaned tracking jobs"));
  cleanupOrphanedResearchJobs();
  cleanupOrphanedCaseStudyJobs();
  cleanupOrphanedAssessmentJobs();

  const tick = async (): Promise<void> => {
    if (!isConfigured()) return;
    const companies = await db
      .select()
      .from(companiesTable)
      .where(eq(companiesTable.autoTrackDaily, true));
    for (const company of companies) {
      try {
        if (isBatchRunning(company.id) || !anyBatchCapacity()) continue;
        if (await hasJobToday(company.id)) continue;
        const job = await startTrackingBatch(company, "scheduled");
        if (!job) continue; // another instance claimed today
        logger.info({ companyId: company.id, jobId: job.id }, "Daily tracking: batch started");
        await waitForJobCompletion(job.id);
        logger.info({ companyId: company.id, jobId: job.id }, "Daily tracking: batch finished");
      } catch (err) {
        logger.error({ err, companyId: company.id }, "Daily tracking: batch errored");
      }
    }
  };

  setInterval(() => void tick(), CHECK_INTERVAL_MS).unref();
  // Also check shortly after boot so a restart never skips the day.
  setTimeout(() => void tick(), 30_000).unref();
}
