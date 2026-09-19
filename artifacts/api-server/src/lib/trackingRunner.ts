import { eq, and, desc, sql } from "drizzle-orm";
import {
  db,
  promptsTable,
  promptRunsTable,
  citationsTable,
  trackingJobsTable,
  runAttemptsTable,
  type Company,
  type Prompt,
  type TrackingJob,
} from "@workspace/db";
import { runSimulation, detectBrandMention } from "./simulate";
import { classifyVisibilityRung } from "./visibilityRung";
import { buildContextSnapshot } from "./companyContext";
import {
  enabledModelIds,
  registrySnapshot,
  resolveModelStrict,
  getModel,
} from "./modelRegistry";
import { classifyAndRegister } from "./domainClassify";
import { refreshGapResearchAfterTracking } from "./gapResearchRunner";
import { logger } from "./logger";
import {
  ENTITY_EXTRACTOR_VERSION,
  wakeEntityExtractionWorker,
} from "./entityExtraction";

/** Canonical default coverage: every enabled registry model. */
export function defaultModels(): string[] {
  return enabledModelIds();
}

// Bounded model spend: at most one batch per company AND at most
// MAX_CONCURRENT_BATCHES batches process-wide. Within a batch, items run
// with small bounded concurrency, so total concurrent model calls stay low.
const MAX_CONCURRENT_BATCHES = 1;
const ITEM_CONCURRENCY = 2;
const RETRY_DELAY_MS = 3_000;
const runningCompanies = new Set<number>();

export function isBatchRunning(companyId: number): boolean {
  return runningCompanies.has(companyId);
}

export function anyBatchCapacity(): boolean {
  return runningCompanies.size < MAX_CONCURRENT_BATCHES;
}

/** Transient failures worth exactly one retry (network, 429, 5xx). */
function isTransient(err: unknown): boolean {
  const status = (err as { status?: number }).status;
  if (status === 429 || (typeof status === "number" && status >= 500)) return true;
  return status === undefined; // network / stream aborts carry no HTTP status
}

/**
 * Run one prompt simulation against one model and persist the run, its
 * verified citations, and a run_attempts audit row. Shared by the
 * single-prompt simulate endpoint, batch jobs, and the daily scheduler.
 */
export async function executeAndStoreSimulation(
  prompt: Prompt,
  company: Company,
  model: string,
  jobId?: number,
): Promise<typeof promptRunsTable.$inferSelect> {
  const started = Date.now();
  let resolved = model;
  try {
    // Resolution happens inside the try so invalid configured model ids
    // still produce a run_attempts audit row with the validation error.
    resolved = resolveModelStrict(model);
    // Tracked visibility runs are deliberately UNPRIMED: no company profile
    // context is injected, so metrics stay comparable to a real user's query
    // and before/after profile edits. Profile context is used only in
    // discovery/research framing; jobs snapshot it purely for provenance.
    const simulation = await runSimulation(prompt.text, resolved);
    const mention = detectBrandMention(simulation.answerText, company.name);
    const visibilityRung = classifyVisibilityRung({
      answerText: simulation.answerText,
      brandName: company.name,
      brandMentioned: mention.mentioned,
      companyDomain: company.domain,
      citationDomains: simulation.sources.map((source) => source.domain),
    });

    const [run] = await db
      .insert(promptRunsTable)
      .values({
        promptId: prompt.id,
        model: resolved,
        answerText: simulation.answerText,
        brandMentioned: mention.mentioned,
        brandPosition: mention.position,
        visibilityRung,
        searchStatus: simulation.searchStatus,
        citationEligible: simulation.citationEligible,
        citationDiagnostics: simulation.diagnostics,
        entityExtractionStatus: "pending",
        entityExtractorVersion: ENTITY_EXTRACTOR_VERSION,
        entityExtractionAttempts: 0,
        durationMs: simulation.durationMs,
      })
      .returning();
    // Queue state is durable in the inserted row. Wake immediately after the
    // run commit; citation persistence and tracking-job completion never wait
    // for entity extraction.
    wakeEntityExtractionWorker();

    let position = 1;
    for (const source of simulation.sources) {
      const { domain, domainType } = await classifyAndRegister(source.domain, {
        id: company.id,
        domain: company.domain,
      }, source.url);
      await db.insert(citationsTable).values({
        runId: run!.id,
        domain,
        url: source.url,
        domainType,
        position: position++,
        provenance: "provider",
        metadata: source.metadata ?? null,
      });
    }
    await db.insert(runAttemptsTable).values({
      jobId: jobId ?? null,
      promptId: prompt.id,
      model: resolved,
      outcome: "succeeded",
      durationMs: Date.now() - started,
      runId: run!.id,
    });
    return run!;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    try {
      await db.insert(runAttemptsTable).values({
        jobId: jobId ?? null,
        promptId: prompt.id,
        model: resolved,
        outcome: "failed",
        error: message.slice(0, 500),
        durationMs: Date.now() - started,
      });
    } catch (persistErr) {
      logger.error({ err: persistErr }, "Failed to persist failed attempt");
    }
    throw err;
  }
}

