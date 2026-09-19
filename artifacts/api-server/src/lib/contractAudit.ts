/**
 * Repeatable live provider contract audit.
 *
 * Runs one neutral, citation-seeking prompt against every registry model
 * (available ones live; unavailable ones reported as such) and produces a
 * sanitized per-model quality report: completion, search/tool behavior,
 * verified citation count, extraction diagnostics (unknown metadata shapes),
 * URL resolution checks, timing, and failure reasons. Nothing is persisted
 * to research tables and nothing is fabricated — this is pure diagnostics.
 *
 * The audit runs asynchronously (bounded concurrency) and is polled via
 * GET /models/contract-audit; the report is also logged as structured JSON.
 */
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { getRegistry, type RegistryView } from "./modelRegistry";
import { runSimulation, isConfigured } from "./simulate";
import { safeFetch } from "./safeFetch";
import { logger } from "./logger";

export const AUDIT_PROMPT =
  "What are the most reliable sources for comparing current savings account interest rates? Cite the specific websites you used.";

const MODEL_CONCURRENCY = 2;
const URL_CHECKS_PER_MODEL = 5;
const URL_CHECK_TIMEOUT_MS = 6_000;

export interface ModelAuditResult {
  model: string;
  provider: string;
  label: string;
  supportsSearch: boolean;
  extraction: string;
  outcome: "completed" | "failed" | "unavailable";
  unavailableReason: string | null;
  searchStatus: string | null;
  citationEligible: boolean | null;
  answerChars: number;
  citationCount: number;
  sampleDomains: string[];
  /** Verified citation URLs probed with a live request. */
  urlsChecked: number;
  /** Probed URLs that answered with HTTP < 400. */
  urlsOk: number;
  diagnostics: {
    metadataEvents: number;
    invalidUrls: number;
    unknownAnnotationTypes: string[];
    unknownShapes: number;
    redirectsResolved: number;
    redirectsFailed: number;
  } | null;
  durationMs: number | null;
  /** Sanitized failure reason (no payloads, no secrets). */
  error: string | null;
}

export interface ContractAuditReport {
  id: number;
  status: "running" | "completed" | "failed";
  prompt: string;
  startedAt: string;
  finishedAt: string | null;
  totalModels: number;
  completedModels: number;
  results: ModelAuditResult[];
  error: string | null;
}

let auditSeq = 0;
let current: ContractAuditReport | null = null;

export function latestContractAudit(): ContractAuditReport | null {
  return current;
}

export function isAuditRunning(): boolean {
  return current?.status === "running";
}

function sanitizeError(err: unknown): string {
  const status = (err as { status?: number }).status;
  const message = err instanceof Error ? err.message : String(err);
  // Strip anything resembling a bearer token before logging/reporting.
  const cleaned = message.replace(/(Bearer\s+)[A-Za-z0-9._-]+/gi, "$1[redacted]").slice(0, 300);
  return status !== undefined ? `HTTP ${status}: ${cleaned}` : cleaned;
}

async function checkUrls(urls: string[]): Promise<{ checked: number; ok: number }> {
  let ok = 0;
  const targets = urls.slice(0, URL_CHECKS_PER_MODEL);
  await Promise.all(
    targets.map(async (url) => {
      try {
        const { res } = await safeFetch(url, {
          method: "GET",
          signal: AbortSignal.timeout(URL_CHECK_TIMEOUT_MS),
        });
        await res.body?.cancel();
        if (res.status < 400) ok += 1;
      } catch {
        // unreachable / SSRF-blocked / timeout — simply not ok
      }
    }),
  );
  return { checked: targets.length, ok };
}

async function auditModel(m: RegistryView): Promise<ModelAuditResult> {
  const base: ModelAuditResult = {
    model: m.id,
    provider: m.provider,
    label: m.label,
    supportsSearch: m.supportsSearch,
    extraction: m.extraction,
    outcome: "failed",
    unavailableReason: null,
    searchStatus: null,
    citationEligible: null,
    answerChars: 0,
    citationCount: 0,
    sampleDomains: [],
    urlsChecked: 0,
    urlsOk: 0,
    diagnostics: null,
    durationMs: null,
    error: null,
  };
  if (!m.available) {
    return { ...base, outcome: "unavailable", unavailableReason: m.unavailableReason };
  }
  try {
    const sim = await runSimulation(AUDIT_PROMPT, m.id);
    const urls = sim.sources.map((s) => s.url).filter((u): u is string => Boolean(u));
    const { checked, ok } = await checkUrls(urls);
    return {
      ...base,
      outcome: "completed",
      searchStatus: sim.searchStatus,
      citationEligible: sim.citationEligible,
      answerChars: sim.answerText.length,
      citationCount: sim.sources.length,
      sampleDomains: [...new Set(sim.sources.map((s) => s.domain))].slice(0, 5),
      urlsChecked: checked,
      urlsOk: ok,
      diagnostics: {
        metadataEvents: sim.diagnostics.metadataEvents,
        invalidUrls: sim.diagnostics.invalidUrls,
        unknownAnnotationTypes: sim.diagnostics.unknownAnnotationTypes,
        unknownShapes: sim.diagnostics.unknownShapes,
        redirectsResolved: sim.diagnostics.redirectsResolved,
        redirectsFailed: sim.diagnostics.redirectsFailed,
      },
      durationMs: sim.durationMs,
    };
  } catch (err) {
    return { ...base, outcome: "failed", error: sanitizeError(err) };
  }
}

