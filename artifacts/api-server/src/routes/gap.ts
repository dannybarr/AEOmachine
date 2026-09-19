import { Router, type IRouter } from "express";
import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import {
  db,
  citationsTable,
  domainRegistryTable,
  promptRunsTable,
  promptsTable,
  gapResearchJobsTable,
  gapFindingsTable,
  gapEvidenceTable,
  gapTrendsTable,
  gapActionProvenanceTable,
  moneyTopicsTable,
  strategyIdeasTable,
  strategyItemsTable,
  type GapFinding,
  type GapEvidence,
  type GapTrend,
} from "@workspace/db";
import {
  StartGapResearchBody,
  PromoteGapFindingParams,
  PromoteGapFindingBody,
} from "@workspace/api-zod";
import { getCompany } from "../lib/companyLookup";
import {
  startGapResearch,
  isResearchRunning,
  latestResearchJob,
  serializeResearchJob,
} from "../lib/gapResearchRunner";
import {
  recommendationMatchesIdea,
  recommendationEvidenceChannel,
  suggestedIdeaTitle,
} from "../lib/recommendationIdeaMatch";
import {
  evidenceFromGapRow,
  pickBestEvidenceRow,
} from "../lib/actionEvidence";
import { ANALYSIS_VERSION } from "../lib/gapAnalysis";
import {
  getGapResearchFreshness,
  getLatestCompatibleGapResearchJob,
} from "../lib/gapResearchFreshness";

const router: IRouter = Router();

// ─── Research jobs ───

router.post("/gap-analysis/research", async (req, res): Promise<void> => {
  const body = StartGapResearchBody.safeParse(req.body ?? {});
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const company = await getCompany(body.data.companyId);
  if (!company) {
    res.status(400).json({ error: "Unknown companyId" });
    return;
  }
  if (isResearchRunning(company.id)) {
    res.status(409).json({ error: "Research is already running for this company." });
    return;
  }
  const windowDays = Math.min(Math.max(body.data.windowDays ?? 30, 7), 90);
  const job = await startGapResearch(company, windowDays);
  if (!job) {
    res.status(409).json({ error: "Research is already running for this company." });
    return;
  }
  res.status(202).json(serializeResearchJob(job));
});

router.get("/gap-analysis/research/jobs", async (req, res): Promise<void> => {
  const company = await getCompany(Number(req.query["companyId"]));
  if (!company) {
    res.status(400).json({ error: "Unknown companyId" });
    return;
  }
  const limit = Math.min(Math.max(Number(req.query["limit"]) || 5, 1), 25);
  const jobs = await db
    .select()
    .from(gapResearchJobsTable)
    .where(eq(gapResearchJobsTable.companyId, company.id))
    .orderBy(desc(gapResearchJobsTable.id))
    .limit(limit);
  res.json(jobs.map(serializeResearchJob));
});

// ─── Research report (latest completed snapshot) ───

/**
 * Serialize an evidence row using ONLY the immutable snapshot captured at
 * analysis time (page_* columns) — never the live gap_source_pages cache,
 * which later research runs may rewrite.
 */
function serializeEvidence(e: GapEvidence) {
  return {
    id: e.id,
    canonicalUrl: e.canonicalUrl,
    domain: e.domain,
    channel: e.channel,
    isCompetitor: e.isCompetitor,
    citationCount: e.citationCount,
    runCount: e.runCount,
    avgPosition: e.avgPosition,
    bestPosition: e.bestPosition,
    models: (e.models as string[]) ?? [],
    runIds: (e.runIds as number[]) ?? [],
    answerContext: e.answerContext,
    lastSeenAt: e.lastSeenAt ? e.lastSeenAt.toISOString() : null,
    page:
      e.pageFetchStatus && e.pageFetchedAt
        ? {
            fetchStatus: e.pageFetchStatus,
            httpStatus: e.pageHttpStatus,
            title: e.pageTitle,
            snippet: e.pageSnippet,
            signals: (e.pageSignals as Record<string, boolean> | null) ?? null,
            fetchedAt: e.pageFetchedAt.toISOString(),
          }
        : null,
  };
}

