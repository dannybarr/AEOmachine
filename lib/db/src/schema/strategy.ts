import {
  pgTable,
  serial,
  integer,
  real,
  text,
  boolean,
  timestamp,
  uniqueIndex,
  jsonb,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companiesTable } from "./companies";

/**
 * Reusable, client-agnostic AEO strategy plays ("Ideas"), generalized from
 * Graphite's 5-step playbook workbook. Category mirrors the signals split:
 * on_page (Step 3, onsite builds) and off_page (Step 4, offsite builds).
 */
export const strategyIdeasTable = pgTable(
  "strategy_ideas",
  {
    id: serial("id").primaryKey(),
    title: text("title").notNull(),
    category: text("category").notNull(), // on_page | off_page
    playType: text("play_type").notNull(), // e.g. "Comparison Landing Page", "Data PR"
    description: text("description").notNull(),
    rationale: text("rationale").notNull(), // why it works for AEO
    priority: text("priority").notNull().default("P1"), // P0 | P1 | P2
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  // Makes catalog seeding idempotent and concurrency-safe (ON CONFLICT DO NOTHING).
  (t) => [uniqueIndex("strategy_ideas_title_unique").on(t.title)],
);

export type StrategyIdea = typeof strategyIdeasTable.$inferSelect;

/**
 * An idea deployed to a specific company: a tracked strategy action with
 * money topic, status, owner notes and target date (playbook Steps 3 & 4).
 */
export const strategyItemsTable = pgTable("strategy_items", {
  id: serial("id").primaryKey(),
  ideaId: integer("idea_id")
    .notNull()
    .references(() => strategyIdeasTable.id, { onDelete: "cascade" }),
  companyId: integer("company_id")
    .notNull()
    .references(() => companiesTable.id, { onDelete: "cascade" }),
  moneyTopic: text("money_topic"), // legacy free-text label (pre-linking)
  // Durable link to a captured money topic; SET NULL on topic delete so the
  // deployed play survives without pointing at a missing record.
  moneyTopicId: integer("money_topic_id").references(
    () => moneyTopicsTable.id,
    { onDelete: "set null" },
  ),
  status: text("status").notNull().default("not_started"), // not_started | in_progress | live
  notes: text("notes"),
  brief: jsonb("brief"),
  targetDate: text("target_date"), // ISO date (yyyy-mm-dd), optional
  liveAt: timestamp("live_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type StrategyItem = typeof strategyItemsTable.$inferSelect;

/**
 * Step 1 — Prompt Research: per-company "money topics" — the questions
 * buyers are already asking AI, mined from Reddit / sales calls / forums.
 */
export const moneyTopicsTable = pgTable(
  "money_topics",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    topic: text("topic").notNull(),
    question: text("question"), // the buyer question / prompt phrasing
    source: text("source"), // where it was found (Reddit, sales call, ...)
    priority: text("priority").notNull().default("medium"), // very_high | high | medium | low
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("money_topics_company_normalized_topic_unique").on(
      t.companyId,
      sql`lower(btrim(${t.topic}))`,
    ),
  ],
);

export type MoneyTopic = typeof moneyTopicsTable.$inferSelect;

/**
 * Step 5 — Tracking & Measurement: weekly rollup rows per company
 * (share of voice, brand vs competitor mentions, top cited page type).
 */
export const weeklyMeasurementsTable = pgTable("weekly_measurements", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id")
    .notNull()
    .references(() => companiesTable.id, { onDelete: "cascade" }),
  weekOf: text("week_of").notNull(), // ISO date (yyyy-mm-dd) of the week start
  totalPrompts: integer("total_prompts").notNull().default(0),
  brandMentions: integer("brand_mentions").notNull().default(0),
  competitorMentionsAvg: real("competitor_mentions_avg"),
  shareOfVoicePct: real("share_of_voice_pct"),
  consensusAnswer: boolean("consensus_answer"),
  topPageType: text("top_page_type"),
  keyTakeaway: text("key_takeaway"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type WeeklyMeasurement = typeof weeklyMeasurementsTable.$inferSelect;
