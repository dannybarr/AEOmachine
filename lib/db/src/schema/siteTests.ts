import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  jsonb,
} from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";

export const siteTestsTable = pgTable("site_tests", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id")
    .notNull()
    .references(() => companiesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  url: text("url").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type SiteTest = typeof siteTestsTable.$inferSelect;

export interface SiteCheckResult {
  key: string;
  label: string;
  passed: boolean;
  detail: string;
}

export const siteSnapshotsTable = pgTable("site_snapshots", {
  id: serial("id").primaryKey(),
  siteTestId: integer("site_test_id")
    .notNull()
    .references(() => siteTestsTable.id, { onDelete: "cascade" }),
  score: integer("score").notNull(),
  httpStatus: integer("http_status"),
  checks: jsonb("checks").$type<SiteCheckResult[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type SiteSnapshot = typeof siteSnapshotsTable.$inferSelect;