function serializeFinding(
  f: GapFinding,
  evidence: ReturnType<typeof serializeEvidence>[],
  promotion: { strategyItemId: number; createdAt: string } | null,
) {
  const recommendation = f.recommendation as Record<string, unknown>;
  return {
    id: f.id,
    promptId: f.promptId,
    promptText: f.promptText,
    topic: f.topic,
    gapType: f.gapType,
    runCount: f.runCount,
    eligibleRunCount: f.eligibleRunCount,
    mentionCount: f.mentionCount,
    citationCount: f.citationCount,
    modelCoverage: f.modelCoverage as Array<Record<string, unknown>>,
    competitors: f.competitors as Array<Record<string, unknown>>,
    recommendation: {
      ...recommendation,
      suggestedIdeaTitle: suggestedIdeaTitle(recommendation),
    },
    lastRunAt: f.lastRunAt ? f.lastRunAt.toISOString() : null,
    evidence,
    promotion,
  };
}

function serializeTrend(t: GapTrend) {
  return {
    id: t.id,
    kind: t.kind,
    title: t.title,
    observation: t.observation,
    hypothesis: t.hypothesis,
    contradictoryEvidence: t.contradictoryEvidence,
    confidence: t.confidence,
    sampleSize: t.sampleSize,
    promptIds: (t.promptIds as number[]) ?? [],
    domain: t.domain,
    channel: t.channel,
    evidence: t.evidence as Array<Record<string, unknown>>,
  };
}

router.get("/gap-analysis/report", async (req, res): Promise<void> => {
  const company = await getCompany(Number(req.query["companyId"]));
  if (!company) {
    res.status(400).json({ error: "Unknown companyId" });
    return;
  }
  const [latest, completedCandidate] = await Promise.all([
    latestResearchJob(company.id, false),
    latestResearchJob(company.id, true),
  ]);
  const completed =
    completedCandidate &&
    completedCandidate.analysisVersion >= ANALYSIS_VERSION
      ? completedCandidate
      : null;
  if (!completed) {
    res.json({
      latestJob: latest ? serializeResearchJob(latest) : null,
      snapshot: null,
    });
    return;
  }

  const findings = await db
    .select()
    .from(gapFindingsTable)
    .where(eq(gapFindingsTable.jobId, completed.id))
    .orderBy(desc(gapFindingsTable.citationCount));
  const findingIds = findings.map((f) => f.id);
  const [evidenceRows, trends, provenance] = await Promise.all([
    findingIds.length
      ? db
          .select()
          .from(gapEvidenceTable)
          .where(inArray(gapEvidenceTable.findingId, findingIds))
          .orderBy(desc(gapEvidenceTable.citationCount))
      : Promise.resolve([]),
    db
      .select()
      .from(gapTrendsTable)
      .where(eq(gapTrendsTable.jobId, completed.id))
      .orderBy(desc(gapTrendsTable.sampleSize)),
    findingIds.length
      ? db
          .select()
          .from(gapActionProvenanceTable)
          .where(inArray(gapActionProvenanceTable.findingId, findingIds))
      : Promise.resolve([]),
  ]);
  const evidenceByFinding = new Map<number, ReturnType<typeof serializeEvidence>[]>();
  for (const e of evidenceRows) {
    const list = evidenceByFinding.get(e.findingId) ?? [];
    list.push(serializeEvidence(e));
    evidenceByFinding.set(e.findingId, list);
  }
  const promotionByFinding = new Map(
    provenance.map((p) => [
      p.findingId,
      { strategyItemId: p.strategyItemId, createdAt: p.createdAt.toISOString() },
    ]),
  );

  res.json({
    latestJob: latest ? serializeResearchJob(latest) : null,
    snapshot: {
      job: serializeResearchJob(completed),
      findings: findings.map((f) =>
        serializeFinding(
          f,
          evidenceByFinding.get(f.id) ?? [],
          promotionByFinding.get(f.id) ?? null,
        ),
      ),
      trends: trends.map(serializeTrend),
    },
  });
});

