import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  promptsTable,
  promptRunsTable,
  citationsTable,
  strategyItemsTable,
  strategyIdeasTable,
  weeklyMeasurementsTable,
  type Company,
} from "@workspace/db";
import {
  buildContextSnapshot,
  type CompanyContextSnapshot,
} from "./companyContext";

/**
 * Structured, dated evidence bundle behind one case-study revision.
 * Every number is computed from recorded platform data; nothing is estimated
 * or extrapolated. The bundle is snapshotted verbatim on the revision so the
 * claimed basis of a narrative can always be audited later.
 */
export interface MetricWindow {
  /** ISO date range the window covers (inclusive). */
  start: string;
  end: string;
  runs: number;
  visibilityPct: number | null;
  avgBrandPosition: number | null;
  /** Verified citations only (provider provenance + citation-eligible run). */
  verifiedCitations: number;
  ownedCitations: number;
}

export interface CaseStudyEvidence {
  version: 1;
  capturedAt: string;
  companyContext: CompanyContextSnapshot;
  authored: {
    startingPosition: string | null;
    strategicFocus: string | null;
    contextNotes: string | null;
  };
  tracking: {
    firstRunAt: string | null;
    lastRunAt: string | null;
    totalRuns: number;
    activePrompts: number;
    /** Earliest 14 tracked days vs latest 14 tracked days. */
    earliest: MetricWindow | null;
    latest: MetricWindow | null;
  };
  strategy: {
    actionsLive: number;
    actionsInProgress: number;
    milestones: Array<{
      date: string;
      title: string;
      category: string;
      status: string;
    }>;
  };
  measurements: Array<{
    weekOf: string;
    shareOfVoicePct: number | null;
    brandMentions: number;
    keyTakeaway: string | null;
  }>;
  /** Human-readable descriptions of what the record cannot yet support. */
  gaps: string[];
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

interface RunRow {
  id: number;
  brandMentioned: boolean;
  brandPosition: number | null;
  citationEligible: boolean | null;
  createdAt: Date;
}

async function metricWindow(runs: RunRow[]): Promise<MetricWindow | null> {
  if (runs.length === 0) return null;
  const positions = runs
    .map((r) => r.brandPosition)
    .filter((p): p is number => p !== null);
  const eligibleIds = runs.filter((r) => r.citationEligible === true).map((r) => r.id);
  let verified = 0;
  let owned = 0;
  if (eligibleIds.length > 0) {
    const rows = await db
      .select({
        n: sql<number>`count(*)::int`,
        owned: sql<number>`count(*) filter (where ${citationsTable.domainType} = 'you')::int`,
      })
      .from(citationsTable)
      .where(
        and(
          inArray(citationsTable.runId, eligibleIds),
          // Verified-citation predicate: provider provenance on an eligible run.
          eq(citationsTable.provenance, "provider"),
        ),
      );
    verified = rows[0]?.n ?? 0;
    owned = rows[0]?.owned ?? 0;
  }
  const dates = runs.map((r) => r.createdAt.toISOString().slice(0, 10)).sort();
  return {
    start: dates[0]!,
    end: dates[dates.length - 1]!,
    runs: runs.length,
    visibilityPct: round1((100 * runs.filter((r) => r.brandMentioned).length) / runs.length),
    avgBrandPosition:
      positions.length > 0
        ? round1(positions.reduce((a, b) => a + b, 0) / positions.length)
        : null,
    verifiedCitations: verified,
    ownedCitations: owned,
  };
}

const WINDOW_DAYS = 14;

/**
 * Assemble the full evidence bundle for a company's case study. The earliest
 * and latest windows deliberately cover the first and last N calendar days of
 * recorded tracking, so "beginning vs now" claims always name their periods.
 */
export async function buildCaseStudyEvidence(
  company: Company,
  authored: {
    startingPosition: string | null;
    strategicFocus: string | null;
    contextNotes: string | null;
  },
): Promise<CaseStudyEvidence> {
  const runs: RunRow[] = await db
    .select({
      id: promptRunsTable.id,
      brandMentioned: promptRunsTable.brandMentioned,
      brandPosition: promptRunsTable.brandPosition,
      citationEligible: promptRunsTable.citationEligible,
      createdAt: promptRunsTable.createdAt,
    })
    .from(promptRunsTable)
    .innerJoin(promptsTable, eq(promptsTable.id, promptRunsTable.promptId))
    .where(eq(promptsTable.companyId, company.id))
    .orderBy(asc(promptRunsTable.createdAt));

  const [{ activePrompts } = { activePrompts: 0 }] = await db
    .select({ activePrompts: sql<number>`count(*)::int` })
    .from(promptsTable)
    .where(and(eq(promptsTable.companyId, company.id), eq(promptsTable.active, true)));

  let earliest: MetricWindow | null = null;
  let latest: MetricWindow | null = null;
  if (runs.length > 0) {
    const firstMs = runs[0]!.createdAt.getTime();
    const lastMs = runs[runs.length - 1]!.createdAt.getTime();
    const span = WINDOW_DAYS * 86400_000;
    earliest = await metricWindow(runs.filter((r) => r.createdAt.getTime() < firstMs + span));
    latest = await metricWindow(runs.filter((r) => r.createdAt.getTime() > lastMs - span));
  }

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
    keyTakeaway: m.keyTakeaway,
  }));

  const gaps: string[] = [];
  if (!authored.startingPosition?.trim())
    gaps.push("No starting position has been written yet — the story opens without the client's own framing.");
  if (!authored.strategicFocus?.trim())
    gaps.push("No strategic focus has been captured — intended direction cannot be described.");
  if (runs.length === 0)
    gaps.push("No tracking runs are recorded — visibility and citation progress cannot be measured yet.");
  else if (
    earliest && latest && earliest.start === latest.start
  )
    gaps.push(
      `All tracking activity falls inside a single ${WINDOW_DAYS}-day window — beginning-vs-now comparisons are not yet meaningful.`,
    );
  const liveOrActive = items.filter((i) => i.status === "live" || i.status === "in_progress");
  if (liveOrActive.length === 0)
    gaps.push("No strategy actions are in progress or live — there is no recorded work to narrate.");
  if (measurements.length === 0)
    gaps.push("No weekly measurements exist — share-of-voice development cannot be reported.");

  return {
    version: 1,
    capturedAt: new Date().toISOString(),
    companyContext: buildContextSnapshot(company),
    authored: {
      startingPosition: authored.startingPosition?.trim() || null,
      strategicFocus: authored.strategicFocus?.trim() || null,
      contextNotes: authored.contextNotes?.trim() || null,
    },
    tracking: {
      firstRunAt: runs[0]?.createdAt.toISOString() ?? null,
      lastRunAt: runs[runs.length - 1]?.createdAt.toISOString() ?? null,
      totalRuns: runs.length,
      activePrompts,
      earliest,
      latest,
    },
    strategy: {
      actionsLive: items.filter((i) => i.status === "live").length,
      actionsInProgress: items.filter((i) => i.status === "in_progress").length,
      milestones: liveOrActive.slice(-20).map((i) => ({
        date: i.updatedAt.toISOString().slice(0, 10),
        title: i.title,
        category: i.category,
        status: i.status,
      })),
    },
    measurements: measurements.slice(-12),
    gaps,
  };
}
