import {
  pgTable,
  serial,
  integer,
  real,
  text,
  boolean,
  timestamp,
  jsonb,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";
import { promptsTable } from "./prompts";
import { strategyItemsTable } from "./strategy";

/**
 * One Gap Analysis research job: starts from eligible stored prompt runs,
 * fetches cited source pages, and produces an immutable snapshot of findings
 * and trends. Returned immediately in "running" state; clients poll.
 */
export const gapResearchJobsTable = pgTable("gap_research_jobs", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id")
    .notNull()
    .references(() => companiesTable.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("running"), // running | completed | failed
  phase: text("phase").notNull().default("collecting"), // collecting | fetching | analyzing | done
  windowDays: integer("window_days").notNull().default(30),
  analysisVersion: integer("analysis_version").notNull().default(1),
  companyContextSnapshot: jsonb("company_context_snapshot"),
  // Denominators for the methodology panel — every metric reconciles to these.
  eligibleRunCount: integer("eligible_run_count").notNull().default(0),
  ineligibleRunCount: integer("ineligible_run_count").notNull().default(0),
  gapPromptCount: integer("gap_prompt_count").notNull().default(0),
  totalSources: integer("total_sources").notNull().default(0),
  fetchedSources: integer("fetched_sources").notNull().default(0),
  failedSources: integer("failed_sources").notNull().default(0),
  cachedSources: integer("cached_sources").notNull().default(0),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export type GapResearchJob = typeof gapResearchJobsTable.$inferSelect;

/**
 * Company-scoped fetch cache of cited source pages, keyed by canonical URL.
 * Fetch outcomes are recorded honestly (ok, http_error, timeout, blocked,
 * unreachable) — a failed fetch is visible, never silently dropped.
 */
export const gapSourcePagesTable = pgTable(
  "gap_source_pages",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    canonicalUrl: text("canonical_url").notNull(),
    domain: text("domain").notNull(),
    fetchStatus: text("fetch_status").notNull(), // ok | http_error | timeout | blocked | unreachable
    httpStatus: integer("http_status"),
    finalUrl: text("final_url"),
    title: text("title"),
    snippet: text("snippet"),
    // Deterministic page signals extracted from fetched HTML:
    // { isComparison, isListicle, isReview, headingSample }
    pageSignals: jsonb("page_signals"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique("gap_source_pages_company_url_unique").on(t.companyId, t.canonicalUrl)],
);

export type GapSourcePage = typeof gapSourcePagesTable.$inferSelect;

/**
 * Per-prompt finding within one research job snapshot. Prompt text/topic are
 * copied so historical findings stay understandable after prompt edits.
 */
export const gapFindingsTable = pgTable("gap_findings", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id")
    .notNull()
    .references(() => gapResearchJobsTable.id, { onDelete: "cascade" }),
  companyId: integer("company_id")
    .notNull()
    .references(() => companiesTable.id, { onDelete: "cascade" }),
  promptId: integer("prompt_id")
    .notNull()
    .references(() => promptsTable.id, { onDelete: "cascade" }),
  promptText: text("prompt_text").notNull(),
  topic: text("topic").notNull(),
  gapType: text("gap_type").notNull(), // full | partial
  runCount: integer("run_count").notNull().default(0),
  eligibleRunCount: integer("eligible_run_count").notNull().default(0),
  mentionCount: integer("mention_count").notNull().default(0),
  citationCount: integer("citation_count").notNull().default(0),
  // [{ model, runs, mentioned, citationsEligible }]
  modelCoverage: jsonb("model_coverage").notNull(),
  // Competitor brands observed in answer text: [{ domain, name, runsSurfaced }]
  competitors: jsonb("competitors").notNull(),
  // Deterministic recommendation built only from stored evidence:
  // { status: proposed|insufficient, category, playType, title, rationale, evidenceUrls }
  recommendation: jsonb("recommendation").notNull(),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type GapFinding = typeof gapFindingsTable.$inferSelect;

/**
 * One observed source (canonical URL) supporting a finding, with exact
 * citation frequency/position, models, recency, and answer context.
 */
export const gapEvidenceTable = pgTable("gap_evidence", {
  id: serial("id").primaryKey(),
  findingId: integer("finding_id")
    .notNull()
    .references(() => gapFindingsTable.id, { onDelete: "cascade" }),
  sourcePageId: integer("source_page_id").references(() => gapSourcePagesTable.id, {
    onDelete: "set null",
  }),
  canonicalUrl: text("canonical_url").notNull(),
  domain: text("domain").notNull(),
  channel: text("channel").notNull(), // competitor_owned | editorial | ugc | review_listicle | reference | brand_owned | other
  isCompetitor: boolean("is_competitor").notNull().default(false),
  citationCount: integer("citation_count").notNull().default(0),
  runCount: integer("run_count").notNull().default(0),
  avgPosition: real("avg_position"),
  bestPosition: integer("best_position"),
  models: jsonb("models").notNull(), // string[]
  runIds: jsonb("run_ids").notNull(), // number[] — provenance back to exact runs
  answerContext: text("answer_context"), // excerpt of an answer referencing this source's brand/domain
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  // Immutable snapshot of the page evidence as observed by THIS job.
  // gap_source_pages is a mutable freshness cache that later runs upsert;
  // reports must read these fields so a refetch can never rewrite history.
  pageFetchStatus: text("page_fetch_status"), // ok | http_error | timeout | blocked | unreachable | null (not fetched)
  pageHttpStatus: integer("page_http_status"),
  pageTitle: text("page_title"),
  pageSnippet: text("page_snippet"),
  pageSignals: jsonb("page_signals"), // PageSignals as observed at analysis time
  pageFetchedAt: timestamp("page_fetched_at", { withTimezone: true }),
});

export type GapEvidence = typeof gapEvidenceTable.$inferSelect;

/**
 * Cross-prompt trend finding in a job snapshot. `observation` is a
 * deterministic fact with explicit sample sizes; `hypothesis` uses calibrated
 * language and is clearly separated; contradictory evidence is attached.
 */
export const gapTrendsTable = pgTable("gap_trends", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id")
    .notNull()
    .references(() => gapResearchJobsTable.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // domain_dominance | channel_pattern | competitor_presence
  title: text("title").notNull(),
  observation: text("observation").notNull(),
  hypothesis: text("hypothesis"),
  contradictoryEvidence: text("contradictory_evidence"),
  confidence: text("confidence").notNull(), // insufficient | weak | moderate | strong
  sampleSize: integer("sample_size").notNull().default(0),
  promptIds: jsonb("prompt_ids").notNull(), // number[]
  domain: text("domain"),
  channel: text("channel"),
  // [{ url, domain, channel, citations }]
  evidence: jsonb("evidence").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type GapTrend = typeof gapTrendsTable.$inferSelect;

/**
 * Provenance link between a promoted strategy item and the research finding
 * it came from. The evidence snapshot keeps the rationale auditable even if
 * the research snapshot is later superseded. Unique finding_id prevents
 * duplicate promotion.
 */
export const gapActionProvenanceTable = pgTable(
  "gap_action_provenance",
  {
    id: serial("id").primaryKey(),
    strategyItemId: integer("strategy_item_id")
      .notNull()
      .references(() => strategyItemsTable.id, { onDelete: "cascade" }),
    findingId: integer("finding_id")
      .notNull()
      .references(() => gapFindingsTable.id, { onDelete: "cascade" }),
    jobId: integer("job_id")
      .notNull()
      .references(() => gapResearchJobsTable.id, { onDelete: "cascade" }),
    promptId: integer("prompt_id").notNull(),
    // { promptText, topic, category, evidenceUrls, runIds, rationale }
    evidenceSnapshot: jsonb("evidence_snapshot").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("gap_action_provenance_finding_unique").on(t.findingId)],
);

export type GapActionProvenance = typeof gapActionProvenanceTable.$inferSelect;
