import { Router, type IRouter } from "express";
import { eq, and, asc } from "drizzle-orm";
import { db, domainRegistryTable } from "@workspace/db";
import { z } from "zod/v4";
import { isConfigured } from "../lib/simulate";
import { getCompany } from "../lib/companyLookup";
import { normalizeDomain } from "../lib/domainClassify";

const router: IRouter = Router();

router.get("/system/status", (_req, res) => {
  res.json({ simulationConfigured: isConfigured() });
});

function serializeRegistry(d: typeof domainRegistryTable.$inferSelect) {
  return {
    id: d.id,
    domain: d.domain,
    domainType: d.domainType,
    isOwned: d.isOwned,
    firstSeenAt: d.firstSeenAt.toISOString(),
  };
}

router.get("/settings/competitors", async (req, res): Promise<void> => {
  const company = await getCompany(Number(req.query["companyId"]));
  if (!company) {
    res.status(400).json({ error: "Unknown companyId" });
    return;
  }
  const rows = await db
    .select()
    .from(domainRegistryTable)
    .where(
      and(
        eq(domainRegistryTable.companyId, company.id),
        eq(domainRegistryTable.domainType, "competitor"),
      ),
    )
    .orderBy(asc(domainRegistryTable.domain));
  res.json(rows.map(serializeRegistry));
});

const AddCompetitor = z.object({
  companyId: z.number().int().positive(),
  domain: z
    .string()
    .trim()
    .min(3)
    .max(253)
    .regex(/^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/i, "Enter a bare domain like example.com"),
});

router.post("/settings/competitors", async (req, res): Promise<void> => {
  const body = AddCompetitor.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const company = await getCompany(body.data.companyId);
  if (!company) {
    res.status(400).json({ error: "Unknown companyId" });
    return;
  }
  const domain = normalizeDomain(body.data.domain);
  const [row] = await db
    .insert(domainRegistryTable)
    .values({ companyId: company.id, domain, domainType: "competitor", isOwned: false })
    .onConflictDoUpdate({
      target: [domainRegistryTable.companyId, domainRegistryTable.domain],
      set: { domainType: "competitor" },
    })
    .returning();
  res.status(201).json(serializeRegistry(row!));
});

router.delete("/settings/competitors/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const [row] = await db
    .select()
    .from(domainRegistryTable)
    .where(eq(domainRegistryTable.id, id));
  if (!row || row.domainType !== "competitor") {
    res.status(404).json({ error: "Not found" });
    return;
  }
  // Demote rather than delete: the domain may still appear in citations.
  await db
    .update(domainRegistryTable)
    .set({ domainType: "other" })
    .where(eq(domainRegistryTable.id, id));
  res.sendStatus(204);
});

export default router;