/** Minimum interval between audit starts — durable across restarts. */
export const AUDIT_COOLDOWN_MINUTES = 10;

export class AuditCooldownError extends Error {
  constructor(public readonly lastStartedAt: string) {
    super(
      `A contract audit was started at ${lastStartedAt}; wait ${AUDIT_COOLDOWN_MINUTES} minutes between audits`,
    );
    this.name = "AuditCooldownError";
  }
}

/**
 * Atomically claim the audit slot in the database. Returns true when this
 * caller may start an audit; false when the durable cooldown is still
 * active. Concurrency-safe: the conditional upsert updates the single state
 * row only when the previous start is old enough, so two racing callers can
 * never both claim it.
 */
export async function claimAuditSlot(): Promise<{ claimed: boolean; lastStartedAt: string | null }> {
  const result = await db.execute(sql`
    INSERT INTO contract_audit_state (id, last_started_at) VALUES (1, now())
    ON CONFLICT (id) DO UPDATE SET last_started_at = now()
    WHERE contract_audit_state.last_started_at <= now() - make_interval(mins => ${AUDIT_COOLDOWN_MINUTES})
    RETURNING last_started_at
  `);
  if (result.rows.length > 0) return { claimed: true, lastStartedAt: null };
  const state = await db.execute(sql`SELECT last_started_at FROM contract_audit_state WHERE id = 1`);
  const last = state.rows[0]?.["last_started_at"];
  return { claimed: false, lastStartedAt: last ? new Date(last as string).toISOString() : null };
}

export class AuditAlreadyRunningError extends Error {
  constructor() {
    super("A contract audit is already running");
    this.name = "AuditAlreadyRunningError";
  }
}

export class AuditNotConfiguredError extends Error {
  constructor() {
    super("Model gateway is not configured (missing API key)");
    this.name = "AuditNotConfiguredError";
  }
}

/**
 * Start a contract audit. Returns the running report immediately; work
 * continues in the background with per-model progress counters.
 */
export async function startContractAudit(): Promise<ContractAuditReport> {
  if (isAuditRunning()) throw new AuditAlreadyRunningError();
  if (!isConfigured()) throw new AuditNotConfiguredError();
  // Durable cost control: at most one audit start per cooldown window,
  // enforced in the database so it survives restarts.
  const slot = await claimAuditSlot();
  if (!slot.claimed) throw new AuditCooldownError(slot.lastStartedAt ?? "unknown");
  const models = getRegistry();
  const report: ContractAuditReport = {
    id: ++auditSeq,
    status: "running",
    prompt: AUDIT_PROMPT,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    totalModels: models.length,
    completedModels: 0,
    results: [],
    error: null,
  };
  current = report;
  void runAudit(report, models);
  return report;
}

async function runAudit(report: ContractAuditReport, models: RegistryView[]): Promise<void> {
  try {
    const queue = [...models];
    const worker = async (): Promise<void> => {
      for (;;) {
        const m = queue.shift();
        if (!m) return;
        const result = await auditModel(m);
        report.results.push(result);
        report.completedModels += 1;
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(MODEL_CONCURRENCY, models.length) }, worker),
    );
    // Stable registry order in the final report.
    const order = new Map(models.map((m, i) => [m.id, i]));
    report.results.sort((a, b) => (order.get(a.model) ?? 99) - (order.get(b.model) ?? 99));
    report.status = "completed";
    report.finishedAt = new Date().toISOString();
    logger.info(
      {
        auditId: report.id,
        models: report.results.map((r) => ({
          model: r.model,
          outcome: r.outcome,
          searchStatus: r.searchStatus,
          citations: r.citationCount,
          urlsOk: `${r.urlsOk}/${r.urlsChecked}`,
          unknownTypes: r.diagnostics?.unknownAnnotationTypes ?? [],
          unknownShapes: r.diagnostics?.unknownShapes ?? 0,
          error: r.error,
        })),
      },
      "Citation contract audit finished",
    );
  } catch (err) {
    report.status = "failed";
    report.error = sanitizeError(err);
    report.finishedAt = new Date().toISOString();
    logger.error({ err, auditId: report.id }, "Citation contract audit failed");
  }
}
