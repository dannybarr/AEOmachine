import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companiesTable } from "./companies";
import { promptsTable } from "./prompts";
import { moneyTopicsTable, strategyItemsTable } from "./strategy";

/** Durable, pollable assessment of one company's public website. */
export const websiteAssessmentJobsTable = pgTable(
  "website_assessment_jobs",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["running", "completed", "failed"] })
      .notNull()
      .default("running"),
    source: text("source", { enum: ["automatic", "manual_rerun"] })
      .notNull()
      .default("automatic"),
    phase: text("phase", { enum: ["crawling", "researching", "analyzing", "saving", "done"] })
      .notNull()
      .default("crawling"),
    totalPages: integer("total_pages").notNull().default(0),
    fetchedPages: integer("fetched_pages").notNull().default(0),
    failedPages: integer("failed_pages").notNull().default(0),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => [
    index("website_assessment_jobs_company_idx").on(t.companyId, t.createdAt),
    uniqueIndex("website_assessment_jobs_one_running_per_company")
      .on(t.companyId)
      .where(sql`${t.status} = 'running'`),
  ],
);

/** Immutable fetch outcomes for every URL attempted by an assessment. */
export const websiteAssessmentPagesTable = pgTable(
  "website_assessment_pages",
  {
    id: serial("id").primaryKey(),
    jobId: integer("job_id")
      .notNull()
      .references(() => websiteAssessmentJobsTable.id, { onDelete: "cascade" }),
    companyId: integer("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    finalUrl: text("final_url"),
    fetchStatus: text("fetch_status").notNull(),
    httpStatus: integer("http_status"),
    title: text("title"),
    content: text("content"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("website_assessment_pages_job_url_unique").on(t.jobId, t.url)],
);

/** Model inference awaiting explicit user approval; evidence is kept separate. */
export const inferredCompanyProfilesTable = pgTable(
  "inferred_company_profiles",
  {
    id: serial("id").primaryKey(),
    jobId: integer("job_id")
      .notNull()
      .references(() => websiteAssessmentJobsTable.id, { onDelete: "cascade" }),
    companyId: integer("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["pending", "approved", "superseded"] })
      .notNull()
      .default("pending"),
    targetAudience: text("target_audience"),
    industry: text("industry"),
    objective: text("objective"),
    productsServices: text("products_services"),
    positioning: text("positioning"),
    geography: text("geography"),
    evidence: jsonb("evidence").notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("inferred_company_profiles_job_unique").on(t.jobId),
    index("inferred_company_profiles_company_status_idx").on(t.companyId, t.status),
  ],
);

/** Audience-led recommendations are review material, never automatically tracked. */
export const audienceRecommendationsTable = pgTable(
  "audience_recommendations",
  {
    id: serial("id").primaryKey(),
    jobId: integer("job_id")
      .notNull()
      .references(() => websiteAssessmentJobsTable.id, { onDelete: "cascade" }),
    companyId: integer("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    question: text("question").notNull(),
    normalizedQuestion: text("normalized_question").notNull(),
    moneyTopic: text("money_topic").notNull(),
    persona: text("persona").notNull(),
    intent: text("intent").notNull(),
    rationale: text("rationale").notNull(),
    researchEvidence: jsonb("research_evidence")
      .$type<Array<{ platform: string; title: string; url: string; query: string }>>()
      .notNull()
      .default([]),
    status: text("status", { enum: ["pending", "added", "dismissed"] })
      .notNull()
      .default("pending"),
    moneyTopicId: integer("money_topic_id").references(() => moneyTopicsTable.id, {
      onDelete: "set null",
    }),
    createdPromptId: integer("created_prompt_id").references(() => promptsTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  },
  (t) => [
    index("audience_recommendations_company_status_idx").on(t.companyId, t.status),
    uniqueIndex("audience_recommendations_company_question_unique").on(
      t.companyId,
      t.normalizedQuestion,
    ),
  ],
);

/**
 * One immutable deterministic whole-site audit for an assessment crawl.
 * Findings and quick wins are structured, bounded summaries; fetched page
 * content remains in website_assessment_pages and is never returned here.
 */
export const websiteAuditFindingsTable = pgTable(
  "website_audit_findings",
  {
    id: serial("id").primaryKey(),
    jobId: integer("job_id")
      .notNull()
      .references(() => websiteAssessmentJobsTable.id, { onDelete: "cascade" }),
    companyId: integer("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    score: integer("score").notNull(),
    auditVersion: text("audit_version").notNull().default("1.0"),
    context: jsonb("context").$type<Record<string, string>>().notNull().default({}),
    categoryScores: jsonb("category_scores").$type<Record<string, number>>().notNull(),
    categoryNarratives: jsonb("category_narratives").$type<Record<string, unknown>>().notNull().default({}),
    counts: jsonb("counts").$type<Record<string, number>>().notNull(),
    pagesScanned: integer("pages_scanned").notNull(),
    methodology: jsonb("methodology").$type<string[]>().notNull(),
    findings: jsonb("findings").$type<Array<Record<string, unknown>>>().notNull(),
    quickWins: jsonb("quick_wins").$type<Array<Record<string, unknown>>>().notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("website_audit_findings_job_unique").on(t.jobId),
    index("website_audit_findings_company_generated_idx").on(t.companyId, t.generatedAt),
  ],
);

/** Idempotent provenance for turning one audit quick win into an on-page item. */
export const websiteAuditQuickWinPromotionsTable = pgTable(
  "website_audit_quick_win_promotions",
  {
    id: serial("id").primaryKey(),
    auditId: integer("audit_id")
      .notNull()
      .references(() => websiteAuditFindingsTable.id, { onDelete: "cascade" }),
    companyId: integer("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    quickWinCode: text("quick_win_code").notNull(),
    strategyItemId: integer("strategy_item_id")
      .notNull()
      .references(() => strategyItemsTable.id, { onDelete: "cascade" }),
    baseline: jsonb("baseline").$type<{
      windowStart: string;
      windowEnd: string;
      eligibleRuns: number;
      citedRuns: number;
      totalRuns: number;
      visibleRuns: number;
      models: string[];
    }>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("website_audit_quick_win_promotion_unique").on(t.auditId, t.quickWinCode),
  ],
);

export type WebsiteAssessmentJob = typeof websiteAssessmentJobsTable.$inferSelect;
export type WebsiteAssessmentPage = typeof websiteAssessmentPagesTable.$inferSelect;
export type InferredCompanyProfile = typeof inferredCompanyProfilesTable.$inferSelect;
export type AudienceRecommendation = typeof audienceRecommendationsTable.$inferSelect;
export type WebsiteAuditFinding = typeof websiteAuditFindingsTable.$inferSelect;
export type WebsiteAuditQuickWinPromotion = typeof websiteAuditQuickWinPromotionsTable.$inferSelect;
