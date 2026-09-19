import type { StrategyIdea } from "@workspace/db";

type RecommendationLike = {
  status?: unknown;
  playType?: unknown;
};

/**
 * Canonical bridge between deterministic research recommendations and the
 * reusable Ideas library. Titles are unique, seeded identifiers in this
 * project; exact matching avoids attaching loosely related evidence.
 */
const IDEA_TITLE_BY_RECOMMENDATION_PLAY: Record<string, string> = {
  "Comparison Landing Page":
    "Comparison landing page with answer-first table + decision tree",
  "Digital PR":
    "Data PR: exclusive proprietary stats to a tier-1 publication",
  "Community Engagement": "Reddit AMA on your money topics",
  "Listicle & Review Outreach":
    "Media list collaboration on an access topic",
  "Structured Reference Content":
    "Definitional help-center page (answer → detail → FAQ)",
};

const EVIDENCE_CHANNEL_BY_RECOMMENDATION_PLAY: Record<string, string> = {
  "Comparison Landing Page": "competitor_owned",
  "Digital PR": "editorial",
  "Community Engagement": "ugc",
  "Listicle & Review Outreach": "review_listicle",
  "Structured Reference Content": "reference",
};

export function suggestedIdeaTitle(
  recommendation: RecommendationLike,
): string | null {
  if (
    recommendation.status !== "proposed" ||
    typeof recommendation.playType !== "string"
  ) {
    return null;
  }
  return IDEA_TITLE_BY_RECOMMENDATION_PLAY[recommendation.playType] ?? null;
}

export function recommendationMatchesIdea(
  recommendation: RecommendationLike,
  idea: Pick<StrategyIdea, "title">,
): boolean {
  const expected = suggestedIdeaTitle(recommendation);
  return expected !== null && idea.title === expected;
}

export function recommendationEvidenceChannel(
  recommendation: RecommendationLike,
): string | null {
  if (
    recommendation.status !== "proposed" ||
    typeof recommendation.playType !== "string"
  ) {
    return null;
  }
  return (
    EVIDENCE_CHANNEL_BY_RECOMMENDATION_PLAY[recommendation.playType] ?? null
  );
}