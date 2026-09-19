import type { Company, Prompt, Signal } from "@workspace/db";

export type ActionRecommendationBasis =
  | "verified_research"
  | "research_refresh_needed"
  | "company_context"
  | "general_strategy";

export type ActionEvidenceLevel =
  | "verified_observation"
  | "historical_observation"
  | "established_practice"
  | "conditional_practice"
  | "experimental";

export interface ActionResearchContext {
  findingId: number;
  promptId: number;
  promptText: string;
  topic: string;
  competitorName: string | null;
  observedAt: string;
  isFresh: boolean;
  staleReason: string | null;
}

export interface ActionRecommendationValue {
  basis: ActionRecommendationBasis;
  evidenceLevel: ActionEvidenceLevel;
  generalPrinciple: string;
  companyRationale: string | null;
  nextStep: string;
  basedOn: string[];
  findingId: number | null;
  promptIds: number[];
}

interface Recipe {
  evidenceLevel: Exclude<ActionEvidenceLevel, "verified_observation">;
  basePriority: number;
  keywords: string[];
  applicableProfileFields?: Array<
    | "industry"
    | "objective"
    | "targetAudience"
    | "productsServices"
    | "positioning"
    | "geography"
  >;
  principle: string;
  nextStep: (context: RecommendationContext) => string;
}

interface RecommendationContext {
  company: Company;
  prompt: Pick<Prompt, "text" | "topic"> | null;
  profileFact: string | null;
}

