import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Server } from "node:http";
import {
  companiesTable,
  db,
  gapActionProvenanceTable,
  gapFindingsTable,
  gapResearchJobsTable,
  promptRunsTable,
  promptsTable,
  strategyIdeasTable,
} from "@workspace/db";
import app from "../../app";
import { ANALYSIS_VERSION } from "../../lib/gapAnalysis";

interface ResearchCase {
  companyId: number;
  findingIds: number[];
}

describe("Gap finding promotion freshness", () => {
  let server: Server;
  let base: string;
  let ideaId: number;
  let ageExpired: ResearchCase;
  let newerRun: ResearchCase;
  let newerJob: ResearchCase;
  const companyIds: number[] = [];

  async function createResearchCase(
    label: string,
    finishedAt: Date[],
    addRunAfterLatestJob = false,
  ): Promise<ResearchCase> {
    const suffix = `${Date.now()}-${label}`;
    const [company] = await db
      .insert(companiesTable)
      .values({
        name: `Freshness ${label} ${suffix}`,
        domain: `freshness-${label}-${suffix}.example`,
      })
      .returning();
    companyIds.push(company!.id);
    const [prompt] = await db
      .insert(promptsTable)
      .values({
        companyId: company!.id,
        text: "Where do buyers discuss monitoring tools?",
        topic: "Community",
      })
      .returning();

    const findingIds: number[] = [];
    for (const completedAt of finishedAt) {
      const [job] = await db
        .insert(gapResearchJobsTable)
        .values({
          companyId: company!.id,
          status: "completed",
          phase: "done",
          analysisVersion: ANALYSIS_VERSION,
          createdAt: new Date(completedAt.getTime() - 5 * 60 * 1_000),
          finishedAt: completedAt,
        })
        .returning();
      const [finding] = await db
        .insert(gapFindingsTable)
        .values({
          jobId: job!.id,
          companyId: company!.id,
          promptId: prompt!.id,
          promptText: prompt!.text,
          topic: prompt!.topic,
          gapType: "full",
          eligibleRunCount: 5,
          modelCoverage: [],
          competitors: [],
          recommendation: {
            status: "proposed",
            category: "off_page",
            playType: "Community Engagement",
            suggestedIdeaTitle: "Reddit AMA on your money topics",
            evidenceUrls: [],
          },
        })
        .returning();
      findingIds.push(finding!.id);
    }

    if (addRunAfterLatestJob) {
      const latestFinishedAt = finishedAt.at(-1)!;
      await db.insert(promptRunsTable).values({
        promptId: prompt!.id,
        model: "perplexity/sonar",
        answerText: "A newer citation-eligible answer.",
        brandMentioned: false,
        citationEligible: true,
        createdAt: new Date(latestFinishedAt.getTime() + 30 * 60 * 1_000),
      });
    }
    return { companyId: company!.id, findingIds };
  }

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const address = server.address();
    base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

    const [idea] = await db
      .select()
      .from(strategyIdeasTable)
      .where(
        and(
          eq(strategyIdeasTable.title, "Reddit AMA on your money topics"),
          eq(strategyIdeasTable.category, "off_page"),
        ),
      );
    if (!idea) throw new Error("Expected seeded Reddit AMA strategy idea");
    ideaId = idea.id;

    ageExpired = await createResearchCase(
      "age",
      [new Date("2026-01-01T10:05:00.000Z")],
    );
    const recent = new Date(Date.now() - 60 * 60 * 1_000);
    newerRun = await createResearchCase("run", [recent], true);
    newerJob = await createResearchCase("job", [
      new Date(Date.now() - 2 * 60 * 60 * 1_000),
      new Date(Date.now() - 60 * 60 * 1_000),
    ]);
  });

  afterAll(async () => {
    for (const companyId of companyIds) {
      await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function promote(researchCase: ResearchCase, findingId: number) {
    return fetch(`${base}/api/gap-analysis/findings/${findingId}/promote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        companyId: researchCase.companyId,
        ideaId,
        category: "off_page",
        brief: { actionAngle: "Run a transparent community AMA." },
      }),
    });
  }

  async function expectNoProvenance(findingId: number) {
    const promoted = await db
      .select()
      .from(gapActionProvenanceTable)
      .where(eq(gapActionProvenanceTable.findingId, findingId));
    expect(promoted).toHaveLength(0);
  }

  it("rejects promotion when the research snapshot is over 45 days old", async () => {
    const findingId = ageExpired.findingIds[0]!;
    const response = await promote(ageExpired, findingId);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("more than 45 days old"),
    });
    await expectNoProvenance(findingId);
  });

  it("rejects promotion when a newer citation-eligible run exists", async () => {
    const findingId = newerRun.findingIds[0]!;
    const response = await promote(newerRun, findingId);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("newer eligible tracking runs"),
    });
    await expectNoProvenance(findingId);
  });

  it("rejects an older valid job but allows its newest replacement", async () => {
    const [olderFindingId, latestFindingId] = newerJob.findingIds;
    const oldResponse = await promote(newerJob, olderFindingId!);
    expect(oldResponse.status).toBe(409);
    await expect(oldResponse.json()).resolves.toMatchObject({
      error: expect.stringContaining("newer completed Gap Analysis"),
    });
    await expectNoProvenance(olderFindingId!);

    const latestResponse = await promote(newerJob, latestFindingId!);
    expect(latestResponse.status).toBe(201);
    const promoted = await db
      .select()
      .from(gapActionProvenanceTable)
      .where(eq(gapActionProvenanceTable.findingId, latestFindingId!));
    expect(promoted).toHaveLength(1);
  });
});