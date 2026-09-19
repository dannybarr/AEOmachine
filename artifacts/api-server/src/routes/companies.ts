import { Router, type IRouter } from "express";
import { eq, gte, sql, inArray, and } from "drizzle-orm";
import {
  db,
  companiesTable,
  domainRegistryTable,
  promptsTable,
  promptRunsTable,
  citationsTable,
} from "@workspace/db";
import { z } from "zod/v4";
import { getCompany, serializeCompany } from "../lib/companyLookup";
import { normalizeDomain } from "../lib/domainClassify";
import { utcWindowStart } from "../lib/timeWindow";
import { startWebsiteAssessment } from "../lib/websiteAssessmentRunner";

const router: IRouter = Router();

const CompanyDomain = z
  .string()
  .trim()
  .transform(normalizeDomain)
  .pipe(
    z
      .string()
      .min(3)
      .max(253)
      .regex(
        /^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/i,
        "Enter a valid website domain like example.com",
      ),
  );

const CompanyInput = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  domain: CompanyDomain,
  industry: z.string().trim().max(120).nullish(),
  objective: z.string().trim().max(600).nullish(),
  targetAudience: z.string().trim().max(600).nullish(),
  productsServices: z.string().trim().max(600).nullish(),
  positioning: z.string().trim().max(600).nullish(),
  geography: z.string().trim().max(300).nullish(),
  notes: z.string().trim().max(2000).nullish(),
  autoTrackDaily: z.boolean().optional(),
});

// Partial profile update: any subset of fields, none required.
const CompanyPatch = CompanyInput.partial();

const PROFILE_FIELDS = [
  "industry",
  "objective",
  "targetAudience",
  "productsServices",
  "positioning",
  "geography",
  "notes",
] as const;

/** Map "" to null so clearing a field in the UI clears it in the DB. */
function normalizeProfileValue(v: string | null | undefined): string | null {
  const t = typeof v === "string" ? v.trim() : v;
  return t ? t : null;
}

interface CompanyStats {
  promptCount: number;
  runCount: number;
  retrievals: number;
  visibilityPct: number | null;
  lastRunAt: string | null;
}

