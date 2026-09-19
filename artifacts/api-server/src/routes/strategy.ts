import { Router, type IRouter } from "express";
import { eq, desc, asc, and, gt, sql, count, inArray } from "drizzle-orm";
import {
  db,
  strategyIdeasTable,
  strategyItemsTable,
  moneyTopicsTable,
  weeklyMeasurementsTable,
  promptsTable,
  promptRunsTable,
  citationsTable,
  gapActionProvenanceTable,
  websiteAuditQuickWinPromotionsTable,
  type StrategyIdea,
  type StrategyItem,
  type MoneyTopic,
  type WeeklyMeasurement,
  type GapActionProvenance,
} from "@workspace/db";
import {
  ListStrategyIdeasQueryParams,
  ListStrategyIdeasResponse,
  ListStrategyItemsQueryParams,
  ListStrategyItemsResponse,
  DeployStrategyIdeaBody,
  DeployStrategyIdeaResponse,
  UpdateStrategyItemParams,
  UpdateStrategyItemBody,
  UpdateStrategyItemResponse,
  DeleteStrategyItemParams,
  GetCompanyPlaybookParams,
  GetCompanyPlaybookResponse,
  CreateMoneyTopicParams,
  CreateMoneyTopicBody,
  CreateMoneyTopicResponse,
  DeleteMoneyTopicParams,
  CreateTopicPromptParams,
  CreateTopicPromptBody,
  CreateTopicPromptResponse,
  AttachPromptToTopicParams,
  AttachPromptToTopicBody,
  AttachPromptToTopicResponse,
  DetachPromptFromTopicParams,
  CreateWeeklyMeasurementParams,
  CreateWeeklyMeasurementBody,
  CreateWeeklyMeasurementResponse,
  DeleteWeeklyMeasurementParams,
} from "@workspace/api-zod";
import { getCompany, serializeCompany } from "../lib/companyLookup";
import { STRATEGY_IDEA_SEEDS } from "../data/strategyIdeas";
import {
  IMPACT_WINDOW_DAYS,
  impactRate,
  measureCompanyImpact,
  type ImpactMeasurement,
} from "../lib/auditStrategyImpact";

const router: IRouter = Router();

function databaseErrorCode(error: unknown): string | null {
  let current = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (!current || typeof current !== "object") return null;
    if (
      "code" in current &&
      typeof (current as { code?: unknown }).code === "string"
    ) {
      return (current as { code: string }).code;
    }
    current = "cause" in current ? current.cause : null;
  }
  return null;
}

/**
 * Seed the Ideas library from the generalized workbook plays, once.
 * Concurrency-safe: the unique index on strategy_ideas.title makes the
 * insert idempotent even if two first requests race.
 */
let ideasSeeded = false;
async function ensureIdeasSeeded(): Promise<void> {
  if (ideasSeeded) return;
  const [row] = await db.select({ n: count() }).from(strategyIdeasTable);
  if ((row?.n ?? 0) === 0) {
    await db
      .insert(strategyIdeasTable)
      .values(STRATEGY_IDEA_SEEDS)
      .onConflictDoNothing({ target: strategyIdeasTable.title });
  }
  ideasSeeded = true;
}

function serializeIdea(i: StrategyIdea) {
  return {
    id: i.id,
    title: i.title,
    category: i.category,
    playType: i.playType,
    description: i.description,
    rationale: i.rationale,
    priority: i.priority,
  };
}

function serializeActionBrief(brief: unknown) {
  if (
    !brief ||
    typeof brief !== "object" ||
    !("actionAngle" in brief) ||
    typeof brief.actionAngle !== "string"
  ) {
    return null;
  }
  return brief;
}

