import { Router, type IRouter } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  db,
  strategyIdeasTable,
  strategyItemsTable,
  websiteAssessmentJobsTable,
  websiteAuditFindingsTable,
  websiteAuditQuickWinPromotionsTable,
} from "@workspace/db";
import {
  GetCompanyAuditParams,
  GetCompanyAuditResponse,
  RerunCompanyAuditParams,
  RerunCompanyAuditBody,
  RerunCompanyAuditResponse,
  PromoteAuditQuickWinParams,
  PromoteAuditQuickWinBody,
  PromoteAuditQuickWinResponse,
} from "@workspace/api-zod";
import { getCompany } from "../lib/companyLookup";
import { ManualRerunQuotaError, serializeAssessmentJob, startWebsiteAssessment } from "../lib/websiteAssessmentRunner";
import { findApprovedAuditQuickWin, serializeStoredAudit } from "../lib/auditSerialization";
import {
  IMPACT_WINDOW_DAYS,
  impactRate,
  measureCompanyImpact,
  type ImpactMeasurement,
} from "../lib/auditStrategyImpact";
const router: IRouter = Router();

router.get("/companies/:id/audit", async (req, res): Promise<void> => {
  const params = GetCompanyAuditParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const company = await getCompany(params.data.id);
  if (!company) {
    res.status(404).json({ error: "Company not found" });
    return;
  }
  const [job] = await db.select().from(websiteAssessmentJobsTable)
    .where(eq(websiteAssessmentJobsTable.companyId, company.id))
    .orderBy(desc(websiteAssessmentJobsTable.id)).limit(1);
  if (!job) {
    res.status(404).json({ error: "No website audit exists for this company." });
    return;
  }
  // During a rerun the newest job may still be crawling; return the latest
  // durable audit result while exposing the current job's honest state.
  const [audit] = await db.select().from(websiteAuditFindingsTable)
    .where(eq(websiteAuditFindingsTable.companyId, company.id))
    .orderBy(desc(websiteAuditFindingsTable.id)).limit(1);
  const promotions = audit ? await db.select({
      promotion: websiteAuditQuickWinPromotionsTable,
      item: strategyItemsTable,
    })
    .from(websiteAuditQuickWinPromotionsTable)
    .innerJoin(strategyItemsTable, eq(strategyItemsTable.id, websiteAuditQuickWinPromotionsTable.strategyItemId))
    .where(and(
      eq(websiteAuditQuickWinPromotionsTable.auditId, audit.id),
      eq(websiteAuditQuickWinPromotionsTable.companyId, company.id),
    )) : [];

  const promotionOutcomes = await Promise.all(promotions.map(async ({ promotion, item }) => {
    const baseline = promotion.baseline as ImpactMeasurement;
    const after = item.liveAt
      ? await measureCompanyImpact(
          company.id,
          item.liveAt,
          new Date(Math.min(Date.now(), item.liveAt.getTime() + IMPACT_WINDOW_DAYS * 86_400_000)),
        )
      : null;
    return {
      quickWinCode: promotion.quickWinCode,
      strategyItemId: item.id,
      status: item.status,
      liveAt: item.liveAt?.toISOString() ?? null,
      baseline,
      after,
      citationRateBefore: impactRate(baseline.citedRuns, baseline.eligibleRuns),
      citationRateAfter: after ? impactRate(after.citedRuns, after.eligibleRuns) : null,
      visibilityBefore: impactRate(baseline.visibleRuns, baseline.totalRuns),
      visibilityAfter: after ? impactRate(after.visibleRuns, after.totalRuns) : null,
    };
  }));
  res.json(GetCompanyAuditResponse.parse({
    job: serializeAssessmentJob(job),
    audit: audit ? serializeStoredAudit(audit) : null,
    promotedQuickWinCodes: promotions.map(({ promotion }) => promotion.quickWinCode),
    promotionOutcomes,
  }));
});

router.post("/companies/:id/audit/rerun", async (req, res): Promise<void> => {
  const params = RerunCompanyAuditParams.safeParse(req.params);
  const body = RerunCompanyAuditBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: (params.success ? body : params).error?.message ?? "Invalid input" });
    return;
  }
  const company = await getCompany(params.data.id);
  if (!company) {
    res.status(404).json({ error: "Company not found" });
    return;
  }
  let job;
  try {
    job = await startWebsiteAssessment(company, "manual_rerun");
  } catch (error) {
    if (error instanceof ManualRerunQuotaError) {
      req.log.warn({ companyId: company.id }, "Website audit rerun quota reached");
      res.status(429).json({ error: error.message });
      return;
    }
    throw error;
  }
  if (!job) {
    res.status(409).json({ error: "A website assessment is already running for this company." });
    return;
  }
  req.log.info({ companyId: company.id, jobId: job.id }, "Website audit rerun started");
  res.status(202).json(RerunCompanyAuditResponse.parse(serializeAssessmentJob(job)));
});

