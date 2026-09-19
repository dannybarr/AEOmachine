import {
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";
import { promptsTable } from "./prompts";

/**
 * AI-generated prompt suggestions, persisted so generated research and its
 * added/dismissed review state survive refreshes. Suggestions are review
 * material only — never metrics or evidence.
 */
export const discoverySuggestionsTable = pgTable(
  "discovery_suggestions",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    topic: text("topic").notNull(),
    rationale: text("rationale").notNull(),
    status: text("status", { enum: ["pending", "added", "dismissed"] })
      .notNull()
      .default("pending"),
    createdPromptId: integer("created_prompt_id").references(
      () => promptsTable.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("discovery_suggestions_company_status_idx").on(t.companyId, t.status)],
);

export type DiscoverySuggestionRow = typeof discoverySuggestionsTable.$inferSelect;
