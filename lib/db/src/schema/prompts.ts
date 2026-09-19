import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";
import { moneyTopicsTable } from "./strategy";

export const promptsTable = pgTable(
  "prompts",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    // Optional link to a Site Lab money topic; the prompt stays a normal
    // tracked prompt if the topic is deleted (SET NULL keeps no orphans).
    moneyTopicId: integer("money_topic_id").references(
      () => moneyTopicsTable.id,
      { onDelete: "set null" },
    ),
    text: text("text").notNull(),
    topic: text("topic").notNull(),
    tags: text("tags").array().notNull().default([]),
    models: text("models").array().notNull().default([]),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("prompts_company_normalized_text_unique").on(
      t.companyId,
      sql`lower(btrim(${t.text}))`,
    ),
  ],
);

export const insertPromptSchema = createInsertSchema(promptsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertPrompt = z.infer<typeof insertPromptSchema>;
export type Prompt = typeof promptsTable.$inferSelect;
