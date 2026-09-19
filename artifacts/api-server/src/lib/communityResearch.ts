import { z } from "zod/v4";
import { safeFetch } from "./safeFetch";

const FETCH_TIMEOUT_MS = 7_000;
const MAX_RESPONSE_BYTES = 350_000;
const MAX_QUERIES = 4;
const MAX_RESULTS_PER_SOURCE = 4;
export const MAX_COMMUNITY_SIGNALS = 24;

export interface CommunitySignal {
  platform: "Reddit" | "Hacker News" | "Stack Exchange";
  title: string;
  url: string;
  excerpt: string;
  query: string;
}

type Fetcher = typeof safeFetch;

export function isAllowedCommunityUrl(value: string, platform: CommunitySignal["platform"]): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    if (platform === "Reddit") {
      return /^(?:www\.)?reddit\.com$/i.test(url.hostname) && /\/r\/[^/]+\/comments\//i.test(url.pathname);
    }
    if (platform === "Hacker News") {
      return url.hostname === "news.ycombinator.com" && url.pathname === "/item" && /^\d+$/.test(url.searchParams.get("id") ?? "");
    }
    return (
      (url.hostname === "stackoverflow.com" || /(?:^|\.)stackexchange\.com$/i.test(url.hostname)) &&
      /^\/(?:questions|q)\/\d+(?:\/|$)/i.test(url.pathname)
    );
  } catch {
    return false;
  }
}

const RESEARCH_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "at",
  "best",
  "for",
  "from",
  "how",
  "i",
  "in",
  "is",
  "of",
  "on",
  "or",
  "should",
  "the",
  "to",
  "what",
  "when",
  "where",
  "which",
  "who",
  "with",
]);

function researchTokens(value: string): Set<string> {
  const expanded = value
    .toLocaleLowerCase("en-US")
    .replace(/\bvc\b/g, "venture capital")
    .replace(/\bpr\b/g, "pull request")
    .replace(/\bllms?\b/g, "ai");
  return new Set(
    expanded
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter((word) => word.length >= 3 && !RESEARCH_STOP_WORDS.has(word))
      .map((word) => word.replace(/(?:ing|ed|es|s)$/i, "").replace(/e$/i, "")),
  );
}

export function communityRelevanceScore(signal: CommunitySignal): number {
  const query = researchTokens(signal.query);
  const evidence = researchTokens(`${signal.title} ${signal.excerpt}`);
  const shared = [...query].filter((token) => evidence.has(token)).length;
  if (shared < 2) return 0;
  return shared / Math.max(2, Math.min(query.size, 6));
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function plainText(value: string): string {
  return decodeEntities(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function readBounded(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    text += decoder.decode(value, { stream: true });
    if (bytes >= MAX_RESPONSE_BYTES) {
      await reader.cancel();
      break;
    }
  }
  return text;
}

async function fetchText(url: URL, accept: string, fetcher: Fetcher): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const { res } = await fetcher(
      url.toString(),
      {
        signal: controller.signal,
        headers: {
          accept,
          "user-agent": "Mozilla/5.0 (compatible; AEO-Audience-Research/1.0)",
        },
      },
      { redirectHost: url.hostname },
    );
    if (!res.ok) {
      await res.body?.cancel();
      throw new Error(`Community source returned ${res.status}`);
    }
    return await readBounded(res);
  } finally {
    clearTimeout(timer);
  }
}

function xmlValue(fragment: string, tag: string): string {
  return fragment.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1] ?? "";
}

export function parseRedditAtom(xml: string, query: string): CommunitySignal[] {
  const results: CommunitySignal[] = [];
  for (const match of xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)) {
    const entry = match[1] ?? "";
    const title = plainText(xmlValue(entry, "title"));
    const excerpt = plainText(xmlValue(entry, "content")).slice(0, 500);
    const url = decodeEntities(entry.match(/<link\b[^>]*\bhref=["']([^"']+)["']/i)?.[1] ?? "");
    if (!title || !isAllowedCommunityUrl(url, "Reddit")) continue;
    results.push({ platform: "Reddit", title: title.slice(0, 240), url, excerpt, query });
    if (results.length >= MAX_RESULTS_PER_SOURCE) break;
  }
  return results;
}

const HackerNewsResult = z.object({
  hits: z.array(
    z.object({
      title: z.string().nullable().optional(),
      story_title: z.string().nullable().optional(),
      story_text: z.string().nullable().optional(),
      comment_text: z.string().nullable().optional(),
      url: z.string().nullable().optional(),
      story_url: z.string().nullable().optional(),
      objectID: z.string().regex(/^\d+$/),
    }),
  ),
});

