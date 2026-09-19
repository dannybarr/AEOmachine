import { Router, type IRouter } from "express";
import { sql, gte, eq, and, count } from "drizzle-orm";
import {
  db,
  promptsTable,
  promptRunsTable,
  citationsTable,
} from "@workspace/db";
import {
  GetOverviewSummaryQueryParams,
  GetOverviewSummaryResponse,
  GetOverviewTimeseriesQueryParams,
  GetOverviewTimeseriesResponse,
} from "@workspace/api-zod";
import { getCompany } from "../lib/companyLookup";

const router: IRouter = Router();

function since(days: number): Date {
  return new Date(Date.now() - days * 86400_000);
}

router.get("/overview/summary", async (req, res): Promise<void> => {
  const q = GetOverviewSummaryQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  const company = await getCompany(q.data.companyId);
  if (!company) {
    res.status(400).json({ error: "Unknown companyId" });
    return;
  }
  const days = q.data.days ?? 30;
  const cutoff = since(days);
  const prevCutoff = since(days * 2);

  const [{ value: totalPrompts }] = await db
    .select({ value: count() })
    .from(promptsTable)
    .where(eq(promptsTable.companyId, company.id));

  const runs = await db
    .select({
      brandMentioned: promptRunsTable.brandMentioned,
      brandPosition: promptRunsTable.brandPosition,
      createdAt: promptRunsTable.createdAt,
    })
    .from(promptRunsTable)
    .innerJoin(promptsTable, eq(promptsTable.id, promptRunsTable.promptId))
    .where(
      and(
        eq(promptsTable.companyId, company.id),
        gte(promptRunsTable.createdAt, prevCutoff),
      ),
    );

  const current = runs.filter((r) => r.createdAt >= cutoff);
  const previous = runs.filter((r) => r.createdAt < cutoff);

  const rate = (rs: typeof current) =>
    rs.length === 0
      ? 0
      : (rs.filter((r) => r.brandMentioned).length / rs.length) * 100;

  const visibilityPct = rate(current);
  const prevVisibility = rate(previous);
  const positions = current
    .map((r) => r.brandPosition)
    .filter((p): p is number => p !== null);
  const avgPosition =
    positions.length > 0
      ? positions.reduce((a, b) => a + b, 0) / positions.length
      : null;

  const [{ value: totalRetrievals }] = await db
    .select({ value: count() })
    .from(citationsTable)
    .innerJoin(
      promptRunsTable,
      sql`${citationsTable.runId} = ${promptRunsTable.id}`,
    )
    .innerJoin(promptsTable, eq(promptsTable.id, promptRunsTable.promptId))
    .where(
      and(
        eq(promptsTable.companyId, company.id),
        gte(promptRunsTable.createdAt, cutoff),
      ),
    );

  const lastRun = current
    .map((r) => r.createdAt)
    .sort((a, b) => b.getTime() - a.getTime())[0];

  res.json(
    GetOverviewSummaryResponse.parse({
      brandName: company.name,
      days,
      totalPrompts,
      totalRuns: current.length,
      totalRetrievals,
      visibilityPct: Math.round(visibilityPct * 10) / 10,
      visibilityDelta:
        Math.round((visibilityPct - prevVisibility) * 10) / 10,
      avgPosition: avgPosition === null ? null : Math.round(avgPosition),
      mentionRatePct: Math.round(visibilityPct * 10) / 10,
      mentionRateDelta:
        Math.round((visibilityPct - prevVisibility) * 10) / 10,
      lastRunAt: lastRun ? lastRun.toISOString() : null,
    }),
  );
});

router.get("/overview/timeseries", async (req, res): Promise<void> => {
  const q = GetOverviewTimeseriesQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  const company = await getCompany(q.data.companyId);
  if (!company) {
    res.status(400).json({ error: "Unknown companyId" });
    return;
  }
  const days = q.data.days ?? 30;
  const cutoff = since(days);

  const rows = await db.execute(sql`
    SELECT
      to_char(d.day, 'YYYY-MM-DD') AS date,
      COALESCE(r.runs, 0)::int AS runs,
      COALESCE(c.retrievals, 0)::int AS retrievals,
      COALESCE(r.visibility, 0)::float AS visibility
    FROM generate_series(
      date_trunc('day', ${cutoff.toISOString()}::timestamptz),
      date_trunc('day', now()),
      interval '1 day'
    ) AS d(day)
    LEFT JOIN (
      SELECT date_trunc('day', pr.created_at) AS day,
             count(*) AS runs,
             100.0 * avg(CASE WHEN pr.brand_mentioned THEN 1 ELSE 0 END) AS visibility
      FROM prompt_runs pr
      JOIN prompts p ON p.id = pr.prompt_id
      WHERE p.company_id = ${company.id}
      GROUP BY 1
    ) r ON r.day = d.day
    LEFT JOIN (
      SELECT date_trunc('day', pr.created_at) AS day, count(*) AS retrievals
      FROM citations ct
      JOIN prompt_runs pr ON pr.id = ct.run_id
      JOIN prompts p ON p.id = pr.prompt_id
      WHERE p.company_id = ${company.id}
      GROUP BY 1
    ) c ON c.day = d.day
    ORDER BY d.day
  `);

  const points = (rows.rows as Array<Record<string, unknown>>).map((r) => ({
    date: String(r["date"]),
    runs: Number(r["runs"]),
    retrievals: Number(r["retrievals"]),
    visibilityPct: Math.round(Number(r["visibility"]) * 10) / 10,
  }));

  res.json(GetOverviewTimeseriesResponse.parse(points));
});

export default router;
