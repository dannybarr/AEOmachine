/**
 * Durable Gap Analysis research jobs: start from eligible stored prompt runs
 * and provider-returned citations, fetch cited pages safely, and persist an
 * immutable snapshot of findings + trends. The job row is returned
 * immediately; work continues in the background with per-phase counters so
 * clients can poll without keeping the page open.
 */
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import {
  db,
  promptsTable,
  promptRunsTable,
  citationsTable,
  domainRegistryTable,
  gapResearchJobsTable,
  gapSourcePagesTable,
  gapFindingsTable,
  gapEvidenceTable,
  gapTrendsTable,
  type Company,
  type GapResearchJob,
  type GapSourcePage,
} from "@workspace/db";
import { getRegistry } from "./modelRegistry";
import {
  buildContextSnapshot,
  strategicFraming,
  type CompanyContextSnapshot,
} from "./companyContext";
import { utcWindowStart } from "./timeWindow";
import { safeFetch } from "./safeFetch";
import { logger } from "./logger";
import {
  ANALYSIS_VERSION,
  canonicalizeUrl,
  classifyChannel,
  confidenceFor,
  detectPageSignals,
  extractAnswerContext,
  extractTitleAndSnippet,
  brandNameFromDomain,
  mentionsBrand,
  buildRecommendation,
  hypothesisFor,
  CHANNEL_LABELS,
  type Channel,
  type PageSignals,
} from "./gapAnalysis";

const SEARCH_MODELS = new Set(
  getRegistry().filter((m) => m.supportsSearch).map((m) => m.id),
);

const FETCH_CONCURRENCY = 4;
const FETCH_TIMEOUT_MS = 8_000;
const MAX_FETCHES_PER_JOB = 60;
const MAX_PAGE_BYTES = 300_000;
const CACHE_FRESH_DAYS = 7;

const runningResearch = new Set<number>();

export function isResearchRunning(companyId: number): boolean {
  return runningResearch.has(companyId);
}

export function serializeResearchJob(job: GapResearchJob) {
  return {
    id: job.id,
    companyId: job.companyId,
    status: job.status,
    phase: job.phase,
    windowDays: job.windowDays,
    analysisVersion: job.analysisVersion,
    eligibleRunCount: job.eligibleRunCount,
    ineligibleRunCount: job.ineligibleRunCount,
    gapPromptCount: job.gapPromptCount,
    totalSources: job.totalSources,
    fetchedSources: job.fetchedSources,
    failedSources: job.failedSources,
    cachedSources: job.cachedSources,
    error: job.error,
    createdAt: job.createdAt.toISOString(),
    finishedAt: job.finishedAt ? job.finishedAt.toISOString() : null,
  };
}

/** Mark research jobs orphaned by a server restart as failed (boot cleanup). */
export function cleanupOrphanedResearchJobs(): void {
  void db
    .update(gapResearchJobsTable)
    .set({
      status: "failed",
      error: "Interrupted by server restart",
      finishedAt: new Date(),
    })
    .where(eq(gapResearchJobsTable.status, "running"))
    .then(() => undefined)
    .catch((err: unknown) =>
      logger.error({ err }, "Failed to clean up orphaned gap research jobs"),
    );
}

export async function startGapResearch(
  company: Company,
  windowDays: number,
): Promise<GapResearchJob | null> {
  if (runningResearch.has(company.id)) return null;
  // The partial unique index gap_research_jobs_one_running_per_company makes
  // this insert the atomic "already running" guard: concurrent requests and
  // other instances get a unique violation instead of a duplicate job.
  let job: GapResearchJob | undefined;
  try {
    [job] = await db
      .insert(gapResearchJobsTable)
      .values({
        companyId: company.id,
        windowDays,
        analysisVersion: ANALYSIS_VERSION,
        companyContextSnapshot: buildContextSnapshot(company),
        status: "running",
        phase: "collecting",
      })
      .returning();
  } catch (err) {
    const cause = (err as { cause?: { code?: string } }).cause;
    const text = `${String(err)} ${String(cause ?? "")}`;
    if (
      (err as { code?: string })?.code === "23505" ||
      cause?.code === "23505" ||
      /duplicate key/i.test(text)
    ) {
      return null;
    }
    throw err;
  }
  runningResearch.add(company.id);
  void processResearch(job!, company).finally(() => {
    runningResearch.delete(company.id);
  });
  return job!;
}