function serializeItem(
  item: StrategyItem,
  idea: StrategyIdea,
  topicName: string | null = null,
  provenance: GapActionProvenance | null = null,
  auditPromotion: typeof websiteAuditQuickWinPromotionsTable.$inferSelect | null = null,
  auditAfter: ImpactMeasurement | null = null,
) {
  const snapshot = provenance?.evidenceSnapshot as
    | {
        promptText?: string;
        topic?: string;
        evidenceUrls?: string[];
        runIds?: number[];
        rationale?: string | null;
      }
    | undefined;
  return {
    id: item.id,
    ideaId: item.ideaId,
    companyId: item.companyId,
    ideaTitle: idea.title,
    ideaCategory: idea.category,
    ideaPlayType: idea.playType,
    moneyTopic: item.moneyTopic,
    moneyTopicId: item.moneyTopicId,
    moneyTopicName: topicName,
    status: item.status,
    notes: item.notes,
    brief: serializeActionBrief(item.brief),
    targetDate: item.targetDate,
    liveAt: item.liveAt?.toISOString() ?? null,
    auditImpact: auditPromotion ? {
      auditId: auditPromotion.auditId,
      quickWinCode: auditPromotion.quickWinCode,
      status: item.status,
      liveAt: item.liveAt?.toISOString() ?? null,
      baseline: auditPromotion.baseline,
      after: auditAfter,
      citationRateBefore: impactRate(
        (auditPromotion.baseline as ImpactMeasurement).citedRuns,
        (auditPromotion.baseline as ImpactMeasurement).eligibleRuns,
      ),
      citationRateAfter: auditAfter ? impactRate(auditAfter.citedRuns, auditAfter.eligibleRuns) : null,
      visibilityBefore: impactRate(
        (auditPromotion.baseline as ImpactMeasurement).visibleRuns,
        (auditPromotion.baseline as ImpactMeasurement).totalRuns,
      ),
      visibilityAfter: auditAfter ? impactRate(auditAfter.visibleRuns, auditAfter.totalRuns) : null,
    } : null,
    evidence:
      provenance && snapshot
        ? {
            findingId: provenance.findingId,
            jobId: provenance.jobId,
            promptId: provenance.promptId,
            promptText: snapshot.promptText ?? "",
            topic: snapshot.topic ?? "",
            rationale: snapshot.rationale ?? null,
            evidenceUrls: snapshot.evidenceUrls ?? [],
            runIds: snapshot.runIds ?? [],
            createdAt: provenance.createdAt.toISOString(),
          }
        : null,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

function serializeMoneyTopic(t: MoneyTopic) {
  return {
    id: t.id,
    companyId: t.companyId,
    topic: t.topic,
    question: t.question,
    source: t.source,
    priority: t.priority,
    createdAt: t.createdAt.toISOString(),
  };
}

function serializeMeasurement(m: WeeklyMeasurement) {
  return {
    id: m.id,
    companyId: m.companyId,
    weekOf: m.weekOf,
    totalPrompts: m.totalPrompts,
    brandMentions: m.brandMentions,
    competitorMentionsAvg: m.competitorMentionsAvg,
    shareOfVoicePct: m.shareOfVoicePct,
    consensusAnswer: m.consensusAnswer,
    topPageType: m.topPageType,
    keyTakeaway: m.keyTakeaway,
    createdAt: m.createdAt.toISOString(),
  };
}

// ─── Ideas library ───

router.get("/strategy/ideas", async (req, res): Promise<void> => {
  const q = ListStrategyIdeasQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  await ensureIdeasSeeded();
  const ideas = await db
    .select()
    .from(strategyIdeasTable)
    .where(
      q.data.category ? eq(strategyIdeasTable.category, q.data.category) : undefined,
    )
    .orderBy(asc(strategyIdeasTable.priority), asc(strategyIdeasTable.title));
  res.json(ListStrategyIdeasResponse.parse(ideas.map(serializeIdea)));
});

// ─── Deployed strategy items ───

router.get("/strategy/items", async (req, res): Promise<void> => {
  const q = ListStrategyItemsQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  const conditions = [];
  if (q.data.companyId !== undefined)
    conditions.push(eq(strategyItemsTable.companyId, q.data.companyId));
  if (q.data.category)
    conditions.push(eq(strategyIdeasTable.category, q.data.category));
  const rows = await db
    .select({
      item: strategyItemsTable,
      idea: strategyIdeasTable,
      topicName: moneyTopicsTable.topic,
      provenance: gapActionProvenanceTable,
      auditPromotion: websiteAuditQuickWinPromotionsTable,
    })
    .from(strategyItemsTable)
    .innerJoin(strategyIdeasTable, eq(strategyIdeasTable.id, strategyItemsTable.ideaId))
    .leftJoin(
      moneyTopicsTable,
      eq(moneyTopicsTable.id, strategyItemsTable.moneyTopicId),
    )
    .leftJoin(
      gapActionProvenanceTable,
      eq(gapActionProvenanceTable.strategyItemId, strategyItemsTable.id),
    )
    .leftJoin(
      websiteAuditQuickWinPromotionsTable,
      eq(websiteAuditQuickWinPromotionsTable.strategyItemId, strategyItemsTable.id),
    )
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(strategyItemsTable.createdAt));
  res.json(
    ListStrategyItemsResponse.parse(
      await Promise.all(rows.map(async ({ item, idea, topicName, provenance, auditPromotion }) => {
        const after = auditPromotion && item.liveAt
          ? await measureCompanyImpact(
              item.companyId,
              item.liveAt,
              new Date(Math.min(Date.now(), item.liveAt.getTime() + IMPACT_WINDOW_DAYS * 86_400_000)),
            )
          : null;
        return serializeItem(item, idea, topicName, provenance, auditPromotion, after);
      })),
    ),
  );
});

router.post("/strategy/items", async (req, res): Promise<void> => {
  const body = DeployStrategyIdeaBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }
  const hasIdeaId = body.data.ideaId != null;
  const hasNewIdea = body.data.newIdea != null;
  if (hasIdeaId === hasNewIdea) {
    res.status(400).json({
      error: "Provide exactly one of ideaId or newIdea",
    });
    return;
  }
  const company = await getCompany(body.data.companyId);
  if (!company) {
    res.status(404).json({ error: "Company not found" });
    return;
  }
  let topicName: string | null = null;
  if (body.data.moneyTopicId != null) {
    const [topic] = await db
      .select()
      .from(moneyTopicsTable)
      .where(eq(moneyTopicsTable.id, body.data.moneyTopicId));
    if (!topic || topic.companyId !== company.id) {
      res.status(404).json({ error: "Money topic not found for this company" });
      return;
    }
    topicName = topic.topic;
  }

  let idea: StrategyIdea;
  if (body.data.newIdea) {
    const cleanIdea = {
      ...body.data.newIdea,
      title: body.data.newIdea.title.trim(),
      playType: body.data.newIdea.playType.trim(),
      description: body.data.newIdea.description.trim(),
      rationale: body.data.newIdea.rationale.trim(),
    };
    if (
      !cleanIdea.title ||
      !cleanIdea.playType ||
      !cleanIdea.description ||
      !cleanIdea.rationale
    ) {
      res.status(400).json({
        error: "New idea fields cannot be blank",
      });
      return;
    }
    try {
      const created = await db.transaction(async (tx) => {
        const [newIdea] = await tx
          .insert(strategyIdeasTable)
          .values(cleanIdea)
          .returning();
        const [newItem] = await tx
          .insert(strategyItemsTable)
          .values({
            ideaId: newIdea!.id,
            companyId: company.id,
            moneyTopic: body.data.moneyTopic ?? null,
            moneyTopicId: body.data.moneyTopicId ?? null,
            status: body.data.status ?? "not_started",
            notes: body.data.notes ?? null,
            brief: body.data.brief ?? null,
            targetDate: body.data.targetDate ?? null,
          })
          .returning();
        return { idea: newIdea!, item: newItem! };
      });
      res.status(201).json(
        DeployStrategyIdeaResponse.parse(
          serializeItem(created.item, created.idea, topicName),
        ),
      );
      return;
    } catch (error) {
      if (databaseErrorCode(error) === "23505") {
        res.status(409).json({
          error: "An idea with this title already exists",
        });
        return;
      }
      throw error;
    }
  }

  const [existingIdea] = await db
    .select()
    .from(strategyIdeasTable)
    .where(eq(strategyIdeasTable.id, body.data.ideaId!));
  if (!existingIdea) {
    res.status(404).json({ error: "Strategy idea not found" });
    return;
  }
  idea = existingIdea;
  const [item] = await db
    .insert(strategyItemsTable)
    .values({
      ideaId: idea.id,
      companyId: company.id,
      moneyTopic: body.data.moneyTopic ?? null,
      moneyTopicId: body.data.moneyTopicId ?? null,
      status: body.data.status ?? "not_started",
      notes: body.data.notes ?? null,
      brief: body.data.brief ?? null,
      targetDate: body.data.targetDate ?? null,
    })
    .returning();
  res.status(201).json(
    DeployStrategyIdeaResponse.parse(serializeItem(item!, idea, topicName)),
  );
});

