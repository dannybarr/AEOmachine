import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";
import { promptsTable } from "./prompts";

/** Immutable per-job model coverage captured when the job starts. */
export interface JobModelSnapshot {
  id: string;
  label: string;
  provider: string;
  supportsSearch: boolean;
}

/**
 * One bulk tracking run: every active prompt for a company simulated across
 * its configured models in a single batch, either triggered manually
 * ("Run all") or by the daily scheduler. Also acts as the dedupe record so
 * the scheduler runs at most once per company per UTC day.
 */
export const trackingJobsTable = pgTable("tracking_jobs", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id")
    .notNull()
    .references(() => companiesTable.id, { onDelete: "cascade" }),
  /** When set, the job covers only this prompt ("Run all models"). */
  promptId: integer("prompt_id").references(() => promptsTable.id, {
    onDelete: "cascade",
  }),
  /** Registry snapshot at job start; NULL for legacy jobs. */
  modelsSnapshot: jsonb("models_snapshot").$type<JobModelSnapshot[]>(),
  companyContextSnapshot: jsonb("company_context_snapshot"),
  runDate: text("run_date").notNull(), // UTC date yyyy-mm-dd
  trigger: text("trigger").notNull(), // manual | scheduled
  status: text("status").notNull().default("running"), // running | completed | failed
  totalSimulations: integer("total_simulations").notNull().default(0),
  succeeded: integer("succeeded").notNull().default(0),
  failed: integer("failed").notNull().default(0),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
});

export type TrackingJob = typeof trackingJobsTable.$inferSelect;
