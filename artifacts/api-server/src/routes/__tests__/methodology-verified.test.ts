import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq, sql } from "drizzle-orm";
import {
  db,
  companiesTable,
  promptsTable,
  promptRunsTable,
  citationsTable,
} from "@workspace/db";
import { utcWindowStart } from "../../lib/timeWindow";

/**
 * Adversarial regression for the methodology aggregation predicate: a
 * provider-provenance citation attached to a legacy (NULL) or tool-rejected
 * (FALSE) run must never count as verified. This runs the exact SQL predicate
 * the /methodology endpoint uses.
 */
describe("methodology verified-citation predicate", () => {
  const DOMAIN = "methodology-verified-test.example";
  let companyId: number;

  beforeAll(async () => {
    const [company] = await db
      .insert(companiesTable)
      .values({ name: "Methodology Verified Test Co", domain: DOMAIN })
      .returning();
    companyId = company!.id;
    const [prompt] = await db
      .insert(promptsTable)
      .values({ companyId, text: "methodology test prompt", topic: "test" })
      .returning();
    const runs = await db
      .insert(promptRunsTable)
      .values([
        { promptId: prompt!.id, model: "perplexity/sonar", answerText: "a", brandMentioned: false, citationEligible: true },
        { promptId: prompt!.id, model: "openai/gpt-5.2", answerText: "b", brandMentioned: false, citationEligible: false },
        { promptId: prompt!.id, model: "perplexity/sonar", answerText: "c", brandMentioned: false, citationEligible: null },
      ] as (typeof promptRunsTable.$inferInsert)[])
      .returning();
    await db.insert(citationsTable).values(
      runs.map((r, i) => ({
        runId: r.id,
        url: `https://example.com/${i}`,
        domain: "example.com",
        domainType: "other" as const,
        position: 1,
        provenance: "provider" as const, // adversarial: provider provenance on ALL runs
      })),
    );
  });

  afterAll(async () => {
    await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
  });

  it("counts as verified only provider citations on confirmed-eligible runs", async () => {
    const cutoff = utcWindowStart(30);
    const [row] = (
      await db.execute(sql`
        SELECT
          count(*)::int AS total,
          count(*) filter (where c.provenance = 'provider' and pr.citation_eligible is true)::int AS verified,
          count(*) filter (where c.provenance is null)::int AS legacy
        FROM citations c
        JOIN prompt_runs pr ON pr.id = c.run_id
        JOIN prompts p ON p.id = pr.prompt_id
        WHERE pr.created_at >= ${cutoff.toISOString()}::timestamptz AND p.company_id = ${companyId}
      `)
    ).rows as Array<Record<string, number>>;
    expect(row!["total"]).toBe(3);
    expect(row!["verified"]).toBe(1); // only the eligible run's citation
    expect(row!["legacy"]).toBe(0);
  });
});
