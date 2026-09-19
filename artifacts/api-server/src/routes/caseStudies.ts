import { Router, type IRouter } from "express";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import {
  db,
  caseStudiesTable,
  caseStudyRevisionsTable,
  caseStudyJobsTable,
  promptsTable,
  promptRunsTable,
  strategyItemsTable,
  weeklyMeasurementsTable,
  type CaseStudy,
  type CaseStudyRevision,
  type CaseStudyJob,
} from "@workspace/db";
import {
  GetCaseStudyQueryParams,
  GetCaseStudyResponse,
  SaveCaseStudyContextBody,
  SaveCaseStudyContextResponse,
  RefreshCaseStudyBody,
  RefreshCaseStudyResponse,
  ListCaseStudyJobsQueryParams,
  ListCaseStudyJobsResponse,
  UpdateCaseStudyRevisionParams,
  UpdateCaseStudyRevisionBody,
  UpdateCaseStudyRevisionResponse,
} from "@workspace/api-zod";
import { getCompany } from "../lib/companyLookup";
import { isConfigured } from "../lib/simulate";
import {
  ensureCaseStudy,
  startCaseStudyRefresh,
  CaseStudyJobRunningError,
} from "../lib/caseStudyRunner";
import type { CaseStudyEvidence } from "../lib/caseStudyEvidence";

const router: IRouter = Router();

function serializeCaseStudy(c: CaseStudy) {
  return {
    id: c.id,
    companyId: c.companyId,
    startingPosition: c.startingPosition,
    strategicFocus: c.strategicFocus,
    contextNotes: c.contextNotes,
    contextUpdatedAt: c.contextUpdatedAt ? c.contextUpdatedAt.toISOString() : null,
    createdAt: c.createdAt.toISOString(),
  };
}

function serializeRevision(r: CaseStudyRevision) {
  const e = r.evidenceSnapshot as CaseStudyEvidence;
  return {
    id: r.id,
    caseStudyId: r.caseStudyId,
    companyId: r.companyId,
    revisionNumber: r.revisionNumber,
    kind: r.kind as "baseline" | "refresh",
    narrative: r.narrative,
    editedNarrative: r.editedNarrative,
    approvedAt: r.approvedAt ? r.approvedAt.toISOString() : null,
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    model: r.model,
    createdAt: r.createdAt.toISOString(),
    evidence: {
      totalRuns: e?.tracking?.totalRuns ?? 0,
      activePrompts: e?.tracking?.activePrompts ?? 0,
      firstRunAt: e?.tracking?.firstRunAt ?? null,
      lastRunAt: e?.tracking?.lastRunAt ?? null,
      earliest: e?.tracking?.earliest ?? null,
      latest: e?.tracking?.latest ?? null,
      actionsLive: e?.strategy?.actionsLive ?? 0,
      actionsInProgress: e?.strategy?.actionsInProgress ?? 0,
      measurementCount: e?.measurements?.length ?? 0,
      gaps: e?.gaps ?? [],
    },
  };
}

function serializeJob(j: CaseStudyJob) {
  return {
    id: j.id,
    companyId: j.companyId,
    status: j.status as "running" | "completed" | "failed",
    stage: j.stage,
    error: j.error,
    revisionId: j.revisionId,
    createdAt: j.createdAt.toISOString(),
    finishedAt: j.finishedAt ? j.finishedAt.toISOString() : null,
  };
}

router.get("/case-study", async (req, res): Promise<void> => {
  const q = GetCaseStudyQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  const company = await getCompany(q.data.companyId);
  if (!company) {
    res.status(400).json({ error: "Unknown companyId" });
    return;
  }
  const caseStudy = await ensureCaseStudy(company.id);
  const revisions = await db
    .select()
    .from(caseStudyRevisionsTable)
    .where(eq(caseStudyRevisionsTable.caseStudyId, caseStudy.id))
    .orderBy(desc(caseStudyRevisionsTable.revisionNumber));
  const jobs = await db
    .select()
    .from(caseStudyJobsTable)
    .where(eq(caseStudyJobsTable.companyId, company.id))
    .orderBy(desc(caseStudyJobsTable.createdAt))
    .limit(1);
  const lastJob = jobs[0] ?? null;

  // Activity recorded after the latest revision, so users know when a
  // refresh is worthwhile.
  let newActivity: { runs: number; actions: number; measurements: number } | null = null;
  const latest = revisions[0];
  if (latest) {
    const since = latest.createdAt;
    const [runRow] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(promptRunsTable)
      .innerJoin(promptsTable, eq(promptsTable.id, promptRunsTable.promptId))
      .where(and(eq(promptsTable.companyId, company.id), gt(promptRunsTable.createdAt, since)));
    const [actionRow] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(strategyItemsTable)
      .where(and(eq(strategyItemsTable.companyId, company.id), gt(strategyItemsTable.updatedAt, since)));
    const [measRow] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(weeklyMeasurementsTable)
      .where(
        and(eq(weeklyMeasurementsTable.companyId, company.id), gt(weeklyMeasurementsTable.createdAt, since)),
      );
    newActivity = {
      runs: runRow?.n ?? 0,
      actions: actionRow?.n ?? 0,
      measurements: measRow?.n ?? 0,
    };
  }

  res.json(
    GetCaseStudyResponse.parse({
      caseStudy: serializeCaseStudy(caseStudy),
      revisions: revisions.map(serializeRevision),
      activeJob: lastJob?.status === "running" ? serializeJob(lastJob) : null,
      lastJob: lastJob ? serializeJob(lastJob) : null,
      newActivity,
      generationAvailable: isConfigured(),
    }),
  );
});

