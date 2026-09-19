export type AuditSeverity = "critical" | "high" | "medium" | "low";

export interface AuditPage {
  url: string;
  finalUrl: string | null;
  fetchStatus: string;
  httpStatus: number | null;
  title: string | null;
  content: string | null;
  html?: string | null;
  crawlDiscovery?: {
    robotsTxtFetched: boolean;
    sitemapFetched: boolean;
    sitemapUrlCount: number;
  };
}

export interface AuditFinding {
  id: string;
  code: string;
  category: string;
  severity: AuditSeverity;
  title: string;
  explanation: string;
  evidence: string;
  pageUrl: string | null;
  recommendation: string;
  effort: "low" | "medium" | "high";
  impact: "low" | "medium" | "high";
  affectedCount: number;
  prevalence: number;
  representativeUrls: string[];
  representativeEvidence: string[];
  scoreRationale: string;
  impactExplanation: string;
  confidence: "high" | "medium" | "low";
  limitations: string[];
}

export interface AuditQuickWin {
  code: string;
  title: string;
  recommendation: string;
  evidence: string;
  pageUrl: string | null;
  findingCodes: string[];
  effort: "low" | "medium" | "high";
  impact: "low" | "medium" | "high";
  family: string;
  rationale: string;
  affectedCount: number;
  representativeUrls: string[];
  rank: number;
}

export interface AuditCategoryNarrative {
  category: string;
  score: number;
  conclusion: string;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  risks: string[];
  scoreRationale: string;
  impact: string;
  evidence: string[];
  confidence: "high" | "medium" | "low";
  limitations: string[];
}

export interface WebsiteAuditResult {
  auditVersion: string;
  context: Record<string, string>;
  score: number;
  categoryScores: Record<string, number>;
  categoryNarratives: Record<string, AuditCategoryNarrative>;
  counts: Record<string, number>;
  pagesScanned: number;
  methodology: string[];
  findings: AuditFinding[];
  quickWins: AuditQuickWin[];
  generatedAt: Date;
}

const WEIGHTS: Record<string, number> = {
  crawlability: 16, metadata: 10, semantics: 10, answerability: 12,
  structured_data: 8, trust: 10, evidence: 9, freshness: 7,
  accessibility: 6, internal_linking: 6, content_quality: 6,
};
const PENALTY: Record<AuditSeverity, number> = { critical: 45, high: 28, medium: 16, low: 8 };

/** A grouped issue applies 50%-100% of its severity penalty based on prevalence. */
function effectiveDeduction(severity: AuditSeverity, prevalence: number): number {
  const multiplier = 0.5 + 0.5 * Math.max(0, Math.min(1, prevalence));
  return Math.round(PENALTY[severity] * multiplier);
}