export function serializeTrackingJob(job: TrackingJob) {
  return {
    id: job.id,
    companyId: job.companyId,
    promptId: job.promptId ?? null,
    runDate: job.runDate,
    trigger: job.trigger,
    status: job.status,
    totalSimulations: job.totalSimulations,
    succeeded: job.succeeded,
    failed: job.failed,
    error: job.error,
    models: job.modelsSnapshot ?? null,
    createdAt: job.createdAt.toISOString(),
    finishedAt: job.finishedAt ? job.finishedAt.toISOString() : null,
  };
}

export function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

interface WorkItem {
  prompt: Prompt;
  model: string;
}

/**
 * Expand prompts × models into the immutable work list for a batch.
 * Models come from each prompt's configuration (legacy ids normalized) or the
 * registry defaults; ids no longer in the registry stay in the list so the
 * attempt is recorded as an explicit failure, never silently skipped.
 */
async function collectWork(companyId: number, promptId?: number): Promise<WorkItem[]> {
  const conditions = [eq(promptsTable.companyId, companyId), eq(promptsTable.active, true)];
  if (promptId !== undefined) conditions.push(eq(promptsTable.id, promptId));
  const prompts = await db
    .select()
    .from(promptsTable)
    .where(and(...conditions));
  const work: WorkItem[] = [];
  for (const prompt of prompts) {
    // Per-prompt "Run all models" always covers the full registry snapshot;
    // company-wide batches respect each prompt's configured model list.
    const models =
      promptId !== undefined
        ? defaultModels()
        : prompt.models.length > 0
          ? prompt.models
          : defaultModels();
    for (const model of models) work.push({ prompt, model });
  }
  return work;
}

/**
 * Create a tracking job (whole company, or a single prompt when `prompt` is
 * given) and return it immediately in "running" state; the simulations
 * continue server-side and update the job's counters after every item so
 * clients can poll for live progress — the run survives page navigation.
 * The registry snapshot captured here is the job's immutable model coverage.
 *
 * For trigger "scheduled" the DB-level partial unique index on
 * (company_id, run_date) makes the insert a no-op when another instance
 * already claimed today — in that case null is returned and nothing runs.
 */
export async function startTrackingBatch(
  company: Company,
  trigger: "manual" | "scheduled",
  prompt?: Prompt,
): Promise<TrackingJob | null> {
  if (runningCompanies.has(company.id) || !anyBatchCapacity()) {
    throw new BatchAlreadyRunningError(company.id);
  }
  // Durable daily quota for manual batch starts — a DB count, not process
  // state, so it holds across restarts and instances. Paid multi-model
  // batches cannot be re-triggered without bound after each completion.
  if (trigger === "manual") {
    const [quotaRow] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(trackingJobsTable)
      .where(
        and(
          eq(trackingJobsTable.companyId, company.id),
          eq(trackingJobsTable.trigger, "manual"),
          eq(trackingJobsTable.runDate, utcToday()),
        ),
      );
    if ((quotaRow?.n ?? 0) >= MANUAL_JOBS_PER_COMPANY_PER_DAY) {
      throw new BatchQuotaExceededError(company.id);
    }
  }
  const work = await collectWork(company.id, prompt?.id);

  // The insert is the atomic claim. Two DB-enforced guards apply:
  //  - tracking_jobs_one_running_per_company: at most one running job per
  //    company across manual AND scheduled triggers (process-local checks
  //    cannot prevent concurrent requests from double-claiming).
  //  - tracking_jobs_scheduled_once_per_day: a scheduled batch runs at most
  //    once per company per UTC day.
  let job: TrackingJob | undefined;
  try {
    const inserted = await db
      .insert(trackingJobsTable)
      .values({
        companyId: company.id,
        promptId: prompt?.id ?? null,
        runDate: utcToday(),
        trigger,
        status: "running",
        totalSimulations: work.length,
        modelsSnapshot: registrySnapshot(),
        companyContextSnapshot: buildContextSnapshot(company),
      })
      .returning();
    job = inserted[0];
  } catch (err) {
    // drizzle may wrap the pg error as DrizzleQueryError with `cause`.
    const raw = err as { code?: string; constraint?: string; cause?: unknown };
    const e = (raw.code ? raw : raw.cause ?? {}) as { code?: string; constraint?: string };
    if (e.code === "23505") {
      if (e.constraint === "tracking_jobs_scheduled_once_per_day") {
        return null; // scheduled batch already claimed for today
      }
      throw new BatchAlreadyRunningError(company.id);
    }
    throw err;
  }
  if (!job) return null;

  runningCompanies.add(company.id);
  void processBatch(job, company, work).finally(() => {
    runningCompanies.delete(company.id);
  });
  return job;
}