// ─── Promote a finding into Strategy Actions (with provenance) ───

router.post("/gap-analysis/findings/:id/promote", async (req, res): Promise<void> => {
  const params = PromoteGapFindingParams.safeParse(req.params);
  const body = PromoteGapFindingBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({
      error: (params.success ? body : params).error?.message ?? "Invalid input",
    });
    return;
  }
  const [finding] = await db
    .select()
    .from(gapFindingsTable)
    .where(eq(gapFindingsTable.id, params.data.id));
  if (!finding) {
    res.status(404).json({ error: "Finding not found" });
    return;
  }
  const company = await getCompany(body.data.companyId);
  if (!company || company.id !== finding.companyId) {
    res.status(400).json({ error: "Finding does not belong to this company" });
    return;
  }
  const [researchJob] = await db
    .select({
      status: gapResearchJobsTable.status,
      analysisVersion: gapResearchJobsTable.analysisVersion,
      createdAt: gapResearchJobsTable.createdAt,
      finishedAt: gapResearchJobsTable.finishedAt,
    })
    .from(gapResearchJobsTable)
    .where(eq(gapResearchJobsTable.id, finding.jobId));
  if (
    !researchJob ||
    researchJob.status !== "completed" ||
    researchJob.analysisVersion < ANALYSIS_VERSION
  ) {
    res.status(409).json({
      error:
        "This finding predates verified citation provenance. Refresh Gap Analysis before promoting it as evidence-backed.",
    });
    return;
  }
  const latestCompatibleJob = await getLatestCompatibleGapResearchJob(company.id);
  if (!latestCompatibleJob || latestCompatibleJob.id !== finding.jobId) {
    res.status(409).json({
      error:
        "A newer completed Gap Analysis has superseded this finding. Use the latest report before promoting evidence-backed work.",
    });
    return;
  }
  const researchFreshness = await getGapResearchFreshness(
    company.id,
    researchJob.finishedAt ?? researchJob.createdAt,
  );
  if (!researchFreshness.isFresh) {
    res.status(409).json({
      error: `Refresh Gap Analysis before promoting this finding as evidence-backed because ${researchFreshness.staleReason}.`,
    });
    return;
  }
  const [idea] = await db
    .select()
    .from(strategyIdeasTable)
    .where(eq(strategyIdeasTable.id, body.data.ideaId));
  if (!idea) {
    res.status(404).json({ error: "Strategy idea not found" });
    return;
  }
  const recommendation = finding.recommendation as Record<string, unknown>;
  if (!recommendationMatchesIdea(recommendation, idea)) {
    res.status(400).json({
      error:
        recommendation["status"] !== "proposed"
          ? "Only proposed research recommendations can be promoted"
          : "Selected idea does not match this research recommendation",
    });
    return;
  }
  if (idea.category !== body.data.category) {
    res.status(400).json({
      error: `Selected idea is ${idea.category === "on_page" ? "onsite" : "offsite"}, but ${body.data.category === "on_page" ? "onsite" : "offsite"} was requested.`,
    });
    return;
  }
  if (body.data.moneyTopicId != null) {
    const [topic] = await db
      .select()
      .from(moneyTopicsTable)
      .where(eq(moneyTopicsTable.id, body.data.moneyTopicId));
    if (!topic || topic.companyId !== company.id) {
      res.status(404).json({ error: "Money topic not found for this company" });
      return;
    }
  }
  const [existing] = await db
    .select()
    .from(gapActionProvenanceTable)
    .where(eq(gapActionProvenanceTable.findingId, finding.id));
  if (existing) {
    res.status(409).json({
      error: "This finding was already promoted to a strategy action.",
    });
    return;
  }

  const evidence = await db
    .select()
    .from(gapEvidenceTable)
    .where(eq(gapEvidenceTable.findingId, finding.id))
    .orderBy(desc(gapEvidenceTable.citationCount));
  const recommendationEvidenceUrls = Array.isArray(
    recommendation["evidenceUrls"],
  )
    ? recommendation["evidenceUrls"].filter(
        (url): url is string => typeof url === "string",
      )
    : [];
  const recommendationChannel = recommendationEvidenceChannel(recommendation);
  const supportingEvidence = recommendationChannel
    ? evidence.filter(
        (row) =>
          row.channel === recommendationChannel &&
          recommendationEvidenceUrls.includes(row.canonicalUrl),
      )
    : [];
  const evidenceUrls = supportingEvidence
    .slice(0, 8)
    .map((row) => row.canonicalUrl);
  const runIds = [
    ...new Set(
      supportingEvidence.flatMap((row) => (row.runIds as number[]) ?? []),
    ),
  ];
  const peerExample = recommendationChannel
    ? pickBestEvidenceRow(evidence, {
        evidenceUrls: recommendationEvidenceUrls,
        channel: recommendationChannel,
      })
    : null;
  const surfacedCompetitor = (
    (finding.competitors as Array<{
      domain?: unknown;
      name?: unknown;
      runsSurfaced?: unknown;
    }>) ?? []
  )
    .filter(
      (competitor) =>
        (typeof competitor.name === "string" ||
          typeof competitor.domain === "string") &&
        typeof competitor.runsSurfaced === "number" &&
        competitor.runsSurfaced > 0,
    )
    .sort(
      (a, b) =>
        (b.runsSurfaced as number) - (a.runsSurfaced as number),
    )[0];
  const surfacedCompany =
    (typeof surfacedCompetitor?.name === "string" &&
      surfacedCompetitor.name) ||
    (typeof surfacedCompetitor?.domain === "string" &&
      surfacedCompetitor.domain) ||
    null;
  const rationale =
    typeof recommendation["rationale"] === "string"
      ? recommendation["rationale"]
      : null;

  const [item] = await db
    .insert(strategyItemsTable)
    .values({
      ideaId: idea.id,
      companyId: company.id,
      moneyTopic: body.data.moneyTopic ?? finding.topic,
      moneyTopicId: body.data.moneyTopicId ?? null,
      status: "not_started",
      notes: body.data.notes ?? null,
      brief: body.data.brief ?? null,
      targetDate: body.data.targetDate ?? null,
    })
    .returning();

  try {
    await db.insert(gapActionProvenanceTable).values({
      strategyItemId: item!.id,
      findingId: finding.id,
      jobId: finding.jobId,
      promptId: finding.promptId,
      evidenceSnapshot: {
        promptText: finding.promptText,
        topic: finding.topic,
        category: body.data.category,
        evidenceUrls,
        runIds,
        rationale,
        example: peerExample && surfacedCompany
          ? evidenceFromGapRow(peerExample, rationale, surfacedCompany)
          : null,
        analysisJobId: finding.jobId,
      },
    });
  } catch (err) {
    // Race: another request promoted the same finding — undo and report.
    await db.delete(strategyItemsTable).where(eq(strategyItemsTable.id, item!.id));
    res.status(409).json({ error: "This finding was already promoted to a strategy action." });
    return;
  }

  res.status(201).json({
    strategyItemId: item!.id,
    findingId: finding.id,
    ideaId: idea.id,
    category: idea.category,
    createdAt: item!.createdAt.toISOString(),
  });
});