router.put("/case-study/context", async (req, res): Promise<void> => {
  const body = SaveCaseStudyContextBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const company = await getCompany(body.data.companyId);
  if (!company) {
    res.status(400).json({ error: "Unknown companyId" });
    return;
  }
  const caseStudy = await ensureCaseStudy(company.id);
  const [updated] = await db
    .update(caseStudiesTable)
    .set({
      startingPosition: body.data.startingPosition ?? null,
      strategicFocus: body.data.strategicFocus ?? null,
      contextNotes: body.data.contextNotes ?? null,
      contextUpdatedAt: new Date(),
    })
    .where(eq(caseStudiesTable.id, caseStudy.id))
    .returning();
  res.json(SaveCaseStudyContextResponse.parse(serializeCaseStudy(updated!)));
});

router.post("/case-study/refresh", async (req, res): Promise<void> => {
  const body = RefreshCaseStudyBody.safeParse(req.body);
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
      error: "Model API key is not configured. Add it to generate the story.",
    });
    return;
  }
  try {
    const job = await startCaseStudyRefresh(company);
    res.status(202).json(RefreshCaseStudyResponse.parse(serializeJob(job)));
  } catch (err) {
    if (err instanceof CaseStudyJobRunningError) {
      res.status(409).json({ error: "A story refresh is already running for this company." });
      return;
    }
    throw err;
  }
});

router.get("/case-study/jobs", async (req, res): Promise<void> => {
  const q = ListCaseStudyJobsQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  const jobs = await db
    .select()
    .from(caseStudyJobsTable)
    .where(eq(caseStudyJobsTable.companyId, q.data.companyId))
    .orderBy(desc(caseStudyJobsTable.createdAt))
    .limit(Math.min(q.data.limit ?? 5, 25));
  res.json(ListCaseStudyJobsResponse.parse(jobs.map(serializeJob)));
});

router.patch("/case-study/revisions/:id", async (req, res): Promise<void> => {
  const params = UpdateCaseStudyRevisionParams.safeParse(req.params);
  const body = UpdateCaseStudyRevisionBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({
      error: (params.success ? body : params).error?.message ?? "Invalid input",
    });
    return;
  }
  const [existing] = await db
    .select()
    .from(caseStudyRevisionsTable)
    .where(eq(caseStudyRevisionsTable.id, params.data.id));
  // Company scoping: a revision id from another company must 404, never leak.
  if (!existing || existing.companyId !== body.data.companyId) {
    res.status(404).json({ error: "Revision not found for this company" });
    return;
  }
  const updates: Partial<typeof caseStudyRevisionsTable.$inferInsert> = {};
  if (body.data.editedNarrative !== undefined) {
    updates.editedNarrative =
      body.data.editedNarrative && body.data.editedNarrative.trim().length > 0
        ? body.data.editedNarrative
        : null;
  }
  if (body.data.approved !== undefined) {
    updates.approvedAt = body.data.approved ? new Date() : null;
  }
  if (Object.keys(updates).length === 0) {
    res.json(UpdateCaseStudyRevisionResponse.parse(serializeRevision(existing)));
    return;
  }
  const [updated] = await db
    .update(caseStudyRevisionsTable)
    .set(updates)
    .where(eq(caseStudyRevisionsTable.id, params.data.id))
    .returning();
  res.json(UpdateCaseStudyRevisionResponse.parse(serializeRevision(updated!)));
});

export default router;
