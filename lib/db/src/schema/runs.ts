import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { promptsTable } from "./prompts";

export const promptRunsTable = pgTable(
  "prompt_runs",
  {
    id: serial("id").primaryKey(),
    promptId: integer("prompt_id")
      .notNull()
      .references(() => promptsTable.id, { onDelete: "cascade" }),
    model: text("model").notNull(),
    answerText: text("answer_text").notNull(),
    brandMentioned: boolean("brand_mentioned").notNull().default(false),
    brandPosition: integer("brand_position"),
    /**
     * Visibility ladder for the tracked brand on this run:
     * recommended | cited | mentioned | absent. NULL = legacy (unscored).
     */
    visibilityRung: text("visibility_rung"),
    /** provider_search | unsupported | tool_rejected; NULL = legacy (unknown). */
    searchStatus: text("search_status"),
    /** Whether this run could produce verified citations; NULL = legacy. */
    citationEligible: boolean("citation_eligible"),
    /**
     * Structured citation-extraction diagnostics (metadata events, invalid
     * URLs, unknown shapes/annotation types, redirect resolution). NULL = legacy.
     */
    citationDiagnostics: jsonb("citation_diagnostics"),
    /** Durable background answer-entity extraction queue state. */
    entityExtractionStatus: text("entity_extraction_status"),
    entityExtractorVersion: text("entity_extractor_version"),
    entityExtractionAttempts: integer("entity_extraction_attempts").notNull().default(0),
    entityExtractionError: text("entity_extraction_error"),
    entityExtractionStartedAt: timestamp("entity_extraction_started_at", {
      withTimezone: true,
    }),
    entityExtractionFinishedAt: timestamp("entity_extraction_finished_at", {
      withTimezone: true,
    }),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("prompt_runs_created_at_idx").on(t.createdAt),
    index("prompt_runs_model_created_at_idx").on(t.model, t.createdAt),
    index("prompt_runs_prompt_id_idx").on(t.promptId),
    index("prompt_runs_entity_extraction_queue_idx").on(
      t.entityExtractionStatus,
      t.entityExtractorVersion,
      t.createdAt,
    ),
    check(
      "prompt_runs_entity_extraction_status_check",
      sql`${t.entityExtractionStatus} is null or ${t.entityExtractionStatus} in ('pending', 'running', 'completed', 'failed')`,
    ),
    check(
      "prompt_runs_visibility_rung_check",
      sql`${t.visibilityRung} is null or ${t.visibilityRung} in ('recommended', 'cited', 'mentioned', 'absent')`,
    ),
  ],
);

export type PromptRun = typeof promptRunsTable.$inferSelect;

export const runAnswerEntitiesTable = pgTable(
  "run_answer_entities",
  {
    id: serial("id").primaryKey(),
    runId: integer("run_id")
      .notNull()
      .references(() => promptRunsTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    relationship: text("relationship").notNull(),
    observedReason: text("observed_reason").notNull(),
    evidenceExcerpt: text("evidence_excerpt").notNull(),
    extractorVersion: text("extractor_version").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("run_answer_entities_run_name_version_unique").on(
      t.runId,
      t.normalizedName,
      t.extractorVersion,
    ),
    index("run_answer_entities_run_id_idx").on(t.runId),
    index("run_answer_entities_name_run_idx").on(t.normalizedName, t.runId),
    check(
      "run_answer_entities_relationship_check",
      sql`${t.relationship} in ('recommended', 'compared', 'mentioned', 'other')`,
    ),
  ],
);

export type RunAnswerEntity = typeof runAnswerEntitiesTable.$inferSelect;

export const citationsTable = pgTable(
  "citations",
  {
    id: serial("id").primaryKey(),
    runId: integer("run_id")
      .notNull()
      .references(() => promptRunsTable.id, { onDelete: "cascade" }),
    domain: text("domain").notNull(),
    url: text("url"),
    domainType: text("domain_type").notNull().default("other"),
    position: integer("position").notNull().default(1),
    /** "provider" = provider-returned metadata; NULL = legacy (unknown). */
    provenance: text("provenance"),
    /** Raw provider-returned citation metadata for auditability. */
    metadata: jsonb("metadata"),
  },
  (t) => [
    index("citations_run_id_idx").on(t.runId),
    index("citations_provenance_run_id_idx").on(t.provenance, t.runId),
  ],
);

export type Citation = typeof citationsTable.$inferSelect;

/**
 * Every simulation attempt, successful or not. Successes link to their
 * prompt_runs row; failures carry the error. prompt_runs itself only ever
 * holds real provider answers, so visibility/citation denominators are
 * never diluted by failures.
 */
export const runAttemptsTable = pgTable("run_attempts", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id"),
  promptId: integer("prompt_id")
    .notNull()
    .references(() => promptsTable.id, { onDelete: "cascade" }),
  model: text("model").notNull(),
  outcome: text("outcome").notNull(), // succeeded | failed
  error: text("error"),
  durationMs: integer("duration_ms"),
  runId: integer("run_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type RunAttempt = typeof runAttemptsTable.$inferSelect;
