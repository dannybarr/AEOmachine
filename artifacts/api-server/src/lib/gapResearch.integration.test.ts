/**
 * Integration test (real database): the page evidence served for a completed
 * research job is an immutable snapshot. Later refetches rewrite the
 * gap_source_pages cache, but must never alter what an existing job's
 * evidence rows report — including resurrecting a failed fetch as verified.
 *
 * Requires DATABASE_URL (same as the migrate script).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import {
  db,
  companiesTable,
  promptsTable,
  gapResearchJobsTable,
  gapSourcePagesTable,
  gapFindingsTable,
  gapEvidenceTable,
} from "@workspace/db";

test("a later refetch cannot alter an existing job's evidence snapshot", async () => {
  const suffix = Date.now();
  const [company] = await db
    .insert(companiesTable)
    .values({ name: `__test_co_${suffix}`, domain: `test-${suffix}.example` })
    .returning();
  try {
    const [prompt] = await db
      .insert(promptsTable)
      .values({ companyId: company!.id, text: "test prompt", topic: "test" })
      .returning();
    const [job] = await db
      .insert(gapResearchJobsTable)
      .values({ companyId: company!.id, status: "completed", phase: "done" })
      .returning();
    const url = `https://source-${suffix}.example/article`;
    const [page] = await db
      .insert(gapSourcePagesTable)
      .values({
        companyId: company!.id,
        canonicalUrl: url,
        domain: `source-${suffix}.example`,
        fetchStatus: "blocked",
        httpStatus: 403,
        title: null,
        snippet: null,
        fetchedAt: new Date("2026-08-01T00:00:00Z"),
      })
      .returning();
    const [finding] = await db
      .insert(gapFindingsTable)
      .values({
        jobId: job!.id,
        companyId: company!.id,
        promptId: prompt!.id,
        promptText: "test prompt",
        topic: "test",
        gapType: "full",
        modelCoverage: [],
        competitors: [],
        recommendation: { status: "insufficient", evidenceUrls: [] },
      })
      .returning();
    // Evidence stores the page state AS OBSERVED by this job (blocked, 403).
    await db.insert(gapEvidenceTable).values({
      findingId: finding!.id,
      sourcePageId: page!.id,
      canonicalUrl: url,
      domain: `source-${suffix}.example`,
      channel: "editorial",
      models: [],
      runIds: [],
      pageFetchStatus: "blocked",
      pageHttpStatus: 403,
      pageTitle: null,
      pageSnippet: null,
      pageSignals: null,
      pageFetchedAt: new Date("2026-08-01T00:00:00Z"),
    });

    // A later research run refetches the URL and rewrites the cache row.
    await db
      .update(gapSourcePagesTable)
      .set({
        fetchStatus: "ok",
        httpStatus: 200,
        title: "Now accessible!",
        snippet: "Rewritten by a later run",
        fetchedAt: new Date(),
      })
      .where(eq(gapSourcePagesTable.id, page!.id));

    // The old job's evidence snapshot must be unchanged: still blocked/403.
    const [evidence] = await db
      .select()
      .from(gapEvidenceTable)
      .where(eq(gapEvidenceTable.findingId, finding!.id));
    assert.equal(evidence!.pageFetchStatus, "blocked");
    assert.equal(evidence!.pageHttpStatus, 403);
    assert.equal(evidence!.pageTitle, null);
    assert.equal(
      evidence!.pageFetchedAt?.toISOString(),
      "2026-08-01T00:00:00.000Z",
    );
  } finally {
    await db.delete(companiesTable).where(eq(companiesTable.id, company!.id));
  }
});

test("the database atomically enforces one running research job per company", async () => {
  const [company] = await db
    .insert(companiesTable)
    .values({ name: `__test_guard_${Date.now()}`, domain: `guard-${Date.now()}.example` })
    .returning();
  try {
    await db
      .insert(gapResearchJobsTable)
      .values({ companyId: company!.id, status: "running", phase: "collecting" });
    // A concurrent second insert (other request or other instance) must fail
    // on the partial unique index, not create a duplicate running job.
    await assert.rejects(
      () =>
        db
          .insert(gapResearchJobsTable)
          .values({ companyId: company!.id, status: "running", phase: "collecting" }),
      (err: unknown) => {
        const s = `${String(err)} ${String((err as { cause?: unknown }).cause ?? "")}`;
        return /duplicate key|23505/i.test(s);
      },
    );
    // But a completed job does not block a new run.
    await db
      .update(gapResearchJobsTable)
      .set({ status: "completed", phase: "done" })
      .where(eq(gapResearchJobsTable.companyId, company!.id));
    await db
      .insert(gapResearchJobsTable)
      .values({ companyId: company!.id, status: "running", phase: "collecting" });
  } finally {
    await db.delete(companiesTable).where(eq(companiesTable.id, company!.id));
  }
});
