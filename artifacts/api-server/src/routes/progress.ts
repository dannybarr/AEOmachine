import { Router, type IRouter } from "express";
import { sql, eq, and, gte, desc, asc, inArray } from "drizzle-orm";
import {
  db,
  promptsTable,
  promptRunsTable,
  citationsTable,
  strategyItemsTable,
  strategyIdeasTable,
  weeklyMeasurementsTable,
} from "@workspace/db";
import {
  GetProgressQueryParams,
  GetProgressResponse,
} from "@workspace/api-zod";
import { getCompany } from "../lib/companyLookup";
import { utcWindowStart } from "../lib/timeWindow";
import { citationMixBucket } from "../lib/domainClassify";

const router: IRouter = Router();

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

router.get("/progress", async (req, res): Promise<void> => {
  const q = GetProgressQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  const company = await getCompany(q.data.companyId);
  if (!company) {
    res.status(400).json({ error: "Unknown companyId" });
    return;
  }
  const days = Math.min(Math.max(q.data.days ?? 30, 7), 365);
  // Shared UTC calendar windows so KPI totals, delta, and the daily series
  // all cover exactly the same calendar days (today included, partial).
  const cutoff = utcWindowStart(days);
  const startMs = cutoff.getTime();
  const prevCutoff = new Date(startMs - days * 86400_000);

  // All runs for this company inside the double window (for delta math).
  const runs = await db
    .select({
      id: promptRunsTable.id,
      brandMentioned: promptRunsTable.brandMentioned,
      brandPosition: promptRunsTable.brandPosition,
      citationEligible: promptRunsTable.citationEligible,
      createdAt: promptRunsTable.createdAt,
    })
    .from(promptRunsTable)
    .innerJoin(promptsTable, eq(promptsTable.id, promptRunsTable.promptId))
    .where(
      and(eq(promptsTable.companyId, company.id), gte(promptRunsTable.createdAt, prevCutoff)),
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

  // Citations joined to their run dates, bucketed by domain type.
  const windowRunIds = windowRuns.map((r) => r.id);
  const citationRows =
    windowRunIds.length === 0
      ? []
      : await db
          .select({
            runId: citationsTable.runId,
            domainType: citationsTable.domainType,
          })
          .from(citationsTable)
          .innerJoin(promptRunsTable, eq(promptRunsTable.id, citationsTable.runId))
          .where(
            and(
              inArray(citationsTable.runId, windowRunIds),
              // Verified-citation predicate: provider provenance AND a
              // confirmed-eligible run — progress KPIs, series, and the
              // average denominator are verified-only.
              eq(citationsTable.provenance, "provider"),
              sql`${promptRunsTable.citationEligible} is true`,
            ),
          );

  const runDateById = new Map<number, string>();
  for (const r of windowRuns) {
    runDateById.set(r.id, r.createdAt.toISOString().slice(0, 10));
  }

  // Build the daily series over every calendar day in the window.
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
  for (const c of citationRows) {
    const date = runDateById.get(c.runId);
    const day = date ? byDay.get(date) : undefined;
    if (!day) continue;
    day[citationMixBucket(c.domainType)] += 1;
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

  // Strategy actions become chart milestones: the updatedAt timestamp is the
  // last status change, which is when the action started affecting reality.
  const items = await db
    .select({
      status: strategyItemsTable.status,
      updatedAt: strategyItemsTable.updatedAt,
      title: strategyIdeasTable.title,
      category: strategyIdeasTable.category,
    })
    .from(strategyItemsTable)
    .innerJoin(strategyIdeasTable, eq(strategyIdeasTable.id, strategyItemsTable.ideaId))
    .where(eq(strategyItemsTable.companyId, company.id))
    .orderBy(asc(strategyItemsTable.updatedAt));

  const events = items
    .filter((i) => i.status === "in_progress" || i.status === "live")
    .filter((i) => i.updatedAt >= cutoff)
    .map((i) => ({
      date: i.updatedAt.toISOString().slice(0, 10),
      title: i.title,
      category: i.category as "on_page" | "off_page",
      status: i.status,
    }));

  const actionsLive = items.filter((i) => i.status === "live").length;
  const actionsInProgress = items.filter((i) => i.status === "in_progress").length;

  const measurements = (
    await db
      .select()
      .from(weeklyMeasurementsTable)
      .where(eq(weeklyMeasurementsTable.companyId, company.id))
      .orderBy(asc(weeklyMeasurementsTable.weekOf))
  ).map((m) => ({
    weekOf: m.weekOf,
    shareOfVoicePct: m.shareOfVoicePct,
    brandMentions: m.brandMentions,
    competitorMentionsAvg: m.competitorMentionsAvg,
    consensusAnswer: m.consensusAnswer,
    topPageType: m.topPageType,
  }));

  const totalRetrievals = citationRows.length;
  const [lastRun] = await db
    .select({ createdAt: sql<string>`max(${promptRunsTable.createdAt})` })
    .from(promptRunsTable)
    .innerJoin(promptsTable, eq(promptsTable.id, promptRunsTable.promptId))
    .where(eq(promptsTable.companyId, company.id));

  res.json(
    GetProgressResponse.parse({
      summary: {
        visibilityPct,
        visibilityDelta,
        totalRuns: windowRuns.length,
        totalRetrievals,
        // Verified citations over confirmed-eligible runs only.
        avgCitationsPerRun: (() => {
          const eligible = windowRuns.filter((r) => r.citationEligible === true).length;
          return eligible > 0 ? round1(totalRetrievals / eligible) : null;
        })(),
        avgBrandPosition,
        actionsLive,
        actionsInProgress,
        lastTrackedAt: lastRun?.createdAt
          ? new Date(lastRun.createdAt).toISOString()
          : null,
      },
      series,
      events,
      measurements,
    }),
  );
});

export default router;
