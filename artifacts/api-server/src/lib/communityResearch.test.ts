import { test } from "node:test";
import assert from "node:assert/strict";
import {
  communityRelevanceScore,
  isAllowedCommunityUrl,
  formatCommunityEvidence,
  parseHackerNewsJson,
  parseRedditAtom,
  parseStackExchangeJson,
} from "./communityResearch";

test("community parsers retain attributed discussion evidence", () => {
  const reddit = parseRedditAtom(
    `<feed><entry><title>How should a founder choose an investor?</title><link href="https://www.reddit.com/r/startups/comments/1/example"/><content>Looking for a London seed investor.</content></entry></feed>`,
    "founder choosing venture investor",
  );
  const hackerNews = parseHackerNewsJson(
    JSON.stringify({
      hits: [{ title: "How to choose the right VC", url: "https://example.com/vc", objectID: "1" }],
    }),
    "founder choosing venture investor",
  );
  const stack = parseStackExchangeJson(
    JSON.stringify({
      items: [{ title: "Can individuals invest in venture capital?", link: "https://money.stackexchange.com/q/1", tags: ["investing"] }],
    }),
    "investing in venture capital",
  );

  assert.equal(reddit[0]?.platform, "Reddit");
  assert.equal(hackerNews[0]?.platform, "Hacker News");
  assert.equal(hackerNews[0]?.url, "https://news.ycombinator.com/item?id=1");
  assert.equal(stack[0]?.platform, "Stack Exchange");
  const formatted = formatCommunityEvidence([...reddit, ...hackerNews, ...stack]);
  assert.match(formatted, /\[1\] Reddit/);
  assert.match(formatted, /research query:/);
  assert.match(formatted, /https:\/\/money\.stackexchange\.com\/q\/1/);
});

test("community relevance rejects generic SEO results and retains audience-topic matches", () => {
  assert.equal(
    communityRelevanceScore({
      platform: "Reddit",
      title: "A perfect ChatGPT prompt has exactly 10 components",
      excerpt: "A general guide to getting better answers.",
      url: "https://www.reddit.com/r/example/1",
      query: "engineering leaders measuring AI code review ROI",
    }),
    0,
  );
  assert.ok(
    communityRelevanceScore({
      platform: "Reddit",
      title: "How do engineering leaders measure code review ROI?",
      excerpt: "We are comparing pull request review time and developer costs.",
      url: "https://www.reddit.com/r/example/2",
      query: "engineering leaders measuring code review ROI",
    }) > 0,
  );
});

test("community evidence URLs are restricted to known HTTPS discussion hosts", () => {
  assert.equal(
    isAllowedCommunityUrl("https://www.reddit.com/r/startups/comments/abc/example", "Reddit"),
    true,
  );
  assert.equal(isAllowedCommunityUrl("http://www.reddit.com/r/startups/comments/abc/example", "Reddit"), false);
  assert.equal(isAllowedCommunityUrl("https://evil.example/reddit.com/r/startups/comments/abc", "Reddit"), false);
  assert.equal(isAllowedCommunityUrl("https://news.ycombinator.com/item?id=123", "Hacker News"), true);
  assert.equal(isAllowedCommunityUrl("https://stackoverflow.com/questions/123/example", "Stack Exchange"), true);
  assert.equal(isAllowedCommunityUrl("https://stackoverflow.com/users/123/example", "Stack Exchange"), false);
  assert.equal(isAllowedCommunityUrl("javascript:alert(1)", "Stack Exchange"), false);
});