import { Router, type IRouter } from "express";
import { eq, desc, and, sql } from "drizzle-orm";
import { db, trackingJobsTable, runAttemptsTable, promptsTable } from "@workspace/db";
import {
  SimulateAllPromptsBody,
  SimulateAllPromptsResponse,
  ListTrackingJobsQueryParams,
  ListTrackingJobsResponse,
} from "@workspace/api-zod";
import { isConfigured } from "../lib/simulate";
import {
  startTrackingBatch,
  isBatchRunning,
  anyBatchCapacity,
  serializeTrackingJob,
  BatchAlreadyRunningError,
  BatchQuotaExceededError,
} from "../lib/trackingRunner";
import { getCompany } from "../lib/companyLookup";

const router: IRouter = Router();

router.post("/prompts/simulate-all", async (req, res): Promise<void> => {
  const body = SimulateAllPromptsBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const company = await getCompany(body.data.companyId);
  if (!company) {
    res.status(400).json({ error: "Unknown companyId" });
    return;
  }
  if (!isConfigured()) {
    res.status(503).json({
      error:
        "OpenAI API key is not configured. Add the OPENAI_API_KEY secret to run real simulations.",
    });
    return;
  }
  if (isBatchRunning(company.id) || !anyBatchCapacity()) {
    res.status(409).json({ error: "A tracking run is already in progress. Wait for it to finish first." });
    return;
  }
  // Returns immediately with the job in "running" state; simulations continue
  // in the background and the client polls /tracking/jobs for live progress.
  let job;
  try {
    job = await startTrackingBatch(company, "manual");
  } catch (err) {
    if (err instanceof BatchAlreadyRunningError) {
      res.status(409).json({ error: "A tracking run is already in progress. Wait for it to finish first." });
      return;
    }
    if (err instanceof BatchQuotaExceededError) {
      res.status(429).json({ error: "Daily tracking-run limit reached for this company. Try again tomorrow." });
      return;
    }
    throw err;
  }
  if (!job) {
    res.status(409).json({ error: "A tracking run was already recorded for today." });
    return;
  }
  res.json(SimulateAllPromptsResponse.parse(serializeTrackingJob(job)));
});

/**
 * "Run all models" for a single prompt as a durable server-side job: the
 * registry snapshot is captured at start, every attempt is recorded, and the
 * run survives page navigation (clients poll /tracking/jobs?promptId=).
 */
router.post("/prompts/:id/simulate-all", async (req, res): Promise<void> => {
  const promptId = Number(req.params["id"]);
  if (!Number.isInteger(promptId) || promptId <= 0) {
    res.status(400).json({ error: "Invalid prompt id" });
    return;
  }
  const [prompt] = await db.select().from(promptsTable).where(eq(promptsTable.id, promptId));
  if (!prompt) {
    res.status(404).json({ error: "Prompt not found" });
    return;
  }
  const company = await getCompany(prompt.companyId);
  if (!company) {
    res.status(409).json({ error: "The prompt's company no longer exists." });
    return;
  }
  if (!isConfigured()) {
    res.status(503).json({
      error:
        "OpenAI API key is not configured. Add the OPENAI_API_KEY secret to run real simulations.",
    });
    return;
  }
  if (isBatchRunning(company.id) || !anyBatchCapacity()) {
    res.status(409).json({ error: "A tracking run is already in progress. Wait for it to finish first." });
    return;
  }
  let job;
  try {
    job = await startTrackingBatch(company, "manual", prompt);
  } catch (err) {
    if (err instanceof BatchAlreadyRunningError) {
      res.status(409).json({ error: "A tracking run is already in progress. Wait for it to finish first." });
      return;
    }
    if (err instanceof BatchQuotaExceededError) {
      res.status(429).json({ error: "Daily tracking-run limit reached for this company. Try again tomorrow." });
      return;
    }
    throw err;
  }
  if (!job) {
    res.status(409).json({ error: "Could not start the run. Try again." });
    return;
  }
  res.json(SimulateAllPromptsResponse.parse(serializeTrackingJob(job)));
});

/** Per-model attempt outcomes for one job — exact partial-failure reporting. */
router.get("/tracking/jobs/:id/attempts", async (req, res): Promise<void> => {
  const jobId = Number(req.params["id"]);
  if (!Number.isInteger(jobId) || jobId <= 0) {
    res.status(400).json({ error: "Invalid job id" });
    return;
  }
  const rows = await db
    .select({
      model: runAttemptsTable.model,
      total: sql<number>`count(*)::int`,
      succeeded: sql<number>`count(*) filter (where ${runAttemptsTable.outcome} = 'succeeded')::int`,
      failed: sql<number>`count(*) filter (where ${runAttemptsTable.outcome} = 'failed')::int`,
      lastError: sql<string | null>`max(${runAttemptsTable.error}) filter (where ${runAttemptsTable.outcome} = 'failed')`,
    })
    .from(runAttemptsTable)
    .where(eq(runAttemptsTable.jobId, jobId))
    .groupBy(runAttemptsTable.model)
    .orderBy(runAttemptsTable.model);
  res.json(rows);
});

router.get("/tracking/jobs", async (req, res): Promise<void> => {
  const q = ListTrackingJobsQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  const company = await getCompany(q.data.companyId);
  if (!company) {
    res.status(400).json({ error: "Unknown companyId" });
    return;
  }
  const limit = Math.min(Math.max(q.data.limit ?? 10, 1), 50);
  const promptIdRaw = req.query["promptId"];
  const promptId = promptIdRaw === undefined ? undefined : Number(promptIdRaw);
  const jobs = await db
    .select()
    .from(trackingJobsTable)
    .where(
      and(
        eq(trackingJobsTable.companyId, company.id),
        promptId !== undefined && Number.isInteger(promptId)
          ? eq(trackingJobsTable.promptId, promptId)
          : undefined,
      ),
    )
    .orderBy(desc(trackingJobsTable.createdAt))
    .limit(limit);
  res.json(ListTrackingJobsResponse.parse(jobs.map(serializeTrackingJob)));
});

export default router;