router.patch("/strategy/items/:id", async (req, res): Promise<void> => {
  const params = UpdateStrategyItemParams.safeParse(req.params);
  const body = UpdateStrategyItemBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({
      error: (params.success ? body : params).error?.message ?? "Invalid input",
    });
    return;
  }
  const [existing] = await db
    .select()
    .from(strategyItemsTable)
    .where(eq(strategyItemsTable.id, params.data.id));
  if (!existing) {
    res.status(404).json({ error: "Strategy item not found" });
    return;
  }
  if (body.data.moneyTopicId != null) {
    const [topic] = await db
      .select()
      .from(moneyTopicsTable)
      .where(eq(moneyTopicsTable.id, body.data.moneyTopicId));
    if (!topic || topic.companyId !== existing.companyId) {
      res.status(404).json({ error: "Money topic not found for this company" });
      return;
    }
  }
  const updates: Partial<typeof strategyItemsTable.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (body.data.status !== undefined) {
    updates.status = body.data.status;
    if (body.data.status === "live" && !existing.liveAt) updates.liveAt = new Date();
  }
  if (body.data.moneyTopic !== undefined) updates.moneyTopic = body.data.moneyTopic;
  if (body.data.moneyTopicId !== undefined) updates.moneyTopicId = body.data.moneyTopicId;
  if (body.data.notes !== undefined) updates.notes = body.data.notes;
  if (body.data.brief !== undefined) updates.brief = body.data.brief;
  if (body.data.targetDate !== undefined) updates.targetDate = body.data.targetDate;
  const [item] = await db
    .update(strategyItemsTable)
    .set(updates)
    .where(eq(strategyItemsTable.id, params.data.id))
    .returning();
  if (!item) {
    res.status(404).json({ error: "Strategy item not found" });
    return;
  }
  const [idea] = await db
    .select()
    .from(strategyIdeasTable)
    .where(eq(strategyIdeasTable.id, item.ideaId));
  const topicName =
    item.moneyTopicId != null
      ? (
          await db
            .select({ topic: moneyTopicsTable.topic })
            .from(moneyTopicsTable)
            .where(eq(moneyTopicsTable.id, item.moneyTopicId))
        )[0]?.topic ?? null
      : null;
  res.json(UpdateStrategyItemResponse.parse(serializeItem(item, idea!, topicName)));
});

