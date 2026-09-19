import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Server } from "node:http";
import {
  companiesTable,
  db,
  gapEvidenceTable,
  gapFindingsTable,
  gapResearchJobsTable,
  promptsTable,
  strategyIdeasTable,
} from "@workspace/db";
import app from "../../app";
import { ANALYSIS_VERSION } from "../../lib/gapAnalysis";

describe("legacy Gap snapshots cannot become verified action evidence", () => {
  let server: Server;
  let base: string;
  let companyId: number;
  let findingId: number;
  let ideaId: number;

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const address = server.address();
    base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

    const suffix = Date.now();
    const [company] = await db
      .insert(companiesTable)
      .values({
        name: `Legacy Evidence ${suffix}`,
        domain: `legacy-evidence-${suffix}.example`,
      })
      .returning();
    companyId = company!.id;
    const [prompt] = await db
      .insert(promptsTable)
      .values({
        companyId,
        text: "Which community sources are trusted?",
        topic: "test",
      })
      .returning();
    const [job] = await db
      .insert(gapResearchJobsTable)
      .values({
        companyId,
        status: "completed",
        phase: "done",
        analysisVersion: ANALYSIS_VERSION - 1,
      })
      .returning();
    const sourceUrl = `https://legacy-source-${suffix}.example/thread`;
    const [finding] = await db
      .insert(gapFindingsTable)
      .values({
        jobId: job!.id,
        companyId,
        promptId: prompt!.id,
        promptText: "Which community sources are trusted?",
        topic: "test",
        gapType: "full",
        eligibleRunCount: 9,
        modelCoverage: [],
        competitors: [
          {
            domain: "legacy-rival.example",
            name: "Legacy Rival",
            runsSurfaced: 9,
          },
        ],
        recommendation: {
          status: "proposed",
          category: "off_page",
          playType: "Community Engagement",
          suggestedIdeaTitle: "Reddit AMA on your money topics",
          evidenceUrls: [sourceUrl],
        },
      })
      .returning();
    findingId = finding!.id;
    await db.insert(gapEvidenceTable).values({
      findingId,
      canonicalUrl: sourceUrl,
      domain: `legacy-source-${suffix}.example`,
      channel: "ugc",
      citationCount: 9,
      runCount: 9,
      models: ["perplexity/sonar"],
      runIds: [1, 2, 3],
    });

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
  });

  afterAll(async () => {
    await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("does not serve the legacy completed job as the current verified report", async () => {
    const response = await fetch(
      `${base}/api/gap-analysis/report?companyId=${companyId}`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      latestJob: { analysisVersion: number } | null;
      snapshot: unknown;
    };
    expect(body.latestJob?.analysisVersion).toBe(ANALYSIS_VERSION - 1);
    expect(body.snapshot).toBeNull();
  });

  it("rejects direct promotion from the legacy finding", async () => {
    const response = await fetch(
      `${base}/api/gap-analysis/findings/${findingId}/promote`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          companyId,
          ideaId,
          category: "off_page",
          brief: { actionAngle: "Run a useful, transparent community AMA." },
        }),
      },
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("predates verified citation provenance"),
    });
  });
});