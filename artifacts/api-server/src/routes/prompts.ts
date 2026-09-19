import { Router, type IRouter } from "express";
import { eq, desc, sql, and, ilike, inArray, gte, type SQL } from "drizzle-orm";
import {
  db,
  promptsTable,
  promptRunsTable,
  citationsTable,
  moneyTopicsTable,
  runAnswerEntitiesTable,
} from "@workspace/db";
import {
  ListPromptsQueryParams,
  ListPromptsResponse,
  CreatePromptBody,
  CreatePromptResponse,
  GetPromptParams,
  GetPromptResponse,
  UpdatePromptParams,
  UpdatePromptBody,
  UpdatePromptResponse,
  DeletePromptParams,
  SimulatePromptParams,
  SimulatePromptBody,
  SimulatePromptResponse,
  ListPromptRunsParams,
  ListPromptRunsResponse,
  GetPromptInsightsParams,
  GetPromptInsightsQueryParams,
  GetPromptInsightsResponse,
} from "@workspace/api-zod";
import { isConfigured } from "../lib/simulate";
import { executeAndStoreSimulation, defaultModels } from "../lib/trackingRunner";
import { citationMixBucket, type CitationMixBucket } from "../lib/domainClassify";
import { resolveModelStrict, UnknownModelError, getModel } from "../lib/modelRegistry";
import { getCompany } from "../lib/companyLookup";
import { utcWindowStart } from "../lib/timeWindow";
import { ENTITY_EXTRACTOR_VERSION } from "../lib/entityExtraction";
import { runAttemptsTable } from "@workspace/db";
import { aggregateModelCitationSources } from "../lib/modelCitationSources";

const router: IRouter = Router();

/**
 * Validate a user-supplied model list against the canonical registry.
 * Legacy ids are normalized; unknown ids are rejected with a 400 rather
 * than silently substituted.
 */
function normalizeModels(models: string[]): { ok: true; models: string[] } | { ok: false; error: string } {
  const out: string[] = [];
  for (const id of models) {
    try {
      const resolved = resolveModelStrict(id);
      if (!out.includes(resolved)) out.push(resolved);
    } catch (err) {
      if (err instanceof UnknownModelError) return { ok: false, error: err.message };
      throw err;
    }
  }
  return { ok: true, models: out };
}

interface PromptStats {
  runCount: number;
  lastVisibilityPct: number | null;
  lastRunAt: string | null;
}

async function promptStats(promptIds: number[]): Promise<Map<number, PromptStats>> {
  const map = new Map<number, PromptStats>();
  if (promptIds.length === 0) return map;
  const rows = await db
    .select({
      promptId: promptRunsTable.promptId,
      runCount: sql<number>`count(*)::int`,
      visibility: sql<number>`100.0 * avg(CASE WHEN ${promptRunsTable.brandMentioned} THEN 1 ELSE 0 END)`,
      lastRunAt: sql<string>`max(${promptRunsTable.createdAt})`,
    })
    .from(promptRunsTable)
    .where(inArray(promptRunsTable.promptId, promptIds))
    .groupBy(promptRunsTable.promptId);
  for (const r of rows) {
    map.set(r.promptId, {
      runCount: r.runCount,
      lastVisibilityPct: Math.round(Number(r.visibility) * 10) / 10,
      lastRunAt: new Date(r.lastRunAt).toISOString(),
    });
  }
  return map;
}

/** Resolve the linked money-topic name for a prompt, if any. */
async function moneyTopicName(moneyTopicId: number | null): Promise<string | null> {
  if (moneyTopicId === null) return null;
  const [t] = await db
    .select({ topic: moneyTopicsTable.topic })
    .from(moneyTopicsTable)
    .where(eq(moneyTopicsTable.id, moneyTopicId));
  return t?.topic ?? null;
}

function serializePrompt(
  p: typeof promptsTable.$inferSelect,
  stats: PromptStats | undefined,
  topicName: string | null = null,
) {
  return {
    id: p.id,
    text: p.text,
    topic: p.topic,
    moneyTopicId: p.moneyTopicId,
    moneyTopicName: topicName,
    tags: p.tags,
    models: p.models.length > 0 ? p.models : defaultModels(),
    active: p.active,
    createdAt: p.createdAt.toISOString(),
    runCount: stats?.runCount ?? 0,
    lastVisibilityPct: stats?.lastVisibilityPct ?? null,
    lastRunAt: stats?.lastRunAt ?? null,
  };
}