router.delete("/strategy/items/:id", async (req, res): Promise<void> => {
  const params = DeleteStrategyItemParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [auditPromotion] = await db
    .select({ id: websiteAuditQuickWinPromotionsTable.id })
    .from(websiteAuditQuickWinPromotionsTable)
    .where(eq(websiteAuditQuickWinPromotionsTable.strategyItemId, params.data.id))
    .limit(1);
  if (auditPromotion) {
    res.status(409).json({
      error: "Audit-backed strategy items cannot be deleted because their measurement history must be retained.",
    });
    return;
  }
  const [deleted] = await db
    .delete(strategyItemsTable)
    .where(eq(strategyItemsTable.id, params.data.id))
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Strategy item not found" });
    return;
  }
  res.sendStatus(204);
});

// ─── Money topics (step 1) ───

router.post("/companies/:id/money-topics", async (req, res): Promise<void> => {
  const params = CreateMoneyTopicParams.safeParse(req.params);
  const body = CreateMoneyTopicBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({
      error: (params.success ? body : params).error?.message ?? "Invalid input",
    });
    return;
  }
  const company = await getCompany(params.data.id);
  if (!company) {
    res.status(404).json({ error: "Company not found" });
    return;
  }
  const [topic] = await db
    .insert(moneyTopicsTable)
    .values({
      companyId: company.id,
      topic: body.data.topic,
      question: body.data.question ?? null,
      source: body.data.source ?? null,
      priority: body.data.priority ?? "medium",
    })
    .returning();
  res.status(201).json(CreateMoneyTopicResponse.parse(serializeMoneyTopic(topic!)));
});

