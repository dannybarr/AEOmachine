import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { getRegistry, getRegistryValidatedAt, enabledModelIds } from "../lib/modelRegistry";
import { getCompany } from "../lib/companyLookup";
import { utcWindowStart } from "../lib/timeWindow";
import {
  startContractAudit,
  latestContractAudit,
  AuditAlreadyRunningError,
  AuditNotConfiguredError,
  AuditCooldownError,
} from "../lib/contractAudit";
import { requireOperator } from "../lib/operatorAuth";

const router: IRouter = Router();

/**
 * Canonical model registry: the single source of truth for every model
 * selector, filter, and label in the product. Unavailable models are
 * included with an explicit reason — never silently dropped.
 */
router.get("/models", (_req, res) => {
  res.json(
    getRegistry().map((m) => ({
      id: m.id,
      label: m.label,
      provider: m.provider,
      family: m.family,
      version: m.version,
      supportsSearch: m.supportsSearch,
      available: m.available,
      unavailableReason: m.available ? null : m.unavailableReason,
      order: m.order,
    })),
  );
});

/**
 * In-product methodology: the active registry snapshot, coverage and sample
 * sizes for the selected window, and how denominators are computed — so
 * every dashboard number is auditable.
 */
router.get("/methodology", async (req, res): Promise<void> => {
  const companyId = Number(req.query["companyId"]);
  const company = Number.isFinite(companyId) ? await getCompany(companyId) : null;
  const days = Math.min(Math.max(Number(req.query["days"]) || 30, 1), 365);
  // Shared UTC calendar window — identical semantics everywhere.
  const cutoff = utcWindowStart(days);

  const companyFilter = company
    ? sql`and p.company_id = ${company.id}`
    : sql``;

  const [runRow] = (
    await db.execute(sql`
      SELECT
        count(*)::int AS total,
        count(*) filter (where pr.citation_eligible is true)::int AS eligible,
        count(*) filter (where pr.citation_eligible is false)::int AS ineligible,
        count(*) filter (where pr.citation_eligible is null)::int AS legacy,
        count(*) filter (where pr.search_status = 'provider_cited')::int AS provider_cited,
        count(*) filter (where pr.search_status = 'search_no_citations')::int AS search_no_citations,
        count(*) filter (where pr.search_status = 'extraction_failed')::int AS extraction_failed,
        count(*) filter (where pr.search_status = 'tool_rejected')::int AS tool_rejected,
        count(*) filter (where pr.search_status = 'unsupported')::int AS answer_only,
        count(*) filter (where pr.search_status = 'provider_search')::int AS legacy_search
      FROM prompt_runs pr JOIN prompts p ON p.id = pr.prompt_id
      WHERE pr.created_at >= ${cutoff.toISOString()}::timestamptz ${companyFilter}
    `)
  ).rows as Array<Record<string, number>>;

  const [citRow] = (
    await db.execute(sql`
      SELECT
        count(*)::int AS total,
        count(*) filter (where c.provenance = 'provider' and pr.citation_eligible is true)::int AS verified,
        count(*) filter (where c.provenance is null)::int AS legacy
      FROM citations c
      JOIN prompt_runs pr ON pr.id = c.run_id
      JOIN prompts p ON p.id = pr.prompt_id
      WHERE pr.created_at >= ${cutoff.toISOString()}::timestamptz ${companyFilter}
    `)
  ).rows as Array<Record<string, number>>;

  const [attemptRow] = (
    await db.execute(sql`
      SELECT
        count(*)::int AS total,
        count(*) filter (where a.outcome = 'failed')::int AS failed
      FROM run_attempts a JOIN prompts p ON p.id = a.prompt_id
      WHERE a.created_at >= ${cutoff.toISOString()}::timestamptz ${companyFilter}
    `)
  ).rows as Array<Record<string, number>>;

  const [promptRow] = (
    await db.execute(sql`
      SELECT count(*)::int AS total, count(*) filter (where p.active)::int AS active
      FROM prompts p WHERE true ${companyFilter}
    `)
  ).rows as Array<Record<string, number>>;

  const registry = getRegistry();
  res.json({
    days,
    windowStartUtc: cutoff.toISOString(),
    registry: registry.map((m) => ({
      id: m.id,
      label: m.label,
      provider: m.provider,
      supportsSearch: m.supportsSearch,
      available: m.available,
      unavailableReason: m.available ? null : m.unavailableReason,
    })),
    registryValidatedAt: getRegistryValidatedAt(),
    enabledModelCount: enabledModelIds().length,
    prompts: { total: promptRow?.["total"] ?? 0, active: promptRow?.["active"] ?? 0 },
    runs: {
      total: runRow?.["total"] ?? 0,
      citationEligible: runRow?.["eligible"] ?? 0,
      searchIneligible: runRow?.["ineligible"] ?? 0,
      legacy: runRow?.["legacy"] ?? 0,
      outcomes: {
        providerCited: runRow?.["provider_cited"] ?? 0,
        searchNoCitations: runRow?.["search_no_citations"] ?? 0,
        extractionFailed: runRow?.["extraction_failed"] ?? 0,
        toolRejected: runRow?.["tool_rejected"] ?? 0,
        answerOnly: runRow?.["answer_only"] ?? 0,
        legacySearch: runRow?.["legacy_search"] ?? 0,
      },
    },
    citations: {
      total: citRow?.["total"] ?? 0,
      verified: citRow?.["verified"] ?? 0,
      legacy: citRow?.["legacy"] ?? 0,
    },
    attempts: {
      total: attemptRow?.["total"] ?? 0,
      failed: attemptRow?.["failed"] ?? 0,
    },
  });
});

