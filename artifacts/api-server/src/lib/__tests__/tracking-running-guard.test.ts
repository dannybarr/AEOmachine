import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, and } from "drizzle-orm";
import { db, companiesTable, trackingJobsTable } from "@workspace/db";
import {
  startTrackingBatch,
  BatchAlreadyRunningError,
  BatchQuotaExceededError,
  MANUAL_JOBS_PER_COMPANY_PER_DAY,
  utcToday,
} from "../trackingRunner";

/**
 * Regression: the single-running-tracking-job guard must be enforced by the
 * DATABASE, not only the process-local set — concurrent requests (or two
 * server instances) must not be able to double-claim a company and double-run
 * paid model executions.
 */
describe("tracking run-all concurrency guard (DB-enforced)", () => {
  const DOMAIN = "tracking-guard-test.example";
  let companyId: number;

  beforeAll(async () => {
    const [company] = await db
      .insert(companiesTable)
      .values({ name: "Tracking Guard Test Co", domain: DOMAIN })
      .returning();
    companyId = company!.id;
    await db.delete(trackingJobsTable).where(eq(trackingJobsTable.companyId, companyId));
  });

  afterAll(async () => {
    await db.delete(trackingJobsTable).where(eq(trackingJobsTable.companyId, companyId));
    await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
  });

  it("the unique index rejects a second concurrent running job for the same company", async () => {
    const base = {
      companyId,
      runDate: "2000-01-01",
      trigger: "manual" as const,
      status: "running" as const,
      totalSimulations: 0,
      modelsSnapshot: [],
    };
    const [first] = await db.insert(trackingJobsTable).values(base).returning();
    await expect(
      db.insert(trackingJobsTable).values({ ...base, runDate: "2000-01-02" }),
    ).rejects.toThrowError(); // 23505 from tracking_jobs_one_running_per_company (drizzle wraps the pg error)
    await db.delete(trackingJobsTable).where(eq(trackingJobsTable.id, first!.id));
  });

  it("concurrent startTrackingBatch calls cannot double-claim: with a running job held, every start is rejected and no new job rows appear", async () => {
    // Hold a running job for the company (as if another process claimed it —
    // the process-local set in THIS process knows nothing about it).
    const [held] = await db
      .insert(trackingJobsTable)
      .values({
        companyId,
        runDate: "2000-01-03",
        trigger: "manual",
        status: "running",
        totalSimulations: 0,
        modelsSnapshot: [],
      })
      .returning();

    const company = (await db
      .select()
      .from(companiesTable)
      .where(eq(companiesTable.id, companyId)))[0]!;

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => startTrackingBatch(company, "manual")),
    );
    for (const r of results) {
      expect(r.status).toBe("rejected");
      if (r.status === "rejected") {
        expect(r.reason).toBeInstanceOf(BatchAlreadyRunningError);
      }
    }

    const rows = await db
      .select()
      .from(trackingJobsTable)
      .where(
        and(
          eq(trackingJobsTable.companyId, companyId),
          eq(trackingJobsTable.status, "running"),
        ),
      );
    expect(rows).toHaveLength(1); // only the held claim — no double-claims
    expect(rows[0]!.id).toBe(held!.id);

    await db.delete(trackingJobsTable).where(eq(trackingJobsTable.id, held!.id));
  });

  it("durable daily quota blocks repeated manual batch starts even after completions", async () => {
    // Fill today's manual quota with COMPLETED jobs — the running-guard does
    // not apply, so only the durable per-day quota can stop a new start.
    await db.insert(trackingJobsTable).values(
      Array.from({ length: MANUAL_JOBS_PER_COMPANY_PER_DAY }, (_, i) => ({
        companyId,
        runDate: utcToday(),
        trigger: "manual" as const,
        status: "done" as const,
        totalSimulations: 0,
        modelsSnapshot: [],
      })),
    );
    const company = (await db
      .select()
      .from(companiesTable)
      .where(eq(companiesTable.id, companyId)))[0]!;
    await expect(startTrackingBatch(company, "manual")).rejects.toBeInstanceOf(
      BatchQuotaExceededError,
    );
    const jobs = await db
      .select()
      .from(trackingJobsTable)
      .where(eq(trackingJobsTable.companyId, companyId));
    expect(jobs).toHaveLength(MANUAL_JOBS_PER_COMPANY_PER_DAY); // nothing new
    await db.delete(trackingJobsTable).where(eq(trackingJobsTable.companyId, companyId));
  });
});