async function serializeRun(run: typeof promptRunsTable.$inferSelect, promptText: string) {
  const [{ value }] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(citationsTable)
    .where(eq(citationsTable.runId, run.id));
  return {
    id: run.id,
    promptId: run.promptId,
    promptText,
    model: run.model,
    brandMentioned: run.brandMentioned,
    brandPosition: run.brandPosition,
    createdAt: run.createdAt.toISOString(),
    citationCount: value,
    answerPreview: run.answerText.slice(0, 200),
    searchStatus: run.searchStatus ?? null,
    citationEligible: run.citationEligible ?? null,
  };
}

router.get("/prompts", async (req, res): Promise<void> => {
  const q = ListPromptsQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  const company = await getCompany(q.data.companyId);
  if (!company) {
    res.status(400).json({ error: "Unknown companyId" });
    return;
  }
  const conditions: SQL[] = [eq(promptsTable.companyId, company.id)];
  if (q.data.topic) conditions.push(eq(promptsTable.topic, q.data.topic));
  if (q.data.tag) conditions.push(sql`${q.data.tag} = ANY(${promptsTable.tags})`);
  if (q.data.search) conditions.push(ilike(promptsTable.text, `%${q.data.search}%`));

  const rows = await db
    .select({ prompt: promptsTable, topicName: moneyTopicsTable.topic })
    .from(promptsTable)
    .leftJoin(moneyTopicsTable, eq(moneyTopicsTable.id, promptsTable.moneyTopicId))
    .where(and(...conditions))
    .orderBy(desc(promptsTable.createdAt));

  const stats = await promptStats(rows.map((r) => r.prompt.id));
  res.json(
    ListPromptsResponse.parse(
      rows.map(({ prompt, topicName }) =>
        serializePrompt(prompt, stats.get(prompt.id), topicName),
      ),
    ),
  );
});

router.post("/prompts", async (req, res): Promise<void> => {
  const parsed = CreatePromptBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const company = await getCompany(parsed.data.companyId);
  if (!company) {
    res.status(400).json({ error: "Unknown companyId" });
    return;
  }
  const normalized = normalizeModels(parsed.data.models ?? defaultModels());
  if (!normalized.ok) {
    res.status(400).json({ error: normalized.error });
    return;
  }
  let topicName: string | null = null;
  if (parsed.data.moneyTopicId != null) {
    const [topic] = await db
      .select()
      .from(moneyTopicsTable)
      .where(eq(moneyTopicsTable.id, parsed.data.moneyTopicId));
    if (!topic || topic.companyId !== company.id) {
      res.status(400).json({ error: "Money topic not found for this company" });
      return;
    }
    topicName = topic.topic;
  }
  const [prompt] = await db
    .insert(promptsTable)
    .values({
      companyId: company.id,
      text: parsed.data.text,
      topic: parsed.data.topic,
      moneyTopicId: parsed.data.moneyTopicId ?? null,
      tags: parsed.data.tags ?? [],
      models: normalized.models,
    })
    .returning();
  res
    .status(201)
    .json(CreatePromptResponse.parse(serializePrompt(prompt!, undefined, topicName)));
});

router.get("/prompts/:id", async (req, res): Promise<void> => {
  const params = GetPromptParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [prompt] = await db
    .select()
    .from(promptsTable)
    .where(eq(promptsTable.id, params.data.id));
  if (!prompt) {
    res.status(404).json({ error: "Prompt not found" });
    return;
  }
  const stats = await promptStats([prompt.id]);
  const runs = await db
    .select()
    .from(promptRunsTable)
    .where(eq(promptRunsTable.promptId, prompt.id))
    .orderBy(desc(promptRunsTable.createdAt))
    .limit(10);
  const recentRuns = [];
  for (const run of runs) {
    recentRuns.push(await serializeRun(run, prompt.text));
  }
  res.json(
    GetPromptResponse.parse({
      ...serializePrompt(
        prompt,
        stats.get(prompt.id),
        await moneyTopicName(prompt.moneyTopicId),
      ),
      recentRuns,
    }),
  );
});

