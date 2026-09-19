import { db, companiesTable, type Company } from "@workspace/db";
import { eq } from "drizzle-orm";

/** Load a company by id; returns null when it does not exist. */
export async function getCompany(id: number): Promise<Company | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  const [company] = await db
    .select()
    .from(companiesTable)
    .where(eq(companiesTable.id, id));
  return company ?? null;
}

export function serializeCompany(c: Company) {
  return {
    id: c.id,
    name: c.name,
    domain: c.domain,
    industry: c.industry,
    objective: c.objective,
    targetAudience: c.targetAudience,
    productsServices: c.productsServices,
    positioning: c.positioning,
    geography: c.geography,
    notes: c.notes,
    profileUpdatedAt: c.profileUpdatedAt ? c.profileUpdatedAt.toISOString() : null,
    autoTrackDaily: c.autoTrackDaily,
    createdAt: c.createdAt.toISOString(),
  };
}
