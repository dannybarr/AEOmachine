import { Router, type IRouter } from "express";
import { eq, desc, and, isNull, inArray } from "drizzle-orm";
import {
  db,
  companiesTable,
  promptsTable,
  signalsTable,
  gapFindingsTable,
  gapEvidenceTable,
  type Signal,
} from "@workspace/db";
import { ListSignalsQueryParams, ListSignalsResponse } from "@workspace/api-zod";
import {
  SIGNAL_EVIDENCE_SEEDS,
  type ActionEvidenceValue,
} from "../data/signalEvidence";
import {
  getGapResearchFreshness,
  getLatestCompatibleGapResearchJob,
} from "../lib/gapResearchFreshness";
import {
  buildActionRecommendation,
  SIGNAL_NAME_BY_IDEA_TITLE,
  type ActionResearchContext,
} from "../lib/actionRecommendations";
import {
  recommendationEvidenceChannel,
  suggestedIdeaTitle,
} from "../lib/recommendationIdeaMatch";

const router: IRouter = Router();

/**
 * Backfill curated evidence onto known signals, once per process.
 * Idempotent: only touches rows whose evidence is still NULL.
 */
let evidenceSeeded = false;
async function ensureSignalEvidence(): Promise<void> {
  if (evidenceSeeded) return;
  for (const [name, evidence] of Object.entries(SIGNAL_EVIDENCE_SEEDS)) {
    await db
      .update(signalsTable)
      .set({ evidence })
      .where(and(eq(signalsTable.name, name), isNull(signalsTable.evidence)));
  }
  evidenceSeeded = true;
}

export function serializeSignal(
  s: Signal,
  personalized?: ReturnType<typeof buildActionRecommendation>,
) {
  return {
    id: s.id,
    name: s.name,
    category: s.category,
    description: personalized?.description ?? s.description,
    weight: personalized?.weight ?? Math.max(1, Math.min(5, Math.round(s.weight / 20))),
    status: personalized?.status ?? s.status,
    recommendation: personalized?.recommendation ?? s.recommendation,
    guidance: personalized?.guidance ?? null,
    evidence: (s.evidence as ActionEvidenceValue | null) ?? null,
  };
}

router.get("/signals", async (req, res): Promise<void> => {
  const q = ListSignalsQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  const [company] = await db
    .select()
    .from(companiesTable)
    .where(eq(companiesTable.id, q.data.companyId));
  if (!company) {
    res.status(400).json({ error: "Unknown companyId" });
    return;
  }
  await ensureSignalEvidence();
  const [signals, prompts, researchBySignal] = await Promise.all([
    db
      .select()
      .from(signalsTable)
      .where(q.data.category ? eq(signalsTable.category, q.data.category) : undefined)
      .orderBy(desc(signalsTable.weight)),
    db.select().from(promptsTable).where(eq(promptsTable.companyId, company.id)),
    loadVerifiedResearchContext(company.id),
  ]);

  const personalized = signals
    .map((signal) =>
      serializeSignal(
        signal,
        buildActionRecommendation(
          signal,
          company,
          prompts,
          researchBySignal.get(signal.name) ?? null,
        ),
      ),
    )
    .sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name));

  res.json(ListSignalsResponse.parse(personalized));
});

async function loadVerifiedResearchContext(
  companyId: number,
): Promise<Map<string, ActionResearchContext>> {
  const job = await getLatestCompatibleGapResearchJob(companyId);
  if (!job) return new Map();
  const observedAt = job.finishedAt ?? job.createdAt;
  const { isFresh, staleReason } = await getGapResearchFreshness(
    companyId,
    observedAt,
  );

  const findings = await db
    .select()
    .from(gapFindingsTable)
    .where(eq(gapFindingsTable.jobId, job.id));
  if (findings.length === 0) return new Map();
  const evidence = await db
    .select()
    .from(gapEvidenceTable)
    .where(inArray(gapEvidenceTable.findingId, findings.map((finding) => finding.id)));
  const evidenceByFinding = new Map<number, typeof evidence>();
  for (const row of evidence) {
    const rows = evidenceByFinding.get(row.findingId) ?? [];
    rows.push(row);
    evidenceByFinding.set(row.findingId, rows);
  }

  const candidates = new Map<
    string,
    { context: ActionResearchContext; strength: [number, number] }
  >();
  for (const finding of findings) {
    if (finding.eligibleRunCount <= 0) continue;
    const recommendation = finding.recommendation as {
      status?: unknown;
      playType?: unknown;
      evidenceUrls?: unknown;
    };
    const ideaTitle = suggestedIdeaTitle(recommendation);
    const signalName = ideaTitle
      ? SIGNAL_NAME_BY_IDEA_TITLE[ideaTitle]
      : undefined;
    const channel = recommendationEvidenceChannel(recommendation);
    const supportingUrls = new Set(
      Array.isArray(recommendation.evidenceUrls)
        ? recommendation.evidenceUrls.filter(
            (value): value is string => typeof value === "string",
          )
        : [],
    );
    if (!signalName || !channel || supportingUrls.size === 0) continue;
    const supporting = (evidenceByFinding.get(finding.id) ?? [])
      .filter(
        (row) =>
          row.channel === channel &&
          row.runCount > 0 &&
          supportingUrls.has(row.canonicalUrl),
      )
      .sort(
        (a, b) =>
          b.runCount - a.runCount || b.citationCount - a.citationCount,
      )[0];
    if (!supporting) continue;

    const competitor = (
      Array.isArray(finding.competitors) ? finding.competitors : []
    )
      .filter(
        (value): value is { name?: unknown; domain?: unknown; runsSurfaced: number } =>
          typeof value === "object" &&
          value !== null &&
          typeof (value as { runsSurfaced?: unknown }).runsSurfaced === "number" &&
          (value as { runsSurfaced: number }).runsSurfaced > 0,
      )
      .sort((a, b) => b.runsSurfaced - a.runsSurfaced)[0];
    const competitorName =
      typeof competitor?.name === "string"
        ? competitor.name
        : typeof competitor?.domain === "string"
          ? competitor.domain
          : null;
    const strength: [number, number] = [
      supporting.runCount,
      supporting.citationCount,
    ];
    const current = candidates.get(signalName);
    if (
      current &&
      (current.strength[0] > strength[0] ||
        (current.strength[0] === strength[0] &&
          current.strength[1] >= strength[1]))
    ) {
      continue;
    }
    candidates.set(signalName, {
      context: {
        findingId: finding.id,
        promptId: finding.promptId,
        promptText: finding.promptText,
        topic: finding.topic,
        competitorName,
        observedAt: observedAt.toISOString(),
        isFresh,
        staleReason,
      },
      strength,
    });
  }

  return new Map(
    [...candidates].map(([signalName, value]) => [
      signalName,
      value.context,
    ]),
  );
}

export default router;
