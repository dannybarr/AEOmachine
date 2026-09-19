import { pgTable, serial, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * A tracked company/brand. All prompts, runs, citations, and domain-registry
 * entries are scoped to a company so multiple businesses can be monitored
 * side by side.
 */
export const companiesTable = pgTable("companies", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  domain: text("domain").notNull(),
  industry: text("industry"),
  objective: text("objective"),
  targetAudience: text("target_audience"),
  productsServices: text("products_services"),
  positioning: text("positioning"),
  geography: text("geography"),
  notes: text("notes"),
  profileUpdatedAt: timestamp("profile_updated_at", { withTimezone: true }),
  autoTrackDaily: boolean("auto_track_daily").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const insertCompanySchema = createInsertSchema(companiesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertCompany = z.infer<typeof insertCompanySchema>;
export type Company = typeof companiesTable.$inferSelect;
