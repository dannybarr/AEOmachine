import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { eq } from "drizzle-orm";
import { db, companiesTable, promptsTable, promptRunsTable } from "@workspace/db";
import runsRouter from "../runs";

/**
 * Per-run diagnostics exposure: stored citation_diagnostics values are
 * returned verbatim on GET /runs/:id, and legacy runs (no diagnostics)
 * return an explicit null — never a fabricated object.
 */
let server: Server;
let base: string;
let companyId: number;
let diagRunId: number;
let legacyRunId: number;

const DIAG = {
  extracted: 2,
  metadataEvents: 5,
  invalidUrls: 1,
  unknownAnnotationTypes: ["grounding_v2"],
  unknownShapes: 2,
  redirectsResolved: 1,
  redirectsFailed: 1,
  observedShapes: ["delta.web_search.content"],
  seenCitationKeys: ["delta.web_search"],
  unparsedCitationKeys: ["delta.annotations"],
};

beforeAll(async () => {
  const [company] = await db
    .insert(companiesTable)
    .values({ name: "Run Diagnostics Test Co", domain: "run-diagnostics-test.example" })
    .returning();
  companyId = company!.id;
  const [prompt] = await db
    .insert(promptsTable)
    .values({ companyId, text: "diagnostics test prompt", topic: "test" })
    .returning();
  const runs = await db
    .insert(promptRunsTable)
    .values([
      {
        promptId: prompt!.id,
        model: "perplexity/sonar",
        answerText: "answer with diagnostics",
        brandMentioned: false,
        citationEligible: true,
        searchStatus: "provider_cited",
        citationDiagnostics: DIAG,
      },
      {
        promptId: prompt!.id,
        model: "perplexity/sonar",
        answerText: "legacy answer",
        brandMentioned: false,
        citationEligible: null,
        searchStatus: null,
        citationDiagnostics: null,
      },
    ] as (typeof promptRunsTable.$inferInsert)[])
    .returning();
  diagRunId = runs[0]!.id;
  legacyRunId = runs[1]!.id;

  const app = express();
  app.use(runsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
});

describe("GET /runs/:id citation diagnostics", () => {
  it("returns stored diagnostics values verbatim", async () => {
    const res = await fetch(`${base}/runs/${diagRunId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { citationDiagnostics: unknown; searchStatus: string };
    expect(body.searchStatus).toBe("provider_cited");
    expect(body.citationDiagnostics).toEqual(DIAG);
  });

  it("returns explicit null for legacy runs without diagnostics", async () => {
    const res = await fetch(`${base}/runs/${legacyRunId}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { citationDiagnostics: unknown; searchStatus: unknown };
    expect(body.citationDiagnostics).toBeNull();
    expect(body.searchStatus).toBeNull();
  });
});
