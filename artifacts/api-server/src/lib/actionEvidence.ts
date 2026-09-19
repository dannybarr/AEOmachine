import { inArray } from "drizzle-orm";
import {
  db,
  gapActionProvenanceTable,
  type GapEvidence,
} from "@workspace/db";
import type { ActionEvidenceValue } from "../data/signalEvidence";

const CHANNEL_LABELS: Record<string, ActionEvidenceValue["evidenceType"]> = {
  competitor_owned: "competitor_owned",
  editorial: "editorial",
  ugc: "ugc",
  review_listicle: "review_listicle",
  reference: "reference",
  brand_owned: "brand_owned",
  other: "other",
};

function snapshotEvidence(value: unknown): ActionEvidenceValue | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ActionEvidenceValue>;
  if (
    typeof candidate.company !== "string" ||
    typeof candidate.evidenceType !== "string" ||
    typeof candidate.observation !== "string" ||
    typeof candidate.confidence !== "string"
  ) {
    return null;
  }
  return candidate as ActionEvidenceValue;
}

export function resolveSnapshotExample(snapshot: unknown): {
  isExplicit: boolean;
  evidence: ActionEvidenceValue | null;
} {
  if (
    !snapshot ||
    typeof snapshot !== "object" ||
    !Object.prototype.hasOwnProperty.call(snapshot, "example")
  ) {
    return { isExplicit: false, evidence: null };
  }
  return {
    isExplicit: true,
    evidence: snapshotEvidence(
      (snapshot as { example?: unknown }).example,
    ),
  };
}

/**
 * Only explicit immutable snapshots may ground a deployed action. Legacy
 * provenance did not bind a source to the recommendation, so it must remain
 * evidence-free rather than falling back to mutable or unrelated finding rows.
 */
export function evidenceFromProvenanceSnapshot(
  snapshot: unknown,
): ActionEvidenceValue | null {
  const resolved = resolveSnapshotExample(snapshot);
  return resolved.isExplicit ? resolved.evidence : null;
}

/** Prefer competitor-owned, most-cited evidence rows within explicit constraints. */
export function pickBestEvidenceRow(
  rows: GapEvidence[],
  constraints?: { evidenceUrls: string[]; channel: string },
): GapEvidence | null {
  const allowedUrls = constraints
    ? new Set(constraints.evidenceUrls)
    : null;
  const candidates = constraints
    ? rows.filter(
        (row) =>
          row.channel === constraints.channel &&
          allowedUrls?.has(row.canonicalUrl),
      )
    : rows;
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => {
    if (a.isCompetitor !== b.isCompetitor) return a.isCompetitor ? -1 : 1;
    return (b.citationCount ?? 0) - (a.citationCount ?? 0);
  })[0]!;
}

/**
 * Build an ActionEvidence value from a stored gap-evidence row plus the
 * qualified rationale snapshotted at promotion time. Observation stays
 * strictly factual (counts, models, stored excerpt); interpretation lives in
 * `rationale` and is passed through from the deterministic research output.
 */
export function evidenceFromGapRow(
  row: GapEvidence,
  rationale: string | null,
  surfacedCompany = row.domain,
): ActionEvidenceValue {
  const models = ((row.models as string[]) ?? []).filter(Boolean);
  const parts = [
    `${row.domain} was cited ${row.citationCount}× across ${row.runCount} stored answer run${row.runCount === 1 ? "" : "s"}`,
  ];
  if (models.length) parts.push(`on ${models.join(", ")}`);
  let observation = parts.join(" ") + ".";
  if (row.answerContext) {
    observation += ` Stored answer excerpt: “${row.answerContext}”`;
  }
  const observedAt = row.lastSeenAt ?? row.pageFetchedAt ?? null;
  return {
    company: surfacedCompany,
    evidenceType: CHANNEL_LABELS[row.channel] ?? "other",
    observation,
    rationale,
    sourceTitle: row.pageTitle ?? row.domain,
    sourceUrl: row.canonicalUrl,
    observedAt: observedAt ? observedAt.toISOString() : null,
    confidence: "observed",
  };
}

/**
 * Resolve evidence for deployed strategy items that were promoted from a
 * Gap Analysis finding. Items without provenance simply get no evidence —
 * they are original ideas, never given invented justification.
 * Degrades cleanly: any missing evidence rows → null for that item.
 */
export async function evidenceForStrategyItems(
  itemIds: number[],
): Promise<Map<number, ActionEvidenceValue>> {
  const result = new Map<number, ActionEvidenceValue>();
  if (itemIds.length === 0) return result;

  const provenance = await db
    .select()
    .from(gapActionProvenanceTable)
    .where(inArray(gapActionProvenanceTable.strategyItemId, itemIds));
  if (provenance.length === 0) return result;

  for (const p of provenance) {
    const evidence = evidenceFromProvenanceSnapshot(p.evidenceSnapshot);
    if (evidence) result.set(p.strategyItemId, evidence);
  }
  return result;
}