const RECIPES: Record<string, Recipe> = {
  "Structured data (schema.org)": {
    evidenceLevel: "established_practice",
    basePriority: 4,
    keywords: ["schema.org", "json-ld", "structured data", "markup"],
    applicableProfileFields: ["productsServices"],
    principle:
      "Valid schema.org markup gives machines explicit entity and page-type information. It supports interpretation, but does not guarantee inclusion or citation.",
    nextStep: ({ company, prompt }) =>
      `Add and validate Organization markup for ${company.name}; use Product or Service markup only on matching offer pages, and FAQPage only where the questions and answers are visibly present${prompt ? `—starting with the page that should answer “${quote(prompt.text)}”` : ""}.`,
  },
  "Question-formatted content": {
    evidenceLevel: "established_practice",
    basePriority: 4,
    keywords: [
      "how do",
      "how should",
      "what is",
      "which ",
      "why ",
      "difference between",
      "question",
      "faq",
    ],
    principle:
      "Answer-first sections aligned to real user questions make passages easier to retrieve and evaluate. The page still needs original, accurate substance.",
    nextStep: ({ company, prompt }) =>
      prompt
        ? `Build an answer-first section for the tracked question “${quote(prompt.text)}”: give a direct answer, supporting criteria, useful detail, and only then a concise FAQ where it adds new information.`
        : `Turn one high-value ${company.name} customer question into an answer-first page with a direct response, supporting criteria, useful detail, and a non-repetitive FAQ.`,
  },
  "llms.txt file": {
    evidenceLevel: "experimental",
    basePriority: 2,
    keywords: ["llms.txt", "ai crawler", "answer engine"],
    principle:
      "llms.txt is an emerging publisher convention, not a proven ranking or citation factor. Treat it as a low-cost discovery aid, not a substitute for crawlable pages and internal links.",
    nextStep: ({ company }) =>
      `If ${company.name} can maintain it, publish a concise /llms.txt pointing to canonical, public pages and monitor server logs for use; do not divert effort from crawl access, content quality, or internal linking.`,
  },
  "Clear title and meta description": {
    evidenceLevel: "established_practice",
    basePriority: 3,
    keywords: ["best ", "top ", "compare", "comparison", "difference between"],
    principle:
      "Specific titles and descriptions clarify page purpose for search and answer systems. They are retrieval hygiene, not evidence of a causal citation lift.",
    nextStep: ({ company, prompt }) =>
      `Rewrite the title, H1, and description of one canonical ${company.name} page so its entity and intent are unambiguous${prompt ? `, using “${quote(prompt.text)}” as the intent to satisfy rather than text to copy verbatim` : ""}.`,
  },
  "Semantic HTML structure": {
    evidenceLevel: "established_practice",
    basePriority: 3,
    keywords: [
      "content structure",
      "structure my",
      "documentation",
      "help center",
      "guide",
      "format",
    ],
    principle:
      "Semantic landmarks, headings, lists, and tables expose document structure consistently to crawlers, accessibility tools, and extraction systems.",
    nextStep: ({ company, prompt }) =>
      `Audit the canonical ${company.name} page${prompt ? ` serving “${quote(prompt.text)}”` : " most important to discovery"} for one H1, logical heading order, main/article landmarks, descriptive links, and real HTML lists or tables instead of visual-only layout.`,
  },
  "Content freshness": {
    evidenceLevel: "conditional_practice",
    basePriority: 3,
    keywords: ["2026", "latest", "current", "today", "recent"],
    principle:
      "Freshness matters when the answer can materially change. Updating dates without rechecking facts is not useful and can reduce trust.",
    nextStep: ({ company, prompt }) =>
      prompt
        ? `Create a review cadence for the page answering “${quote(prompt.text)}”; verify changed claims and sources, record substantive revisions, and show an updated date only when the content truly changes.`
        : `Identify ${company.name} pages with time-sensitive claims, assign an owner and review cadence, and show updated dates only after substantive fact checking.`,
  },
  "Crawler access (robots.txt)": {
    evidenceLevel: "established_practice",
    basePriority: 5,
    keywords: [
      "robots.txt",
      "crawler",
      "crawl access",
      "blocked from",
      "cannot access",
      "indexing",
    ],
    principle:
      "A public page cannot be retrieved by a crawler that is blocked from requesting it. Bot access is a prerequisite, not proof that a page will be surfaced.",
    nextStep: ({ company, prompt }) =>
      `Test ${company.domain}/robots.txt and representative canonical URLs against the crawlers ${company.name} intends to allow; confirm HTTP status, rendered content, canonical tags, and server-log access${prompt ? ` for the page serving “${quote(prompt.text)}”` : ""}.`,
  },
  "Reddit and community presence": {
    evidenceLevel: "conditional_practice",
    basePriority: 3,
    keywords: ["reddit", "community", "forum", "first-hand", "experience-led"],
    principle:
      "First-hand community discussions can be retrieved for recommendation and experience-led questions. Relevance and authenticity matter; manufactured promotion is a trust risk.",
    nextStep: ({ company, prompt, profileFact }) =>
      `Find existing discussions${prompt ? ` around “${quote(prompt.text)}”` : ` relevant to ${company.name}`}${profileFact ? ` and ${profileFact}` : ""}; contribute useful expertise with clear affiliation, and do not seed undisclosed endorsements or synthetic conversations.`,
  },
  "Editorial coverage and listicles": {
    evidenceLevel: "conditional_practice",
    basePriority: 4,
    keywords: ["best ", "top ", "compare", "comparison", "recommend"],
    principle:
      "Independent editorial comparisons are frequently available to answer systems for commercial queries. Inclusion is earned through relevance and substantiated differentiation, not placement alone.",
    nextStep: ({ company, prompt, profileFact }) =>
      `Build a source-backed editorial pitch for ${company.name}${prompt ? ` around the decision behind “${quote(prompt.text)}”` : ""}${profileFact ? `, grounded in ${profileFact}` : ""}; offer verifiable data or expert input rather than asking for an unsupported “best” ranking.`,
  },
  "Wikipedia and reference presence": {
    evidenceLevel: "conditional_practice",
    basePriority: 2,
    keywords: ["who is", "company history", "brand history", "wikipedia", "notability"],
    principle:
      "Independent reference sources can help establish entities, but Wikipedia requires significant third-party coverage and editorial independence. A promotional page is not an acceptable tactic.",
    nextStep: ({ company }) =>
      `Assess whether ${company.name} already has substantial independent coverage that meets reference-site notability rules. If not, focus on earning accurate third-party coverage and maintaining consistent public facts—do not create promotional reference content.`,
  },
  "Review platform ratings": {
    evidenceLevel: "conditional_practice",
    basePriority: 3,
    keywords: ["review", "best ", "top ", "compare", "comparison", "recommend"],
    principle:
      "Independent review profiles can supply structured product and customer-experience signals for comparison queries. Their usefulness depends on category, market, and genuine review volume.",
    nextStep: ({ company, prompt, profileFact }) =>
      `Identify the one review platform actually used for ${profileFact ?? `${company.name}’s category`}${prompt ? ` and the decision behind “${quote(prompt.text)}”` : ""}; complete factual fields, invite honest customer feedback without incentives for sentiment, and respond transparently.`,
  },
  "Consistent entity mentions": {
    evidenceLevel: "conditional_practice",
    basePriority: 3,
    keywords: [
      "brand mentioned",
      "brand visibility",
      "recognise my brand",
      "recognize my brand",
      "entity",
    ],
    principle:
      "Consistent names, descriptions, and relationships reduce entity ambiguity across first- and third-party sources. Consistency alone does not prove authority or cause model visibility.",
    nextStep: ({ company, profileFact }) =>
      `Define a factual one-sentence description of ${company.name}${profileFact ? ` anchored in ${profileFact}` : ""}, then reconcile the name, domain, category, and key claims across the site and legitimate external profiles without mass-producing mentions.`,
  },
};