router.patch("/prompts/:id", async (req, res): Promise<void> => {
  const params = UpdatePromptParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdatePromptBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [existing] = await db
    .select()
    .from(promptsTable)
    .where(eq(promptsTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Prompt not found" });
    return;
  }
  if (parsed.data.moneyTopicId != null) {
    const [topic] = await db
      .select()
      .from(moneyTopicsTable)
      .where(eq(moneyTopicsTable.id, parsed.data.moneyTopicId));
    if (!topic || topic.companyId !== existing.companyId) {
      res.status(400).json({ error: "Money topic not found for this company" });
      return;
    }
  }
  let update = parsed.data;
  if (update.models) {
    const normalized = normalizeModels(update.models);
    if (!normalized.ok) {
      res.status(400).json({ error: normalized.error });
      return;
    }
    update = { ...update, models: normalized.models };
  }
  const [prompt] = await db
    .update(promptsTable)
    .set(update)
    .where(eq(promptsTable.id, params.data.id))
    .returning();
  if (!prompt) {
    res.status(404).json({ error: "Prompt not found" });
    return;
  }
  const stats = await promptStats([prompt.id]);
  res.json(
    UpdatePromptResponse.parse(
      serializePrompt(
        prompt,
        stats.get(prompt.id),
        await moneyTopicName(prompt.moneyTopicId),
      ),
    ),
  );
});

router.delete("/prompts/:id", async (req, res): Promise<void> => {
  const params = DeletePromptParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [deleted] = await db
    .delete(promptsTable)
    .where(eq(promptsTable.id, params.data.id))
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Prompt not found" });
    return;
  }
  res.sendStatus(204);
});

// Simulations call a paid model API with a server-held key: bound concurrency
// and rate to protect against runaway cost from unauthenticated callers.
const SIM_MAX_CONCURRENT = 2;
const SIM_MAX_PER_WINDOW = 30;
const SIM_WINDOW_MS = 10 * 60 * 1000;
let simInFlight = 0;
let simWindowStart = Date.now();
let simWindowCount = 0;

function acquireSimulationSlot(): { ok: true } | { ok: false; error: string } {
  const now = Date.now();
  if (now - simWindowStart > SIM_WINDOW_MS) {
    simWindowStart = now;
    simWindowCount = 0;
  }
  if (simInFlight >= SIM_MAX_CONCURRENT) {
    return { ok: false, error: "Too many simulations running. Try again in a moment." };
  }
  if (simWindowCount >= SIM_MAX_PER_WINDOW) {
    return { ok: false, error: "Simulation rate limit reached. Try again in a few minutes." };
  }
  simInFlight += 1;
  simWindowCount += 1;
  return { ok: true };
}

