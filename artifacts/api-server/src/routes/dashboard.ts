import { Router, type IRouter } from "express";
import { and, eq, gte, isNull, sql } from "drizzle-orm";
import {
  db,
  companiesTable,
  promptsTable,
  promptRunsTable,
  citationsTable,
} from "@workspace/db";
import { getModel } from "../lib/modelRegistry";
import { dashboardTotals } from "../lib/dashboardTotals";
import { utcWindowStart } from "../lib/timeWindow";
import { companyStats } from "./companies";
import { serializeCompany } from "../lib/companyLookup";

const router: IRouter = Router();

/**
 * Industry-level intelligence aggregated across every tracked company.
 * All figures are computed from real simulation runs and citations.
 */
router.get("/dashboard", async (req, res) => {
  const requestedDays = Number(req.query["days"]) || 30;
  const days = [30, 90, 180].includes(requestedDays) ? requestedDays : 30;
  const allHistory = req.query["all"] === "true";
  // Optional canonical model filter; unknown values are rejected rather
  // than silently returning unfiltered data.
  const model = typeof req.query["model"] === "string" && req.query["model"] ? req.query["model"] : null;
  if (model && !getModel(model)) {
    res.status(400).json({ error: `Unknown model id "${model}"` });
    return;
  }
  const topic = typeof req.query["topic"] === "string" && req.query["topic"] ? req.query["topic"] : null;

  // Shared UTC calendar window (today included, partial) so figures
  // reconcile exactly with stored runs for the selected calendar days.
  const windowStart = utcWindowStart(days);
  const cutoff = sql`${windowStart.toISOString()}::timestamptz`;

  const companyFilter = topic === "__uncategorized__"
    ? isNull(companiesTable.industry)
    : topic
      ? eq(companiesTable.industry, topic)
      : undefined;
  const runFilter = and(
    allHistory ? undefined : gte(promptRunsTable.createdAt, cutoff),
    model ? eq(promptRunsTable.model, model) : undefined,
    companyFilter,
  );

  const matchingCompanyRows = await db
    .selectDistinct({ id: companiesTable.id })
    .from(promptRunsTable)
    .innerJoin(promptsTable, eq(promptsTable.id, promptRunsTable.promptId))
    .innerJoin(companiesTable, eq(companiesTable.id, promptsTable.companyId))
    .where(runFilter);
  const matchingCompanyIds = new Set(matchingCompanyRows.map((row) => row.id));

  let companiesQuery = db
    .select()
    .from(companiesTable)
    .$dynamic();
  if (companyFilter) companiesQuery = companiesQuery.where(companyFilter);
  const companies = (await companiesQuery.orderBy(companiesTable.name))
    .filter((company) => matchingCompanyIds.has(company.id));
  const stats = await companyStats(companies.map((c) => c.id), days, {
    model,
    allHistory,
  });
  const companySummaries = companies.map((c) => ({
    ...serializeCompany(c),
    ...stats.get(c.id)!,
  }));

  // One shared verified-citation predicate for every citation-derived
  // aggregate: provider-returned provenance AND a confirmed-eligible run.
  // Legacy/rejected runs' citations never enter citation intelligence.
  const verifiedCitationFilter = and(
    runFilter,
    eq(citationsTable.provenance, "provider"),
    sql`${promptRunsTable.citationEligible} is true`,
  );

  const totalsShared = await dashboardTotals(runFilter);
  const [promptTotal] = await db
    .select({ prompts: sql<number>`count(distinct ${promptsTable.id})::int` })
    .from(promptRunsTable)
    .innerJoin(promptsTable, eq(promptsTable.id, promptRunsTable.promptId))
    .innerJoin(companiesTable, eq(companiesTable.id, promptsTable.companyId))
    .where(runFilter);
  const [uniqueDomainsRow] = await db
    .select({ uniqueDomains: sql<number>`count(distinct ${citationsTable.domain})::int` })
    .from(citationsTable)
    .innerJoin(promptRunsTable, eq(promptRunsTable.id, citationsTable.runId))
    .innerJoin(promptsTable, eq(promptsTable.id, promptRunsTable.promptId))
    .innerJoin(companiesTable, eq(companiesTable.id, promptsTable.companyId))
    .where(verifiedCitationFilter);

  const runs = totalsShared.runs;
  const retrievals = totalsShared.retrievals;
  const uniqueDomains = uniqueDomainsRow?.uniqueDomains ?? 0;
  const eligibleRuns = totalsShared.eligibleRuns;
  const avgCitationsPerRun = totalsShared.avgCitationsPerRun;

  // Source distribution by domain type, across all companies.
  const typeRows = await db
    .select({
      domainType: citationsTable.domainType,
      retrievals: sql<number>`count(*)::int`,
    })
    .from(citationsTable)
    .innerJoin(promptRunsTable, eq(promptRunsTable.id, citationsTable.runId))
    .innerJoin(promptsTable, eq(promptsTable.id, promptRunsTable.promptId))
    .innerJoin(companiesTable, eq(companiesTable.id, promptsTable.companyId))
    .where(verifiedCitationFilter)
    .groupBy(citationsTable.domainType)
    .orderBy(sql`count(*) desc`);
  const typeTotal = typeRows.reduce((s, r) => s + r.retrievals, 0);
  const domainTypes = typeRows.map((r) => ({
    domainType: r.domainType,
    retrievals: r.retrievals,
    sharePct: typeTotal > 0 ? Math.round((r.retrievals / typeTotal) * 1000) / 10 : 0,
  }));

  // Top domains across the industry, with how many companies they surface for,
  // average citation position and distinct-model consensus.
  const topDomainRows = await db
    .select({
      domain: citationsTable.domain,
      retrievals: sql<number>`count(*)::int`,
      companiesCitedFor: sql<number>`count(distinct ${promptsTable.companyId})::int`,
      domainTypes: sql<string[]>`array_agg(distinct ${citationsTable.domainType})`,
      avgPosition: sql<number | null>`avg(${citationsTable.position})`,
      modelCount: sql<number>`count(distinct ${promptRunsTable.model})::int`,
    })
    .from(citationsTable)
    .innerJoin(promptRunsTable, eq(promptRunsTable.id, citationsTable.runId))
    .innerJoin(promptsTable, eq(promptsTable.id, promptRunsTable.promptId))
    .innerJoin(companiesTable, eq(companiesTable.id, promptsTable.companyId))
    .where(verifiedCitationFilter)
    .groupBy(citationsTable.domain)
    .orderBy(sql`count(*) desc`)
    .limit(25);

  // Citation concentration: unique domains, avg citations per run,
  // and the share of retrievals held by the top 5 domains.
  const top5Retrievals = topDomainRows
    .slice(0, 5)
    .reduce((s, d) => s + d.retrievals, 0);
  const top5SharePct =
    totalsShared.verifiedRetrievals > 0
      ? Math.round((top5Retrievals / totalsShared.verifiedRetrievals) * 1000) / 10
      : null;
  const concentration = {
    uniqueDomains,
    avgCitationsPerRun,
    top5SharePct,
  };

  const totals = {
    companies: companies.length,
    prompts: promptTotal?.prompts ?? 0,
    runs,
    citationEligibleRuns: eligibleRuns,
    searchIneligibleRuns: totalsShared.ineligibleRuns,
    legacyRuns: totalsShared.legacyRuns,
    // Raw stored citations (includes legacy/unknown-provenance rows).
    retrievals,
    // Provider-returned citations from confirmed citation-eligible runs only.
    verifiedRetrievals: totalsShared.verifiedRetrievals,
    uniqueDomains,
    avgCitationsPerRun,
    top5ConcentrationPct: top5SharePct,
    overallVisibilityPct:
      runs > 0 ? Math.round((totalsShared.mentions / runs) * 1000) / 10 : null,
  };

  const [brandPositionRows, citationPositionRows] = await Promise.all([
    db
      .select({
        positionedBrandRuns: sql<number>`count(*) filter (where ${promptRunsTable.brandMentioned} and ${promptRunsTable.brandPosition} is not null)::int`,
        avgBrandPosition: sql<number | null>`avg(${promptRunsTable.brandPosition}) filter (where ${promptRunsTable.brandMentioned} and ${promptRunsTable.brandPosition} is not null)`,
      })
      .from(promptRunsTable)
      .innerJoin(promptsTable, eq(promptsTable.id, promptRunsTable.promptId))
      .innerJoin(companiesTable, eq(companiesTable.id, promptsTable.companyId))
      .where(runFilter),
    db
      .select({
        positionedCitations: sql<number>`count(*) filter (where ${citationsTable.position} is not null)::int`,
        top3Citations: sql<number>`count(*) filter (where ${citationsTable.position} between 1 and 3)::int`,
      })
      .from(citationsTable)
      .innerJoin(promptRunsTable, eq(promptRunsTable.id, citationsTable.runId))
      .innerJoin(promptsTable, eq(promptsTable.id, promptRunsTable.promptId))
      .innerJoin(companiesTable, eq(companiesTable.id, promptsTable.companyId))
      .where(verifiedCitationFilter),
  ]);
  const qualityRow = brandPositionRows[0];
  const citationPositionRow = citationPositionRows[0];
  const positionedCitations = citationPositionRow?.positionedCitations ?? 0;
  const quality = {
    searchCoveragePct:
      runs > 0 ? Math.round((eligibleRuns / runs) * 1000) / 10 : null,
    avgBrandPosition:
      qualityRow?.avgBrandPosition != null
        ? Math.round(Number(qualityRow.avgBrandPosition) * 10) / 10
        : null,
    positionedBrandRuns: qualityRow?.positionedBrandRuns ?? 0,
    top3CitationSharePct:
      positionedCitations > 0
        ? Math.round(((citationPositionRow?.top3Citations ?? 0) / positionedCitations) * 1000) / 10
        : null,
    positionedCitations,
  };

  // Model × source-type mix: per model, share of citations by source category.
  const mixRows = await db
    .select({
      model: promptRunsTable.model,
      domainType: citationsTable.domainType,
      retrievals: sql<number>`count(*)::int`,
    })
    .from(citationsTable)
    .innerJoin(promptRunsTable, eq(promptRunsTable.id, citationsTable.runId))
    .innerJoin(promptsTable, eq(promptsTable.id, promptRunsTable.promptId))
    .innerJoin(companiesTable, eq(companiesTable.id, promptsTable.companyId))
    .where(verifiedCitationFilter)
    .groupBy(promptRunsTable.model, citationsTable.domainType)
    .orderBy(sql`count(*) desc`);
  const mixByModel = new Map<string, { domainType: string; retrievals: number }[]>();
  for (const r of mixRows) {
    const list = mixByModel.get(r.model) ?? [];
    list.push({ domainType: r.domainType, retrievals: r.retrievals });
    mixByModel.set(r.model, list);
  }
  const modelSourceMix = Array.from(mixByModel.entries()).map(([model, rows]) => {
    const total = rows.reduce((s, r) => s + r.retrievals, 0);
    return {
      model,
      totalRetrievals: total,
      mix: rows.map((r) => ({
        domainType: r.domainType,
        retrievals: r.retrievals,
        sharePct: total > 0 ? Math.round((r.retrievals / total) * 1000) / 10 : 0,
      })),
    };
  }).sort((a, b) => b.totalRetrievals - a.totalRetrievals);

  // Top cited URLs (page-level) where URL data exists.
  const topUrlRows = await db
    .select({
      url: citationsTable.url,
      domain: citationsTable.domain,
      retrievals: sql<number>`count(*)::int`,
      avgPosition: sql<number | null>`avg(${citationsTable.position})`,
      modelCount: sql<number>`count(distinct ${promptRunsTable.model})::int`,
    })
    .from(citationsTable)
    .innerJoin(promptRunsTable, eq(promptRunsTable.id, citationsTable.runId))
    .innerJoin(promptsTable, eq(promptsTable.id, promptRunsTable.promptId))
    .innerJoin(companiesTable, eq(companiesTable.id, promptsTable.companyId))
    .where(and(verifiedCitationFilter, sql`${citationsTable.url} is not null`))
    .groupBy(citationsTable.url, citationsTable.domain)
    .orderBy(sql`count(*) desc`)
    .limit(15);

  // Daily trend of runs and retrievals over the selected window.
  const trendRows = await db
    .select({
      date: sql<string>`to_char(date_trunc('day', ${promptRunsTable.createdAt}), 'YYYY-MM-DD')`,
      runs: sql<number>`count(distinct ${promptRunsTable.id})::int`,
      retrievals: sql<number>`count(${citationsTable.id})::int`,
      mentions: sql<number>`count(distinct ${promptRunsTable.id}) filter (where ${promptRunsTable.brandMentioned})::int`,
      eligibleRuns: sql<number>`count(distinct ${promptRunsTable.id}) filter (where ${promptRunsTable.citationEligible} is true)::int`,
    })
    .from(promptRunsTable)
    .leftJoin(
      citationsTable,
      and(
        eq(citationsTable.runId, promptRunsTable.id),
        eq(citationsTable.provenance, "provider"),
        sql`${promptRunsTable.citationEligible} is true`,
      ),
    )
    .innerJoin(promptsTable, eq(promptsTable.id, promptRunsTable.promptId))
    .innerJoin(companiesTable, eq(companiesTable.id, promptsTable.companyId))
    .where(runFilter)
    .groupBy(sql`date_trunc('day', ${promptRunsTable.createdAt})`)
    .orderBy(sql`date_trunc('day', ${promptRunsTable.createdAt})`);
  const brandPositionTrendRows = await db
    .select({
      date: sql<string>`to_char(date_trunc('day', ${promptRunsTable.createdAt}), 'YYYY-MM-DD')`,
      avgBrandPosition: sql<number | null>`avg(${promptRunsTable.brandPosition}) filter (where ${promptRunsTable.brandMentioned} and ${promptRunsTable.brandPosition} is not null)`,
    })
    .from(promptRunsTable)
    .innerJoin(promptsTable, eq(promptsTable.id, promptRunsTable.promptId))
    .innerJoin(companiesTable, eq(companiesTable.id, promptsTable.companyId))
    .where(runFilter)
    .groupBy(sql`date_trunc('day', ${promptRunsTable.createdAt})`)
    .orderBy(sql`date_trunc('day', ${promptRunsTable.createdAt})`);
  const brandPositionTrend = new Map(
    brandPositionTrendRows.map((row) => [row.date, row.avgBrandPosition]),
  );

  // Per-model behavior across all companies.
  const modelRows = await db
    .select({
      model: promptRunsTable.model,
      runCount: sql<number>`count(*)::int`,
      mentionCount: sql<number>`count(*) filter (where ${promptRunsTable.brandMentioned})::int`,
      eligibleCount: sql<number>`count(*) filter (where ${promptRunsTable.citationEligible} is true)::int`,
      legacyCount: sql<number>`count(*) filter (where ${promptRunsTable.citationEligible} is null)::int`,
      // Verified-citation average: provider-provenance citations over
      // confirmed citation-eligible runs only (legacy excluded).
      avgCitations: sql<number | null>`avg((select count(*) from citations c where c.run_id = ${promptRunsTable.id} and c.provenance = 'provider')) filter (where ${promptRunsTable.citationEligible} is true)`,
    })
    .from(promptRunsTable)
    .innerJoin(promptsTable, eq(promptsTable.id, promptRunsTable.promptId))
    .innerJoin(companiesTable, eq(companiesTable.id, promptsTable.companyId))
    .where(runFilter)
    .groupBy(promptRunsTable.model)
    .orderBy(sql`count(*) desc`);
  const models = modelRows.map((m) => {
    const reg = getModel(m.model);
    return {
      model: m.model,
      label: reg?.label ?? m.model,
      provider: reg?.provider ?? null,
      supportsSearch: reg?.supportsSearch ?? null,
      runCount: m.runCount,
      citationEligibleRuns: m.eligibleCount,
      legacyRuns: m.legacyCount,
      mentionRatePct:
        m.runCount > 0 ? Math.round((m.mentionCount / m.runCount) * 1000) / 10 : null,
      avgCitations:
        m.avgCitations !== null ? Math.round(Number(m.avgCitations) * 10) / 10 : null,
    };
  });

  // Topic landscape across companies.
  const topicRows = await db
    .select({
      topic: promptsTable.topic,
      promptCount: sql<number>`count(distinct ${promptsTable.id})::int`,
      companies: sql<number>`count(distinct ${promptsTable.companyId})::int`,
      runCount: sql<number>`count(${promptRunsTable.id})::int`,
      mentionCount: sql<number>`count(${promptRunsTable.id}) filter (where ${promptRunsTable.brandMentioned})::int`,
    })
    .from(promptsTable)
    .innerJoin(companiesTable, eq(companiesTable.id, promptsTable.companyId))
    .innerJoin(promptRunsTable, and(
      eq(promptRunsTable.promptId, promptsTable.id),
      allHistory ? undefined : gte(promptRunsTable.createdAt, cutoff),
      model ? eq(promptRunsTable.model, model) : undefined,
    ))
    .where(companyFilter)
    .groupBy(promptsTable.topic)
    .orderBy(sql`count(distinct ${promptsTable.id}) desc`);
  const topics = topicRows.map((t) => ({
    topic: t.topic,
    promptCount: t.promptCount,
    runCount: t.runCount,
    companies: t.companies,
    mentionRatePct:
      t.runCount > 0 ? Math.round((t.mentionCount / t.runCount) * 1000) / 10 : null,
  }));

  res.json({
    days: allHistory ? 0 : days,
    model: model ?? null,
    windowStartUtc: windowStart.toISOString(),
    totals,
    companies: companySummaries,
    domainTypes,
    topDomains: topDomainRows.map((d) => ({
      domain: d.domain,
      retrievals: d.retrievals,
      companiesCitedFor: d.companiesCitedFor,
      domainTypes: d.domainTypes,
      avgPosition:
        d.avgPosition !== null ? Math.round(Number(d.avgPosition) * 10) / 10 : null,
      modelCount: d.modelCount,
    })),
    models,
    topics,
    concentration,
    modelSourceMix,
    topUrls: topUrlRows.map((u) => ({
      url: u.url as string,
      domain: u.domain,
      retrievals: u.retrievals,
      avgPosition:
        u.avgPosition !== null ? Math.round(Number(u.avgPosition) * 10) / 10 : null,
      modelCount: u.modelCount,
    })),
    quality,
    trend: trendRows.map((row) => ({
      ...row,
      visibilityPct:
        row.runs > 0 ? Math.round((row.mentions / row.runs) * 1000) / 10 : null,
      citationsPerEligibleRun:
        row.eligibleRuns > 0 ? Math.round((row.retrievals / row.eligibleRuns) * 10) / 10 : null,
      avgBrandPosition:
        brandPositionTrend.get(row.date) != null
          ? Math.round(Number(brandPositionTrend.get(row.date)) * 10) / 10
          : null,
    })),
  });
});

export default router;