export function parseHackerNewsJson(raw: string, query: string): CommunitySignal[] {
  const parsed = HackerNewsResult.safeParse(JSON.parse(raw));
  if (!parsed.success) return [];
  return parsed.data.hits
    .map((hit): CommunitySignal | null => {
      const title = plainText(hit.title ?? hit.story_title ?? "");
      if (!title) return null;
      const url = `https://news.ycombinator.com/item?id=${hit.objectID}`;
      if (!isAllowedCommunityUrl(url, "Hacker News")) return null;
      return {
        platform: "Hacker News",
        title: title.slice(0, 240),
        url,
        excerpt: plainText(hit.story_text ?? hit.comment_text ?? "").slice(0, 500),
        query,
      };
    })
    .filter((item): item is CommunitySignal => item !== null)
    .slice(0, MAX_RESULTS_PER_SOURCE);
}

const StackExchangeResult = z.object({
  items: z.array(
    z.object({
      title: z.string(),
      link: z.string().url(),
      tags: z.array(z.string()).optional(),
    }),
  ),
});

export function parseStackExchangeJson(raw: string, query: string): CommunitySignal[] {
  const parsed = StackExchangeResult.safeParse(JSON.parse(raw));
  if (!parsed.success) return [];
  return parsed.data.items
    .filter((item) => isAllowedCommunityUrl(item.link, "Stack Exchange"))
    .slice(0, MAX_RESULTS_PER_SOURCE)
    .map((item) => ({
      platform: "Stack Exchange" as const,
      title: plainText(item.title).slice(0, 240),
      url: item.link,
      excerpt: item.tags?.length ? `Discussion tags: ${item.tags.join(", ")}` : "",
      query,
    }));
}

async function researchQuery(query: string, fetcher: Fetcher): Promise<CommunitySignal[]> {
  const reddit = new URL("https://www.reddit.com/search.rss");
  reddit.searchParams.set("q", query);
  reddit.searchParams.set("sort", "relevance");
  reddit.searchParams.set("t", "year");

  const hackerNews = new URL("https://hn.algolia.com/api/v1/search");
  hackerNews.searchParams.set("query", query);
  hackerNews.searchParams.set("tags", "story");
  hackerNews.searchParams.set("hitsPerPage", String(MAX_RESULTS_PER_SOURCE));

  const stackExchange = new URL("https://api.stackexchange.com/2.3/search/advanced");
  stackExchange.searchParams.set("order", "desc");
  stackExchange.searchParams.set("sort", "relevance");
  stackExchange.searchParams.set("q", query);
  stackExchange.searchParams.set(
    "site",
    /\b(?:api|cloud|code|developer|engineering|programming|security|software|technical)\b/i.test(query)
      ? "stackoverflow"
      : "money",
  );
  stackExchange.searchParams.set("pagesize", String(MAX_RESULTS_PER_SOURCE));

  const results = await Promise.allSettled([
    fetchText(reddit, "application/atom+xml", fetcher).then((raw) => parseRedditAtom(raw, query)),
    fetchText(hackerNews, "application/json", fetcher).then((raw) => parseHackerNewsJson(raw, query)),
    fetchText(stackExchange, "application/json", fetcher).then((raw) => parseStackExchangeJson(raw, query)),
  ]);
  return results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
}

export async function researchCommunity(
  rawQueries: readonly string[],
  fetcher: Fetcher = safeFetch,
): Promise<CommunitySignal[]> {
  const queries = [...new Set(rawQueries.map((query) => query.trim()).filter(Boolean))].slice(0, MAX_QUERIES);
  const batches = await Promise.all(queries.map((query) => researchQuery(query, fetcher)));
  const unique = new Map<string, { signal: CommunitySignal; score: number }>();
  for (const signal of batches.flat()) {
    const key = signal.url.toLocaleLowerCase("en-US");
    const score = communityRelevanceScore(signal);
    const current = unique.get(key);
    if (score > 0 && (!current || score > current.score)) unique.set(key, { signal, score });
  }
  return [...unique.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_COMMUNITY_SIGNALS)
    .map(({ signal }) => signal);
}

export function formatCommunityEvidence(signals: readonly CommunitySignal[]): string {
  return signals
    .map(
      (signal, index) =>
        `[${index + 1}] ${signal.platform} · research query: ${signal.query}\n${signal.title}\n${signal.excerpt || "(title only)"}\n${signal.url}`,
    )
    .join("\n\n")
    .slice(0, 35_000);
}