router.post("/prompts/:id/simulate", async (req, res): Promise<void> => {
  const params = SimulatePromptParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = SimulatePromptBody.safeParse(req.body ?? {});
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const [prompt] = await db
    .select()
    .from(promptsTable)
    .where(eq(promptsTable.id, params.data.id));
  if (!prompt) {
    res.status(404).json({ error: "Prompt not found" });
    return;
  }
  if (!isConfigured()) {
    res.status(503).json({
      error:
        "OpenAI API key is not configured. Add the OPENAI_API_KEY secret to run real simulations.",
    });
    return;
  }

  const slot = acquireSimulationSlot();
  if (!slot.ok) {
    res.status(429).json({ error: slot.error });
    return;
  }

  const company = await getCompany(prompt.companyId);
  if (!company) {
    simInFlight -= 1;
    res.status(409).json({ error: "The prompt's company no longer exists." });
    return;
  }
  let run;
  try {
    const model = body.data.model ?? defaultModels()[0];
    if (!model) {
      res.status(503).json({ error: "No models are currently available in the registry." });
      return;
    }
    run = await executeAndStoreSimulation(prompt, company, model);
  } catch (err) {
    if (err instanceof UnknownModelError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  } finally {
    simInFlight -= 1;
  }

  res.status(201).json(SimulatePromptResponse.parse(await serializeRun(run, prompt.text)));
});

router.get("/prompts/:id/runs", async (req, res): Promise<void> => {
  const params = ListPromptRunsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [prompt] = await db
    .select()
    .from(promptsTable)
    .where(eq(promptsTable.id, params.data.id));
  if (!prompt) {
    res.status(404).json({ error: "Prompt not found" });
    return;
  }
  const runs = await db
    .select()
    .from(promptRunsTable)
    .where(eq(promptRunsTable.promptId, prompt.id))
    .orderBy(desc(promptRunsTable.createdAt));
  const out = [];
  for (const run of runs) {
    out.push(await serializeRun(run, prompt.text));
  }
  res.json(ListPromptRunsResponse.parse(out));
});

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

router.get("/prompts/:id/insights", async (req, res): Promise<void> => {
  const params = GetPromptInsightsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const q = GetPromptInsightsQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  const [prompt] = await db
    .select()
    .from(promptsTable)
    .where(eq(promptsTable.id, params.data.id));
  if (!prompt) {
    res.status(404).json({ error: "Prompt not found" });
    return;
  }

  const days = Math.min(Math.max(q.data.days ?? 30, 7), 365);
  // Shared UTC calendar window math — same as /progress so both pages agree.
  const cutoff = utcWindowStart(days);
  const startMs = cutoff.getTime();
  const prevCutoff = new Date(startMs - days * 86400_000);

  const runs = await db
    .select({
      id: promptRunsTable.id,
      model: promptRunsTable.model,
      brandMentioned: promptRunsTable.brandMentioned,
      brandPosition: promptRunsTable.brandPosition,
      citationEligible: promptRunsTable.citationEligible,
      answerText: promptRunsTable.answerText,
      entityExtractionStatus: promptRunsTable.entityExtractionStatus,
      entityExtractorVersion: promptRunsTable.entityExtractorVersion,
      createdAt: promptRunsTable.createdAt,
    })
    .from(promptRunsTable)
    .where(
      and(eq(promptRunsTable.promptId, prompt.id), gte(promptRunsTable.createdAt, prevCutoff)),
    );

  const windowRuns = runs.filter((r) => r.createdAt >= cutoff);
  const prevRuns = runs.filter((r) => r.createdAt < cutoff);

  const visibility = (rs: typeof runs): number | null =>
    rs.length === 0
      ? null
      : round1((100 * rs.filter((r) => r.brandMentioned).length) / rs.length);

  const visibilityPct = visibility(windowRuns);
  const prevVisibility = visibility(prevRuns);
  const visibilityDelta =
    visibilityPct !== null && prevVisibility !== null
      ? round1(visibilityPct - prevVisibility)
      : null;

  const positions = windowRuns
    .map((r) => r.brandPosition)
    .filter((p): p is number => p !== null);
  const avgBrandPosition =
    positions.length > 0
      ? round1(positions.reduce((a, b) => a + b, 0) / positions.length)
      : null;

  const windowRunIds = windowRuns.map((r) => r.id);
  const citationRows =
    windowRunIds.length === 0
      ? []
      : await db
          .select({
            runId: citationsTable.runId,
            domain: citationsTable.domain,
            url: citationsTable.url,
            domainType: citationsTable.domainType,
            position: citationsTable.position,
            provenance: citationsTable.provenance,
          })
          .from(citationsTable)
          .innerJoin(promptRunsTable, eq(promptRunsTable.id, citationsTable.runId))
          .where(
            and(
              inArray(citationsTable.runId, windowRunIds),
              // Verified-citation predicate: provider provenance AND a
              // confirmed-eligible run. All insight aggregates (sources,
              // charts, series, per-model counts) are verified-only.
              eq(citationsTable.provenance, "provider"),
              sql`${promptRunsTable.citationEligible} is true`,
            ),
          );

  const eligibleRunIds = new Set(
    windowRuns.filter((r) => r.citationEligible === true).map((r) => r.id),
  );
  const eligibleRunCount = eligibleRunIds.size;
  const verifiedRetrievals = citationRows.filter(
    (c) => c.provenance === "provider" && eligibleRunIds.has(c.runId),
  ).length;

  const runDateById = new Map<number, Date>();
  for (const r of windowRuns) runDateById.set(r.id, r.createdAt);

  interface DayAgg {
    runs: number;
    mentioned: number;
    positions: number[];
    owned: number;
    competitor: number;
    corporate: number;
    directory: number;
    comparison: number;
    ugc: number;
    editorial: number;
    institutional: number;
    other: number;
  }
  const byDay = new Map<string, DayAgg>();
  for (let i = 0; i < days; i++) {
    const date = new Date(startMs + i * 86400_000).toISOString().slice(0, 10);
    byDay.set(date, {
      runs: 0,
      mentioned: 0,
      positions: [],
      owned: 0,
      competitor: 0,
      corporate: 0,
      directory: 0,
      comparison: 0,
      ugc: 0,
      editorial: 0,
      institutional: 0,
      other: 0,
    });
  }
  for (const r of windowRuns) {
    const day = byDay.get(r.createdAt.toISOString().slice(0, 10));
    if (!day) continue;
    day.runs += 1;
    if (r.brandMentioned) day.mentioned += 1;
    if (r.brandPosition !== null) day.positions.push(r.brandPosition);
  }
  const typeCounts: Record<CitationMixBucket, number> = {
    owned: 0,
    competitor: 0,
    corporate: 0,
    directory: 0,
    comparison: 0,
    ugc: 0,
    editorial: 0,
    institutional: 0,
    other: 0,
  };
  for (const c of citationRows) {
    const bucket = citationMixBucket(c.domainType);
    typeCounts[bucket] += 1;
    const runDate = runDateById.get(c.runId);
    const day = runDate ? byDay.get(runDate.toISOString().slice(0, 10)) : undefined;
    if (day) day[bucket] += 1;
  }

  const series = [...byDay.entries()].map(([date, d]) => ({
    date,
    runs: d.runs,
    retrievals:
      d.owned +
      d.competitor +
      d.corporate +
      d.directory +
      d.comparison +
      d.ugc +
      d.editorial +
      d.institutional +
      d.other,
    visibilityPct: d.runs > 0 ? round1((100 * d.mentioned) / d.runs) : null,
    avgBrandPosition:
      d.positions.length > 0
        ? round1(d.positions.reduce((a, b) => a + b, 0) / d.positions.length)
        : null,
    ownedCitations: d.owned,
    competitorCitations: d.competitor,
    corporateCitations: d.corporate,
    directoryCitations: d.directory,
    comparisonCitations: d.comparison,
    ugcCitations: d.ugc,
    editorialCitations: d.editorial,
    institutionalCitations: d.institutional,
    otherCitations: d.other,
  }));

  const totalRetrievals = citationRows.length;
  const sourceTypes = (
    Object.entries(typeCounts) as [keyof typeof typeCounts, number][]
  )
    .filter(([, count]) => count > 0)
    .map(([type, retrievals]) => ({
      type,
      retrievals,
      pct: totalRetrievals > 0 ? round1((100 * retrievals) / totalRetrievals) : 0,
    }))
    .sort((a, b) => b.retrievals - a.retrievals);

  // Per-domain source table: retrieval count, avg citation position,
  // last seen, and the most-cited URL for that domain.
  interface SourceAgg {
    domainType: string;
    retrievals: number;
    positions: number[];
    lastSeen: Date;
    urlCounts: Map<string, number>;
  }
  const byDomain = new Map<string, SourceAgg>();
  for (const c of citationRows) {
    const runDate = runDateById.get(c.runId);
    if (!runDate) continue;
    let agg = byDomain.get(c.domain);
    if (!agg) {
      agg = {
        domainType: c.domainType,
        retrievals: 0,
        positions: [],
        lastSeen: runDate,
        urlCounts: new Map(),
      };
      byDomain.set(c.domain, agg);
    }
    agg.retrievals += 1;
    agg.positions.push(c.position);
    if (runDate > agg.lastSeen) {
      agg.lastSeen = runDate;
      agg.domainType = c.domainType;
    }
    if (c.url) agg.urlCounts.set(c.url, (agg.urlCounts.get(c.url) ?? 0) + 1);
  }
  const sources = [...byDomain.entries()]
    .map(([domain, agg]) => ({
      domain,
      domainType: agg.domainType,
      retrievals: agg.retrievals,
      avgPosition:
        agg.positions.length > 0
          ? round1(agg.positions.reduce((a, b) => a + b, 0) / agg.positions.length)
          : null,
      lastSeenAt: agg.lastSeen.toISOString(),
      topUrl:
        [...agg.urlCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null,
    }))
    .sort((a, b) => b.retrievals - a.retrievals)
    .slice(0, 50);

  const runById = new Map(windowRuns.map((run) => [run.id, run]));
  const entityRows =
    windowRunIds.length === 0
      ? []
      : await db
          .select({
            runId: runAnswerEntitiesTable.runId,
            name: runAnswerEntitiesTable.name,
            normalizedName: runAnswerEntitiesTable.normalizedName,
            observedReason: runAnswerEntitiesTable.observedReason,
            evidenceExcerpt: runAnswerEntitiesTable.evidenceExcerpt,
          })
          .from(runAnswerEntitiesTable)
          .where(
            and(
              inArray(runAnswerEntitiesTable.runId, windowRunIds),
              eq(runAnswerEntitiesTable.extractorVersion, ENTITY_EXTRACTOR_VERSION),
            ),
          );

  const analyzedRuns = windowRuns.filter(
    (run) =>
      run.entityExtractionStatus === "completed" &&
      run.entityExtractorVersion === ENTITY_EXTRACTOR_VERSION,
  );
  const pendingRuns = windowRuns.filter(
    (run) =>
      run.entityExtractorVersion !== ENTITY_EXTRACTOR_VERSION ||
      run.entityExtractionStatus === null ||
      run.entityExtractionStatus === "pending" ||
      run.entityExtractionStatus === "running",
  );
  const failedRuns = windowRuns.filter(
    (run) =>
      run.entityExtractionStatus === "failed" &&
      run.entityExtractorVersion === ENTITY_EXTRACTOR_VERSION,
  );

  interface EntityAgg {
    name: string;
    runIds: Set<number>;
    models: Set<string>;
    latest: {
      runId: number;
      createdAt: Date;
      observedReason: string;
      evidenceExcerpt: string;
    };
  }
  const byEntity = new Map<string, EntityAgg>();
  for (const entity of entityRows) {
    const run = runById.get(entity.runId);
    if (!run) continue;
    let agg = byEntity.get(entity.normalizedName);
    if (!agg) {
      agg = {
        name: entity.name,
        runIds: new Set(),
        models: new Set(),
        latest: {
          runId: run.id,
          createdAt: run.createdAt,
          observedReason: entity.observedReason,
          evidenceExcerpt: entity.evidenceExcerpt,
        },
      };
      byEntity.set(entity.normalizedName, agg);
    }
    agg.runIds.add(run.id);
    agg.models.add(run.model);
    if (run.createdAt > agg.latest.createdAt) {
      agg.name = entity.name;
      agg.latest = {
        runId: run.id,
        createdAt: run.createdAt,
        observedReason: entity.observedReason,
        evidenceExcerpt: entity.evidenceExcerpt,
      };
    }
  }
  const mentionedEntities = [...byEntity.values()]
    .map((agg) => {
      const appearances = agg.runIds.size;
      return {
        name: agg.name,
        appearances,
        shareOfAnalyzedAnswersPct:
          analyzedRuns.length > 0 ? round1((100 * appearances) / analyzedRuns.length) : 0,
        models: [...agg.models].sort(),
        lastSeenAt: agg.latest.createdAt.toISOString(),
        evidenceRunId: agg.latest.runId,
        evidenceExcerpt: agg.latest.evidenceExcerpt,
        observedReason: agg.latest.observedReason,
        strategyCategory: null,
        strategyRationale:
          appearances >= 2
            ? `This entity appeared across ${appearances} analyzed answers. Review the surrounding wording and the separate cited-source mix before deciding whether an on-page or off-page investigation is warranted.`
            : "This is one observed answer mention, not enough evidence for a strategy recommendation by itself. Review the original answer and the separate cited-source mix before acting.",
      };
    })
    .sort(
      (a, b) =>
        b.appearances - a.appearances ||
        a.name.localeCompare(b.name),
    )
    .slice(0, 50);

  const lastRunAll = await db
    .select({ createdAt: sql<string>`max(${promptRunsTable.createdAt})` })
    .from(promptRunsTable)
    .where(eq(promptRunsTable.promptId, prompt.id));

  // Per-model coverage: sample sizes, outcomes, and citation eligibility so
  // the landscape view is honest about what each figure is based on.
  const attemptRows = await db
    .select({
      model: runAttemptsTable.model,
      failed: sql<number>`count(*) filter (where ${runAttemptsTable.outcome} = 'failed')::int`,
    })
    .from(runAttemptsTable)
    .where(
      and(eq(runAttemptsTable.promptId, prompt.id), gte(runAttemptsTable.createdAt, cutoff)),
    )
    .groupBy(runAttemptsTable.model);
  const failedByModel = new Map(attemptRows.map((a) => [a.model, a.failed]));

  const citationsByRun = new Map<number, number>();
  for (const c of citationRows) {
    citationsByRun.set(c.runId, (citationsByRun.get(c.runId) ?? 0) + 1);
  }
  const modelSources = aggregateModelCitationSources(
    citationRows.flatMap((citation) => {
      const run = runById.get(citation.runId);
      return run
        ? [{
            runId: run.id,
            model: run.model,
            brandMentioned: run.brandMentioned,
            domain: citation.domain,
            domainType: citation.domainType,
            url: citation.url,
            position: citation.position,
          }]
        : [];
    }),
  );
  interface ModelAgg {
    runs: number;
    mentions: number;
    citations: number;
    eligibleRuns: number;
    lastRunAt: Date | null;
  }
  const byModel = new Map<string, ModelAgg>();
  for (const r of windowRuns) {
    let agg = byModel.get(r.model);
    if (!agg) {
      agg = { runs: 0, mentions: 0, citations: 0, eligibleRuns: 0, lastRunAt: null };
      byModel.set(r.model, agg);
    }
    agg.runs += 1;
    if (r.brandMentioned) agg.mentions += 1;
    agg.citations += citationsByRun.get(r.id) ?? 0;
    if (r.citationEligible === true) agg.eligibleRuns += 1;
    if (!agg.lastRunAt || r.createdAt > agg.lastRunAt) agg.lastRunAt = r.createdAt;
  }
  for (const model of failedByModel.keys()) {
    if (!byModel.has(model)) {
      byModel.set(model, { runs: 0, mentions: 0, citations: 0, eligibleRuns: 0, lastRunAt: null });
    }
  }
  const modelCoverage = [...byModel.entries()]
    .map(([model, agg]) => ({
      model,
      runs: agg.runs,
      mentions: agg.mentions,
      mentionRatePct: agg.runs > 0 ? round1((100 * agg.mentions) / agg.runs) : null,
      citations: agg.citations,
      citationEligibleRuns: agg.eligibleRuns,
      failedAttempts: failedByModel.get(model) ?? 0,
      lastRunAt: agg.lastRunAt ? agg.lastRunAt.toISOString() : null,
      sources: modelSources.get(model) ?? [],
    }))
    .sort((a, b) => b.runs - a.runs || a.model.localeCompare(b.model));

  res.json(
    GetPromptInsightsResponse.parse({
      companyId: prompt.companyId,
      summary: {
        visibilityPct,
        visibilityDelta,
        totalRuns: windowRuns.length,
        totalRetrievals,
        citationEligibleRuns: eligibleRunCount,
        avgCitationsPerRun:
          eligibleRunCount > 0 ? round1(verifiedRetrievals / eligibleRunCount) : null,
        avgBrandPosition,
        lastRunAt: lastRunAll[0]?.createdAt
          ? new Date(lastRunAll[0].createdAt).toISOString()
          : null,
      },
      series,
      sourceTypes,
      sources,
      mentionedEntities,
      entityExtraction: {
        totalAnswers: windowRuns.length,
        analyzedAnswers: analyzedRuns.length,
        pendingAnswers: pendingRuns.length,
        failedAnswers: failedRuns.length,
        isComplete: pendingRuns.length === 0 && failedRuns.length === 0,
      },
      modelCoverage,
    }),
  );
});

export default router;