export async function companyStats(
  companyIds: number[],
  days: number,
  options?: { model?: string | null; allHistory?: boolean },
): Promise<Map<number, CompanyStats>> {
  const map = new Map<number, CompanyStats>();
  if (companyIds.length === 0) return map;
  // Shared UTC calendar window — identical to the dashboard aggregate window
  // so company summaries reconcile exactly with the other dashboard figures.
  const cutoff = sql`${utcWindowStart(days).toISOString()}::timestamptz`;

  const promptCounts = options
    ? await db
        .select({
          companyId: promptsTable.companyId,
          promptCount: sql<number>`count(distinct ${promptsTable.id})::int`,
        })
        .from(promptsTable)
        .innerJoin(promptRunsTable, and(
          eq(promptRunsTable.promptId, promptsTable.id),
          options.allHistory ? undefined : gte(promptRunsTable.createdAt, cutoff),
          options.model ? eq(promptRunsTable.model, options.model) : undefined,
        ))
        .where(inArray(promptsTable.companyId, companyIds))
        .groupBy(promptsTable.companyId)
    : await db
        .select({
          companyId: promptsTable.companyId,
          promptCount: sql<number>`count(*)::int`,
        })
        .from(promptsTable)
        .where(inArray(promptsTable.companyId, companyIds))
        .groupBy(promptsTable.companyId);

  const runStats = await db
    .select({
      companyId: promptsTable.companyId,
      runCount: sql<number>`count(${promptRunsTable.id})::int`,
      mentionCount: sql<number>`count(${promptRunsTable.id}) filter (where ${promptRunsTable.brandMentioned})::int`,
      lastRunAt: sql<string | null>`max(${promptRunsTable.createdAt})`,
    })
    .from(promptRunsTable)
    .innerJoin(promptsTable, eq(promptsTable.id, promptRunsTable.promptId))
    .where(
      and(
        inArray(promptsTable.companyId, companyIds),
        options?.allHistory ? undefined : gte(promptRunsTable.createdAt, cutoff),
        options?.model ? eq(promptRunsTable.model, options.model) : undefined,
      ),
    )
    .groupBy(promptsTable.companyId);

  const citationStats = await db
    .select({
      companyId: promptsTable.companyId,
      retrievals: sql<number>`count(${citationsTable.id})::int`,
    })
    .from(citationsTable)
    .innerJoin(promptRunsTable, eq(promptRunsTable.id, citationsTable.runId))
    .innerJoin(promptsTable, eq(promptsTable.id, promptRunsTable.promptId))
    .where(
      and(
        // Verified-citation predicate: provider provenance AND a
        // confirmed-eligible run — company summaries reconcile with the
        // dashboard's verified totals, never with raw/legacy rows.
        eq(citationsTable.provenance, "provider"),
        sql`${promptRunsTable.citationEligible} is true`,
        inArray(promptsTable.companyId, companyIds),
        options?.allHistory ? undefined : gte(promptRunsTable.createdAt, cutoff),
        options?.model ? eq(promptRunsTable.model, options.model) : undefined,
      ),
    )
    .groupBy(promptsTable.companyId);

  for (const id of companyIds) {
    map.set(id, {
      promptCount: 0,
      runCount: 0,
      retrievals: 0,
      visibilityPct: null,
      lastRunAt: null,
    });
  }
  for (const r of promptCounts) map.get(r.companyId)!.promptCount = r.promptCount;
  for (const r of runStats) {
    const entry = map.get(r.companyId)!;
    entry.runCount = r.runCount;
    entry.visibilityPct =
      r.runCount > 0 ? Math.round((r.mentionCount / r.runCount) * 1000) / 10 : null;
    entry.lastRunAt = r.lastRunAt ? new Date(r.lastRunAt).toISOString() : null;
  }
  for (const r of citationStats) map.get(r.companyId)!.retrievals = r.retrievals;
  return map;
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Keep exactly one aligned "you" registry entry for the company's domain.
 * Runs inside the same transaction as the company-row update so a registry
 * conflict rolls the whole change back. Handles the collision where the new
 * domain already exists as another registry row (e.g. a tracked competitor):
 * that row is promoted to "you"; stale "you" rows on other domains are
 * demoted to unresolved "other" (never deleted — they may appear in citations).
 */
async function alignYouRegistry(tx: Tx, companyId: number, domain: string): Promise<void> {
  await tx
    .update(domainRegistryTable)
    .set({ domainType: "other", isOwned: false })
    .where(
      and(
        eq(domainRegistryTable.companyId, companyId),
        eq(domainRegistryTable.domainType, "you"),
        sql`${domainRegistryTable.domain} <> ${domain}`,
      ),
    );
  await tx
    .insert(domainRegistryTable)
    .values({ companyId, domain, domainType: "you", isOwned: true })
    .onConflictDoUpdate({
      target: [domainRegistryTable.companyId, domainRegistryTable.domain],
      set: { domainType: "you", isOwned: true },
    });
}

router.get("/companies", async (req, res) => {
  const days = Math.min(Math.max(Number(req.query["days"]) || 30, 1), 365);
  const companies = await db
    .select()
    .from(companiesTable)
    .orderBy(companiesTable.name);
  const stats = await companyStats(companies.map((c) => c.id), days);
  res.json(
    companies.map((c) => ({ ...serializeCompany(c), ...stats.get(c.id)! })),
  );
});

router.post("/companies", async (req, res): Promise<void> => {
  const body = CompanyInput.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const domain = body.data.domain;
  const name =
    body.data.name ??
    domain
      .split(".")[0]!
      .split("-")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  const onboarding = await db.transaction(async (tx) => {
    // This lock covers legacy databases which may already contain duplicate
    // domain rows, so correctness does not depend on adding a new constraint.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${domain}, 55))`);
    const [existing] = await tx
      .select()
      .from(companiesTable)
      .where(sql`lower(btrim(${companiesTable.domain})) = ${domain}`)
      .orderBy(companiesTable.id)
      .limit(1);
    if (existing) return { company: existing, created: false };
    const [created] = await tx
      .insert(companiesTable)
      .values({
        name,
        domain,
        industry: normalizeProfileValue(body.data.industry),
        objective: normalizeProfileValue(body.data.objective),
        targetAudience: normalizeProfileValue(body.data.targetAudience),
        productsServices: normalizeProfileValue(body.data.productsServices),
        positioning: normalizeProfileValue(body.data.positioning),
        geography: normalizeProfileValue(body.data.geography),
        notes: normalizeProfileValue(body.data.notes),
        profileUpdatedAt: new Date(),
        autoTrackDaily: body.data.autoTrackDaily ?? false,
      })
      .returning();
    if (!created) throw new Error("Company creation returned no row");
    // Register the company's own domain so citations of it classify as "you".
    await alignYouRegistry(tx, created.id, domain);
    return { company: created, created: true };
  });
  const company = onboarding.company;
  const stats = await companyStats([company.id], 30);
  // Claim the durable job row before responding so the onboarding client's
  // first poll cannot race ahead of it. startWebsiteAssessment returns after
  // the insert and runs crawl/model work asynchronously.
  if (onboarding.created) {
    await startWebsiteAssessment(company, "automatic").catch((err: unknown) => {
      req.log.error({ err, companyId: company.id }, "Failed to start onboarding assessment");
      return null;
    });
  }
  res.status(201).json({ ...serializeCompany(company), ...stats.get(company.id)! });
});

router.put("/companies/:id", async (req, res): Promise<void> => {
  const company = await getCompany(Number(req.params.id));
  if (!company) {
    res.status(404).json({ error: "Company not found" });
    return;
  }
  const body = CompanyInput.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const domain = body.data.domain;
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(companiesTable)
      .set({
      name: body.data.name,
      domain,
      industry:
        body.data.industry !== undefined
          ? normalizeProfileValue(body.data.industry)
          : company.industry,
      objective:
        body.data.objective !== undefined
          ? normalizeProfileValue(body.data.objective)
          : company.objective,
      targetAudience:
        body.data.targetAudience !== undefined
          ? normalizeProfileValue(body.data.targetAudience)
          : company.targetAudience,
      productsServices:
        body.data.productsServices !== undefined
          ? normalizeProfileValue(body.data.productsServices)
          : company.productsServices,
      positioning:
        body.data.positioning !== undefined
          ? normalizeProfileValue(body.data.positioning)
          : company.positioning,
      geography:
        body.data.geography !== undefined
          ? normalizeProfileValue(body.data.geography)
          : company.geography,
      notes:
        body.data.notes !== undefined
          ? normalizeProfileValue(body.data.notes)
          : company.notes,
      profileUpdatedAt: new Date(),
      autoTrackDaily: body.data.autoTrackDaily ?? company.autoTrackDaily,
    })
      .where(eq(companiesTable.id, company.id))
      .returning();
    if (domain !== company.domain) {
      await alignYouRegistry(tx, company.id, domain);
    }
    return row!;
  });
  const stats = await companyStats([company.id], 30);
  res.json({ ...serializeCompany(updated), ...stats.get(company.id)! });
});

