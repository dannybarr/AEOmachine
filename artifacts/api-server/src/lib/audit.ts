import type { SiteCheckResult } from "@workspace/db";
import { safeFetch } from "./safeFetch";

interface AuditResult {
  httpStatus: number | null;
  score: number;
  checks: SiteCheckResult[];
}

interface CheckDef {
  key: string;
  label: string;
  weight: number;
  run: (html: string, url: URL) => { passed: boolean; detail: string };
}

function extract(html: string, re: RegExp): string | null {
  const m = html.match(re);
  return m?.[1]?.trim() ?? null;
}

const CHECKS: CheckDef[] = [
  {
    key: "title",
    label: "Descriptive title tag",
    weight: 10,
    run: (html) => {
      const title = extract(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
      if (!title) return { passed: false, detail: "No <title> tag found." };
      const ok = title.length >= 15 && title.length <= 70;
      return {
        passed: ok,
        detail: `Title (${title.length} chars): "${title.slice(0, 80)}"${ok ? "" : " — aim for 15-70 characters"}`,
      };
    },
  },
  {
    key: "meta_description",
    label: "Meta description",
    weight: 10,
    run: (html) => {
      const desc =
        extract(
          html,
          /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i,
        ) ??
        extract(
          html,
          /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i,
        );
      if (!desc) return { passed: false, detail: "No meta description found." };
      const ok = desc.length >= 50 && desc.length <= 180;
      return {
        passed: ok,
        detail: `Description is ${desc.length} chars${ok ? "" : " — aim for 50-180"}.`,
      };
    },
  },
  {
    key: "h1",
    label: "Single clear H1",
    weight: 8,
    run: (html) => {
      const count = (html.match(/<h1[\s>]/gi) ?? []).length;
      return {
        passed: count === 1,
        detail: count === 0 ? "No H1 found." : `${count} H1 element(s) found.`,
      };
    },
  },
  {
    key: "structured_data",
    label: "Schema.org structured data",
    weight: 14,
    run: (html) => {
      const ld = (html.match(/application\/ld\+json/gi) ?? []).length;
      const micro = /itemscope|itemtype=/i.test(html);
      const passed = ld > 0 || micro;
      return {
        passed,
        detail: passed
          ? `${ld} JSON-LD block(s)${micro ? " + microdata" : ""} detected.`
          : "No JSON-LD or microdata detected — AI agents rely heavily on structured data.",
      };
    },
  },
  {
    key: "faq_content",
    label: "Q&A / FAQ style content",
    weight: 10,
    run: (html) => {
      const passed =
        /FAQPage|itemprop=["']acceptedAnswer/i.test(html) ||
        /<h[23][^>]*>[^<]*\?/i.test(html);
      return {
        passed,
        detail: passed
          ? "Question-formatted headings or FAQ schema present."
          : "No question-style headings or FAQ schema — answer engines favor direct Q&A content.",
      };
    },
  },
  {
    key: "og_tags",
    label: "Open Graph metadata",
    weight: 6,
    run: (html) => {
      const passed = /property=["']og:title["']/i.test(html);
      return {
        passed,
        detail: passed
          ? "og:title present."
          : "Missing Open Graph tags — they aid entity recognition and link previews.",
      };
    },
  },
  {
    key: "canonical",
    label: "Canonical URL",
    weight: 6,
    run: (html) => {
      const passed = /<link[^>]+rel=["']canonical["']/i.test(html);
      return {
        passed,
        detail: passed ? "Canonical link present." : "No canonical link tag.",
      };
    },
  },
  {
    key: "semantic_structure",
    label: "Semantic HTML structure",
    weight: 8,
    run: (html) => {
      const tags = ["<main", "<article", "<section", "<nav"].filter((t) =>
        html.toLowerCase().includes(t),
      );
      return {
        passed: tags.length >= 2,
        detail: `${tags.length} of 4 semantic landmarks (main/article/section/nav) present.`,
      };
    },
  },
  {
    key: "content_depth",
    label: "Substantive text content",
    weight: 10,
    run: (html) => {
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ");
      const words = text.split(" ").filter(Boolean).length;
      return {
        passed: words >= 300,
        detail: `${words} words of visible text${words >= 300 ? "" : " — thin content is rarely retrieved by answer engines"}.`,
      };
    },
  },
];

/** Robots + llms.txt are fetched separately from the page HTML. */
async function fetchOk(url: string): Promise<{ ok: boolean; body: string }> {
  try {
    const { res } = await safeFetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { "User-Agent": "AEO-Lab-Auditor/1.0" },
    });
    if (!res.ok) return { ok: false, body: "" };
    return { ok: true, body: await res.text() };
  } catch {
    return { ok: false, body: "" };
  }
}

/**
 * Fetch the live site and evaluate real on-page AEO checks against the
 * actual HTML. Every check result includes the concrete evidence observed.
 */
export async function auditSite(rawUrl: string): Promise<AuditResult> {
  const url = new URL(/^https?:\/\//.test(rawUrl) ? rawUrl : `https://${rawUrl}`);
  const { res } = await safeFetch(url.toString(), {
    signal: AbortSignal.timeout(15000),
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; AEO-Intelligence-Auditor/1.0)",
      Accept: "text/html,application/xhtml+xml",
    },
  });
  const html = await res.text();

  const checks: SiteCheckResult[] = CHECKS.map((c) => {
    const { passed, detail } = c.run(html, url);
    return { key: c.key, label: c.label, passed, detail };
  });

  const origin = url.origin;
  const [robots, llms] = await Promise.all([
    fetchOk(`${origin}/robots.txt`),
    fetchOk(`${origin}/llms.txt`),
  ]);
  checks.push({
    key: "robots",
    label: "robots.txt allows crawling",
    passed: robots.ok && !/^\s*disallow:\s*\/\s*$/im.test(robots.body),
    detail: robots.ok
      ? /^\s*disallow:\s*\/\s*$/im.test(robots.body)
        ? "robots.txt blocks all crawlers (Disallow: /)."
        : "robots.txt reachable and does not block all crawlers."
      : "No robots.txt reachable.",
  });
  checks.push({
    key: "llms_txt",
    label: "llms.txt present",
    passed: llms.ok,
    detail: llms.ok
      ? "llms.txt found — explicit guidance for AI crawlers."
      : "No llms.txt — consider adding one to guide AI crawlers.",
  });

  const weights: Record<string, number> = {};
  for (const c of CHECKS) weights[c.key] = c.weight;
  weights["robots"] = 8;
  weights["llms_txt"] = 10;
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  const earned = checks.reduce(
    (sum, c) => sum + (c.passed ? (weights[c.key] ?? 0) : 0),
    0,
  );

  return {
    httpStatus: res.status,
    score: Math.round((earned / total) * 100),
    checks,
  };
}
