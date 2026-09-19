import { Router, type IRouter } from "express";
import { sql, eq, gte, and, desc } from "drizzle-orm";
import {
  db,
  promptRunsTable,
  citationsTable,
  domainRegistryTable,
} from "@workspace/db";
import { promptsTable } from "@workspace/db";
import { getCompany } from "../lib/companyLookup";
import {
  ListDomainsQueryParams,
  ListDomainsResponse,
  GetDomainTypeDistributionQueryParams,
  GetDomainTypeDistributionResponse,
  ListUrlsQueryParams,
  ListUrlsResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

function since(days: number): Date {
  return new Date(Date.now() - days * 86400_000);
}

router.get("/sources/domains", async (req, res): Promise<void> => {
  const q = ListDomainsQueryParams.safeParse(req.query);
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
  const limit = q.data.limit ?? 20;
  const view = q.data.view ?? "top";
  const cutoff = since(days);
  const prevCutoff = since(days * 2);

  const rows = await db
    .select({
      domain: citationsTable.domain,
      domainType: sql<string>`max(${citationsTable.domainType})`,
      current: sql<number>`count(*) FILTER (WHERE ${promptRunsTable.createdAt} >= ${cutoff.toISOString()}::timestamptz)::int`,
      previous: sql<number>`count(*) FILTER (WHERE ${promptRunsTable.createdAt} < ${cutoff.toISOString()}::timestamptz)::int`,
      firstCited: sql<string>`min(${promptRunsTable.createdAt})`,
    })
    .from(citationsTable)
    .innerJoin(promptRunsTable, eq(promptRunsTable.id, citationsTable.runId))
    .innerJoin(promptsTable, eq(promptsTable.id, promptRunsTable.promptId))
    .where(
      and(
        eq(promptsTable.companyId, company.id),
        gte(promptRunsTable.createdAt, prevCutoff),
      ),
    )
    .groupBy(citationsTable.domain);

  const registry = await db
    .select()
    .from(domainRegistryTable)
    .where(eq(domainRegistryTable.companyId, company.id));
  const regMap = new Map(registry.map((r) => [r.domain, r]));

  let stats = rows.map((r, i) => {
    const reg = regMap.get(r.domain);
    // No prior-window data: a domain with current retrievals is fully new
    // (+100%); with none in either window the delta is flat (0).
    const deltaPct =
      r.previous === 0
        ? r.current > 0
          ? 100
          : 0
        : Math.round(((r.current - r.previous) / r.previous) * 1000) / 10;
    // First-seen is real observed data: registry timestamp when known,
    // otherwise the earliest run in which the domain was actually cited.
    const firstSeenAt = reg?.firstSeenAt ?? new Date(r.firstCited);
    return {
      id: reg?.id ?? -(i + 1),
      domain: r.domain,
      domainType: reg?.domainType ?? r.domainType,
      retrievals: r.current,
      deltaPct,
      isOwned: reg?.isOwned ?? false,
      firstSeenAt: firstSeenAt.toISOString(),
    };
  });

  switch (view) {
    case "new":
      stats = stats
        .filter(
          (s) => new Date(s.firstSeenAt) >= cutoff && s.retrievals > 0,
        )
        .sort((a, b) => b.retrievals - a.retrievals);
      break;
    case "trending":
      stats = stats
        .filter((s) => s.retrievals > 0 && s.deltaPct > 0)
        .sort((a, b) => b.deltaPct - a.deltaPct);
      break;
    case "losing":
      stats = stats
        .filter((s) => s.deltaPct < 0)
        .sort((a, b) => a.deltaPct - b.deltaPct);
      break;
    default:
      stats = stats
        .filter((s) => s.retrievals > 0)
        .sort((a, b) => b.retrievals - a.retrievals);
  }

  res.json(ListDomainsResponse.parse(stats.slice(0, limit)));
});

router.get("/sources/domain-types", async (req, res): Promise<void> => {
  const q = GetDomainTypeDistributionQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  const company = await getCompany(q.data.companyId);
  if (!company) {
    res.status(400).json({ error: "Unknown companyId" });
    return;
  }
  const cutoff = since(q.data.days ?? 30);

  const rows = await db
    .select({
      domainType: citationsTable.domainType,
      retrievals: sql<number>`count(*)::int`,
    })
    .from(citationsTable)
    .innerJoin(promptRunsTable, eq(promptRunsTable.id, citationsTable.runId))
    .innerJoin(promptsTable, eq(promptsTable.id, promptRunsTable.promptId))
    .where(
      and(
        eq(promptsTable.companyId, company.id),
        gte(promptRunsTable.createdAt, cutoff),
      ),
    )
    .groupBy(citationsTable.domainType)
    .orderBy(desc(sql`count(*)`));

  const total = rows.reduce((s, r) => s + r.retrievals, 0);
  res.json(
    GetDomainTypeDistributionResponse.parse({
      totalRetrievals: total,
      types: rows.map((r) => ({
        domainType: r.domainType,
        retrievals: r.retrievals,
        sharePct: total === 0 ? 0 : Math.round((r.retrievals / total) * 1000) / 10,
      })),
    }),
  );
});

router.get("/sources/urls", async (req, res): Promise<void> => {
  const q = ListUrlsQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  const company = await getCompany(q.data.companyId);
  if (!company) {
    res.status(400).json({ error: "Unknown companyId" });
    return;
  }
  const cutoff = since(q.data.days ?? 30);
  const limit = q.data.limit ?? 20;

  const rows = await db
    .select({
      url: citationsTable.url,
      domain: citationsTable.domain,
      domainType: sql<string>`max(${citationsTable.domainType})`,
      retrievals: sql<number>`count(*)::int`,
      lastSeenAt: sql<string>`max(${promptRunsTable.createdAt})`,
    })
    .from(citationsTable)
    .innerJoin(promptRunsTable, eq(promptRunsTable.id, citationsTable.runId))
    .innerJoin(promptsTable, eq(promptsTable.id, promptRunsTable.promptId))
    .where(
      and(
        eq(promptsTable.companyId, company.id),
        gte(promptRunsTable.createdAt, cutoff),
        sql`${citationsTable.url} IS NOT NULL`,
      ),
    )
    .groupBy(citationsTable.url, citationsTable.domain)
    .orderBy(desc(sql`count(*)`))
    .limit(limit);

  res.json(
    ListUrlsResponse.parse(
      rows.map((r, i) => ({
        id: i + 1,
        url: r.url ?? "",
        domain: r.domain,
        domainType: r.domainType,
        retrievals: r.retrievals,
        lastSeenAt: new Date(r.lastSeenAt).toISOString(),
      })),
    ),
  );
});

export default router;
