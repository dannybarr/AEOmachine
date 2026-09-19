import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EvidenceSelectionModelResult,
  RecommendationEvidenceAuditModelResult,
  RecommendationModelResult,
  ResearchPlanModelResult,
  buildCommunityResearchQueries,
  directlySupportsRecommendation,
  crawlWebsite,
  extractSameSiteLinks,
  isAudienceLlmQuestion,
  normalizeQuestion,
  parseRecommendationModelOutput,
  parseEvidenceSelectionModelOutput,
  parseRecommendationEvidenceAuditModelOutput,
  parseResearchPlanModelOutput,
  preserveCanonicalTargetAudience,
  sameSiteUrl,
  formatTrackedPrompts,
  MAX_ASSESSMENT_PAGES,
  MAX_TRACKED_PROMPT_CHARS_IN_MODEL_INPUT,
  MAX_TRACKED_PROMPTS_IN_MODEL_INPUT,
  robotsAllowsUrl,
} from "./websiteAssessmentRunner";

test("same-site crawl candidates exclude other hosts, unsafe protocols, assets, and fragments", () => {
  const root = new URL("https://example.com/");
  const base = new URL("https://www.example.com/products/");
  assert.equal(sameSiteUrl("../about#team", base, root), "https://www.example.com/about");
  assert.equal(sameSiteUrl("https://evil.example/about", base, root), null);
  assert.equal(sameSiteUrl("http://127.0.0.1/admin", base, root), null);
  assert.equal(sameSiteUrl("javascript:alert(1)", base, root), null);
  assert.equal(sameSiteUrl("/brochure.pdf", base, root), null);
  assert.deepEqual(
    extractSameSiteLinks(
      '<a href="/a">A</a><a href="/a#again">again</a><a href="https://other.test/">bad</a>',
      root,
      root,
    ),
    ["https://example.com/a"],
  );
});

test("robots uses matching crawler groups and longest Allow override", () => {
  const wildcard = `User-agent: *
Disallow: /private
Allow: /private/public`;
  assert.equal(robotsAllowsUrl(wildcard, "https://example.com/private/x"), false);
  assert.equal(robotsAllowsUrl(wildcard, "https://example.com/private/public/x"), true);
  const robots = `User-agent: aeo-website-assessment
Disallow: /reports
Allow: /reports/public`;
  assert.equal(robotsAllowsUrl(robots, "https://example.com/reports/x"), false);
  assert.equal(robotsAllowsUrl(robots, "https://example.com/reports/public/x"), true);
});

