import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import type { Server } from "node:http";
import {
  db,
  companiesTable,
  promptsTable,
  promptRunsTable,
  citationsTable,
  caseStudiesTable,
  caseStudyRevisionsTable,
  caseStudyJobsTable,
  weeklyMeasurementsTable,
} from "@workspace/db";
import app from "../../app";
import { buildCaseStudyEvidence } from "../../lib/caseStudyEvidence";
import { buildNarrativePrompt } from "../../lib/caseStudyRunner";

/**
 * Case studies: company isolation, revision history and immutability,
 * evidence grounding (period labels, verified-citation predicate, honest
 * gaps), and refresh-job guard behavior.
 */
describe("case studies", () => {
  let server: Server;
  let base: string;
  let companyA: number;
  let companyB: number;
  let promptA: number;

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;

    const [a] = await db
      .insert(companiesTable)
      .values({ name: "CaseStudy Co A", domain: "case-a.example" })
      .returning();
    const [b] = await db
      .insert(companiesTable)
      .values({ name: "CaseStudy Co B", domain: "case-b.example" })
      .returning();
    companyA = a!.id;
    companyB = b!.id;

    const [p] = await db
      .insert(promptsTable)
      .values({ companyId: companyA, text: "best case study tool?", topic: "t" })
      .returning();
    promptA = p!.id;

    const early = new Date("2026-07-01T10:00:00Z");
    const late = new Date("2026-08-25T10:00:00Z");
    const runs = await db
      .insert(promptRunsTable)
      .values([
        { promptId: promptA, model: "perplexity/sonar", answerText: "x", brandMentioned: false, citationEligible: true, createdAt: early },
        { promptId: promptA, model: "perplexity/sonar", answerText: "y", brandMentioned: true, brandPosition: 3, citationEligible: true, createdAt: late },
        // Citation-ineligible run: its citations must never count as verified.
        { promptId: promptA, model: "openai/gpt-5-mini", answerText: "z", brandMentioned: true, citationEligible: false, createdAt: late },
      ] as (typeof promptRunsTable.$inferInsert)[])
      .returning();
    await db.insert(citationsTable).values([
      { runId: runs[1]!.id, url: "https://case-a.example/p", domain: "case-a.example", domainType: "you", position: 1, provenance: "provider" },
      { runId: runs[2]!.id, url: "https://elsewhere.example/q", domain: "elsewhere.example", domainType: "other", position: 1, provenance: "provider" },
    ] as (typeof citationsTable.$inferInsert)[]);
    await db.insert(weeklyMeasurementsTable).values({
      companyId: companyA,
      weekOf: "2026-08-17",
      brandMentions: 4,
      shareOfVoicePct: 22,
      keyTakeaway: "First owned citation appeared",
    });
  });

  afterAll(async () => {
    await db.delete(companiesTable).where(eq(companiesTable.id, companyA));
    await db.delete(companiesTable).where(eq(companiesTable.id, companyB));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("GET creates the per-company record and PUT saves authored context", async () => {
    const r1 = await fetch(`${base}/api/case-study?companyId=${companyA}`);
    expect(r1.status).toBe(200);
    const body1 = await r1.json();
    expect(body1.caseStudy.companyId).toBe(companyA);
    expect(body1.revisions).toEqual([]);
    expect(body1.newActivity).toBeNull();

    const r2 = await fetch(`${base}/api/case-study/context`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        companyId: companyA,
        startingPosition: "Invisible in AI answers",
        strategicFocus: "Win comparison prompts",
      }),
    });
    expect(r2.status).toBe(200);
    const saved = await r2.json();
    expect(saved.startingPosition).toBe("Invisible in AI answers");
    expect(saved.contextUpdatedAt).toBeTruthy();

    const r3 = await fetch(`${base}/api/case-study?companyId=${companyB}`);
    const bodyB = await r3.json();
    // Company isolation: B never sees A's context.
    expect(bodyB.caseStudy.startingPosition).toBeNull();
  });

  it("evidence bundle grounds metrics with periods, verified citations, and honest gaps", async () => {
    const [companyRow] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyA));
    const e = await buildCaseStudyEvidence(companyRow!, {
      startingPosition: "Invisible",
      strategicFocus: null,
      contextNotes: null,
    });
    expect(e.tracking.totalRuns).toBe(3);
    expect(e.tracking.earliest?.start).toBe("2026-07-01");
    expect(e.tracking.latest?.end).toBe("2026-08-25");
    // Verified predicate: the citation on the ineligible run must be excluded.
    expect(e.tracking.latest?.verifiedCitations).toBe(1);
    expect(e.tracking.latest?.ownedCitations).toBe(1);
    // Sparse-data honesty: missing focus and missing strategy actions are named.
    expect(e.gaps.join(" ")).toMatch(/strategic focus/i);
    expect(e.gaps.join(" ")).toMatch(/strategy actions/i);

    const { system, user } = buildNarrativePrompt(e);
    expect(system).toMatch(/Never claim a strategy action CAUSED/);
    expect(system).toMatch(/name its measurement period/);
    expect(user).toContain("2026-07-01");
    expect(user).toContain("KNOWN GAPS");
    expect(user).toContain("share of voice 22%");

    // Empty company: every gap class is reported instead of invented data.
    const [rowB] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyB));
    const eb = await buildCaseStudyEvidence(rowB!, { startingPosition: null, strategicFocus: null, contextNotes: null });
    expect(eb.tracking.totalRuns).toBe(0);
    expect(eb.tracking.earliest).toBeNull();
    expect(eb.gaps.join(" ")).toMatch(/No tracking runs/);
    expect(eb.gaps.join(" ")).toMatch(/No weekly measurements/);
  });

  it("revision history stays ordered, immutable, and company-scoped", async () => {
    const [cs] = await db.select().from(caseStudiesTable).where(eq(caseStudiesTable.companyId, companyA));
    const snapshot = { version: 1, tracking: { totalRuns: 3 }, gaps: [] };
    const [rev1] = await db
      .insert(caseStudyRevisionsTable)
      .values({ caseStudyId: cs!.id, companyId: companyA, revisionNumber: 1, kind: "baseline", narrative: "Baseline story.".repeat(5), evidenceSnapshot: snapshot })
      .returning();
    await db
      .insert(caseStudyRevisionsTable)
      .values({ caseStudyId: cs!.id, companyId: companyA, revisionNumber: 2, kind: "refresh", narrative: "Refreshed story.".repeat(5), evidenceSnapshot: snapshot });

    const r = await fetch(`${base}/api/case-study?companyId=${companyA}`);
    const body = await r.json();
    expect(body.revisions.map((x: { revisionNumber: number }) => x.revisionNumber)).toEqual([2, 1]);
    expect(body.revisions[1].kind).toBe("baseline");

    // Cross-company patch must 404, never leak or mutate.
    const forbidden = await fetch(`${base}/api/case-study/revisions/${rev1!.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ companyId: companyB, editedNarrative: "hijack" }),
    });
    expect(forbidden.status).toBe(404);

    // Legitimate edit + approve: generated narrative stays untouched.
    const ok = await fetch(`${base}/api/case-study/revisions/${rev1!.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ companyId: companyA, editedNarrative: "Polished wording.", approved: true }),
    });
    expect(ok.status).toBe(200);
    const patched = await ok.json();
    expect(patched.editedNarrative).toBe("Polished wording.");
    expect(patched.approvedAt).toBeTruthy();
    expect(patched.narrative).toBe("Baseline story.".repeat(5));

    // Clearing the edit restores generated wording as the display text.
    const cleared = await fetch(`${base}/api/case-study/revisions/${rev1!.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ companyId: companyA, editedNarrative: null }),
    });
    expect((await cleared.json()).editedNarrative).toBeNull();

    // B still sees no revisions.
    const rb = await fetch(`${base}/api/case-study?companyId=${companyB}`);
    expect((await rb.json()).revisions).toEqual([]);

    // newActivity counts activity after the latest revision (runs inserted
    // before the revision → zero).
    expect(body.newActivity).toEqual({ runs: 0, actions: 0, measurements: 0 });
  });

  it("refresh refuses to double-run per company", async () => {
    await db
      .insert(caseStudyJobsTable)
      .values({ companyId: companyA, status: "running", stage: "generating_narrative" });
    const r = await fetch(`${base}/api/case-study/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ companyId: companyA }),
    });
    expect(r.status).toBe(409);
    // But company B is unaffected by A's running job (isolation of the guard):
    // we don't actually start B's job here to avoid a live model call.
    const jobs = await fetch(`${base}/api/case-study/jobs?companyId=${companyB}`);
    expect(await jobs.json()).toEqual([]);
    await db.delete(caseStudyJobsTable).where(eq(caseStudyJobsTable.companyId, companyA));
  });
});