router.delete("/money-topics/:id", async (req, res): Promise<void> => {
  const params = DeleteMoneyTopicParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [deleted] = await db
    .delete(moneyTopicsTable)
    .where(eq(moneyTopicsTable.id, params.data.id))
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Money topic not found" });
    return;
  }
  res.sendStatus(204);
});

// ─── Money topic ↔ tracked prompt linking ───

const DEFAULT_MODELS = ["openai/gpt-5-mini", "perplexity/sonar"];

/** Serialize a prompt row into the shared Prompt contract (with run stats). */
async function serializeTopicPrompt(
  p: typeof promptsTable.$inferSelect,
  topicName: string | null,
) {
  const [stats] = await db
    .select({
      runCount: sql<number>`count(*)::int`,
      visibility: sql<number | null>`100.0 * avg(CASE WHEN ${promptRunsTable.brandMentioned} THEN 1 ELSE 0 END)`,
      lastRunAt: sql<string | null>`max(${promptRunsTable.createdAt})`,
    })
    .from(promptRunsTable)
    .where(eq(promptRunsTable.promptId, p.id));
  return {
    id: p.id,
    text: p.text,
    topic: p.topic,
    moneyTopicId: p.moneyTopicId,
    moneyTopicName: topicName,
    tags: p.tags,
    models: p.models.length > 0 ? p.models : DEFAULT_MODELS,
    active: p.active,
    createdAt: p.createdAt.toISOString(),
    runCount: stats?.runCount ?? 0,
    lastVisibilityPct:
      stats?.visibility != null
        ? Math.round(Number(stats.visibility) * 10) / 10
        : null,
    lastRunAt: stats?.lastRunAt ? new Date(stats.lastRunAt).toISOString() : null,
  };
}

router.post("/money-topics/:id/prompts", async (req, res): Promise<void> => {
  const params = CreateTopicPromptParams.safeParse(req.params);
  const body = CreateTopicPromptBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({
      error: (params.success ? body : params).error?.message ?? "Invalid input",
    });
    return;
  }
  const [topic] = await db
    .select()
    .from(moneyTopicsTable)
    .where(eq(moneyTopicsTable.id, params.data.id));
  if (!topic) {
    res.status(404).json({ error: "Money topic not found" });
    return;
  }
  const [prompt] = await db
    .insert(promptsTable)
    .values({
      companyId: topic.companyId,
      text: body.data.text,
      topic: topic.topic,
      moneyTopicId: topic.id,
      tags: body.data.tags ?? [],
      models: DEFAULT_MODELS,
    })
    .returning();
  res
    .status(201)
    .json(
      CreateTopicPromptResponse.parse(
        await serializeTopicPrompt(prompt!, topic.topic),
      ),
    );
});

router.post(
  "/money-topics/:id/prompts/attach",
  async (req, res): Promise<void> => {
    const params = AttachPromptToTopicParams.safeParse(req.params);
    const body = AttachPromptToTopicBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({
        error:
          (params.success ? body : params).error?.message ?? "Invalid input",
      });
      return;
    }
    const [topic] = await db
      .select()
      .from(moneyTopicsTable)
      .where(eq(moneyTopicsTable.id, params.data.id));
    if (!topic) {
      res.status(404).json({ error: "Money topic not found" });
      return;
    }
    const [prompt] = await db
      .select()
      .from(promptsTable)
      .where(eq(promptsTable.id, body.data.promptId));
    if (!prompt) {
      res.status(404).json({ error: "Prompt not found" });
      return;
    }
    if (prompt.companyId !== topic.companyId) {
      res.status(400).json({ error: "Prompt belongs to another company" });
      return;
    }
    const [updated] = await db
      .update(promptsTable)
      .set({ moneyTopicId: topic.id })
      .where(eq(promptsTable.id, prompt.id))
      .returning();
    res.json(
      AttachPromptToTopicResponse.parse(
        await serializeTopicPrompt(updated!, topic.topic),
      ),
    );
  },
);

