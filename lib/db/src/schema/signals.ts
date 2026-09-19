import { pgTable, serial, text, integer, jsonb } from "drizzle-orm/pg-core";

/**
 * General AEO checklist catalog. These rows are reusable practices, not
 * company-specific observations or proof that a factor affects citations.
 */
export const signalsTable = pgTable("signals", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category").notNull(), // on_page | off_page
  description: text("description").notNull(),
  weight: integer("weight").notNull().default(50),
  status: text("status").notNull().default("monitor"),
  recommendation: text("recommendation"),
  // Optional curated evidence signal (verified example of a company surfacing
  // well via this mechanism). Shape mirrors the ActionEvidence API schema:
  // { company, evidenceType, observation, rationale, sourceTitle, sourceUrl,
  //   observedAt, confidence }. Null for signals with no precedent on file.
  evidence: jsonb("evidence"),
});

export type Signal = typeof signalsTable.$inferSelect;
