import type {
  GapCompetitorSurfaced,
  GapEvidenceItem,
  GapResearchFinding,
  Signal,
  StrategyIdea,
} from "@workspace/api-client-react";
import type { StrategyIdeaPreset } from "@/components/strategy/DeployIdeaDialog";

const SIGNAL_RESEARCH_MAPPING: Record<
  string,
  { ideaTitle: string; evidenceChannel: GapEvidenceItem["channel"] }
> = {
  "Reddit and community presence": {
    ideaTitle: "Reddit AMA on your money topics",
    evidenceChannel: "ugc",
  },
  "Editorial coverage and listicles": {
    ideaTitle: "Media list collaboration on an access topic",
    evidenceChannel: "review_listicle",
  },
  "Question-formatted content": {
    ideaTitle: "Definitional help-center page (answer → detail → FAQ)",
    evidenceChannel: "reference",
  },
};

const RECOMMENDATION_EVIDENCE_CHANNEL: Record<
  string,
  GapEvidenceItem["channel"]
> = {
  "Comparison Landing Page": "competitor_owned",
  "Digital PR": "editorial",
  "Community Engagement": "ugc",
  "Listicle & Review Outreach": "review_listicle",
  "Structured Reference Content": "reference",
};

export interface ActionResearchMatch {
  finding: GapResearchFinding | null;
  evidence: GapEvidenceItem | null;
  competitor: GapCompetitorSurfaced | null;
  mappedTitle?: string;
  initialIdeaTitle?: string;
  initialFindingId?: number;
  initialCustomIdea?: StrategyIdeaPreset;
}

export function selectDeploymentFinding(
  findings: GapResearchFinding[],
  idea: Pick<StrategyIdea, "title" | "category">,
  initialFindingId: number | undefined,
  allowFallback: boolean,
): GapResearchFinding | null {
  if (typeof initialFindingId === "number") {
    return (
      findings.find(
        (finding) =>
          finding.id === initialFindingId &&
          !finding.promotion &&
          finding.recommendation.status === "proposed" &&
          finding.recommendation.category === idea.category &&
          finding.recommendation.suggestedIdeaTitle === idea.title,
      ) ?? null
    );
  }
  if (!allowFallback) return null;
  return (
    findings.find(
      (finding) =>
        !finding.promotion &&
        finding.recommendation.status === "proposed" &&
        finding.recommendation.category === idea.category &&
        finding.recommendation.suggestedIdeaTitle === idea.title,
    ) ?? null
  );
}

export function calculateObservedShare(
  runCount: number,
  eligibleRunCount: number,
): { observedRunCount: number; sharePct: number } | null {
  if (eligibleRunCount <= 0) return null;
  const observedRunCount = Math.min(
    Math.max(Math.trunc(runCount), 0),
    Math.trunc(eligibleRunCount),
  );
  return {
    observedRunCount,
    sharePct: Math.round((observedRunCount / eligibleRunCount) * 100),
  };
}

export function getRecommendationSupportingEvidence(
  finding: GapResearchFinding,
): GapEvidenceItem | null {
  const playType = finding.recommendation.playType;
  const expectedChannel =
    typeof playType === "string"
      ? RECOMMENDATION_EVIDENCE_CHANNEL[playType]
      : undefined;
  if (!expectedChannel) return null;
  const supportingUrls = new Set(finding.recommendation.evidenceUrls);
  return (
    [...finding.evidence]
      .filter(
        (evidence) =>
          evidence.channel === expectedChannel &&
          evidence.runCount > 0 &&
          supportingUrls.has(evidence.canonicalUrl),
      )
      .sort((a, b) => {
        if (a.runCount !== b.runCount) return b.runCount - a.runCount;
        return b.citationCount - a.citationCount;
      })[0] ?? null
  );
}

function evidenceStrength(
  finding: GapResearchFinding,
  evidence: GapEvidenceItem,
): [number, number, number, number] {
  const observed = calculateObservedShare(
    evidence.runCount,
    finding.eligibleRunCount,
  );
  return [
    observed?.sharePct ?? 0,
    evidence.runCount,
    evidence.citationCount,
    new Date(evidence.lastSeenAt ?? 0).getTime(),
  ];
}

function isStrongerEvidence(
  candidate: [number, number, number, number],
  current: [number, number, number, number],
): boolean {
  for (let index = 0; index < candidate.length; index += 1) {
    if (candidate[index] !== current[index]) {
      return candidate[index] > current[index];
    }
  }
  return false;
}

export function getSignalIdeaMapping(
  signal: Signal,
  findings: GapResearchFinding[],
  strategyIdeas: StrategyIdea[],
  preferredFindingId?: number | null,
): ActionResearchMatch {
  const researchMapping = SIGNAL_RESEARCH_MAPPING[signal.name];
  const mappedTitle = researchMapping?.ideaTitle;
  let finding: GapResearchFinding | null = null;
  let evidence: GapEvidenceItem | null = null;
  let competitor: GapCompetitorSurfaced | null = null;
  let strongest: [number, number, number, number] | null = null;

  if (mappedTitle) {
    for (const candidateFinding of findings) {
      if (
        preferredFindingId === null ||
        (typeof preferredFindingId === "number" &&
          candidateFinding.id !== preferredFindingId) ||
        candidateFinding.recommendation.category !== signal.category ||
        candidateFinding.recommendation.status !== "proposed" ||
        candidateFinding.recommendation.suggestedIdeaTitle !== mappedTitle ||
        candidateFinding.eligibleRunCount <= 0
      ) {
        continue;
      }

      const candidateCompetitor = [...candidateFinding.competitors]
        .filter((item) => item.runsSurfaced > 0)
        .sort((a, b) => b.runsSurfaced - a.runsSurfaced)[0];
      if (!candidateCompetitor && typeof preferredFindingId !== "number") {
        continue;
      }
      const supportingUrls = new Set(
        candidateFinding.recommendation.evidenceUrls,
      );

      for (const candidateEvidence of candidateFinding.evidence) {
        if (
          candidateEvidence.runCount <= 0 ||
          candidateEvidence.channel !== researchMapping.evidenceChannel ||
          !supportingUrls.has(candidateEvidence.canonicalUrl)
        ) {
          continue;
        }
        const strength = evidenceStrength(candidateFinding, candidateEvidence);
        if (!strongest || isStrongerEvidence(strength, strongest)) {
          strongest = strength;
          finding = candidateFinding;
          evidence = candidateEvidence;
          competitor = candidateCompetitor ?? null;
        }
      }
    }
  }

  let initialIdeaTitle: string | undefined;
  let initialCustomIdea: StrategyIdeaPreset | undefined;

  if (mappedTitle) {
    initialIdeaTitle = mappedTitle;
  } else {
    const existingIdea = strategyIdeas.find(
      (idea) =>
        idea.category === signal.category &&
        idea.title.toLowerCase() === signal.name.toLowerCase(),
    );
    if (existingIdea) {
      initialIdeaTitle = existingIdea.title;
    } else {
      initialCustomIdea = {
        title: signal.name,
        category: signal.category === "off_page" ? "off_page" : "on_page",
        playType: "AEO action",
        description: signal.description,
        rationale: signal.recommendation || signal.description,
        priority: signal.weight >= 5 ? "P0" : signal.weight >= 3 ? "P1" : "P2",
      };
    }
  }

  return {
    finding,
    evidence,
    competitor,
    mappedTitle,
    initialIdeaTitle,
    initialFindingId: finding?.id,
    initialCustomIdea,
  };
}