router.delete(
  "/money-topics/:id/prompts/:promptId",
  async (req, res): Promise<void> => {
    const params = DetachPromptFromTopicParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const [updated] = await db
      .update(promptsTable)
      .set({ moneyTopicId: null })
      .where(
        and(
          eq(promptsTable.id, params.data.promptId),
          eq(promptsTable.moneyTopicId, params.data.id),
        ),
      )
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Prompt is not linked to this money topic" });
      return;
    }
    res.sendStatus(204);
  },
);

// ─── Weekly measurements (step 5) ───

router.post("/companies/:id/measurements", async (req, res): Promise<void> => {
  const params = CreateWeeklyMeasurementParams.safeParse(req.params);
  const body = CreateWeeklyMeasurementBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({
      error: (params.success ? body : params).error?.message ?? "Invalid input",
    });
    return;
  }
  const company = await getCompany(params.data.id);
  if (!company) {
    res.status(404).json({ error: "Company not found" });
    return;
  }
  const [row] = await db
    .insert(weeklyMeasurementsTable)
    .values({
      companyId: company.id,
      weekOf: body.data.weekOf,
      totalPrompts: body.data.totalPrompts ?? 0,
      brandMentions: body.data.brandMentions ?? 0,
      competitorMentionsAvg: body.data.competitorMentionsAvg ?? null,
      shareOfVoicePct: body.data.shareOfVoicePct ?? null,
      consensusAnswer: body.data.consensusAnswer ?? null,
      topPageType: body.data.topPageType ?? null,
      keyTakeaway: body.data.keyTakeaway ?? null,
    })
    .returning();
  res.status(201).json(CreateWeeklyMeasurementResponse.parse(serializeMeasurement(row!)));
});

router.delete("/measurements/:id", async (req, res): Promise<void> => {
  const params = DeleteWeeklyMeasurementParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [deleted] = await db
    .delete(weeklyMeasurementsTable)
    .where(eq(weeklyMeasurementsTable.id, params.data.id))
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Measurement not found" });
    return;
  }
  res.sendStatus(204);
});

// ─── Per-company 5-step playbook ───

