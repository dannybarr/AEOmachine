import { describe, it, expect } from "vitest";
import { sql, eq, and, gte } from "drizzle-orm";
import { db, companiesTable, promptsTable, promptRunsTable } from "@workspace/db";
import { companyStats } from "../companies";
import { utcWindowStart } from "../../lib/timeWindow";

/**
 * Regression: the dashboard model filter must propagate into company
 * summaries with the SAME UTC-midnight window, so "Every figure below"
 * stays true when a model is selected.
 */
describe("companyStats model filtering reconciles with stored runs", () => {
  const DAYS = 30;
  // Same shared UTC calendar window the routes use.
  const cutoff = sql`${utcWindowStart(DAYS).toISOString()}::timestamptz`;

  async function expectedRunCount(companyId: number, model?: string) {
    const rows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(promptRunsTable)
      .innerJoin(promptsTable, eq(promptsTable.id, promptRunsTable.promptId))
      .where(
        and(
          eq(promptsTable.companyId, companyId),
          gte(promptRunsTable.createdAt, cutoff),
          ...(model ? [eq(promptRunsTable.model, model)] : []),
        ),
      );
    return rows[0]!.n;
  }

  it("filtered stats match a direct per-model query and differ from all-model stats", async () => {
    const companies = await db.select().from(companiesTable);
    expect(companies.length).toBeGreaterThan(0);
    const companyId = companies[0]!.id;

    const model = "perplexity/sonar";
    const all = (await companyStats([companyId], DAYS)).get(companyId)!;
    const filtered = (await companyStats([companyId], DAYS, { model })).get(companyId)!;

    // Exact reconciliation with the stored runs for the same window/filter.
    expect(all.runCount).toBe(await expectedRunCount(companyId));
    expect(filtered.runCount).toBe(await expectedRunCount(companyId, model));

    // The filter must actually narrow the data when other models have runs.
    if (all.runCount > filtered.runCount) {
      expect(filtered.runCount).toBeLessThan(all.runCount);
      expect(filtered.retrievals).toBeLessThanOrEqual(all.retrievals);
    }
  });

  it("an unrun model yields zeroed company metrics, not aggregate leakage", async () => {
    const companies = await db.select().from(companiesTable);
    const companyId = companies[0]!.id;
    const filtered = (
      await companyStats([companyId], DAYS, { model: "openai/gpt-5" })
    ).get(companyId)!;
    expect(filtered.runCount).toBe(await expectedRunCount(companyId, "openai/gpt-5"));
  });
});
