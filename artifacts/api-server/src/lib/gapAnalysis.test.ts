/**
 * Contract tests for the accuracy-critical Gap Analysis helpers:
 * URL canonicalization, page/channel classification, brand extraction,
 * confidence thresholds, answer-context provenance, and recommendation
 * fallback behavior. Run with: pnpm --filter @workspace/api-server run test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalizeUrl,
  detectPageSignals,
  extractTitleAndSnippet,
  classifyChannel,
  confidenceFor,
  extractAnswerContext,
  brandNameFromDomain,
  mentionsBrand,
  buildRecommendation,
  hypothesisFor,
} from "./gapAnalysis";

// ── URL canonicalization ──

test("canonicalizeUrl strips tracking params, www, fragments; keeps meaningful params", () => {
  assert.equal(
    canonicalizeUrl("https://WWW.Example.com/path/?utm_source=x&utm_medium=y#frag"),
    "https://example.com/path",
  );
  assert.equal(
    canonicalizeUrl("https://example.com/search?q=best+tools&fbclid=abc"),
    "https://example.com/search?q=best+tools",
  );
  assert.equal(canonicalizeUrl("https://example.com/"), "https://example.com/");
});

test("canonicalizeUrl dedupes equivalent URLs and rejects junk", () => {
  const a = canonicalizeUrl("https://www.example.com/a/?utm_campaign=z");
  const b = canonicalizeUrl("https://example.com/a");
  assert.equal(a, b);
  assert.equal(canonicalizeUrl("not a url"), null);
  assert.equal(canonicalizeUrl("ftp://example.com/x"), null);
  assert.equal(canonicalizeUrl(null), null);
});

// ── Page signal detection & extraction ──

test("detectPageSignals flags comparison, listicle and review patterns", () => {
  assert.deepEqual(detectPageSignals("Semrush vs Ahrefs", ""), {
    isComparison: true,
    isListicle: false,
    isReview: false,
  });
  const listy = detectPageSignals("Top 10 SEO tools for 2026", "");
  assert.equal(listy.isListicle, true);
  const review = detectPageSignals("Ahrefs review: pros and cons", "");
  assert.equal(review.isReview, true);
  const plain = detectPageSignals("How search engines work", "An explainer.");
  assert.deepEqual(plain, { isComparison: false, isListicle: false, isReview: false });
});

test("extractTitleAndSnippet parses title and meta description with entity decoding", () => {
  const html = `<html><head><title>Best Tools &amp; Apps</title>
    <meta name="description" content="A guide to what&#39;s cited."></head><body></body></html>`;
  const { title, snippet } = extractTitleAndSnippet(html);
  assert.equal(title, "Best Tools & Apps");
  assert.equal(snippet, "A guide to what's cited.");
  assert.deepEqual(extractTitleAndSnippet("<html></html>"), { title: "", snippet: "" });
});

// ── Channel classification ──

test("classifyChannel: ownership classes are never overridden by page signals", () => {
  const listy = { isComparison: false, isListicle: true, isReview: true };
  assert.equal(classifyChannel("you", listy), "brand_owned");
  assert.equal(classifyChannel("competitor", listy), "competitor_owned");
  assert.equal(classifyChannel("ugc", listy), "ugc");
  assert.equal(classifyChannel("reference", listy), "reference");
});

test("classifyChannel: editorial/generic upgrade to review_listicle on signals", () => {
  const listy = { isComparison: false, isListicle: true, isReview: false };
  assert.equal(classifyChannel("editorial", listy), "review_listicle");
  assert.equal(classifyChannel("editorial", null), "editorial");
  assert.equal(classifyChannel("other", listy), "review_listicle");
  assert.equal(classifyChannel("other", null), "other");
  assert.equal(classifyChannel("institutional", null), "reference");
});

// ── Confidence thresholds ──

test("confidenceFor applies calibrated sample-size thresholds", () => {
  assert.equal(confidenceFor(1, 5), "insufficient");
  assert.equal(confidenceFor(2, 1), "weak");
  assert.equal(confidenceFor(5, 2), "moderate");
  assert.equal(confidenceFor(10, 3), "strong");
  assert.equal(confidenceFor(10, 2), "moderate"); // many citations, few prompts
  assert.equal(confidenceFor(4, 4), "weak");
});

// ── Answer context: never fabricated ──

test("extractAnswerContext returns an excerpt only when the term occurs", () => {
  const answer = "For SEO research, many teams use Ahrefs because of its index size.";
  const ctx = extractAnswerContext(answer, "Ahrefs");
  assert.ok(ctx && ctx.includes("Ahrefs"));
  assert.equal(extractAnswerContext(answer, "Semrush"), null);
  assert.equal(extractAnswerContext(answer, ""), null);
});

test("extractAnswerContext adds ellipses only when truncating", () => {
  const long = `${"x".repeat(300)} Ahrefs ${"y".repeat(300)}`;
  const ctx = extractAnswerContext(long, "Ahrefs");
  assert.ok(ctx?.startsWith("…") && ctx.endsWith("…"));
  const short = extractAnswerContext("Ahrefs is a tool.", "Ahrefs");
  assert.equal(short, "Ahrefs is a tool.");
});

// ── Brand extraction ──

test("brandNameFromDomain and mentionsBrand use word boundaries", () => {
  assert.equal(brandNameFromDomain("semrush.com"), "Semrush");
  assert.ok(mentionsBrand("We compared SEMrush and others", "Semrush"));
  assert.ok(!mentionsBrand("The semrushlike tool", "Semrush"));
  assert.ok(!mentionsBrand("anything", "ab")); // too short to be reliable
});

// ── Recommendations: evidence-grounded with insufficient fallback ──

test("buildRecommendation proposes the dominant channel's play with cited URLs", () => {
  const rec = buildRecommendation("seo tools", [
    { channel: "editorial", citations: 6, urls: ["https://forbes.com/a"] },
    { channel: "ugc", citations: 2, urls: ["https://reddit.com/r/x"] },
  ]);
  assert.equal(rec.status, "proposed");
  assert.equal(rec.category, "off_page");
  assert.deepEqual(rec.evidenceUrls, ["https://forbes.com/a"]);
  assert.ok(rec.rationale && !/will|guarantees|causes/.test(rec.rationale));
});

test("buildRecommendation falls back to insufficient instead of speculating", () => {
  const none = buildRecommendation("topic", []);
  assert.equal(none.status, "insufficient");
  assert.equal(none.category, null);
  assert.deepEqual(none.evidenceUrls, []);
  // Only unactionable channels (brand_owned / other with 1 citation) → insufficient
  const thin = buildRecommendation("topic", [
    { channel: "other", citations: 1, urls: ["https://x.com/a"] },
  ]);
  assert.equal(thin.status, "insufficient");
});

test("buildRecommendation for competitor-owned dominance proposes onsite comparison page", () => {
  const rec = buildRecommendation("crm software", [
    { channel: "competitor_owned", citations: 4, urls: ["https://rival.com/compare"] },
  ]);
  assert.equal(rec.status, "proposed");
  assert.equal(rec.category, "on_page");
  assert.match(rec.playType ?? "", /comparison/i);
});

// ── Hypotheses use calibrated, non-causal language ──

test("hypothesisFor never uses causal certainty language", () => {
  for (const kind of ["domain_dominance", "channel_pattern", "competitor_presence"]) {
    const h = hypothesisFor(kind, "forbes.com", 42.5);
    assert.ok(h.length > 0);
    assert.ok(
      !/\b(proves|caused|causes|guarantees|definitely|certainly)\b/i.test(h),
      `causal language in: ${h}`,
    );
  }
});