function tags(html: string, name: string): string[] {
  return [...html.matchAll(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, "gi"))]
    .map((m) => (m[1] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}
function has(html: string, pattern: RegExp): boolean {
  pattern.lastIndex = 0;
  return pattern.test(html);
}
function attrCount(html: string, tag: string, attr: RegExp): number {
  return [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>`, "gi"))].filter((m) => attr.test(m[0])).length;
}
function stableId(code: string, pageUrl: string | null, occurrence: number): string {
  let hash = 2166136261;
  for (const character of `${code}|${pageUrl ?? "site"}|${occurrence}`) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  }
  return `${code}:${(hash >>> 0).toString(36)}`;
}
function jsonLdScripts(html: string): string[] {
  return [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter((match) => /\btype\s*=\s*(['"]?)application\/ld\+json\1/i.test(match[1] ?? ""))
    .map((match) => match[2] ?? "");
}
const RELEVANT_SCHEMA_TYPES = new Set([
  "organization", "localbusiness", "person", "website", "webpage", "article",
  "newsarticle", "blogposting", "faqpage", "product", "service", "breadcrumblist",
  "howto", "review", "event",
]);

export function generateWebsiteAudit(
  pages: readonly AuditPage[],
  context?: {
    companyName?: string | null;
    targetAudience?: string | null;
    industry?: string | null;
    objective?: string | null;
    productsServices?: string | null;
    positioning?: string | null;
    geography?: string | null;
  },
  now = new Date(),
): WebsiteAuditResult {
  type RawFinding = Omit<AuditFinding, "affectedCount" | "prevalence" | "representativeUrls" | "representativeEvidence" | "scoreRationale" | "impactExplanation" | "confidence" | "limitations">;
  const rawFindings: RawFinding[] = [];
  const ok = pages.filter((p) => p.fetchStatus === "ok");
  let findingOccurrence = 0;
  const add = (
    code: string, category: string, severity: AuditSeverity, title: string,
    explanation: string, evidence: string, pageUrl: string | null,
    recommendation: string, effort: AuditFinding["effort"] = "low",
    impact: AuditFinding["impact"] = "medium",
  ) => rawFindings.push({ id: stableId(code, pageUrl, findingOccurrence++), code, category, severity, title, explanation, evidence, pageUrl, recommendation, effort, impact });

  for (const page of pages.filter((p) => p.fetchStatus !== "ok")) {
    add("crawl.fetch_failure", "crawlability", page === pages[0] ? "critical" : "high",
      "Page could not be fetched", "Unavailable pages cannot be indexed or reliably extracted.",
      `Fetch outcome: ${page.fetchStatus}${page.httpStatus ? ` (HTTP ${page.httpStatus})` : ""}.`, page.url,
      "Restore a crawlable 2xx HTML response and verify redirects stay on the canonical host.", "medium", "high");
  }
  if (!ok.length) add("crawl.no_readable_pages", "crawlability", "critical", "No readable HTML pages",
    "The bounded crawl found no usable public HTML.", `${pages.length} URL(s) attempted; 0 readable.`, pages[0]?.url ?? null,
    "Check hosting, robots/firewall rules, redirects, and public access.", "high", "high");
  if (!ok.length) {
    const findings = aggregateFindings(rawFindings, pages.length, 0);
    const crawlFinding = findings.find((finding) => finding.code === "crawl.no_readable_pages")!;
    const categoryScores = Object.fromEntries(Object.keys(WEIGHTS).map((category) => [category, 0]));
    return {
      auditVersion: "2.0",
      context: cleanContext(context),
      score: 0,
      categoryScores,
      categoryNarratives: buildCategoryNarratives(categoryScores, findings, pages.length, 0),
      counts: {
        findings: findings.length,
        critical: findings.filter((finding) => finding.severity === "critical").length,
        high: findings.filter((finding) => finding.severity === "high").length,
        medium: 0,
        low: 0,
        fetched: 0,
        failed: pages.length,
        listPages: 0,
        tablePages: 0,
        questionHeadings: 0,
        conciseAnswers: 0,
        faqPages: 0,
        validJsonLd: 0,
      },
      pagesScanned: pages.length,
      methodology: [
        "Assessment stopped at crawlability because no public HTML could be read",
        "Google Search Essentials and helpful-content guidance",
        "Deterministic bounded-crawl AEO extractability heuristics (signals, not ranking guarantees)",
      ],
      findings,
      quickWins: [{
        code: "restore-public-crawl-access",
        title: "Restore public crawl access",
        recommendation: crawlFinding.recommendation,
        evidence: crawlFinding.evidence,
        pageUrl: crawlFinding.pageUrl,
        findingCodes: [crawlFinding.code],
        effort: crawlFinding.effort,
        impact: crawlFinding.impact,
        family: "crawl_index_access",
        rationale: crawlFinding.explanation,
        affectedCount: crawlFinding.affectedCount,
        representativeUrls: crawlFinding.representativeUrls,
        rank: 1,
      }],
      generatedAt: now,
    };
  }

  let listPages = 0, tablePages = 0, questionHeadings = 0, conciseAnswers = 0;
  let faqPages = 0, validJsonLd = 0, invalidJsonLd = 0, trustPages = 0;
  let citationPages = 0, researchPages = 0, datedPages = 0, timeSensitivePages = 0, missingAlt = 0, mediaWithoutText = 0;
  const discovery = pages[0]?.crawlDiscovery;
  let robotsNoindex = 0, thinPages = 0, moneyTopicPages = 0, internalLinkSignals = 0;
  const titleCounts = new Map<string, number>();

  for (const page of ok) {
    const html = page.html ?? "";
    const text = page.content ?? "";
    const url = page.finalUrl ?? page.url;
    const headings = [1, 2, 3, 4, 5, 6].flatMap((level) => tags(html, `h${level}`).map((value) => ({ level, value })));
    const title = page.title?.trim() ?? "";
    if (!title) add("metadata.missing_title", "metadata", "high", "Missing page title",
      "A descriptive title helps search systems and people identify the page.", "No non-empty title element was detected.", url,
      "Add a unique, concise title describing this page.", "low", "high");
    else titleCounts.set(title.toLowerCase(), (titleCounts.get(title.toLowerCase()) ?? 0) + 1);
    if (!has(html, /<meta\b[^>]*name\s*=\s*["']description["'][^>]*content\s*=\s*["'][^"']{20,}["']/i))
      add("metadata.missing_description", "metadata", "medium", "Missing or unclear meta description",
        "A clear description improves page understanding and search snippets.", "No substantial meta description was detected.", url,
        "Write a page-specific description that accurately summarizes visible content.");
    if (!has(html, /<link\b[^>]*rel\s*=\s*["'][^"']*canonical[^"']*["'][^>]*href=/i))
      add("metadata.missing_canonical", "metadata", "low", "Canonical URL not declared",
        "Canonical hints help consolidate duplicate URL variants.", "No canonical link was detected.", url,
        "Declare a self-referencing canonical URL when appropriate.");
    if (has(html, /<meta\b[^>]*(?:name\s*=\s*["']robots["'][^>]*content\s*=\s*["'][^"']*noindex|content\s*=\s*["'][^"']*noindex[^>]*name\s*=\s*["']robots)/i)) robotsNoindex++;
    if (!headings.some((h) => h.level === 1)) add("semantics.missing_h1", "semantics", "medium", "Missing primary heading",
      "A semantic H1 gives the page a clear topic.", "No H1 was detected.", url, "Add one descriptive H1 aligned with visible content.");
    if (headings.some((h, i) => i > 0 && h.level > headings[i - 1]!.level + 1))
      add("semantics.heading_jump", "semantics", "low", "Heading hierarchy skips levels",
        "Ordered headings make sections easier to navigate and extract.", "A heading level jump was detected.", url,
        "Use headings in a logical hierarchy without choosing levels for styling.");
    const questions = headings.filter((h) => /^(?:who|what|where|when|why|how|which|can|should|is|are|do|does)\b.*\?$/i.test(h.value));
    questionHeadings += questions.length;
    if (questions.length && questions.some((q) => {
      const pos = text.toLowerCase().indexOf(q.value.toLowerCase().replace(/\?$/, ""));
      const following = pos >= 0 ? text.slice(pos + q.value.length, pos + q.value.length + 450) : "";
      return following.split(/\s+/).filter(Boolean).length >= 15 && following.split(/[.!?]/)[0]!.split(/\s+/).length <= 80;
    })) conciseAnswers++;
    if (has(html, /<(?:ul|ol)\b/i)) listPages++;
    if (has(html, /<table\b/i)) tablePages++;
    if (has(html, /\b(?:faq|frequently asked|common questions)\b/i)) faqPages++;
    if (/\b(?:price|pricing|cost|fee|budget|investment|roi|value|plan|quote)\b/i.test(text)) moneyTopicPages++;
    internalLinkSignals += [...html.matchAll(/<a\b[^>]*href\s*=\s*["'](?:\/|\.\/|\.\.\/|#)/gi)].length;
    for (const script of jsonLdScripts(html)) {
      try {
        const value = JSON.parse(script);
        const nodes = Array.isArray(value) ? value : [value];
        if (nodes.some((node) => {
          const type = node && typeof node === "object" ? (node as Record<string, unknown>)["@type"] : null;
          return (Array.isArray(type) ? type : [type]).some((item) => typeof item === "string" && RELEVANT_SCHEMA_TYPES.has(item.toLowerCase()));
        })) validJsonLd++;
      } catch { invalidJsonLd++; }
    }
    if (/\b(?:author|written by|reviewed by|about us|contact us|our team|editorial policy|privacy policy)\b/i.test(text)) trustPages++;
    if (has(html, /<a\b[^>]*href\s*=\s*["']https?:\/\/(?![^"']*(?:www\.)?[^/"']+\/?["'])/i) || /\b(?:source|references|according to)\b/i.test(text)) citationPages++;
    if (/\b(?:our research|our data|we surveyed|methodology|sample size|case study|benchmark|first-party)\b/i.test(text)) researchPages++;
    if (has(html, /<time\b/i) || /\b(?:updated|published)\s+(?:on\s+)?[A-Z][a-z]+\s+\d{1,2},?\s+\d{4}\b/.test(text)) datedPages++;
    if (/\b(?:current|currently|latest|recent|today|this year|price|pricing|cost|rate|fee|deadline|schedule|availability|version|release|news)\b/i.test(text)) timeSensitivePages++;
    const images = [...html.matchAll(/<img\b[^>]*>/gi)];
    missingAlt += images.filter((m) => !/\balt\s*=\s*["'][^"']+["']/i.test(m[0])).length;
    if (has(html, /<(?:audio|video)\b/i) && !/\b(?:transcript|captions|subtitles)\b/i.test(text)) mediaWithoutText++;
    if (text.split(/\s+/).filter(Boolean).length < 180) thinPages++;
  }
  for (const [title, count] of titleCounts) if (count > 1) add("metadata.duplicate_title", "metadata", "medium",
    "Duplicate titles across crawled pages", "Unique titles clarify each page's purpose.", `${count} pages use “${title.slice(0, 120)}”.`, null,
    "Give each indexable page a distinct descriptive title.");
  if (robotsNoindex) add("crawl.noindex", "crawlability", "high", "Noindex directive detected",
    "Noindex prevents affected pages from appearing in search.", `${robotsNoindex} crawled page(s) contain a noindex directive.`, null,
    "Confirm noindex is intentional; remove it from pages meant for discovery.");
  if (!discovery?.robotsTxtFetched) add("crawl.robots_unavailable", "crawlability", "low", "robots.txt could not be fetched",
    "Robots directives and sitemap declarations should be publicly retrievable for crawl discovery.",
    "The explicit same-site robots.txt request did not return a readable 2xx response.", pages[0]?.url ?? null,
    "Publish a publicly reachable robots.txt and verify it with a direct request.");
  if (!discovery?.sitemapFetched) add("crawl.sitemap_unavailable", "crawlability", "low", "Sitemap could not be fetched",
    "Sitemaps support URL discovery; this check explicitly requested sitemap URLs and is not inferred from page HTML.",
    "No readable same-site sitemap was returned from /sitemap.xml or robots.txt declarations.", pages[0]?.url ?? null,
    "Publish a valid XML sitemap and declare its URL in robots.txt.");
  if (ok.length > 1 && listPages === 0) add("answerability.no_lists", "answerability", "medium", "No list-based content detected",
    "Lists can make steps, options, and criteria easier to extract when they fit the content.", `0 of ${ok.length} readable pages used ordered or unordered lists.`, null,
    "Convert suitable steps, criteria, or comparisons into semantic lists.");
  if (!questionHeadings) add("answerability.no_question_headings", "answerability", "medium", "No specific question headings detected",
    "Explicit audience questions followed by direct answers improve clarity and extractability.", "No interrogative H1-H6 ending in a question mark was detected.", null,
    "Add meaningful audience questions as headings and answer each immediately and concisely.");
  else if (!conciseAnswers) add("answerability.no_direct_answers", "answerability", "medium", "Question headings lack concise direct answers",
    "A short answer immediately after a meaningful question makes the passage easier to understand and extract.",
    `${questionHeadings} question heading(s) were detected without a concise following answer signal.`, null,
    "Lead each question section with a complete, direct answer before adding detail.");
  if (!tablePages && ok.some((p) => /\b(?:compare|comparison|pricing|data|benchmark|features)\b/i.test(p.content ?? "")))
    add("answerability.no_tables_for_comparable_data", "answerability", "low", "Comparable information is not tabular",
      "Semantic tables can clarify genuinely comparable facts; they should not be used only for layout.",
      "Comparison, pricing, feature, data, or benchmark wording was detected but no table was found.", null,
      "Use a captioned semantic table where the visible information has consistent rows and columns.");
  if (!faqPages) add("answerability.no_faq", "answerability", "medium", "FAQ coverage was not detected",
    "Useful FAQs can address recurring audience decisions; FAQ structured data must match visible answers.", "No visible FAQ or common-questions wording was detected.", null,
    "Publish visible, non-duplicative FAQs based on genuine audience and customer questions.");
  if (!faqPages && moneyTopicPages) add("answerability.money_faq_gap", "answerability", "medium", "Money-topic questions lack FAQ coverage",
    "Pricing, cost, value, or investment content often creates recurring decision questions worth answering directly.",
    `${moneyTopicPages} page(s) contained money-topic wording, while no visible FAQ coverage was detected.`, null,
    "Build visible FAQ content around genuine cost, pricing, risk, value, and comparison questions.");
  if (!validJsonLd) add("structured_data.missing_relevant", "structured_data", "medium", "Relevant JSON-LD not detected",
    "Valid structured data can clarify entities and page meaning when it matches visible content.", "No JSON-LD object with @context and @type was detected.", null,
    "Add applicable Organization, Article, Breadcrumb, Product, or FAQ markup that matches visible content.");
  if (invalidJsonLd) add("structured_data.invalid_json", "structured_data", "high", "Invalid JSON-LD detected",
    "Malformed JSON cannot be reliably interpreted.", `${invalidJsonLd} JSON-like script block(s) could not be parsed.`, null,
    "Validate JSON-LD syntax and ensure properties reflect visible content.");
  if (!trustPages) add("trust.missing_signals", "trust", "medium", "Authorship and trust signals are unclear",
    "Clear authorship, company identity, and contact information help readers verify accountability.", `0 of ${ok.length} readable pages showed common authorship/about/contact signals.`, null,
    "Add author or reviewer details and accessible About and Contact information.");
  if (!citationPages) add("evidence.no_sources", "evidence", "medium", "Source citations were not detected",
    "Verifiable claims are stronger when linked to authoritative primary sources.", `0 of ${ok.length} readable pages showed source/reference signals.`, null,
    "Cite primary sources next to material factual claims.");
  if (!researchPages) add("evidence.no_original_research", "evidence", "medium", "Original research or first-party data was not detected",
    "Original, well-explained data can make content more useful and verifiable; it does not guarantee citations.", `0 of ${ok.length} readable pages showed research, methodology, survey, or benchmark signals.`, null,
    "Publish genuine first-party data with methodology, dates, limitations, and source files.", "high", "high");
  if (!datedPages && timeSensitivePages) add("freshness.no_dates", "freshness", "medium", "Publication and update dates are unclear",
    "Visible dates help users assess whether time-sensitive information is current.", `0 of ${ok.length} readable pages showed detectable publication/update dates.`, null,
    "Show accurate published and materially-updated dates on time-sensitive content.");
  if (missingAlt) add("accessibility.image_alt", "accessibility", "medium", "Images lack meaningful alt text",
    "Text alternatives improve accessibility and machine understanding.", `${missingAlt} image(s) had missing or empty alt text.`, null,
    "Add concise contextual alt text; use empty alt only for decorative images.");
  if (mediaWithoutText) add("accessibility.media_text", "accessibility", "medium", "Media text alternative not detected",
    "Transcripts and captions make media content accessible and extractable.", `${mediaWithoutText} page(s) included audio/video without detectable transcript or caption wording.`, null,
    "Provide captions and a visible transcript or equivalent text.");
  if (ok.length && ok.length < pages.length) add("links.orphan_risk", "internal_linking", "medium", "Internal discovery coverage is limited",
    "Failed or undiscovered pages can indicate weak internal paths; this is an orphan-risk proxy, not a full link graph.",
    `${ok.length} of ${pages.length} attempted URLs were readable.`, null, "Repair internal links and ensure important pages are linked from navigable hubs.");
  if (ok.length && internalLinkSignals === 0) add("links.no_internal_links", "internal_linking", "medium", "No internal link signals detected",
    "Navigable internal links help crawlers and users discover important pages; this bounded check is an orphan-risk proxy.",
    `No relative internal links were detected across ${ok.length} readable page(s).`, null,
    "Link important pages from relevant navigation and contextual content using crawlable anchors.");
  if (thinPages) add("content.thin", "content_quality", thinPages === ok.length ? "high" : "medium", "Thin or unclear page content",
    "Pages with little readable text may not answer a clear user need.", `${thinPages} of ${ok.length} readable pages contained fewer than 180 words.`, null,
    "Clarify each page's purpose and add useful, specific information rather than filler.");

  const findings = aggregateFindings(rawFindings, pages.length, ok.length);
  const categoryScores = Object.fromEntries(Object.entries(WEIGHTS).map(([category]) => {
    const penalty = findings.filter((f) => f.category === category)
      .reduce((sum, f) => sum + effectiveDeduction(f.severity, f.prevalence), 0);
    return [category, Math.max(0, 100 - penalty)];
  }));
  const score = Math.round(Object.entries(WEIGHTS).reduce((sum, [category, weight]) => sum + categoryScores[category]! * weight / 100, 0));
  const quickWins: AuditQuickWin[] = [];
  const quick = (findingCode: string, family: string, code: string, title: string, recommendation?: string, effort: AuditQuickWin["effort"] = "low") => {
    const f = findings.find((item) => item.code === findingCode);
    const companyRelevance = context?.companyName
      ? `This applies to ${context.companyName}${context.targetAudience ? ` and content serving ${context.targetAudience}` : ""}.`
      : "This applies to the crawled website evidence.";
    if (f) quickWins.push({
      code, family, title, recommendation: recommendation ?? f.recommendation,
      evidence: f.representativeEvidence.join(" "), pageUrl: f.representativeUrls[0] ?? null,
      findingCodes: [f.code], effort, impact: f.impact,
      rationale: `${companyRelevance} ${f.explanation}`,
      affectedCount: f.affectedCount, representativeUrls: f.representativeUrls, rank: 0,
    });
  };
  quick("crawl.fetch_failure", "crawl_index_access", "repair-crawl-failures", "Repair crawl and index access");
  quick("crawl.noindex", "crawl_index_access", "review-noindex-pages", "Restore intentional index access");
  quick("answerability.no_direct_answers", "answer_first_passages_lists", "lead-with-direct-answers", "Lead question sections with direct answers");
  quick("answerability.no_lists", "answer_first_passages_lists", "add-list-content", "Add useful list-based passages");
  quick("evidence.no_sources", "claim_evidence_primary_research", "cite-material-claims", "Cite primary evidence for material claims");
  quick("evidence.no_original_research", "claim_evidence_primary_research", "publish-original-research", "Publish original research or first-party data", undefined, "high");
  quick("answerability.money_faq_gap", "high_value_topic_gaps_faqs", "faq-money-topics", "Build useful FAQs around high-value money topics",
    "Use genuine pricing, cost, risk, comparison, or value questions where relevant; publish visible answers before adding matching schema.", "medium");
  if (context?.targetAudience) quick("answerability.no_question_headings", "high_value_topic_gaps_faqs", "answer-audience-questions", "Answer specific target-audience questions",
    `Create pages for ${context.targetAudience}${context.productsServices ? ` considering ${context.productsServices}` : ""} that answer evidenced questions directly; lead each section with a concise answer.`, "medium");
  if (ok.some((p) => /\b(?:help|support|contact|customer)\b/i.test(p.content ?? "")))
    quick("answerability.no_faq", "high_value_topic_gaps_faqs", "helpdesk-questions-to-content", "Turn help-desk and customer questions into useful FAQs",
      "Review recurring support questions and publish accurate, reusable answers with sensitive details removed.", "medium");
  quick("freshness.no_dates", "freshness_accountability_new_content", "add-content-accountability", "Add accurate publication and review accountability",
    "Show accurate publication, author/reviewer, and materially-updated dates on content where freshness affects decisions.");
  quick("metadata.duplicate_title", "consolidation_weak_overlapping_pages", "consolidate-overlapping-pages", "Consolidate overlapping pages",
    "Review pages sharing the same title, merge genuinely overlapping coverage, and keep the strongest useful destination.", "medium");
  if (thinPages > 1) quick("content.thin", "consolidation_weak_overlapping_pages", "consolidate-weak-pages", "Consolidate or strengthen weak pages",
    "Merge overlapping thin pages where they serve the same need; otherwise add specific, useful information to the distinct page.", "medium");
  const impactRank = { high: 3, medium: 2, low: 1 };
  const effortRank = { low: 3, medium: 2, high: 1 };
  quickWins.sort((a, b) =>
    (impactRank[b.impact] * 10 + effortRank[b.effort] + b.affectedCount / Math.max(1, ok.length))
    - (impactRank[a.impact] * 10 + effortRank[a.effort] + a.affectedCount / Math.max(1, ok.length))
    || a.code.localeCompare(b.code));
  quickWins.forEach((item, index) => { item.rank = index + 1; });

  return {
    auditVersion: "2.0",
    context: cleanContext(context),
    score, categoryScores,
    categoryNarratives: buildCategoryNarratives(categoryScores, findings, pages.length, ok.length),
    counts: {
      findings: findings.length, critical: findings.filter((f) => f.severity === "critical").length,
      high: findings.filter((f) => f.severity === "high").length,
      medium: findings.filter((f) => f.severity === "medium").length,
      low: findings.filter((f) => f.severity === "low").length,
      fetched: ok.length, failed: pages.length - ok.length, listPages, tablePages,
      questionHeadings, conciseAnswers, faqPages, validJsonLd,
      crawlCap: 50, crawlCapped: pages.length >= 50 ? 1 : 0,
      robotsTxtFetched: discovery?.robotsTxtFetched ? 1 : 0,
      sitemapFetched: discovery?.sitemapFetched ? 1 : 0,
      sitemapUrlCount: discovery?.sitemapUrlCount ?? 0,
    },
    pagesScanned: pages.length,
    methodology: [
      "Google Search Essentials and helpful-content guidance",
      "Schema.org structured data matched to visible content",
      "W3C semantic HTML and WCAG text-alternative principles",
      "Deterministic sitemap-aware crawl capped at 50 public HTML URLs (representative, not exhaustive)",
      "Deterministic AEO extractability heuristics (signals, not ranking guarantees)",
    ],
    findings, quickWins, generatedAt: now,
  };
}

function cleanContext(context: Parameters<typeof generateWebsiteAudit>[1]): Record<string, string> {
  return Object.fromEntries(Object.entries(context ?? {})
    .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0)
    .map(([key, value]) => [key, value.trim()]));
}

function aggregateFindings<T extends Omit<AuditFinding, "affectedCount" | "prevalence" | "representativeUrls" | "representativeEvidence" | "scoreRationale" | "impactExplanation" | "confidence" | "limitations">>(
  raw: readonly T[],
  attemptedPages: number,
  readablePages: number,
): AuditFinding[] {
  const groups = new Map<string, T[]>();
  for (const finding of raw) groups.set(finding.code, [...(groups.get(finding.code) ?? []), finding]);
  return [...groups.entries()].map(([code, matches]) => {
    const first = matches[0]!;
    const urls = [...new Set(matches.map((item) => item.pageUrl).filter((url): url is string => Boolean(url)))].sort();
    const evidence = [...new Set(matches.map((item) => item.evidence))].sort();
    const zeroOfTotal = evidence[0]?.match(/\b0\s+of\s+(\d+)\s+(?:readable\s+)?page/i);
    const siteLevelCount = Number(zeroOfTotal?.[1] ?? evidence[0]?.match(/\b(\d+)\s+(?:of\s+\d+\s+)?(?:page|URL|image)/i)?.[1]);
    const affectedCount = matches.length > 1 ? matches.length : Number.isFinite(siteLevelCount) ? siteLevelCount : 1;
    const denominator = first.category === "crawlability" ? Math.max(1, attemptedPages) : Math.max(1, readablePages);
    const prevalence = Math.min(1, affectedCount / denominator);
    const limitation = readablePages < attemptedPages
      ? `Signals are limited to ${readablePages} readable page(s) from ${attemptedPages} attempted URL(s).`
      : `The bounded crawl covered ${readablePages} readable page(s) and is representative, not exhaustive.`;
    return {
      ...first,
      id: stableId(code, null, 0),
      evidence: evidence.slice(0, 3).join(" "),
      pageUrl: urls[0] ?? first.pageUrl,
      affectedCount,
      prevalence: Number(prevalence.toFixed(3)),
      representativeUrls: urls.slice(0, 5),
      representativeEvidence: evidence.slice(0, 5),
      scoreRationale: `This grouped ${first.severity} issue deducts ${effectiveDeduction(first.severity, prevalence)} points from ${first.category}: base ${PENALTY[first.severity]} × prevalence factor ${(0.5 + 0.5 * prevalence).toFixed(3)}. Repeated pages increase prevalence but do not create duplicate full penalties.`,
      impactExplanation: first.explanation,
      confidence: (urls.length || readablePages ? "high" : "medium") as AuditFinding["confidence"],
      limitations: [limitation],
    };
  }).sort((a, b) => a.category.localeCompare(b.category) || a.code.localeCompare(b.code));
}

function buildCategoryNarratives(
  scores: Record<string, number>,
  findings: readonly AuditFinding[],
  attemptedPages: number,
  readablePages: number,
): Record<string, AuditCategoryNarrative> {
  return Object.fromEntries(Object.keys(WEIGHTS).map((category) => {
    const categoryFindings = findings.filter((finding) => finding.category === category);
    const score = scores[category] ?? 0;
    const risks = categoryFindings.slice(0, 3).map((finding) =>
      `${finding.title}: ${finding.affectedCount} affected signal(s) (${Math.round(finding.prevalence * 100)}% prevalence).`);
    const deductions = categoryFindings.map((finding) => effectiveDeduction(finding.severity, finding.prevalence));
    const impactLevel = categoryFindings.some((finding) => finding.severity === "critical" || finding.severity === "high")
      ? "High" : categoryFindings.length ? "Moderate" : "Low";
    const conclusion = categoryFindings.length
      ? `${category.replace(/_/g, " ")} has ${categoryFindings.length} distinct weakness(es) in the bounded crawl.`
      : `No applicable ${category.replace(/_/g, " ")} weakness was detected in the bounded crawl.`;
    return [category, {
      category,
      score,
      conclusion,
      summary: categoryFindings.length
        ? `${category.replace(/_/g, " ")} scored ${score}/100 after ${categoryFindings.length} distinct grouped check(s); duplicate page occurrences were not penalized repeatedly.`
        : `${category.replace(/_/g, " ")} scored ${score}/100 because no issue was detected by the applicable bounded checks.`,
      strengths: categoryFindings.length
        ? ["Applicable checks not listed as weaknesses did not produce a negative signal in the readable crawl sample."]
        : ["No applicable negative signal was detected in the readable crawl sample."],
      weaknesses: risks,
      risks,
      scoreRationale: categoryFindings.length
        ? `The category starts at 100 and deducts ${deductions.join(" + ")} prevalence-adjusted point(s), bounded at zero.`
        : "The category starts at 100 and received no deduction from applicable checks.",
      impact: categoryFindings.length
        ? `${impactLevel} potential AEO impact: the detected weaknesses can make this content harder to discover, interpret, verify, or reuse accurately, depending on the category. This is a readiness signal, not a guaranteed ranking or citation outcome.`
        : "Low detected impact in this sample; no applicable weakness was found, but the bounded crawl cannot prove site-wide performance.",
      evidence: categoryFindings.flatMap((finding) => finding.representativeEvidence).slice(0, 5),
      confidence: readablePages >= 3 ? "high" : readablePages ? "medium" : "low",
      limitations: [`Assessment used ${readablePages} readable page(s) from ${attemptedPages} attempted URL(s); absence of a signal is not proof of site-wide absence.`],
    }];
  }));
}