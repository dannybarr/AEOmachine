import { test } from "node:test";
import assert from "node:assert/strict";
import { generateWebsiteAudit, type AuditPage } from "./websiteAudit";
import { assertManualRerunAllowed, ManualRerunQuotaError } from "./websiteAssessmentRunner";

function page(html: string, content: string): AuditPage {
  return {
    url: "https://example.com/",
    finalUrl: "https://example.com/",
    fetchStatus: "ok",
    httpStatus: 200,
    title: html.match(/<title>(.*?)<\/title>/)?.[1] ?? null,
    html,
    content,
  };
}

test("deterministic audit scores weak pages and emits evidence-based stable checks", () => {
  const result = generateWebsiteAudit([
    page("<html><title>Home</title><body><img src='hero.jpg'><p>Short.</p></body></html>", "Short."),
    {
      url: "https://example.com/broken",
      finalUrl: null,
      fetchStatus: "http_error",
      httpStatus: 500,
      title: null,
      content: null,
    },
  ], { targetAudience: "independent retailers" }, new Date("2026-01-02T00:00:00Z"));

  assert.ok(result.score >= 0 && result.score <= 100);
  assert.equal(result.pagesScanned, 2);
  assert.equal(result.generatedAt.toISOString(), "2026-01-02T00:00:00.000Z");
  assert.ok(result.findings.some((finding) => finding.code === "crawl.fetch_failure"));
  assert.ok(result.findings.some((finding) => finding.code === "accessibility.image_alt"));
  assert.ok(result.findings.every((finding) => finding.evidence.length > 0));
  assert.equal(new Set(result.findings.map((finding) => finding.id)).size, result.findings.length);
  assert.ok(result.quickWins.some((win) => win.code === "publish-original-research"));
  assert.ok(result.quickWins.some((win) => win.code === "answer-audience-questions"));
  assert.equal(new Set(result.findings.map((finding) => finding.code)).size, result.findings.length);
  assert.equal(result.context.targetAudience, "independent retailers");
  assert.ok(Object.values(result.categoryNarratives).every((item) =>
    item.conclusion.length > 0
    && item.summary.length > 0
    && item.scoreRationale.length > 0
    && Array.isArray(item.strengths)
    && Array.isArray(item.weaknesses)
    && Array.isArray(item.evidence)
    && Array.isArray(item.limitations)));
});

test("an unreadable site is not scored as partially ready or given unsupported content advice", () => {
  const audit = generateWebsiteAudit([
    {
      url: "https://example.com/",
      finalUrl: null,
      fetchStatus: "unreachable",
      httpStatus: null,
      title: null,
      content: null,
      html: null,
    },
  ]);

  assert.equal(audit.score, 0);
  assert.equal(audit.categoryScores["crawlability"], 0);
  assert.deepEqual(audit.quickWins.map((item) => item.code), ["restore-public-crawl-access"]);
  assert.equal(audit.findings.some((item) => item.code === "evidence.no_original_research"), false);
});

test("page-level checks are grouped and do not compound category penalties", () => {
  const pages = [
    page("<html><body><h1>One</h1></body></html>", "A short page."),
    { ...page("<html><body><h1>Two</h1></body></html>", "Another short page."), url: "https://example.com/two", finalUrl: "https://example.com/two" },
  ];
  const first = generateWebsiteAudit(pages);
  const second = generateWebsiteAudit(pages);
  const missingTitles = first.findings.filter((finding) => finding.code === "metadata.missing_title");
  assert.equal(missingTitles.length, 1);
  assert.equal(missingTitles[0]!.affectedCount, 2);
  assert.equal(first.categoryScores.metadata, second.categoryScores.metadata);
  assert.match(missingTitles[0]!.scoreRationale, /do not create duplicate full penalties/i);
  assert.deepEqual(first.findings.map((finding) => finding.id), second.findings.map((finding) => finding.id));
});

test("grouped scoring uses bounded prevalence without duplicate full penalties", () => {
  const pages = Array.from({ length: 8 }, (_, index) => ({
    ...page(`<html><head><title>Page ${index}</title><meta name="description" content="A sufficiently detailed and unique page description."><link rel="canonical" href="https://example.com/${index}"></head><body><h1>Page</h1></body></html>`, "word ".repeat(200)),
    url: `https://example.com/${index}`,
    finalUrl: `https://example.com/${index}`,
  }));
  const oneAffected = generateWebsiteAudit([
    { ...pages[0]!, title: null, html: pages[0]!.html!.replace(/<title>.*?<\/title>/, "") },
    ...pages.slice(1),
  ]);
  const allAffected = generateWebsiteAudit(pages.map((item) => ({
    ...item,
    title: null,
    html: item.html!.replace(/<title>.*?<\/title>/, ""),
  })));
  const oneFinding = oneAffected.findings.find((item) => item.code === "metadata.missing_title")!;
  const allFinding = allAffected.findings.find((item) => item.code === "metadata.missing_title")!;
  assert.equal(oneFinding.affectedCount, 1);
  assert.equal(allFinding.affectedCount, 8);
  assert.ok(allAffected.categoryScores.metadata < oneAffected.categoryScores.metadata);
  assert.match(oneFinding.scoreRationale, /deducts 16 points/);
  assert.match(allFinding.scoreRationale, /deducts 28 points/);
  assert.equal(allAffected.findings.filter((item) => item.code === "metadata.missing_title").length, 1);
});

