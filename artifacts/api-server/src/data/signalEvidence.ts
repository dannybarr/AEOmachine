/**
 * Curated, verified evidence signals for catalog signals ("actions").
 *
 * Every entry names a real company/organization, a real published source
 * (URLs verified reachable at curation time), and keeps observation strictly
 * separate from qualified interpretation (`rationale`). Signals without a
 * defensible precedent are deliberately absent — they render as original
 * ideas with no evidence control, never with invented justification.
 *
 * Applied lazily and idempotently: only fills rows whose `evidence` is NULL,
 * matched by signal name.
 */
export interface ActionEvidenceValue {
  company: string;
  evidenceType:
    | "editorial"
    | "ugc"
    | "original_statistics"
    | "faq_structure"
    | "documentation"
    | "review_listicle"
    | "competitor_owned"
    | "reference"
    | "brand_owned"
    | "other";
  observation: string;
  rationale: string | null;
  sourceTitle: string | null;
  sourceUrl: string | null;
  observedAt: string | null; // ISO date
  confidence: "observed" | "curated" | "hypothesis";
}

export const SIGNAL_EVIDENCE_SEEDS: Record<string, ActionEvidenceValue> = {
  "Reddit and community presence": {
    company: "Reddit",
    evidenceType: "ugc",
    observation:
      "Google publicly announced an expanded partnership (Feb 2024) giving its AI products structured access to Reddit content, and community threads are a major retrieval source for 'best X' style questions.",
    rationale:
      "Presence in high-quality community threads correlates with brand mentions in AI answers. This is an observed retrieval pattern, not proof that any single thread causes a mention.",
    sourceTitle: "Google — An expanded partnership with Reddit",
    sourceUrl:
      "https://blog.google/inside-google/company-announcements/expanded-reddit-partnership/",
    observedAt: "2024-02-22",
    confidence: "curated",
  },
  "Editorial coverage and listicles": {
    company: "Zapier",
    evidenceType: "review_listicle",
    observation:
      "Zapier maintains continuously updated 'best X apps' listicles with answer-first verdicts and structured comparisons — a format answer engines can quote almost verbatim.",
    rationale:
      "Being featured in widely retrieved editorial listicles correlates with AI-answer inclusion for category queries. Correlation from retrieval patterns; causation is not claimed.",
    sourceTitle: "Zapier — The best to-do list apps",
    sourceUrl: "https://zapier.com/blog/best-todo-list-apps/",
    observedAt: null,
    confidence: "curated",
  },
  "Crawler access (robots.txt)": {
    company: "OpenAI",
    evidenceType: "documentation",
    observation:
      "OpenAI documents its crawlers (GPTBot, OAI-SearchBot) and states that sites disallowing them in robots.txt are excluded from its crawling and search retrieval.",
    rationale:
      "This is vendor-documented behavior: blocking AI crawlers directly prevents retrieval, so allowing them is a prerequisite for being cited at all.",
    sourceTitle: "OpenAI — Bots and crawlers documentation",
    sourceUrl: "https://platform.openai.com/docs/bots",
    observedAt: null,
    confidence: "curated",
  },
  "Structured data (schema.org)": {
    company: "Google",
    evidenceType: "documentation",
    observation:
      "Google's structured-data documentation describes how schema.org markup lets machines reliably interpret page content — the same machine-readability answer engines depend on when parsing sources.",
    rationale:
      "Documented machine-readability benefit. A direct lift in AI citations is plausible but has not been independently proven; treat as a strong hygiene factor.",
    sourceTitle: "Google Search Central — Introduction to structured data",
    sourceUrl:
      "https://developers.google.com/search/docs/appearance/structured-data/intro-structured-data",
    observedAt: null,
    confidence: "curated",
  },
  "llms.txt file": {
    company: "llmstxt.org (open proposal)",
    evidenceType: "documentation",
    observation:
      "The llms.txt proposal defines a root-level markdown file that gives LLMs a curated map of a site's most important content.",
    rationale:
      "Adoption is early and no major answer engine has confirmed consuming llms.txt. Treat this as a low-cost experiment, not a proven ranking signal.",
    sourceTitle: "The /llms.txt proposal",
    sourceUrl: "https://llmstxt.org/",
    observedAt: null,
    confidence: "hypothesis",
  },
  "Review platform ratings": {
    company: "G2",
    evidenceType: "review_listicle",
    observation:
      "G2 category pages publish structured rankings and verified review counts in a format answer engines can quote directly when comparing software.",
    rationale:
      "Review platforms appear frequently among retrieved sources for comparison queries. Strong ratings there correlate with favorable AI mentions; causation is not claimed.",
    sourceTitle: "G2 — Software categories",
    sourceUrl: "https://www.g2.com/categories",
    observedAt: null,
    confidence: "curated",
  },
};
