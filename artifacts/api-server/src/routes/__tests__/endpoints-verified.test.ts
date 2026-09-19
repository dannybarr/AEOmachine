import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import type { Server } from "node:http";
import {
  db,
  companiesTable,
  promptsTable,
  promptRunsTable,
  citationsTable,
} from "@workspace/db";
import app from "../../app";

/**
 * Endpoint-level adversarial regression: provider-provenance citations
 * attached to legacy (NULL) or tool-rejected (FALSE) runs must be invisible
 * to every verified-citation surface of /api/dashboard and
 * /api/prompts/:id/insights — totals, sources, type charts, top domains,
 * and per-model counts.
 */
describe("dashboard & prompt-insights endpoints exclude non-verified citations", () => {
  const DOMAIN = "adversarial-endpoint-test.example";
  const CITED = "adversarial-cited-domain.example";
  let server: Server;
  let base: string;
  let companyId: number;
  let promptId: number;

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;

    const [company] = await db
      .insert(companiesTable)
      .values({ name: "Adversarial Endpoint Co", domain: DOMAIN })
      .returning();
    companyId = company!.id;
    const [prompt] = await db
      .insert(promptsTable)
      .values({ companyId, text: "adversarial endpoint prompt", topic: "test" })
      .returning();
    promptId = prompt!.id;

    const runs = await db
      .insert(promptRunsTable)
      .values([
        // legacy + tool-rejected runs, both carrying provider-provenance citations
        { promptId, model: "perplexity/sonar", answerText: "x", brandMentioned: false, citationEligible: null },
        { promptId, model: "openai/gpt-5.2", answerText: "y", brandMentioned: false, citationEligible: false },
      ] as (typeof promptRunsTable.$inferInsert)[])
      .returning();
    await db.insert(citationsTable).values(
      runs.map((r, i) => ({
        runId: r.id,
        url: `https://${CITED}/${i}`,
        domain: CITED,
        domainType: "other" as const,
        position: 1,
        provenance: "provider" as const,
      })),
    );
  });

  afterAll(async () => {
    await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("GET /api/dashboard never surfaces the adversarial citations in verified metrics or sources", async () => {
    const res = await fetch(`${base}/api/dashboard?days=30`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      totals: { runs: number; retrievals: number; verifiedRetrievals: number };
      domainTypes: Array<{ domainType: string; retrievals: number }>;
      topDomains: Array<{ domain: string }>;
      topUrls: Array<{ domain: string }>;
    };
    // Raw count includes the adversarial rows; verified must not.
    expect(body.totals.retrievals).toBeGreaterThanOrEqual(2);
    expect(body.totals.retrievals - body.totals.verifiedRetrievals).toBeGreaterThanOrEqual(2);
    // No citation-intelligence surface may show the adversarial domain.
    expect(body.topDomains.some((d) => d.domain === CITED)).toBe(false);
    expect(body.topUrls.some((d) => d.domain === CITED)).toBe(false);
  });

  it("GET /api/dashboard company summaries exclude the adversarial citations", async () => {
    const res = await fetch(`${base}/api/dashboard?days=30`);
    const body = (await res.json()) as {
      companies: Array<{ id: number; runCount: number; retrievals: number }>;
    };
    const row = body.companies.find((c) => c.id === companyId);
    expect(row).toBeDefined();
    expect(row!.runCount).toBe(2); // runs are counted…
    expect(row!.retrievals).toBe(0); // …but their citations are never verified
  });

  it("GET /api/companies/:id/progress KPIs and series exclude the adversarial citations", async () => {
    const res = await fetch(`${base}/api/progress?companyId=${companyId}&days=30`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      summary: { totalRetrievals: number; avgCitationsPerRun: number | null };
      series: Array<{ ownedCitations?: number; retrievals?: number }>;
    };
    expect(body.summary.totalRetrievals).toBe(0);
    expect(body.summary.avgCitationsPerRun).toBeNull(); // no eligible runs
  });

  it("GET /api/prompts/:id/insights reports zero verified retrievals and no adversarial sources", async () => {
    const res = await fetch(`${base}/api/prompts/${promptId}/insights`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      summary: { totalRetrievals: number };
      sourceTypes: Array<{ type: string; retrievals: number }>;
      sources: Array<{ domain: string }>;
      modelCoverage: Array<{ model: string; citations: number; sources: Array<{ domain: string }> }>;
    };
    // Only citations from confirmed-eligible runs count — this prompt has none.
    expect(body.summary.totalRetrievals).toBe(0);
    expect(body.sourceTypes.every((t) => t.retrievals === 0) || body.sourceTypes.length === 0).toBe(true);
    expect((body.sources ?? []).some((s) => s.domain === CITED)).toBe(false);
    expect(body.modelCoverage.every((model) => model.citations === 0 && model.sources.length === 0)).toBe(true);
  });
});