test("audience-specific recommendation family requires approved audience context", () => {
  const input = [page("<html><head><title>Home</title></head><body><h1>Home</h1></body></html>", "word ".repeat(200))];
  const generic = generateWebsiteAudit(input);
  const contextual = generateWebsiteAudit(input, {
    companyName: "Example Co",
    targetAudience: "independent retailers",
    productsServices: "inventory software",
  });
  assert.equal(generic.quickWins.some((item) => item.code === "answer-audience-questions"), false);
  const recommendation = contextual.quickWins.find((item) => item.code === "answer-audience-questions");
  assert.match(recommendation?.recommendation ?? "", /independent retailers/);
  assert.match(recommendation?.recommendation ?? "", /inventory software/);
  assert.ok(contextual.quickWins.every((item, index) => item.rank === index + 1));
});

test("quick wins stay within approved families and gate freshness and consolidation on evidence", () => {
  const allowed = new Set([
    "crawl_index_access",
    "answer_first_passages_lists",
    "claim_evidence_primary_research",
    "high_value_topic_gaps_faqs",
    "freshness_accountability_new_content",
    "consolidation_weak_overlapping_pages",
  ]);
  const pages = [
    page("<html><head><title>Shared</title></head><body><h1>One</h1><img src='x'></body></html>", "Current pricing is available for buyers."),
    {
      ...page("<html><head><title>Shared</title><script type='application/ld+json'>{bad}</script></head><body><h1>Two</h1></body></html>", "Latest product pricing and availability."),
      url: "https://example.com/two",
      finalUrl: "https://example.com/two",
    },
  ];
  const audit = generateWebsiteAudit(pages);
  assert.ok(audit.quickWins.every((item) => allowed.has(item.family)));
  assert.ok(audit.quickWins.some((item) => item.family === "freshness_accountability_new_content"));
  assert.ok(audit.quickWins.some((item) => item.family === "consolidation_weak_overlapping_pages"));
  assert.equal(audit.quickWins.some((item) => /schema|structured|internal|accessib|metadata/i.test(item.family)), false);
});

test("strong semantic content avoids unsupported quick wins and recognizes JSON-LD", () => {
  const html = `<html><head><title>Pricing guide</title>
    <meta name="description" content="A detailed and current pricing guide for buyers.">
    <link rel="canonical" href="https://example.com/guide">
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"Article"}</script>
    </head><body><h1>Pricing guide</h1><h2>How much does it cost?</h2>
    <p>The standard plan costs £20 per month and includes support for five users.</p>
    <ul><li>Transparent pricing</li><li>Email support</li></ul>
    <h2>Frequently asked questions</h2><p>Written by Ada. Updated January 2, 2026.</p>
    <p>According to the <a href="https://www.gov.uk/example">primary source</a>, this is current.</p>
    <p>Our research methodology surveyed a sample size of 300 customers.</p>
    <img src="chart.png" alt="Pricing survey results"></body></html>`;
  const text = "Pricing guide How much does it cost? The standard plan costs £20 per month and includes support for five users. Frequently asked questions Written by Ada. Updated January 2, 2026. According to the primary source, this is current. Our research methodology surveyed a sample size of 300 customers. ".repeat(2);
  const result = generateWebsiteAudit([page(html, text)]);

  assert.equal(result.counts.validJsonLd, 1);
  assert.equal(result.counts.listPages, 1);
  assert.equal(result.quickWins.some((win) => win.code === "publish-original-research"), false);
  assert.equal(result.quickWins.some((win) => win.code === "add-list-content"), false);
  assert.equal(result.quickWins.some((win) => win.code === "faq-money-topics"), false);
});

test("only ld+json scripts produce JSON-LD validity findings", () => {
  const html = `<html><head><title>Page</title>
    <script type="application/json">{not valid json}</script>
    <script> {not valid json} </script>
    </head><body><h1>Page</h1></body></html>`;
  const result = generateWebsiteAudit([page(html, "Page ".repeat(100))]);
  assert.equal(result.counts.validJsonLd, 0);
  assert.equal(result.findings.some((finding) => finding.code === "structured_data.invalid_json"), false);
  assert.ok(result.findings.some((finding) => finding.code === "structured_data.missing_relevant"));
});

test("manual rerun safeguard permits three starts but rejects a fourth in the window", () => {
  assert.doesNotThrow(() => assertManualRerunAllowed(2));
  assert.throws(() => assertManualRerunAllowed(3), ManualRerunQuotaError);
});