function clean(value: string | null | undefined, max = 180): string | null {
  if (!value?.trim()) return null;
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function quote(value: string): string {
  return clean(value, 150) ?? "";
}

type ProfileField = NonNullable<Recipe["applicableProfileFields"]>[number];

function profileFact(
  company: Company,
  onlyFields?: ProfileField[],
): string | null {
  const candidates: Array<[ProfileField, string, string | null]> = [
    ["productsServices", "its products or services", clean(company.productsServices)],
    ["targetAudience", "its target audience", clean(company.targetAudience)],
    ["objective", "its stated objective", clean(company.objective)],
    ["positioning", "its positioning", clean(company.positioning)],
    ["geography", "its market", clean(company.geography)],
    ["industry", "its industry", clean(company.industry)],
  ];
  const selected = candidates
    .filter(
      ([field, , value]) =>
        value && (!onlyFields || onlyFields.includes(field)),
    )
    .slice(0, 2)
    .map(([, label, value]) => `${label} — ${value}`);
  return selected.length > 0 ? selected.join("; ") : null;
}

function relevantPrompts(
  prompts: Array<Pick<Prompt, "id" | "text" | "topic" | "active">>,
  keywords: string[],
): Array<Pick<Prompt, "id" | "text" | "topic" | "active">> {
  return prompts
    .filter((prompt) => prompt.active)
    .map((prompt) => {
      const haystack = `${prompt.topic} ${prompt.text}`.toLowerCase();
      const score = keywords.reduce(
        (total, keyword) => total + (haystack.includes(keyword) ? 1 : 0),
        0,
      );
      return { prompt, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.prompt.id - b.prompt.id)
    .map(({ prompt }) => prompt);
}

export function buildActionRecommendation(
  signal: Signal,
  company: Company,
  prompts: Array<Pick<Prompt, "id" | "text" | "topic" | "active">>,
  research: ActionResearchContext | null,
): {
  description: string;
  recommendation: string;
  weight: number;
  status: string;
  guidance: ActionRecommendationValue;
} {
  const recipe = RECIPES[signal.name];
  if (!recipe) {
    const fallback = signal.recommendation ?? signal.description;
    return {
      description: signal.description,
      recommendation: fallback,
      weight: Math.max(1, Math.min(5, Math.round(signal.weight / 20))),
      status: "general",
      guidance: {
        basis: "general_strategy",
        evidenceLevel: "conditional_practice",
        generalPrinciple: signal.description,
        companyRationale: null,
        nextStep: fallback,
        basedOn: ["General AEO playbook"],
        findingId: null,
        promptIds: [],
      },
    };
  }

  const matchedPrompts = relevantPrompts(prompts, recipe.keywords);
  const prompt = research
    ? {
        id: research.promptId,
        text: research.promptText,
        topic: research.topic,
        active: true,
      }
    : (matchedPrompts[0] ?? null);
  const fact = profileFact(company);
  const applicableFact = profileFact(
    company,
    recipe.applicableProfileFields ?? [],
  );
  const nextStep = recipe.nextStep({ company, prompt, profileFact: fact });

  if (research) {
    if (!research.isFresh) {
      return {
        description: recipe.principle,
        recommendation: nextStep,
        weight: Math.min(5, Math.max(3, recipe.basePriority)),
        status: "refresh research",
        guidance: {
          basis: "research_refresh_needed",
          evidenceLevel: "historical_observation",
          generalPrinciple: recipe.principle,
          companyRationale: `A matching Gap Analysis observation exists from ${formatDate(research.observedAt)}, but it is not current${research.staleReason ? `: ${research.staleReason}` : ""}. Refresh research before treating it as evidence for ${company.name}.`,
          nextStep,
          basedOn: ["Historical Gap Analysis", "General AEO playbook"],
          findingId: null,
          promptIds: [research.promptId],
        },
      };
    }
    const competitor = research.competitorName
      ? ` while ${clean(research.competitorName) ?? "a competitor"} surfaced`
      : "";
    return {
      description: recipe.principle,
      recommendation: nextStep,
      weight: 5,
      status: "research gap",
      guidance: {
        basis: "verified_research",
        evidenceLevel: "verified_observation",
        generalPrinciple: recipe.principle,
        companyRationale: `Verified Gap Analysis completed ${formatDate(research.observedAt)} observed a ${company.name} visibility gap${competitor} for “${quote(research.promptText)}”. This supports prioritising the action, but does not prove the cited source caused the result.`,
        nextStep,
        basedOn: ["Verified Gap Analysis", "Tracked prompt", ...(fact ? ["Company profile"] : [])],
        findingId: research.findingId,
        promptIds: [research.promptId],
      },
    };
  }

  const hasContext = Boolean(prompt || applicableFact);
  const reasons: string[] = [];
  if (prompt) reasons.push(`the tracked question “${quote(prompt.text)}”`);
  if (applicableFact) reasons.push(applicableFact);
  return {
    description: recipe.principle,
    recommendation: nextStep,
    weight: Math.min(5, recipe.basePriority + (hasContext ? 1 : 0)),
    status: hasContext
      ? recipe.evidenceLevel === "experimental"
        ? "contextual test"
        : "company fit"
      : recipe.evidenceLevel === "experimental"
        ? "test"
        : "foundation",
    guidance: {
      basis: hasContext ? "company_context" : "general_strategy",
      evidenceLevel: recipe.evidenceLevel,
      generalPrinciple: recipe.principle,
      companyRationale: hasContext
        ? `Prioritised for ${company.name} because it matches ${reasons.join(" and ")}. This is contextual fit, not evidence that the action has already improved this company’s visibility.`
        : null,
      nextStep,
      basedOn: hasContext
        ? [
            ...(prompt ? ["Tracked prompts"] : []),
            ...(fact ? ["Company profile"] : []),
            "General AEO playbook",
          ]
        : ["General AEO playbook"],
      findingId: null,
      promptIds: matchedPrompts.slice(0, 3).map((item) => item.id),
    },
  };
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "an earlier research snapshot"
    : date.toISOString().slice(0, 10);
}

export const SIGNAL_NAME_BY_IDEA_TITLE: Record<string, string> = {
  "Reddit AMA on your money topics": "Reddit and community presence",
  "Media list collaboration on an access topic":
    "Editorial coverage and listicles",
  "Definitional help-center page (answer → detail → FAQ)":
    "Question-formatted content",
};