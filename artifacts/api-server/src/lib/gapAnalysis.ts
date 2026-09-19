/**
 * Pure, deterministic helpers for the evidence-backed Gap Analysis engine.
 * Everything here is a function of its inputs — no DB, no network — so the
 * accuracy-critical logic (canonicalization, classification, confidence,
 * recommendations) is directly unit-testable.
 */
import type { DomainType } from "./domainClassify";

/**
 * Version 2 is the first analysis contract built exclusively from runs with
 * confirmed citation eligibility and provider-returned citation provenance.
 * Earlier snapshots must never be presented or promoted as verified evidence.
 */
export const ANALYSIS_VERSION = 2;

// ─── URL canonicalization ───

const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gclid",
  "fbclid",
  "ref",
  "ref_src",
  "mc_cid",
  "mc_eid",
]);

/**
 * Canonicalize a cited URL for deduplication: lowercase host, strip www,
 * drop fragments and tracking params, collapse trailing slash. Returns null
 * for unparseable or non-http(s) URLs.
 */
export function canonicalizeUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  u.hash = "";
  u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
  const kept = [...u.searchParams.entries()].filter(
    ([k]) => !TRACKING_PARAMS.has(k.toLowerCase()),
  );
  u.search = "";
  for (const [k, v] of kept) u.searchParams.append(k, v);
  let s = u.toString();
  // Collapse trailing slash on bare paths (keep root "/")
  if (u.pathname !== "/" && u.pathname.endsWith("/") && !u.search) {
    s = s.replace(/\/$/, "");
  }
  return s;
}

// ─── Page signals ───

export interface PageSignals {
  isComparison: boolean;
  isListicle: boolean;
  isReview: boolean;
}

/** Detect deterministic page-type signals from a title + description. */
export function detectPageSignals(title: string, snippet: string): PageSignals {
  const t = `${title} ${snippet}`.toLowerCase();
  return {
    isComparison: /\bvs\.?\b|\bversus\b|\bcompared?\b|\bcomparison\b|\balternatives?\b/.test(t),
    isListicle: /\b(top|best)\s+\d+\b|\b\d+\s+(best|top|great)\b|\bbest\b.*\b(tools|software|platforms|apps|services|companies)\b/.test(t),
    isReview: /\breviews?\b|\brating\b|\bpros and cons\b/.test(t),
  };
}

