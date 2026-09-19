import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { eq } from "drizzle-orm";
import {
  citationsTable,
  companiesTable,
  db,
  promptsTable,
  promptRunsTable,
  strategyItemsTable,
  websiteAssessmentJobsTable,
  websiteAuditFindingsTable,
} from "@workspace/db";
import app from "../../app";

describe("audit quick-win impact", () => {
  let server: Server;
  let base: string;
  let companyId: number;
  let auditId: number;
  let strategyItemId: number;

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const address = server.address();
    base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

    const [company] = await db.insert(companiesTable).values({
      name: `Impact test ${Date.now()}`,
      domain: `impact-${Date.now()}.example`,
    }).returning();
    companyId = company!.id;
    const [prompt] = await db.insert(promptsTable).values({
      companyId,
      text: "Which provider should I choose?",
      topic: "Provider choice",
    }).returning();

    const auditAt = new Date(Date.now() - 2 * 86_400_000);
    const beforeRuns = await db.insert(promptRunsTable).values([
      {
        promptId: prompt!.id,
        model: "verified-model",
        answerText: "eligible",
        brandMentioned: true,
        citationEligible: true,
        createdAt: new Date(auditAt.getTime() - 86_400_000),
      },
      {
        promptId: prompt!.id,
        model: "legacy-model",
        answerText: "ineligible",
        brandMentioned: false,
        citationEligible: false,
        createdAt: new Date(auditAt.getTime() - 86_400_000),
      },
    ]).returning();
    await db.insert(citationsTable).values(beforeRuns.map((run) => ({
      runId: run.id,
      domain: company!.domain,
      url: `https://${company!.domain}/${run.id}`,
      domainType: "you",
      provenance: "provider",
    })));

    const [job] = await db.insert(websiteAssessmentJobsTable).values({
      companyId,
      status: "completed",
      finishedAt: auditAt,
    }).returning();
    const [audit] = await db.insert(websiteAuditFindingsTable).values({
      jobId: job!.id,
      companyId,
      score: 70,
      categoryScores: { answerability: 70 },
      counts: { findings: 1 },
      pagesScanned: 1,
      methodology: ["test"],
      findings: [],
      quickWins: [{
        code: "impact-test",
        title: "Publish a direct answer",
        recommendation: "Add a direct answer.",
        evidence: "No direct answer was found.",
        pageUrl: null,
        findingCodes: ["answerability"],
        effort: "low",
        impact: "high",
      }],
      generatedAt: auditAt,
    }).returning();
    auditId = audit!.id;
  });

  afterAll(async () => {
    await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("keeps an immutable verified baseline and compares it with the first live window", async () => {
    const promoted = await fetch(`${base}/api/companies/${companyId}/audit/quick-wins/promote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ auditId, quickWinCode: "impact-test" }),
    });
    expect(promoted.status).toBe(200);
    strategyItemId = ((await promoted.json()) as { strategyItemId: number }).strategyItemId;

    const markLive = async (status: "live" | "in_progress") => {
      const response = await fetch(`${base}/api/strategy/items/${strategyItemId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      expect(response.status).toBe(200);
      return (await response.json()) as { liveAt: string | null };
    };
    const firstLiveAt = (await markLive("live")).liveAt;
    expect(firstLiveAt).not.toBeNull();
    await markLive("in_progress");
    expect((await markLive("live")).liveAt).toBe(firstLiveAt);

    const deletion = await fetch(`${base}/api/strategy/items/${strategyItemId}`, {
      method: "DELETE",
    });
    expect(deletion.status).toBe(409);

    const liveAt = new Date(Date.now() - 86_400_000);
    await db.update(strategyItemsTable).set({ status: "live", liveAt }).where(eq(strategyItemsTable.id, strategyItemId));
    const [prompt] = await db.select().from(promptsTable).where(eq(promptsTable.companyId, companyId));
    const afterRuns = await db.insert(promptRunsTable).values([
      {
        promptId: prompt!.id,
        model: "verified-model",
        answerText: "cited",
        brandMentioned: true,
        citationEligible: true,
      },
      {
        promptId: prompt!.id,
        model: "second-model",
        answerText: "visible",
        brandMentioned: true,
        citationEligible: true,
      },
    ]).returning();
    await db.insert(citationsTable).values({
      runId: afterRuns[0]!.id,
      domain: "owned.example",
      url: "https://owned.example/post-live",
      domainType: "you",
      provenance: "provider",
    });

    const response = await fetch(`${base}/api/companies/${companyId}/audit`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      promotionOutcomes: Array<{
        baseline: { eligibleRuns: number; totalRuns: number; models: string[] };
        after: { eligibleRuns: number; totalRuns: number; models: string[] };
        citationRateBefore: number;
        citationRateAfter: number;
        visibilityBefore: number;
        visibilityAfter: number;
      }>;
    };
    const outcome = body.promotionOutcomes[0]!;
    expect(outcome.baseline).toMatchObject({ eligibleRuns: 1, totalRuns: 2 });
    expect(outcome.baseline.models).toEqual(expect.arrayContaining(["verified-model", "legacy-model"]));
    expect(outcome.after).toMatchObject({ eligibleRuns: 2, totalRuns: 2 });
    expect(outcome).toMatchObject({
      citationRateBefore: 100,
      citationRateAfter: 50,
      visibilityBefore: 50,
      visibilityAfter: 100,
    });
  });
});