/**
 * Operator diagnostics: per-model citation quality over stored runs.
 * Surfaces zero-citation search runs, extraction failures, tool rejections,
 * and verified citation yield so provider drift is visible — computed from
 * persisted run/citation provenance, never fabricated.
 */
router.get("/models/citation-quality", async (req, res): Promise<void> => {
  const companyId = Number(req.query["companyId"]);
  const company = Number.isFinite(companyId) ? await getCompany(companyId) : null;
  const days = Math.min(Math.max(Number(req.query["days"]) || 30, 1), 365);
  const cutoff = utcWindowStart(days);
  const companyFilter = company ? sql`and p.company_id = ${company.id}` : sql``;

  const rows = (
    await db.execute(sql`
      SELECT
        pr.model,
        count(*)::int AS runs,
        count(*) filter (where pr.search_status = 'provider_cited')::int AS provider_cited,
        count(*) filter (where pr.search_status = 'search_no_citations')::int AS search_no_citations,
        count(*) filter (where pr.search_status = 'extraction_failed')::int AS extraction_failed,
        count(*) filter (where pr.search_status = 'tool_rejected')::int AS tool_rejected,
        count(*) filter (where pr.search_status = 'unsupported')::int AS answer_only,
        count(*) filter (where pr.search_status = 'provider_search')::int AS legacy_search,
        count(*) filter (where pr.search_status is null)::int AS legacy,
        count(*) filter (where pr.citation_eligible is true)::int AS citation_eligible_runs,
        coalesce(sum((SELECT count(*) FROM citations c WHERE c.run_id = pr.id AND c.provenance = 'provider')) filter (where pr.citation_eligible is true), 0)::int AS verified_citations,
        count(*) filter (
          where pr.citation_eligible is true
            and not exists (SELECT 1 FROM citations c WHERE c.run_id = pr.id AND c.provenance = 'provider')
        )::int AS zero_citation_eligible_runs,
        max(pr.created_at) AS last_run_at
      FROM prompt_runs pr JOIN prompts p ON p.id = pr.prompt_id
      WHERE pr.created_at >= ${cutoff.toISOString()}::timestamptz ${companyFilter}
      GROUP BY pr.model
    `)
  ).rows as Array<Record<string, unknown>>;

  const registry = getRegistry();
  const byModel = new Map(rows.map((r) => [r["model"] as string, r]));
  const known = registry.map((m) => {
    const r = byModel.get(m.id);
    byModel.delete(m.id);
    return { meta: m, row: r ?? null };
  });
  const toEntry = (
    model: string,
    meta: (typeof registry)[number] | null,
    r: Record<string, unknown> | null,
  ) => ({
    model,
    label: meta?.label ?? model,
    provider: meta?.provider ?? null,
    supportsSearch: meta?.supportsSearch ?? null,
    available: meta?.available ?? false,
    unavailableReason: meta && !meta.available ? meta.unavailableReason : null,
    inRegistry: Boolean(meta),
    runs: Number(r?.["runs"] ?? 0),
    outcomes: {
      providerCited: Number(r?.["provider_cited"] ?? 0),
      searchNoCitations: Number(r?.["search_no_citations"] ?? 0),
      extractionFailed: Number(r?.["extraction_failed"] ?? 0),
      toolRejected: Number(r?.["tool_rejected"] ?? 0),
      answerOnly: Number(r?.["answer_only"] ?? 0),
      legacySearch: Number(r?.["legacy_search"] ?? 0),
      legacy: Number(r?.["legacy"] ?? 0),
    },
    citationEligibleRuns: Number(r?.["citation_eligible_runs"] ?? 0),
    verifiedCitations: Number(r?.["verified_citations"] ?? 0),
    zeroCitationEligibleRuns: Number(r?.["zero_citation_eligible_runs"] ?? 0),
    lastRunAt: r?.["last_run_at"] ? new Date(r["last_run_at"] as string).toISOString() : null,
  });
  res.json({
    days,
    windowStartUtc: cutoff.toISOString(),
    models: [
      ...known.map(({ meta, row }) => toEntry(meta.id, meta, row)),
      // Stored runs from models no longer in the registry stay visible.
      ...[...byModel.entries()].map(([model, row]) => toEntry(model, null, row)),
    ],
  });
});

/**
 * Live provider contract audit: run one neutral citation-seeking prompt
 * against every registry model and report sanitized per-model quality.
 * Returns 202 with the running report; poll GET /models/contract-audit.
 */
router.post("/models/contract-audit", requireOperator, async (_req, res): Promise<void> => {
  try {
    res.status(202).json(await startContractAudit());
  } catch (err) {
    if (err instanceof AuditAlreadyRunningError) {
      res.status(409).json({ error: err.message });
      return;
    }
    if (err instanceof AuditCooldownError) {
      res.status(429).json({ error: err.message, lastStartedAt: err.lastStartedAt });
      return;
    }
    if (err instanceof AuditNotConfiguredError) {
      res.status(503).json({ error: err.message });
      return;
    }
    throw err;
  }
});

router.get("/models/contract-audit", requireOperator, (_req, res) => {
  const report = latestContractAudit();
  if (!report) {
    res.status(404).json({ error: "No contract audit has been run yet. POST /models/contract-audit to start one." });
    return;
  }
  res.json(report);
});

export default router;