/** Extract <title> and meta description from an HTML document (best effort). */
export function extractTitleAndSnippet(html: string): { title: string; snippet: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const descMatch =
    html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i) ??
    html.match(/<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i) ??
    html.match(/<meta[^>]+property=["']og:description["'][^>]*content=["']([^"']*)["']/i);
  const decode = (s: string): string =>
    s
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;|&apos;/g, "'")
      .replace(/\s+/g, " ")
      .trim();
  return {
    title: decode(titleMatch?.[1] ?? "").slice(0, 300),
    snippet: decode(descMatch?.[1] ?? "").slice(0, 500),
  };
}

// ─── Channel classification ───

export type Channel =
  | "competitor_owned"
  | "editorial"
  | "ugc"
  | "review_listicle"
  | "reference"
  | "brand_owned"
  | "other";

export const CHANNEL_LABELS: Record<Channel, string> = {
  competitor_owned: "Competitor-owned",
  editorial: "Editorial / press",
  ugc: "UGC / forum",
  review_listicle: "Review / listicle",
  reference: "Reference",
  brand_owned: "Your domain",
  other: "Other",
};

/**
 * Map a registry domain type plus fetched page signals into an actionable
 * channel. Page signals only upgrade generic/editorial sources into
 * review_listicle — they never override ownership classes.
 */
export function classifyChannel(
  domainType: DomainType | string,
  signals: PageSignals | null,
): Channel {
  if (domainType === "you") return "brand_owned";
  if (domainType === "competitor") return "competitor_owned";
  if (domainType === "ugc") return "ugc";
  if (domainType === "reference") return "reference";
  const listy = signals !== null && (signals.isListicle || signals.isReview);
  if (domainType === "editorial") return listy ? "review_listicle" : "editorial";
  if (listy) return "review_listicle";
  if (domainType === "institutional") return "reference";
  return "other";
}

// ─── Confidence ───

export type Confidence = "insufficient" | "weak" | "moderate" | "strong";

/**
 * Calibrated confidence for a cross-prompt pattern based on explicit sample
 * sizes: number of supporting citations and number of distinct prompts.
 */
export function confidenceFor(citations: number, prompts: number): Confidence {
  if (citations < 2 || prompts < 1) return "insufficient";
  if (citations >= 10 && prompts >= 3) return "strong";
  if (citations >= 5 && prompts >= 2) return "moderate";
  return "weak";
}

// ─── Answer context extraction ───

/**
 * Deterministic excerpt of an answer around the first occurrence of a term
 * (brand name or domain), for auditable "answer context". Returns null when
 * the term does not occur — never fabricates context.
 */
export function extractAnswerContext(
  answerText: string,
  term: string,
  radius = 140,
): string | null {
  if (!term) return null;
  const idx = answerText.toLowerCase().indexOf(term.toLowerCase());
  if (idx === -1) return null;
  const start = Math.max(0, idx - radius);
  const end = Math.min(answerText.length, idx + term.length + radius);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < answerText.length ? "…" : "";
  return `${prefix}${answerText.slice(start, end).replace(/\s+/g, " ").trim()}${suffix}`;
}

/** Human brand name guess from a domain (e.g. "semrush.com" → "Semrush"). */
export function brandNameFromDomain(domain: string): string {
  const base = domain.split(".")[0] ?? domain;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/** Word-boundary, case-insensitive brand mention test (min 3 chars). */
export function mentionsBrand(text: string, brandName: string): boolean {
  if (brandName.length < 3) return false;
  const escaped = brandName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(text);
}

// ─── Recommendations ───

export interface Recommendation {
  status: "proposed" | "insufficient";
  category: "on_page" | "off_page" | null;
  playType: string | null;
  title: string | null;
  rationale: string | null;
  evidenceUrls: string[];
}

interface ChannelStat {
  channel: Channel;
  citations: number;
  urls: string[];
}

const CHANNEL_PLAYS: Record<
  Exclude<Channel, "brand_owned" | "other">,
  { category: "on_page" | "off_page"; playType: string; action: string; mechanism: string }
> = {
  competitor_owned: {
    category: "on_page",
    playType: "Comparison Landing Page",
    action: "Publish an answer-first comparison page targeting this prompt",
    mechanism:
      "competitor-owned pages are being retrieved where you have no equivalent asset; a comparable page on your domain gives engines a citable alternative",
  },
  editorial: {
    category: "off_page",
    playType: "Digital PR",
    action: "Pitch editorial coverage in the outlets already cited for this prompt",
    mechanism:
      "editorial articles are repeatedly retrieved for this prompt; earning coverage in the same outlets is a replicable path into the cited set",
  },
  ugc: {
    category: "off_page",
    playType: "Community Engagement",
    action: "Build genuine presence in the community threads cited for this prompt",
    mechanism:
      "forum/UGC threads are repeatedly retrieved for this prompt; authentic participation where the discussion already happens is the replicable mechanism",
  },
  review_listicle: {
    category: "off_page",
    playType: "Listicle & Review Outreach",
    action: "Pursue inclusion in the cited review and listicle pages",
    mechanism:
      "round-up/review pages dominate retrievals for this prompt; getting listed in the same round-ups is a direct, replicable route into answers",
  },
  reference: {
    category: "on_page",
    playType: "Structured Reference Content",
    action: "Publish authoritative reference/definition content for this prompt",
    mechanism:
      "reference-style sources are retrieved for this prompt; comparable structured, factual content on your domain can compete for the same retrievals",
  },
};

/**
 * Deterministic, evidence-grounded recommendation for one prompt finding.
 * Built only from the observed channel mix; uses calibrated language and
 * falls back to "insufficient evidence" instead of speculating.
 */
export function buildRecommendation(
  promptTopic: string,
  channelStats: ChannelStat[],
): Recommendation {
  const actionable = channelStats
    .filter((c) => c.channel !== "brand_owned" && c.channel !== "other")
    .sort((a, b) => b.citations - a.citations);
  const top = actionable[0];
  if (!top || top.citations < 2) {
    return {
      status: "insufficient",
      category: null,
      playType: null,
      title: null,
      rationale:
        "Not enough cited-source evidence for this prompt to support a specific recommendation. Run more tracked simulations on search-capable models, then refresh the research.",
      evidenceUrls: top?.urls.slice(0, 5) ?? [],
    };
  }
  const play = CHANNEL_PLAYS[top.channel as keyof typeof CHANNEL_PLAYS];
  const label = CHANNEL_LABELS[top.channel].toLowerCase();
  return {
    status: "proposed",
    category: play.category,
    playType: play.playType,
    title: `${play.action.split(" ").slice(0, 6).join(" ")} — ${promptTopic}`,
    rationale:
      `${play.action}. Observed: ${top.citations} citation${top.citations === 1 ? "" : "s"} of ${label} sources for this prompt. ` +
      `This is an association, not proven causation — but ${play.mechanism}.`,
    evidenceUrls: top.urls.slice(0, 5),
  };
}

// ─── Trend text (calibrated language) ───

export function hypothesisFor(kind: string, subject: string, sharePct: number): string {
  switch (kind) {
    case "domain_dominance":
      return `${subject} may be functioning as a go-to source for these prompts. Its repeated retrieval is an association, not proven causation, but matching the format and depth of its cited pages is a plausible, replicable path into the same answers.`;
    case "channel_pattern":
      return `Answer engines appear to favor ${subject} sources for these prompts (${sharePct}% of retrievals). This correlation suggests — but does not prove — that presence in this channel is what earns citations here.`;
    case "competitor_presence":
      return `${subject} surfacing repeatedly alongside these prompts may indicate its content or third-party coverage aligns closely with what engines retrieve. Association only; no causal claim.`;
    default:
      return "";
  }
}
