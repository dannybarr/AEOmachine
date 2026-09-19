import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";

/**
 * Known-domain registry, scoped per company: classifies domains cited in AI
 * answers into types (corporate, competitor, editorial, ugc, reference,
 * institutional, you, other) and flags owned domains. A domain can be a
 * competitor for one company and irrelevant for another.
 */
export const domainRegistryTable = pgTable(
  "domain_registry",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    domain: text("domain").notNull(),
    domainType: text("domain_type").notNull().default("other"),
    isOwned: boolean("is_owned").notNull().default(false),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [unique("domain_registry_company_domain_unique").on(t.companyId, t.domain)],
);

export type DomainRegistryEntry = typeof domainRegistryTable.$inferSelect;