router.get("/companies/:id/playbook", async (req, res): Promise<void> => {
  const params = GetCompanyPlaybookParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const company = await getCompany(params.data.id);
  if (!company) {
    res.status(404).json({ error: "Company not found" });
    return;
  }
  await ensureIdeasSeeded();

  const cutoff30 = sql`now() - interval '30 days'`;
  const cutoff7 = sql`now() - interval '7 days'`;

  const [
    moneyTopics,
    itemRows,
    measurements,
    [promptStats],
    [runStats30],
    [citedDomains],
    topDomains,
  ] = await Promise.all([
    db
      .select()
      .from(moneyTopicsTable)
      .where(eq(moneyTopicsTable.companyId, company.id))
      .orderBy(desc(moneyTopicsTable.createdAt)),
    db
      .select({
        item: strategyItemsTable,
        idea: strategyIdeasTable,
        provenance: gapActionProvenanceTable,
        auditPromotion: websiteAuditQuickWinPromotionsTable,
      })
      .from(strategyItemsTable)
      .innerJoin(
        strategyIdeasTable,
        eq(strategyIdeasTable.id, strategyItemsTable.ideaId),
      )
      .leftJoin(
        gapActionProvenanceTable,
        eq(gapActionProvenanceTable.strategyItemId, strategyItemsTable.id),
      )
      .leftJoin(
        websiteAuditQuickWinPromotionsTable,
        eq(websiteAuditQuickWinPromotionsTable.strategyItemId, strategyItemsTable.id),
      )
      .where(eq(strategyItemsTable.companyId, company.id))
      .orderBy(desc(strategyItemsTable.createdAt)),
    db
      .select()
      .from(weeklyMeasurementsTable)
      .where(eq(weeklyMeasurementsTable.companyId, company.id))
      .orderBy(desc(weeklyMeasurementsTable.weekOf)),
    db
      .select({
        promptCount: sql<number>`count(*)::int`,
        activePromptCount: sql<number>`count(*) filter (where ${promptsTable.active})::int`,
      })
      .from(promptsTable)
      .where(eq(promptsTable.companyId, company.id)),
    db
      .select({
        runCount: sql<number>`count(${promptRunsTable.id})::int`,
        lastRunAt: sql<string | null>`max(${promptRunsTable.createdAt})`,
      })
      .from(promptRunsTable)
      .innerJoin(promptsTable, eq(promptsTable.id, promptRunsTable.promptId))
      .where(
        and(eq(promptsTable.companyId, company.id), gt(promptRunsTable.createdAt, cutoff30)),
      ),
    db
      .select({
        citedDomainCount: sql<number>`count(distinct ${citationsTable.domain})::int`,
      })
      .from(citationsTable)
      .innerJoin(promptRunsTable, eq(promptRunsTable.id, citationsTable.runId))
      .innerJoin(promptsTable, eq(promptsTable.id, promptRunsTable.promptId))
      .where(eq(promptsTable.companyId, company.id)),
    db
      .select({
        domain: citationsTable.domain,
        domainType: sql<string>`max(${citationsTable.domainType})`,
        retrievals: sql<number>`count(*)::int`,
      })
      .from(citationsTable)
      .innerJoin(promptRunsTable, eq(promptRunsTable.id, citationsTable.runId))
      .innerJoin(promptsTable, eq(promptsTable.id, promptRunsTable.promptId))
      .where(eq(promptsTable.companyId, company.id))
      .groupBy(citationsTable.domain)
      .orderBy(desc(sql`count(*)`))
      .limit(6),
  ]);

  // Suggested current-week rollup computed from real run data (last 7 days).
  const [week] = await db
    .select({
      totalPrompts: sql<number>`count(distinct ${promptRunsTable.promptId})::int`,
      totalRuns: sql<number>`count(${promptRunsTable.id})::int`,
      brandMentions: sql<number>`count(${promptRunsTable.id}) filter (where ${promptRunsTable.brandMentioned})::int`,
    })
    .from(promptRunsTable)
    .innerJoin(promptsTable, eq(promptsTable.id, promptRunsTable.promptId))
    .where(
      and(eq(promptsTable.companyId, company.id), gt(promptRunsTable.createdAt, cutoff7)),
    );

  let suggestedWeek: Record<string, unknown> | undefined;
  if (week && week.totalRuns > 0) {
    const [compCit] = await db
      .select({
        competitorCitations: sql<number>`count(${citationsTable.id}) filter (where ${citationsTable.domainType} = 'competitor')::int`,
      })
      .from(citationsTable)
      .innerJoin(promptRunsTable, eq(promptRunsTable.id, citationsTable.runId))
      .innerJoin(promptsTable, eq(promptsTable.id, promptRunsTable.promptId))
      .where(
        and(eq(promptsTable.companyId, company.id), gt(promptRunsTable.createdAt, cutoff7)),
      );
    const [topType] = await db
      .select({
        domainType: citationsTable.domainType,
        n: sql<number>`count(*)::int`,
      })
      .from(citationsTable)
      .innerJoin(promptRunsTable, eq(promptRunsTable.id, citationsTable.runId))
      .innerJoin(promptsTable, eq(promptsTable.id, promptRunsTable.promptId))
      .where(
        and(eq(promptsTable.companyId, company.id), gt(promptRunsTable.createdAt, cutoff7)),
      )
      .groupBy(citationsTable.domainType)
      .orderBy(desc(sql`count(*)`))
      .limit(1);

    // Monday of the current week (ISO).
    const now = new Date();
    const monday = new Date(now);
    monday.setUTCDate(now.getUTCDate() - ((now.getUTCDay() + 6) % 7));
    suggestedWeek = {
      weekOf: monday.toISOString().slice(0, 10),
      totalPrompts: week.totalPrompts,
      brandMentions: week.brandMentions,
      competitorMentionsAvg:
        week.totalRuns > 0
          ? Math.round(((compCit?.competitorCitations ?? 0) / week.totalRuns) * 100) / 100
          : null,
      shareOfVoicePct:
        week.totalRuns > 0
          ? Math.round((week.brandMentions / week.totalRuns) * 1000) / 10
          : null,
      topPageType: topType?.domainType ?? null,
    };
  }

  // Per-topic linked prompts (with run stats) and strategy status summary.
  const topicIds = moneyTopics.map((t) => t.id);
  const linkedPrompts =
    topicIds.length === 0
      ? []
      : await db
          .select()
          .from(promptsTable)
          .where(inArray(promptsTable.moneyTopicId, topicIds))
          .orderBy(desc(promptsTable.createdAt));
  const linkedIds = linkedPrompts.map((p) => p.id);
  const promptRunStats =
    linkedIds.length === 0
      ? []
      : await db
          .select({
            promptId: promptRunsTable.promptId,
            runCount: sql<number>`count(*)::int`,
            visibility: sql<number | null>`100.0 * avg(CASE WHEN ${promptRunsTable.brandMentioned} THEN 1 ELSE 0 END)`,
            lastRunAt: sql<string | null>`max(${promptRunsTable.createdAt})`,
          })
          .from(promptRunsTable)
          .where(inArray(promptRunsTable.promptId, linkedIds))
          .groupBy(promptRunsTable.promptId);
  const statsById = new Map(promptRunStats.map((s) => [s.promptId, s]));

  const playbookMoneyTopics = moneyTopics.map((t) => {
    const topicItems = itemRows.filter(
      ({ item }) => item.moneyTopicId === t.id,
    );
    return {
      ...serializeMoneyTopic(t),
      prompts: linkedPrompts
        .filter((p) => p.moneyTopicId === t.id)
        .map((p) => {
          const s = statsById.get(p.id);
          return {
            id: p.id,
            text: p.text,
            active: p.active,
            runCount: s?.runCount ?? 0,
            lastVisibilityPct:
              s?.visibility != null
                ? Math.round(Number(s.visibility) * 10) / 10
                : null,
            lastRunAt: s?.lastRunAt
              ? new Date(s.lastRunAt).toISOString()
              : null,
          };
        }),
      strategy: {
        total: topicItems.length,
        notStarted: topicItems.filter(({ item }) => item.status === "not_started")
          .length,
        inProgress: topicItems.filter(({ item }) => item.status === "in_progress")
          .length,
        live: topicItems.filter(({ item }) => item.status === "live").length,
      },
    };
  });

  const topicNameById = new Map(moneyTopics.map((t) => [t.id, t.topic]));
  const itemTopicName = (item: StrategyItem): string | null =>
    item.moneyTopicId != null
      ? topicNameById.get(item.moneyTopicId) ?? null
      : null;

  res.json(
    GetCompanyPlaybookResponse.parse({
      company: serializeCompany(company),
      moneyTopics: playbookMoneyTopics,
      tracking: {
        promptCount: promptStats?.promptCount ?? 0,
        activePromptCount: promptStats?.activePromptCount ?? 0,
        runCount: runStats30?.runCount ?? 0,
        citedDomainCount: citedDomains?.citedDomainCount ?? 0,
        lastRunAt: runStats30?.lastRunAt
          ? new Date(runStats30.lastRunAt).toISOString()
          : null,
        topDomains,
      },
      onsiteItems: itemRows
        .filter(({ idea }) => idea.category === "on_page")
        .map(({ item, idea, provenance, auditPromotion }) =>
          serializeItem(item, idea, itemTopicName(item), provenance, auditPromotion),
        ),
      offsiteItems: itemRows
        .filter(({ idea }) => idea.category === "off_page")
        .map(({ item, idea, provenance, auditPromotion }) =>
          serializeItem(item, idea, itemTopicName(item), provenance, auditPromotion),
        ),
      measurements: measurements.map(serializeMeasurement),
      ...(suggestedWeek ? { suggestedWeek } : {}),
    }),
  );
});

export default router;