export const AUTO_RESEARCH_COOLDOWN_MS = 24 * 60 * 60 * 1000;
export const AUTO_RESEARCH_WINDOW_DAYS = 30;

export function isAutomaticResearchRefreshDue(
  latestCompleted: GapResearchJob | null,
  now: Date,
): boolean {
  return (
    !latestCompleted ||
    now.getTime() - latestCompleted.createdAt.getTime() >= AUTO_RESEARCH_COOLDOWN_MS
  );
}

/**
 * Start a fresh research snapshot after tracking when the newest completed
 * snapshot is outside the cooldown. startGapResearch retains the existing
 * process-local and DB-level one-running-job guards.
 */
export async function refreshGapResearchAfterTracking(
  company: Company,
  now = new Date(),
): Promise<GapResearchJob | null> {
  const latest = await latestResearchJob(company.id, true);
  if (!isAutomaticResearchRefreshDue(latest, now)) return null;
  return startGapResearch(company, AUTO_RESEARCH_WINDOW_DAYS);
}

interface UrlAgg {
  canonicalUrl: string;
  domain: string;
  domainType: string;
  citations: number;
  runIds: Set<number>;
  models: Set<string>;
  positions: number[];
  lastSeenAt: Date | null;
}

async function processResearch(job: GapResearchJob, company: Company): Promise<void> {
  try {
    // Shared UTC calendar window — same semantics as dashboard aggregates.
    const cutoff = utcWindowStart(job.windowDays);

    // ── Phase 1: collect eligible runs & gap prompts ──
    const prompts = await db
      .select()
      .from(promptsTable)
      .where(eq(promptsTable.companyId, company.id));
    const promptById = new Map(prompts.map((p) => [p.id, p]));
    const runs = prompts.length
      ? await db
          .select()
          .from(promptRunsTable)
          .where(
            and(
              inArray(promptRunsTable.promptId, prompts.map((p) => p.id)),
              gte(promptRunsTable.createdAt, cutoff),
            ),
          )
      : [];

    // Evidence eligibility requires stored per-run provenance: the run must
    // have been confirmed citation-eligible (search actually performed), not
    // merely executed on a search-capable model. Legacy/tool-rejected runs
    // are excluded from evidence collection.
    const eligibleRuns = runs.filter(
      (r) => r.citationEligible === true && SEARCH_MODELS.has(r.model),
    );
    const ineligibleCount = runs.length - eligibleRuns.length;

    // Gap prompts: full (0 mentions) or partial (<50% mention rate, ≥2 runs).
    interface PromptAgg {
      runs: typeof runs;
      mentions: number;
    }
    const byPrompt = new Map<number, PromptAgg>();
    for (const r of runs) {
      const agg = byPrompt.get(r.promptId) ?? { runs: [], mentions: 0 };
      agg.runs.push(r);
      if (r.brandMentioned) agg.mentions += 1;
      byPrompt.set(r.promptId, agg);
    }
    const gapPrompts: Array<{ promptId: number; gapType: "full" | "partial" }> = [];
    for (const [promptId, agg] of byPrompt) {
      if (agg.runs.length === 0) continue;
      if (agg.mentions === 0) gapPrompts.push({ promptId, gapType: "full" });
      else if (agg.runs.length >= 2 && agg.mentions / agg.runs.length < 0.5)
        gapPrompts.push({ promptId, gapType: "partial" });
    }

    await db
      .update(gapResearchJobsTable)
      .set({
        eligibleRunCount: eligibleRuns.length,
        ineligibleRunCount: ineligibleCount,
        gapPromptCount: gapPrompts.length,
        phase: "fetching",
      })
      .where(eq(gapResearchJobsTable.id, job.id));

    // ── Collect citations for gap prompts (eligible runs only) ──
    const gapPromptIds = new Set(gapPrompts.map((g) => g.promptId));
    const gapRuns = eligibleRuns.filter((r) => gapPromptIds.has(r.promptId));
    const gapRunById = new Map(gapRuns.map((r) => [r.id, r]));
    // Only provider-returned citations may serve as verified evidence.
    const citations = gapRuns.length
      ? await db
          .select()
          .from(citationsTable)
          .where(
            and(
              inArray(citationsTable.runId, gapRuns.map((r) => r.id)),
              eq(citationsTable.provenance, "provider"),
            ),
          )
      : [];

    // Aggregate per prompt per canonical URL.
    const perPrompt = new Map<number, Map<string, UrlAgg>>();
    const globalUrls = new Map<string, UrlAgg>();
    for (const c of citations) {
      const run = gapRunById.get(c.runId);
      if (!run) continue;
      const canonical = canonicalizeUrl(c.url) ?? `https://${c.domain}/`;
      const add = (map: Map<string, UrlAgg>): void => {
        const agg =
          map.get(canonical) ??
          ({
            canonicalUrl: canonical,
            domain: c.domain,
            domainType: c.domainType,
            citations: 0,
            runIds: new Set<number>(),
            models: new Set<string>(),
            positions: [],
            lastSeenAt: null,
          } satisfies UrlAgg);
        agg.citations += 1;
        agg.runIds.add(run.id);
        agg.models.add(run.model);
        agg.positions.push(c.position);
        if (!agg.lastSeenAt || run.createdAt > agg.lastSeenAt) agg.lastSeenAt = run.createdAt;
        map.set(canonical, agg);
      };
      let m = perPrompt.get(run.promptId);
      if (!m) {
        m = new Map();
        perPrompt.set(run.promptId, m);
      }
      add(m);
      add(globalUrls);
    }

    // ── Phase 2: fetch cited pages (bounded, cached, honest failures) ──
    const toFetch = [...globalUrls.values()]
      .sort((a, b) => b.citations - a.citations)
      .slice(0, MAX_FETCHES_PER_JOB);
    await db
      .update(gapResearchJobsTable)
      .set({ totalSources: toFetch.length })
      .where(eq(gapResearchJobsTable.id, job.id));

    const cacheCutoff = new Date(Date.now() - CACHE_FRESH_DAYS * 86400_000);
    const existingPages = toFetch.length
      ? await db
          .select()
          .from(gapSourcePagesTable)
          .where(
            and(
              eq(gapSourcePagesTable.companyId, company.id),
              inArray(gapSourcePagesTable.canonicalUrl, toFetch.map((t) => t.canonicalUrl)),
            ),
          )
      : [];
    const pageByUrl = new Map<string, GapSourcePage>(
      existingPages.map((p) => [p.canonicalUrl, p]),
    );

    let fetched = 0;
    let failed = 0;
    let cached = 0;
    const queue = [...toFetch];
    const worker = async (): Promise<void> => {
      for (;;) {
        const item = queue.shift();
        if (!item) return;
        const existing = pageByUrl.get(item.canonicalUrl);
        if (existing && existing.fetchedAt > cacheCutoff) {
          cached += 1;
        } else {
          const page = await fetchSourcePage(company.id, item.canonicalUrl, item.domain);
          pageByUrl.set(item.canonicalUrl, page);
          if (page.fetchStatus === "ok") fetched += 1;
          else failed += 1;
        }
        try {
          await db
            .update(gapResearchJobsTable)
            .set({ fetchedSources: fetched, failedSources: failed, cachedSources: cached })
            .where(eq(gapResearchJobsTable.id, job.id));
        } catch (err) {
          logger.error({ err, jobId: job.id }, "Failed to persist research fetch progress");
        }
      }
    };
    await Promise.all(Array.from({ length: FETCH_CONCURRENCY }, () => worker()));

    // Final authoritative counter write: interleaved per-item progress writes
    // can persist a stale snapshot; totals must reconcile to totalSources.
    await db
      .update(gapResearchJobsTable)
      .set({ fetchedSources: fetched, failedSources: failed, cachedSources: cached, phase: "analyzing" })
      .where(eq(gapResearchJobsTable.id, job.id));

    // ── Competitor registry for brand detection ──
    const registry = await db
      .select()
      .from(domainRegistryTable)
      .where(eq(domainRegistryTable.companyId, company.id));
    const competitorDomains = registry
      .filter((r) => r.domainType === "competitor")
      .map((r) => r.domain);

    // ── Phase 3: findings per gap prompt ──
    interface TrendAgg {
      citations: number;
      promptIds: Set<number>;
      urls: Map<string, { url: string; domain: string; channel: Channel; citations: number }>;
    }
    const domainTrend = new Map<string, TrendAgg>();
    const channelTrend = new Map<Channel, TrendAgg>();
    const competitorTrend = new Map<string, TrendAgg>();

    for (const gp of gapPrompts) {
      const prompt = promptById.get(gp.promptId);
      if (!prompt) continue;
      const agg = byPrompt.get(gp.promptId)!;
      const promptEligible = agg.runs.filter(
        (r) => r.citationEligible === true && SEARCH_MODELS.has(r.model),
      );
      const urlAggs = [...(perPrompt.get(gp.promptId)?.values() ?? [])].sort(
        (a, b) => b.citations - a.citations,
      );

      // Model coverage (all runs, flag citation eligibility per model).
      const byModel = new Map<string, { runs: number; mentioned: number }>();
      for (const r of agg.runs) {
        const m = byModel.get(r.model) ?? { runs: 0, mentioned: 0 };
        m.runs += 1;
        if (r.brandMentioned) m.mentioned += 1;
        byModel.set(r.model, m);
      }
      const modelCoverage = [...byModel.entries()].map(([model, m]) => ({
        model,
        runs: m.runs,
        mentioned: m.mentioned,
        citationsEligible: SEARCH_MODELS.has(model),
      }));

      // Competitor brands surfaced in answer text (deterministic).
      const competitors: Array<{ domain: string; name: string; runsSurfaced: number }> = [];
      for (const compDomain of competitorDomains) {
        const name = brandNameFromDomain(compDomain);
        let surfaced = 0;
        for (const r of promptEligible) {
          if (mentionsBrand(r.answerText, name) || r.answerText.includes(compDomain)) {
            surfaced += 1;
          }
        }
        const citedHere = urlAggs.some((u) => u.domain === compDomain || u.domain.endsWith("." + compDomain));
        if (surfaced > 0 || citedHere) competitors.push({ domain: compDomain, name, runsSurfaced: surfaced });
      }

      // Evidence rows + channel stats for the recommendation.
      const channelStats = new Map<Channel, { citations: number; urls: string[] }>();
      const evidenceRows: Array<typeof gapEvidenceTable.$inferInsert> = [];
      for (const u of urlAggs) {
        const page = pageByUrl.get(u.canonicalUrl) ?? null;
        const signals = (page?.pageSignals as PageSignals | null) ?? null;
        const channel = classifyChannel(u.domainType, signals);
        const isCompetitor = channel === "competitor_owned";
        // Answer context: excerpt from the most recent citing run mentioning
        // the source's brand/domain; null when absent (never fabricated).
        let answerContext: string | null = null;
        const citingRuns = [...u.runIds]
          .map((id) => gapRunById.get(id))
          .filter((r): r is NonNullable<typeof r> => Boolean(r))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        const brandName = brandNameFromDomain(u.domain);
        for (const r of citingRuns) {
          answerContext =
            extractAnswerContext(r.answerText, brandName) ??
            extractAnswerContext(r.answerText, u.domain);
          if (answerContext) break;
        }
        const cs = channelStats.get(channel) ?? { citations: 0, urls: [] };
        cs.citations += u.citations;
        if (cs.urls.length < 5) cs.urls.push(u.canonicalUrl);
        channelStats.set(channel, cs);

        evidenceRows.push({
          findingId: 0, // set after finding insert
          sourcePageId: page?.id ?? null,
          canonicalUrl: u.canonicalUrl,
          domain: u.domain,
          channel,
          isCompetitor,
          citationCount: u.citations,
          runCount: u.runIds.size,
          avgPosition:
            u.positions.length > 0
              ? Math.round((u.positions.reduce((a, b) => a + b, 0) / u.positions.length) * 10) / 10
              : null,
          bestPosition: u.positions.length > 0 ? Math.min(...u.positions) : null,
          models: [...u.models],
          runIds: [...u.runIds],
          answerContext,
          lastSeenAt: u.lastSeenAt,
          // Immutable page-evidence snapshot as observed by THIS job — the
          // gap_source_pages cache row may be rewritten by later runs.
          pageFetchStatus: page?.fetchStatus ?? null,
          pageHttpStatus: page?.httpStatus ?? null,
          pageTitle: page?.title ?? null,
          pageSnippet: page?.snippet ?? null,
          pageSignals: signals,
          pageFetchedAt: page?.fetchedAt ?? null,
        });

        // Cross-prompt trend aggregation (skip brand-owned).
        if (channel !== "brand_owned") {
          const push = (map: Map<string, TrendAgg>, key: string): void => {
            const t = map.get(key) ?? {
              citations: 0,
              promptIds: new Set<number>(),
              urls: new Map(),
            };
            t.citations += u.citations;
            t.promptIds.add(gp.promptId);
            const e = t.urls.get(u.canonicalUrl) ?? {
              url: u.canonicalUrl,
              domain: u.domain,
              channel,
              citations: 0,
            };
            e.citations += u.citations;
            t.urls.set(u.canonicalUrl, e);
            map.set(key, t);
          };
          push(domainTrend, u.domain);
          push(channelTrend as unknown as Map<string, TrendAgg>, channel);
          if (isCompetitor) push(competitorTrend, u.domain);
        }
      }

      const recommendation = buildRecommendation(
        prompt.topic,
        [...channelStats.entries()].map(([channel, s]) => ({
          channel,
          citations: s.citations,
          urls: s.urls,
        })),
      );
      // Frame (never alter) the recommendation with the IMMUTABLE context
      // snapshot stored on this job — not the live profile — so a later
      // profile edit cannot change what this research claims it was based on.
      const framing = strategicFraming(
        job.companyContextSnapshot as CompanyContextSnapshot | null,
      );
      if (framing && recommendation.status === "proposed") {
        recommendation.rationale = `${recommendation.rationale} ${framing}`;
      }

      const [finding] = await db
        .insert(gapFindingsTable)
        .values({
          jobId: job.id,
          companyId: company.id,
          promptId: prompt.id,
          promptText: prompt.text,
          topic: prompt.topic,
          gapType: gp.gapType,
          runCount: agg.runs.length,
          eligibleRunCount: promptEligible.length,
          mentionCount: agg.mentions,
          citationCount: urlAggs.reduce((a, u) => a + u.citations, 0),
          modelCoverage,
          competitors,
          recommendation,
          lastRunAt: agg.runs.reduce<Date | null>(
            (acc, r) => (!acc || r.createdAt > acc ? r.createdAt : acc),
            null,
          ),
        })
        .returning();
      if (evidenceRows.length > 0) {
        await db
          .insert(gapEvidenceTable)
          .values(evidenceRows.map((e) => ({ ...e, findingId: finding!.id })));
      }
    }

    // ── Phase 4: trends with confidence, sample size & contradictions ──
    const totalGapCitations = [...globalUrls.values()].reduce((a, u) => a + u.citations, 0);

    // Contrast set: how often does each channel appear where the brand IS mentioned?
    const mentionedPromptIds = [...byPrompt.entries()]
      .filter(([, a]) => a.runs.length > 0 && a.mentions / a.runs.length >= 0.5)
      .map(([id]) => id);

    const trendRows: Array<typeof gapTrendsTable.$inferInsert> = [];
    const addTrend = (
      kind: string,
      key: string,
      t: TrendAgg,
      subjectLabel: string,
      opts: { domain?: string; channel?: Channel } = {},
    ): void => {
      if (t.promptIds.size < 2 && kind !== "channel_pattern") return;
      const confidence = confidenceFor(t.citations, t.promptIds.size);
      const sharePct =
        totalGapCitations > 0 ? Math.round((1000 * t.citations) / totalGapCitations) / 10 : 0;
      const contradictory =
        mentionedPromptIds.length > 0
          ? `Contrast: ${mentionedPromptIds.length} tracked prompt${mentionedPromptIds.length === 1 ? "" : "s"} where your brand is mentioned in ≥50% of runs were excluded from this pattern; the association holds only within the ${t.promptIds.size} gap prompt${t.promptIds.size === 1 ? "" : "s"} sampled.`
          : `No prompts with ≥50% brand mention rate exist in this window to serve as a contrast group, which limits how much this pattern can be isolated to gaps.`;
      trendRows.push({
        jobId: job.id,
        kind,
        title:
          kind === "channel_pattern"
            ? `${CHANNEL_LABELS[key as Channel]} sources: ${sharePct}% of gap-prompt retrievals`
            : kind === "competitor_presence"
              ? `${subjectLabel} appears across ${t.promptIds.size} gap prompts`
              : `${key} cited in ${t.promptIds.size} gap prompts`,
        observation:
          `Observed: ${t.citations} citation${t.citations === 1 ? "" : "s"} across ${t.promptIds.size} gap prompt${t.promptIds.size === 1 ? "" : "s"} ` +
          `(${sharePct}% of ${totalGapCitations} total gap-prompt retrievals in the last ${job.windowDays} days, ${eligibleRuns.length} eligible runs).`,
        hypothesis:
          confidence === "insufficient" ? null : hypothesisFor(kind, subjectLabel, sharePct),
        contradictoryEvidence: contradictory,
        confidence,
        sampleSize: t.citations,
        promptIds: [...t.promptIds],
        domain: opts.domain ?? null,
        channel: opts.channel ?? null,
        evidence: [...t.urls.values()].sort((a, b) => b.citations - a.citations).slice(0, 8),
      });
    };

    for (const [domain, t] of domainTrend) {
      addTrend("domain_dominance", domain, t, domain, { domain });
    }
    for (const [channel, t] of channelTrend) {
      if (t.citations >= 2)
        addTrend("channel_pattern", channel, t, CHANNEL_LABELS[channel].toLowerCase(), {
          channel,
        });
    }
    for (const [domain, t] of competitorTrend) {
      addTrend("competitor_presence", domain, t, brandNameFromDomain(domain), { domain });
    }
    // Keep the snapshot focused: strongest trends first, cap at 12.
    const rank = { strong: 3, moderate: 2, weak: 1, insufficient: 0 } as const;
    trendRows.sort(
      (a, b) =>
        rank[b.confidence as keyof typeof rank] - rank[a.confidence as keyof typeof rank] ||
        (b.sampleSize ?? 0) - (a.sampleSize ?? 0),
    );
    if (trendRows.length > 0) {
      await db.insert(gapTrendsTable).values(trendRows.slice(0, 12));
    }

    await db
      .update(gapResearchJobsTable)
      .set({ status: "completed", phase: "done", finishedAt: new Date() })
      .where(eq(gapResearchJobsTable.id, job.id));
    logger.info(
      { jobId: job.id, companyId: company.id, gapPrompts: gapPrompts.length },
      "Gap research completed",
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, jobId: job.id }, "Gap research failed");
    try {
      await db
        .update(gapResearchJobsTable)
        .set({ status: "failed", error: message, finishedAt: new Date() })
        .where(eq(gapResearchJobsTable.id, job.id));
    } catch (persistErr) {
      logger.error({ err: persistErr, jobId: job.id }, "Failed to persist research failure");
    }
  }
}

