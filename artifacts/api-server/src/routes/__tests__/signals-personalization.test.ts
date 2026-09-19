import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import { eq } from "drizzle-orm";
import {
  companiesTable,
  db,
  gapEvidenceTable,
  gapFindingsTable,
  gapResearchJobsTable,
  promptsTable,
} from "@workspace/db";
import app from "../../app";
import { ANALYSIS_VERSION } from "../../lib/gapAnalysis";

describe("company-grounded Actions endpoint", () => {
  let server: Server;
  let base: string;
  let firstCompanyId: number;
  let secondCompanyId: number;
  let staleCompanyId: number;

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const address = server.address();
    base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
    const suffix = Date.now();
    const [first, second, stale] = await db
      .insert(companiesTable)
      .values([
        {
          name: `Agency Monitor ${suffix}`,
          domain: `agency-monitor-${suffix}.example`,
          productsServices: "Citation monitoring for independent agencies",
          targetAudience: "Independent agencies",
        },
        {
          name: `Local Clinic ${suffix}`,
          domain: `local-clinic-${suffix}.example`,
          productsServices: "Private physiotherapy appointments",
          targetAudience: "Patients in Manchester",
        },
        {
          name: `Stale Research ${suffix}`,
          domain: `stale-research-${suffix}.example`,
        },
      ])
      .returning();
    firstCompanyId = first!.id;
    secondCompanyId = second!.id;
    staleCompanyId = stale!.id;
    const [firstPrompt] = await db.insert(promptsTable).values([
      {
        companyId: firstCompanyId,
        text: "What are the best citation monitoring platforms for agencies?",
        topic: "Commercial comparison",
      },
      {
        companyId: secondCompanyId,
        text: "How do I choose a physiotherapist in Manchester?",
        topic: "Local care",
      },
    ]).returning();
    const [job] = await db
      .insert(gapResearchJobsTable)
      .values({
        companyId: firstCompanyId,
        status: "completed",
        phase: "done",
        analysisVersion: ANALYSIS_VERSION,
      })
      .returning();
    const sourceUrl = `https://community-${suffix}.example/thread`;
    const [finding] = await db
      .insert(gapFindingsTable)
      .values({
        jobId: job!.id,
        companyId: firstCompanyId,
        promptId: firstPrompt!.id,
        promptText: firstPrompt!.text,
        topic: firstPrompt!.topic,
        gapType: "full",
        eligibleRunCount: 9,
        modelCoverage: [],
        competitors: [
          {
            name: "Observed Rival",
            domain: "observed-rival.example",
            runsSurfaced: 5,
          },
        ],
        recommendation: {
          status: "proposed",
          category: "off_page",
          playType: "Community Engagement",
          evidenceUrls: [sourceUrl],
        },
      })
      .returning();
    await db.insert(gapEvidenceTable).values({
      findingId: finding!.id,
      canonicalUrl: sourceUrl,
      domain: `community-${suffix}.example`,
      channel: "ugc",
      citationCount: 5,
      runCount: 5,
      models: ["perplexity/sonar"],
      runIds: [1, 2, 3, 4, 5],
    });

    const [stalePrompt] = await db
      .insert(promptsTable)
      .values({
        companyId: staleCompanyId,
        text: "Where do buyers discuss monitoring tools?",
        topic: "Community",
      })
      .returning();
    const [staleJob] = await db
      .insert(gapResearchJobsTable)
      .values({
        companyId: staleCompanyId,
        status: "completed",
        phase: "done",
        analysisVersion: ANALYSIS_VERSION,
        createdAt: new Date("2026-01-01T10:00:00.000Z"),
        finishedAt: new Date("2026-01-01T10:05:00.000Z"),
      })
      .returning();
    const staleUrl = `https://stale-community-${suffix}.example/thread`;
    const [staleFinding] = await db
      .insert(gapFindingsTable)
      .values({
        jobId: staleJob!.id,
        companyId: staleCompanyId,
        promptId: stalePrompt!.id,
        promptText: stalePrompt!.text,
        topic: stalePrompt!.topic,
        gapType: "full",
        eligibleRunCount: 5,
        modelCoverage: [],
        competitors: [
          {
            name: "Old Rival",
            domain: "old-rival.example",
            runsSurfaced: 3,
          },
        ],
        recommendation: {
          status: "proposed",
          category: "off_page",
          playType: "Community Engagement",
          evidenceUrls: [staleUrl],
        },
      })
      .returning();
    await db.insert(gapEvidenceTable).values({
      findingId: staleFinding!.id,
      canonicalUrl: staleUrl,
      domain: `stale-community-${suffix}.example`,
      channel: "ugc",
      citationCount: 3,
      runCount: 3,
      models: ["perplexity/sonar"],
      runIds: [1, 2, 3],
    });
  });

  afterAll(async () => {
    await db.delete(companiesTable).where(eq(companiesTable.id, firstCompanyId));
    await db.delete(companiesTable).where(eq(companiesTable.id, secondCompanyId));
    await db.delete(companiesTable).where(eq(companiesTable.id, staleCompanyId));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("marks old research for refresh and withholds deployable provenance", async () => {
    const response = await fetch(
      `${base}/api/signals?companyId=${staleCompanyId}&category=off_page`,
    );
    expect(response.status).toBe(200);
    const actions = (await response.json()) as Array<{
      name: string;
      status: string;
      guidance: {
        basis: string;
        evidenceLevel: string;
        findingId: number | null;
        companyRationale: string | null;
      };
    }>;
    const community = actions.find(
      (action) => action.name === "Reddit and community presence",
    );
    expect(community?.status).toBe("refresh research");
    expect(community?.guidance.basis).toBe("research_refresh_needed");
    expect(community?.guidance.evidenceLevel).toBe("historical_observation");
    expect(community?.guidance.findingId).toBeNull();
    expect(community?.guidance.companyRationale).toContain("more than 45 days");
  });

  it("requires company scope instead of returning a misleading global list", async () => {
    const response = await fetch(`${base}/api/signals?category=on_page`);
    expect(response.status).toBe(400);
  });

  it("returns different, explicitly qualified actions for different companies", async () => {
    const [firstResponse, secondResponse] = await Promise.all([
      fetch(
        `${base}/api/signals?companyId=${firstCompanyId}&category=off_page`,
      ),
      fetch(
        `${base}/api/signals?companyId=${secondCompanyId}&category=off_page`,
      ),
    ]);
    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    const first = (await firstResponse.json()) as Array<{
      name: string;
      weight: number;
      guidance: {
        basis: string;
        companyRationale: string | null;
        nextStep: string;
      };
    }>;
    const second = (await secondResponse.json()) as typeof first;
    const firstEditorial = first.find(
      (action) => action.name === "Editorial coverage and listicles",
    );
    const secondEditorial = second.find(
      (action) => action.name === "Editorial coverage and listicles",
    );
    expect(firstEditorial?.guidance.basis).toBe("company_context");
    expect(firstEditorial?.guidance.companyRationale).toContain(
      "citation monitoring platforms",
    );
    expect(firstEditorial?.guidance.nextStep).toContain("Agency Monitor");
    expect(secondEditorial?.guidance.nextStep).toContain("Local Clinic");
    expect(secondEditorial?.guidance.nextStep).not.toContain("Agency Monitor");
    expect(first.every((action) => action.weight >= 1 && action.weight <= 5)).toBe(
      true,
    );
    const firstCommunity = first.find(
      (action) => action.name === "Reddit and community presence",
    );
    const secondCommunity = second.find(
      (action) => action.name === "Reddit and community presence",
    );
    expect(firstCommunity?.guidance.basis).toBe("verified_research");
    expect(firstCommunity?.guidance.companyRationale).toContain(
      "Observed Rival surfaced",
    );
    expect(secondCommunity?.guidance.basis).not.toBe("verified_research");
    expect(secondCommunity?.guidance.companyRationale ?? "").not.toContain(
      "Observed Rival",
    );
  });
});