async function runWorkItem(job: TrackingJob, company: Company, item: WorkItem): Promise<void> {
  try {
    await executeAndStoreSimulation(item.prompt, company, item.model, job.id);
  } catch (err) {
    if (!isTransient(err)) throw err;
    // One bounded retry for transient failures (rate limits, 5xx, network).
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    await executeAndStoreSimulation(item.prompt, company, item.model, job.id);
  }
}

async function processBatch(
  job: TrackingJob,
  company: Company,
  work: WorkItem[],
): Promise<void> {
  let firstError: string | null = null;
  const queue = [...work];
  const worker = async (): Promise<void> => {
    for (;;) {
      const item = queue.shift();
      if (!item) return;
      let ok = false;
      try {
        await runWorkItem(job, company, item);
        ok = true;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!firstError) {
          const label = getModel(item.model)?.label ?? item.model;
          firstError = `${label}: ${message}`.slice(0, 500);
        }
        logger.warn(
          { err, promptId: item.prompt.id, model: item.model, companyId: company.id },
          "Tracking batch simulation failed",
        );
      }
      // Persist counters per item so polling clients see live progress.
      try {
        await db
          .update(trackingJobsTable)
          .set(
            ok
              ? { succeeded: sql`${trackingJobsTable.succeeded} + 1` }
              : { failed: sql`${trackingJobsTable.failed} + 1`, error: firstError },
          )
          .where(eq(trackingJobsTable.id, job.id));
      } catch (err) {
        logger.error({ err, jobId: job.id }, "Failed to persist tracking progress");
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(ITEM_CONCURRENCY, Math.max(work.length, 1)) }, worker),
  );
  try {
    const [current] = await db
      .select()
      .from(trackingJobsTable)
      .where(eq(trackingJobsTable.id, job.id));
    const succeeded = current?.succeeded ?? 0;
    const failed = current?.failed ?? 0;
    const status = failed > 0 && succeeded === 0 && work.length > 0 ? "failed" : "completed";
    await db
      .update(trackingJobsTable)
      .set({
        status,
        finishedAt: new Date(),
      })
      .where(eq(trackingJobsTable.id, job.id));
    logger.info(
      { jobId: job.id, companyId: company.id, succeeded, failed },
      "Tracking batch finished",
    );
    if (status === "completed") {
      try {
        const researchJob = await refreshGapResearchAfterTracking(company);
        if (researchJob) {
          logger.info(
            { companyId: company.id, trackingJobId: job.id, researchJobId: researchJob.id },
            "Tracking completion triggered gap research",
          );
        }
      } catch (err) {
        logger.error(
          { err, companyId: company.id, trackingJobId: job.id },
          "Failed to trigger gap research after tracking",
        );
      }
    }
  } catch (err) {
    logger.error({ err, jobId: job.id }, "Failed to finalize tracking job");
  }
}

/** Wait for a specific job to leave "running" state (used by the scheduler). */
export async function waitForJobCompletion(jobId: number, pollMs = 5_000): Promise<void> {
  for (;;) {
    const [job] = await db
      .select({ status: trackingJobsTable.status })
      .from(trackingJobsTable)
      .where(eq(trackingJobsTable.id, jobId));
    if (!job || job.status !== "running") return;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

export const MANUAL_JOBS_PER_COMPANY_PER_DAY = 20;

export class BatchQuotaExceededError extends Error {
  constructor(companyId: number) {
    super(`Daily manual tracking-run quota reached for company ${companyId}`);
    this.name = "BatchQuotaExceededError";
  }
}

export class BatchAlreadyRunningError extends Error {
  constructor(companyId: number) {
    super(`A tracking batch is already running for company ${companyId}`);
    this.name = "BatchAlreadyRunningError";
  }
}

/** True when this company already has a full-company job recorded today (UTC).
 * Per-prompt "Run all models" jobs do not count — they must not suppress the
 * daily full tracking run. */
export async function hasJobToday(companyId: number): Promise<boolean> {
  const [existing] = await db
    .select({ id: trackingJobsTable.id })
    .from(trackingJobsTable)
    .where(
      and(
        eq(trackingJobsTable.companyId, companyId),
        eq(trackingJobsTable.runDate, utcToday()),
        sql`${trackingJobsTable.promptId} is null`,
      ),
    )
    .orderBy(desc(trackingJobsTable.id))
    .limit(1);
  return Boolean(existing);
}