/** Fetch one cited page via the SSRF-guarded fetcher and upsert the cache row. */
async function fetchSourcePage(
  companyId: number,
  canonicalUrl: string,
  domain: string,
): Promise<GapSourcePage> {
  let fetchStatus = "unreachable";
  let httpStatus: number | null = null;
  let finalUrl: string | null = null;
  let title: string | null = null;
  let snippet: string | null = null;
  let pageSignals: PageSignals | null = null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const { res, finalUrl: fu } = await safeFetch(canonicalUrl, {
      signal: controller.signal,
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; AEO-Research/1.0)",
        accept: "text/html,application/xhtml+xml",
      },
    });
    finalUrl = fu;
    httpStatus = res.status;
    if (res.ok) {
      const reader = res.body?.getReader();
      let html = "";
      if (reader) {
        const decoder = new TextDecoder();
        let bytes = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          html += decoder.decode(value, { stream: true });
          if (bytes > MAX_PAGE_BYTES) {
            await reader.cancel();
            break;
          }
        }
      }
      const extracted = extractTitleAndSnippet(html);
      title = extracted.title || null;
      snippet = extracted.snippet || null;
      pageSignals = detectPageSignals(extracted.title, extracted.snippet);
      fetchStatus = "ok";
    } else {
      await res.body?.cancel();
      fetchStatus = res.status === 401 || res.status === 403 || res.status === 451 ? "blocked" : "http_error";
    }
  } catch (err) {
    fetchStatus =
      err instanceof Error && err.name === "AbortError" ? "timeout" : "unreachable";
  } finally {
    clearTimeout(timer);
  }

  const [page] = await db
    .insert(gapSourcePagesTable)
    .values({
      companyId,
      canonicalUrl,
      domain,
      fetchStatus,
      httpStatus,
      finalUrl,
      title,
      snippet,
      pageSignals,
      fetchedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [gapSourcePagesTable.companyId, gapSourcePagesTable.canonicalUrl],
      set: {
        fetchStatus,
        httpStatus,
        finalUrl,
        title,
        snippet,
        pageSignals: pageSignals as unknown as object,
        fetchedAt: new Date(),
      },
    })
    .returning();
  return page!;
}

/** Latest research job for a company, optionally only completed ones. */
export async function latestResearchJob(
  companyId: number,
  onlyCompleted: boolean,
): Promise<GapResearchJob | null> {
  const conditions = [eq(gapResearchJobsTable.companyId, companyId)];
  if (onlyCompleted) conditions.push(eq(gapResearchJobsTable.status, "completed"));
  const [job] = await db
    .select()
    .from(gapResearchJobsTable)
    .where(and(...conditions))
    .orderBy(sql`${gapResearchJobsTable.id} desc`)
    .limit(1);
  return job ?? null;
}