router.patch("/companies/:id", async (req, res): Promise<void> => {
  const company = await getCompany(Number(req.params.id));
  if (!company) {
    res.status(404).json({ error: "Company not found" });
    return;
  }
  const body = CompanyPatch.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const data = body.data;
  const set: Partial<typeof companiesTable.$inferInsert> = {};
  if (data.name !== undefined) set.name = data.name;
  let domain: string | undefined;
  if (data.domain !== undefined) {
    domain = data.domain;
    set.domain = domain;
  }
  for (const field of PROFILE_FIELDS) {
    if (data[field] !== undefined) set[field] = normalizeProfileValue(data[field]);
  }
  if (data.autoTrackDaily !== undefined) set.autoTrackDaily = data.autoTrackDaily;
  if (Object.keys(set).length === 0) {
    const stats = await companyStats([company.id], 30);
    res.json({ ...serializeCompany(company), ...stats.get(company.id)! });
    return;
  }
  set.profileUpdatedAt = new Date();
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(companiesTable)
      .set(set)
      .where(eq(companiesTable.id, company.id))
      .returning();
    if (domain && domain !== company.domain) {
      await alignYouRegistry(tx, company.id, domain);
    }
    return row!;
  });
  const stats = await companyStats([company.id], 30);
  res.json({ ...serializeCompany(updated), ...stats.get(company.id)! });
});

router.delete("/companies/:id", async (req, res): Promise<void> => {
  const company = await getCompany(Number(req.params.id));
  if (!company) {
    res.status(404).json({ error: "Company not found" });
    return;
  }
  // Atomic guard: only delete when another company exists at delete time.
  const deleted = await db
    .delete(companiesTable)
    .where(
      sql`${companiesTable.id} = ${company.id} and exists (select 1 from companies c2 where c2.id <> ${company.id})`,
    )
    .returning({ id: companiesTable.id });
  if (deleted.length === 0) {
    res.status(409).json({ error: "Cannot delete the last remaining company." });
    return;
  }
  res.sendStatus(204);
});

export default router;