router.get("/gap-analysis", async (req, res): Promise<void> => {
  const company = await getCompany(Number(req.query["companyId"]));
  if (!company) {
    res.status(400).json({ error: "Unknown companyId" });
    return;
  }
  const days = Math.min(Math.max(Number(req.query["days"]) || 30, 1), 365);
  const cutoff = sql`now() - make_interval(days => ${days})`;

  // Per-prompt run/mention counts within the window.
  const promptStats = await db
    .select({
      promptId: promptsTable.id,
      text: promptsTable.text,
      topic: promptsTable.topic,
      runCount: sql<number>`count(${promptRunsTable.id})::int`,
      mentionCount: sql<number>`count(${promptRunsTable.id}) filter (where ${promptRunsTable.brandMentioned})::int`,
    })
    .from(promptsTable)
    .innerJoin(
      promptRunsTable,
      sql`${promptRunsTable.promptId} = ${promptsTable.id} and ${promptRunsTable.createdAt} > ${cutoff}`,
    )
    .where(eq(promptsTable.companyId, company.id))
    .groupBy(promptsTable.id, promptsTable.text, promptsTable.topic);

  const gapPromptIds = promptStats
    .filter((p) => p.runCount > 0 && p.mentionCount === 0)
    .map((p) => p.promptId);

  // Top cited domains for each gap prompt (who wins where the brand is absent).
  const topDomainsByPrompt = new Map<number, string[]>();
  if (gapPromptIds.length > 0) {
    const rows = await db
      .select({
        promptId: promptRunsTable.promptId,
        domain: citationsTable.domain,
        retrievals: sql<number>`count(*)::int`,
      })
      .from(citationsTable)
      .innerJoin(promptRunsTable, eq(promptRunsTable.id, citationsTable.runId))
      .where(
        sql`${inArray(promptRunsTable.promptId, gapPromptIds)} and ${promptRunsTable.createdAt} > ${cutoff}`,
      )
      .groupBy(promptRunsTable.promptId, citationsTable.domain)
      .orderBy(sql`count(*) desc`);
    for (const row of rows) {
      const list = topDomainsByPrompt.get(row.promptId) ?? [];
      if (list.length < 3) {
        list.push(row.domain);
        topDomainsByPrompt.set(row.promptId, list);
      }
    }
  }

  const promptGaps = promptStats
    .filter((p) => p.runCount > 0 && p.mentionCount === 0)
    .map((p) => ({
      promptId: p.promptId,
      text: p.text,
      topic: p.topic,
      runCount: p.runCount,
      mentionCount: p.mentionCount,
      topDomains: topDomainsByPrompt.get(p.promptId) ?? [],
    }))
    .sort((a, b) => b.runCount - a.runCount);

  // Citation share: this company's domains vs its tracked competitors,
  // from real citations of its own prompt runs.
  const [totalRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(citationsTable)
    .innerJoin(promptRunsTable, eq(promptRunsTable.id, citationsTable.runId))
    .innerJoin(promptsTable, eq(promptsTable.id, promptRunsTable.promptId))
    .where(
      and(eq(promptsTable.companyId, company.id), gt(promptRunsTable.createdAt, cutoff)),
    );
  const totalRetrievals = totalRow?.total ?? 0;

  const shareRows = await db
    .select({
      domain: domainRegistryTable.domain,
      domainType: domainRegistryTable.domainType,
      isOwned: domainRegistryTable.isOwned,
      retrievals: sql<number>`coalesce(count(${citationsTable.id}) filter (where ${promptRunsTable.createdAt} > ${cutoff} and ${promptsTable.companyId} = ${company.id}), 0)::int`,
    })
    .from(domainRegistryTable)
    .leftJoin(citationsTable, eq(citationsTable.domain, domainRegistryTable.domain))
    .leftJoin(promptRunsTable, eq(promptRunsTable.id, citationsTable.runId))
    .leftJoin(promptsTable, eq(promptsTable.id, promptRunsTable.promptId))
    .where(
      sql`${domainRegistryTable.companyId} = ${company.id} and (${domainRegistryTable.domainType} in ('you', 'competitor') or ${domainRegistryTable.isOwned})`,
    )
    .groupBy(
      domainRegistryTable.domain,
      domainRegistryTable.domainType,
      domainRegistryTable.isOwned,
    );

  const competitorShare = shareRows
    .map((r) => ({
      domain: r.domain,
      domainType: r.domainType,
      isYou: r.domainType === "you" || r.isOwned,
      retrievals: r.retrievals,
      sharePct:
        totalRetrievals > 0
          ? Math.round((r.retrievals / totalRetrievals) * 1000) / 10
          : 0,
    }))
    .sort((a, b) => b.retrievals - a.retrievals);

  res.json({ promptGaps, competitorShare, totalRetrievals });
});

export default router;