router.post("/companies/:id/audit/quick-wins/promote", async (req, res): Promise<void> => {
  const params = PromoteAuditQuickWinParams.safeParse(req.params);
  const body = PromoteAuditQuickWinBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: (params.success ? body : params).error?.message ?? "Invalid input" });
    return;
  }
  const company = await getCompany(params.data.id);
  if (!company) {
    res.status(404).json({ error: "Company not found" });
    return;
  }
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${company.id}, 71)`);
    const [audit] = await tx.select().from(websiteAuditFindingsTable).where(and(
      eq(websiteAuditFindingsTable.id, body.data.auditId),
      eq(websiteAuditFindingsTable.companyId, company.id),
    )).limit(1);
    if (!audit) return { error: "Audit not found" as const };
    const quickWin = findApprovedAuditQuickWin(
      audit.quickWins as Array<Record<string, unknown>>,
      body.data.quickWinCode,
    );
    if (!quickWin) return { error: "Quick win not found in this audit" as const };
    const [existing] = await tx.select({
      promotion: websiteAuditQuickWinPromotionsTable,
      item: strategyItemsTable,
      idea: strategyIdeasTable,
    }).from(websiteAuditQuickWinPromotionsTable)
      .innerJoin(strategyItemsTable, eq(strategyItemsTable.id, websiteAuditQuickWinPromotionsTable.strategyItemId))
      .innerJoin(strategyIdeasTable, eq(strategyIdeasTable.id, strategyItemsTable.ideaId))
      .where(and(
        eq(websiteAuditQuickWinPromotionsTable.auditId, audit.id),
        eq(websiteAuditQuickWinPromotionsTable.quickWinCode, body.data.quickWinCode),
      )).limit(1);
    if (existing) return existing;

    const title = `Website audit: ${String(quickWin["title"])}`;
    let [idea] = await tx.select().from(strategyIdeasTable)
      .where(and(
        sql`lower(btrim(${strategyIdeasTable.title})) = ${title.trim().toLowerCase()}`,
        eq(strategyIdeasTable.category, "on_page"),
      )).limit(1);
    if (!idea) {
      [idea] = await tx.insert(strategyIdeasTable).values({
        title,
        category: "on_page",
        playType: "Website Audit Quick Win",
        description: String(quickWin["recommendation"]),
        rationale: "Evidence-based improvement identified by the deterministic whole-site audit.",
        priority: quickWin["impact"] === "high" ? "P0" : "P1",
      }).returning();
    }
    const evidence = {
      auditId: audit.id,
      jobId: audit.jobId,
      auditVersion: audit.auditVersion,
      auditContext: audit.context,
      quickWinCode: body.data.quickWinCode,
      recommendationFamily: quickWin["family"],
      rationale: quickWin["rationale"],
      evidence: quickWin["evidence"],
      pageUrl: quickWin["pageUrl"] ?? null,
      affectedCount: quickWin["affectedCount"],
      representativeUrls: quickWin["representativeUrls"],
      findingCodes: quickWin["findingCodes"],
      methodology: audit.methodology,
    };
    const baselineEnd = audit.generatedAt;
    const baselineStart = new Date(baselineEnd.getTime() - IMPACT_WINDOW_DAYS * 86_400_000);
    const baseline = await measureCompanyImpact(company.id, baselineStart, baselineEnd);
    const [item] = await tx.insert(strategyItemsTable).values({
      ideaId: idea!.id,
      companyId: company.id,
      status: "not_started",
      notes: `Promoted from website audit quick win: ${body.data.quickWinCode}`,
      brief: evidence,
    }).returning();
    const [promotion] = await tx.insert(websiteAuditQuickWinPromotionsTable).values({
      auditId: audit.id,
      companyId: company.id,
      quickWinCode: body.data.quickWinCode,
      strategyItemId: item!.id,
      baseline,
    }).returning();
    return { promotion: promotion!, item: item!, idea: idea! };
  });
  if ("error" in result) {
    res.status(404).json({ error: result.error });
    return;
  }
  const response = {
    auditId: result.promotion.auditId,
    quickWinCode: result.promotion.quickWinCode,
    strategyItemId: result.item.id,
    ideaId: result.idea.id,
    ideaTitle: result.idea.title,
    category: result.idea.category,
    status: result.item.status,
    evidence: result.item.brief,
    createdAt: result.promotion.createdAt.toISOString(),
  };
  res.json(PromoteAuditQuickWinResponse.parse(response));
});

export default router;
