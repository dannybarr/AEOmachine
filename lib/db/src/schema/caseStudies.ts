import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companiesTable } from "./companies";

/**
 * One evolving case study per company: the user-authored context (starting
 * position, strategic focus, notes) that anchors every generated narrative.
 * Generated wording lives in revisions — this row is only the durable,
 * user-owned framing.
 */
export const caseStudiesTable = pgTable(
  "case_studies",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    startingPosition: text("starting_position"),
    strategicFocus: text("strategic_focus"),
    contextNotes: text("context_notes"),
    contextUpdatedAt: timestamp("context_updated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("case_studies_company_unique").on(t.companyId)],
);

export type CaseStudy = typeof caseStudiesTable.$inferSelect;

/**
 * Dated, immutable story revisions. Revision 1 is the baseline; later
 * revisions never overwrite earlier ones, so the value story's development is
 * preserved. Each revision snapshots the evidence bundle (metrics window,
 * activity counts) it was generated from — later data changes cannot silently
 * rewrite the claimed basis of an existing narrative.
 */
export const caseStudyRevisionsTable = pgTable(
  "case_study_revisions",
  {
    id: serial("id").primaryKey(),
    caseStudyId: integer("case_study_id")
      .notNull()
      .references(() => caseStudiesTable.id, { onDelete: "cascade" }),
    companyId: integer("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    revisionNumber: integer("revision_number").notNull(),
    kind: text("kind").notNull(), // baseline | refresh
    /** Generated narrative — never mutated after insert. */
    narrative: text("narrative").notNull(),
    /** User-edited wording; null means the generated narrative stands. */
    editedNarrative: text("edited_narrative"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    /** Immutable evidence bundle this revision was generated from. */
    evidenceSnapshot: jsonb("evidence_snapshot").notNull(),
    /** Measurement period the narrative's claims cover (ISO dates). */
    periodStart: text("period_start"),
    periodEnd: text("period_end"),
    model: text("model"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("case_study_revisions_number_unique").on(
      t.caseStudyId,
      t.revisionNumber,
    ),
  ],
);

export type CaseStudyRevision = typeof caseStudyRevisionsTable.$inferSelect;

/**
 * Durable background narrative-refresh jobs (same pattern as tracking_jobs):
 * insert running → poll → completed/failed. A DB-level partial unique index
 * enforces one active job per company; boot cleanup marks orphans failed.
 */
export const caseStudyJobsTable = pgTable(
  "case_study_jobs",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("running"), // running | completed | failed
    stage: text("stage").notNull().default("collecting_evidence"),
    error: text("error"),
    revisionId: integer("revision_id").references(
      () => caseStudyRevisionsTable.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("case_study_jobs_one_running_per_company")
      .on(t.companyId)
      .where(sql`status = 'running'`),
  ],
);

export type CaseStudyJob = typeof caseStudyJobsTable.$inferSelect;
