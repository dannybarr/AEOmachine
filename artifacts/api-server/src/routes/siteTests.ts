import { Router, type IRouter } from "express";
import { eq, desc, sql, and } from "drizzle-orm";
import { db, siteTestsTable, siteSnapshotsTable } from "@workspace/db";
import {
  ListSiteTestsResponse,
  CreateSiteTestBody,
  CreateSiteTestResponse,
  GetSiteTestParams,
  GetSiteTestResponse,
  DeleteSiteTestParams,
  RunSiteAuditParams,
  RunSiteAuditResponse,
} from "@workspace/api-zod";
import { auditSite } from "../lib/audit";
import { getCompany } from "../lib/companyLookup";

const router: IRouter = Router();

function serializeSnapshot(s: typeof siteSnapshotsTable.$inferSelect) {
  return {
    id: s.id,
    siteTestId: s.siteTestId,
    score: s.score,
    httpStatus: s.httpStatus,
    checks: s.checks,
    createdAt: s.createdAt.toISOString(),
  };
}

router.get("/site-tests", async (req, res): Promise<void> => {
  const company = await getCompany(Number(req.query["companyId"]));
  if (!company) {
    res.status(400).json({ error: "Unknown companyId" });
    return;
  }
  const rows = await db
    .select({
      site: siteTestsTable,
      snapshotCount: sql<number>`(SELECT count(*)::int FROM site_snapshots ss WHERE ss.site_test_id = ${siteTestsTable.id})`,
      latestScore: sql<number | null>`(SELECT score FROM site_snapshots ss WHERE ss.site_test_id = ${siteTestsTable.id} ORDER BY created_at DESC LIMIT 1)`,
      latestSnapshotAt: sql<string | null>`(SELECT created_at FROM site_snapshots ss WHERE ss.site_test_id = ${siteTestsTable.id} ORDER BY created_at DESC LIMIT 1)`,
    })
    .from(siteTestsTable)
    .where(eq(siteTestsTable.companyId, company.id))
    .orderBy(desc(siteTestsTable.createdAt));

  res.json(
    ListSiteTestsResponse.parse(
      rows.map(({ site, snapshotCount, latestScore, latestSnapshotAt }) => ({
        id: site.id,
        companyId: site.companyId,
        name: site.name,
        url: site.url,
        createdAt: site.createdAt.toISOString(),
        snapshotCount,
        latestScore,
        latestSnapshotAt: latestSnapshotAt
          ? new Date(latestSnapshotAt).toISOString()
          : null,
      })),
    ),
  );
});

router.post("/site-tests", async (req, res): Promise<void> => {
  const parsed = CreateSiteTestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const company = await getCompany(parsed.data.companyId);
  if (!company) {
    res.status(400).json({ error: "Unknown companyId" });
    return;
  }
  const [site] = await db
    .insert(siteTestsTable)
    .values({
      companyId: company.id,
      name: parsed.data.name,
      url: parsed.data.url,
    })
    .returning();
  res.status(201).json(
    CreateSiteTestResponse.parse({
      id: site!.id,
      companyId: site!.companyId,
      name: site!.name,
      url: site!.url,
      createdAt: site!.createdAt.toISOString(),
      snapshotCount: 0,
      latestScore: null,
      latestSnapshotAt: null,
    }),
  );
});

router.get("/site-tests/:id", async (req, res): Promise<void> => {
  const params = GetSiteTestParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const company = await getCompany(Number(req.query["companyId"]));
  if (!company) {
    res.status(400).json({ error: "Unknown companyId" });
    return;
  }
  const [site] = await db
    .select()
    .from(siteTestsTable)
    .where(
      and(
        eq(siteTestsTable.id, params.data.id),
        eq(siteTestsTable.companyId, company.id),
      ),
    );
  if (!site) {
    res.status(404).json({ error: "Site test not found" });
    return;
  }
  const snapshots = await db
    .select()
    .from(siteSnapshotsTable)
    .where(eq(siteSnapshotsTable.siteTestId, site.id))
    .orderBy(desc(siteSnapshotsTable.createdAt));

  res.json(
    GetSiteTestResponse.parse({
      id: site.id,
      companyId: site.companyId,
      name: site.name,
      url: site.url,
      createdAt: site.createdAt.toISOString(),
      snapshotCount: snapshots.length,
      latestScore: snapshots[0]?.score ?? null,
      latestSnapshotAt: snapshots[0]?.createdAt.toISOString() ?? null,
      snapshots: snapshots.map(serializeSnapshot),
    }),
  );
});

router.delete("/site-tests/:id", async (req, res): Promise<void> => {
  const params = DeleteSiteTestParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const company = await getCompany(Number(req.query["companyId"]));
  if (!company) {
    res.status(400).json({ error: "Unknown companyId" });
    return;
  }
  const [deleted] = await db
    .delete(siteTestsTable)
    .where(
      and(
        eq(siteTestsTable.id, params.data.id),
        eq(siteTestsTable.companyId, company.id),
      ),
    )
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Site test not found" });
    return;
  }
  res.sendStatus(204);
});

router.post("/site-tests/:id/audit", async (req, res): Promise<void> => {
  const params = RunSiteAuditParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const company = await getCompany(Number(req.query["companyId"]));
  if (!company) {
    res.status(400).json({ error: "Unknown companyId" });
    return;
  }
  const [site] = await db
    .select()
    .from(siteTestsTable)
    .where(
      and(
        eq(siteTestsTable.id, params.data.id),
        eq(siteTestsTable.companyId, company.id),
      ),
    );
  if (!site) {
    res.status(404).json({ error: "Site test not found" });
    return;
  }

  let result;
  try {
    result = await auditSite(site.url);
  } catch (err) {
    req.log.warn({ err, url: site.url }, "Site audit fetch failed");
    res.status(502).json({
      error: `Could not reach ${site.url} — the site did not respond to a live fetch.`,
    });
    return;
  }

  const [snapshot] = await db
    .insert(siteSnapshotsTable)
    .values({
      siteTestId: site.id,
      score: result.score,
      httpStatus: result.httpStatus,
      checks: result.checks,
    })
    .returning();

  res.status(201).json(RunSiteAuditResponse.parse(serializeSnapshot(snapshot!)));
});

export default router;