test("crawl is bounded and never follows cross-site links", async () => {
  const requested: string[] = [];
  const redirectHosts: string[] = [];
  const fetcher = async (url: string, _init: RequestInit, options?: { redirectHost?: string }) => {
    requested.push(url);
    redirectHosts.push(options?.redirectHost ?? "");
    const links = Array.from({ length: 20 }, (_, i) => `<a href="/page-${i}">p</a>`).join("");
    return {
      res: new Response(`<html><title>Page</title><body>${links}<a href="https://attacker.test/x">x</a></body></html>`, {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
      finalUrl: url,
    };
  };
  const pages = await crawlWebsite(new URL("https://example.com/"), undefined, fetcher);
  assert.equal(pages.length, 21);
  assert.ok(pages.length <= MAX_ASSESSMENT_PAGES);
  // robots.txt and /sitemap.xml are explicitly bounded discovery requests;
  // only public HTML documents count toward the page cap.
  assert.equal(requested.length, pages.length + 2);
  assert.ok(requested.every((url) => new URL(url).hostname === "example.com"));
  assert.deepEqual(redirectHosts, Array(pages.length + 2).fill("example.com"));
});

test("crawl explicitly discovers same-site sitemap URLs without treating sitemap XML as pages", async () => {
  const requested: string[] = [];
  const fetcher = async (url: string, _init: RequestInit, _options?: { redirectHost?: string }) => {
    requested.push(url);
    if (url.endsWith("/robots.txt")) {
      return { res: new Response("Sitemap: https://example.com/site-map.xml", { status: 200 }), finalUrl: url };
    }
    if (url.endsWith("/sitemap.xml") || url.endsWith("/site-map.xml")) {
      return {
        res: new Response("<urlset><url><loc>https://example.com/sitemap-page</loc></url><url><loc>https://other.test/nope</loc></url></urlset>", { status: 200 }),
        finalUrl: url,
      };
    }
    return {
      res: new Response("<html><title>Page</title><body><h1>Page</h1></body></html>", { status: 200, headers: { "content-type": "text/html" } }),
      finalUrl: url,
    };
  };
  const pages = await crawlWebsite(new URL("https://example.com/"), undefined, fetcher);
  assert.ok(pages.some((item) => item.url.endsWith("/sitemap-page")));
  assert.equal(pages[0]!.crawlDiscovery?.robotsTxtFetched, true);
  assert.equal(pages[0]!.crawlDiscovery?.sitemapFetched, true);
  assert.equal(pages[0]!.crawlDiscovery?.sitemapUrlCount, 1);
  assert.ok(!pages.some((item) => item.url.endsWith(".xml")));
  assert.ok(requested.every((url) => new URL(url).hostname === "example.com"));
});

test("robots-blocked URLs are recorded without an HTML request and progress is discovered-work based", async () => {
  const requested: string[] = [];
  const progress: number[] = [];
  const fetcher = async (url: string, _init: RequestInit, _options?: { redirectHost?: string }) => {
    requested.push(url);
    if (url.endsWith("/robots.txt")) return { res: new Response("User-agent: *\nDisallow: /private", { status: 200 }), finalUrl: url };
    if (url.endsWith("/sitemap.xml")) return { res: new Response("<urlset><url><loc>https://example.com/private</loc></url></urlset>", { status: 200 }), finalUrl: url };
    return { res: new Response("<html><title>Home</title></html>", { status: 200, headers: { "content-type": "text/html" } }), finalUrl: url };
  };
  const pages = await crawlWebsite(new URL("https://example.com/"), async (_pages, total) => { progress.push(total); }, fetcher);
  assert.equal(pages.length, 2);
  assert.equal(pages[1]!.fetchStatus, "blocked_by_robots");
  assert.equal(requested.some((url) => url.endsWith("/private")), false);
  assert.deepEqual(progress, [2, 2]);
});

test("malformed and structurally invalid model output fails explicitly", () => {
  assert.throws(() => parseResearchPlanModelOutput("{not-json"), /malformed JSON/);
  assert.throws(
    () => parseRecommendationModelOutput(JSON.stringify({ recommendations: [] })),
    /invalid recommendations/,
  );
  assert.equal(ResearchPlanModelResult.safeParse({}).success, false);
  assert.equal(RecommendationModelResult.safeParse({}).success, false);
  assert.equal(EvidenceSelectionModelResult.safeParse({}).success, false);
  assert.equal(RecommendationEvidenceAuditModelResult.safeParse({}).success, false);
  assert.throws(
    () => parseEvidenceSelectionModelOutput(JSON.stringify({ relevantEvidenceIndices: [] })),
    /invalid selection/,
  );
  assert.deepEqual(
    parseRecommendationEvidenceAuditModelOutput(
      JSON.stringify({ recommendations: [{ recommendationIndex: 1, evidenceIndices: [] }] }),
    ),
    { recommendations: [{ recommendationIndex: 1, evidenceIndices: [] }] },
  );
  assert.deepEqual(
    parseRecommendationModelOutput(JSON.stringify({
      recommendations: Array.from({ length: 5 }, (_, index) => ({
        question: `What funding option should startup ${index + 1} consider?`,
        moneyTopic: "Venture funding",
        persona: "Startup founder",
        intent: "Evaluate funding",
        rationale: "This follows from the website-derived target audience.",
      })),
    })).recommendations[0]?.evidenceIndices,
    [],
  );
});

test("question normalization provides deterministic deduplication", () => {
  assert.equal(normalizeQuestion("  What   Is The Best Plan? "), "what is the best plan?");
  assert.equal(normalizeQuestion("WHAT IS THE BEST PLAN?"), normalizeQuestion("what is the best plan?"));
});

test("a nonempty user-provided audience overrides the model inference", () => {
  const profile = {
    targetAudience: "Model-selected audience",
    industry: null,
    objective: null,
    productsServices: null,
    positioning: null,
    geography: null,
  };
  assert.equal(preserveCanonicalTargetAudience(profile, "Independent agencies").targetAudience, "Independent agencies");
  assert.equal(preserveCanonicalTargetAudience(profile, "  ").targetAudience, "Model-selected audience");
});

test("tracked prompt context is bounded before it is sent to the model", () => {
  const context = formatTrackedPrompts(
    Array.from({ length: MAX_TRACKED_PROMPTS_IN_MODEL_INPUT + 10 }, () => ({ text: "x".repeat(500) })),
  );
  assert.ok(context.length <= MAX_TRACKED_PROMPT_CHARS_IN_MODEL_INPUT);
  assert.ok(context.split("\n").length <= MAX_TRACKED_PROMPTS_IN_MODEL_INPUT);
});

test("audience question validation rejects company-addressed and branded prompts", () => {
  assert.equal(
    isAudienceLlmQuestion(
      "I am a fintech founder, who are the best London-based venture investors to partner with?",
      "Love Ventures",
    ),
    true,
  );
  assert.equal(isAudienceLlmQuestion("How do I invest in venture capital?", "Love Ventures"), true);
  assert.equal(isAudienceLlmQuestion("What is EIS?", "Love Ventures"), true);
  assert.equal(isAudienceLlmQuestion("How can Love Ventures help my startup?", "Love Ventures"), false);
  assert.equal(isAudienceLlmQuestion("Can you explain your investment process?", "Love Ventures"), false);
  assert.equal(
    isAudienceLlmQuestion(`How ${"very ".repeat(35)}expensive is this?`, "Love Ventures"),
    false,
  );
});

test("community research starts with concise offering and audience queries", () => {
  const queries = buildCommunityResearchQueries(
    {
      targetAudience: "Engineering leaders at startups and scaleups",
      industry: "Developer tools",
      objective: null,
      productsServices: "AI-native code review platform (automated PR feedback, comparisons)",
      positioning: null,
      geography: "United States and Europe",
    },
    ["developer productivity tooling evaluation"],
    "Graphite",
    "graphite.dev",
  );
  assert.equal(queries[0], "developer productivity tooling evaluation");
  assert.equal(queries[1], 'AI-native "code review" platform');
  assert.ok(queries.every((query) => !query.toLowerCase().includes("graphite")));
});

test("recommendation evidence must share a specific issue beyond the broad category", () => {
  const generic = {
    platform: "Hacker News" as const,
    title: "A general security checklist for software teams",
    excerpt: "A broad discussion of security and compliance.",
    url: "https://news.ycombinator.com/item?id=1",
    query: '"code review" AI',
  };
  assert.equal(
    directlySupportsRecommendation(
      "What security risks come with cloud-based AI code review?",
      "Security and compliance risk",
      generic,
    ),
    false,
  );
  assert.equal(
    directlySupportsRecommendation("Can I use AI tools?", "Tool adoption", generic),
    false,
  );
  assert.equal(
    directlySupportsRecommendation(
      "What security risks come with cloud-based AI code review?",
      "Security and compliance risk",
      { ...generic, excerpt: "Cloud-based review can create security risks by exposing private code." },
    ),
    true,
  );
});