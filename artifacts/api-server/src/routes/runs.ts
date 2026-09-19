import { Router, type IRouter } from "express";
import { and, eq, desc, sql } from "drizzle-orm";
import { getCompany } from "../lib/companyLookup";
import {
  db,
  promptsTable,
  promptRunsTable,
  citationsTable,
} from "@workspace/db";
import {
  ListRunsQueryParams,
  ListRunsResponse,
  GetRunParams,
  GetRunResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/runs", async (req, res): Promise<void> => {
  const q = ListRunsQueryParams.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: q.error.message });
    return;
  }
  const company = await getCompany(q.data.companyId);
  if (!company) {
    res.status(400).json({ error: "Unknown companyId" });
    return;
  }
  const limit = q.data.limit ?? 25;

  const rows = await db
    .select({
      run: promptRunsTable,
      promptText: promptsTable.text,
      citationCount: sql<number>`(SELECT count(*)::int FROM citations WHERE citations.run_id = ${promptRunsTable.id})`,
    })
    .from(promptRunsTable)
    .innerJoin(promptsTable, eq(promptsTable.id, promptRunsTable.promptId))
    .where(
      and(
        eq(promptsTable.companyId, company.id),
        q.data.model ? eq(promptRunsTable.model, q.data.model) : undefined,
      ),
    )
    .orderBy(desc(promptRunsTable.createdAt))
    .limit(limit);

  res.json(
    ListRunsResponse.parse(
      rows.map(({ run, promptText, citationCount }) => ({
        id: run.id,
        promptId: run.promptId,
        promptText,
        model: run.model,
        brandMentioned: run.brandMentioned,
        brandPosition: run.brandPosition,
        createdAt: run.createdAt.toISOString(),
        citationCount,
        answerPreview: run.answerText.slice(0, 200),
        searchStatus: run.searchStatus ?? null,
        citationEligible: run.citationEligible ?? null,
        visibilityRung: run.visibilityRung ?? null,
      })),
    ),
  );
});

router.get("/runs/:id", async (req, res): Promise<void> => {
  const params = GetRunParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [row] = await db
    .select({ run: promptRunsTable, promptText: promptsTable.text })
    .from(promptRunsTable)
    .innerJoin(promptsTable, eq(promptsTable.id, promptRunsTable.promptId))
    .where(eq(promptRunsTable.id, params.data.id));
  if (!row) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  const citations = await db
    .select()
    .from(citationsTable)
    .where(eq(citationsTable.runId, row.run.id))
    .orderBy(citationsTable.position);

  res.json(
    GetRunResponse.parse({
      id: row.run.id,
      promptId: row.run.promptId,
      promptText: row.promptText,
      model: row.run.model,
      brandMentioned: row.run.brandMentioned,
      brandPosition: row.run.brandPosition,
      createdAt: row.run.createdAt.toISOString(),
      citationCount: citations.length,
      answerPreview: row.run.answerText.slice(0, 200),
      answerText: row.run.answerText,
      searchStatus: row.run.searchStatus ?? null,
      citationEligible: row.run.citationEligible ?? null,
      visibilityRung: row.run.visibilityRung ?? null,
      citationDiagnostics: serializeDiagnostics(row.run.citationDiagnostics),
      citations: citations.map((c) => ({
        id: c.id,
        domain: c.domain,
        url: c.url,
        domainType: c.domainType,
        position: c.position,
        provenance: c.provenance ?? null,
      })),
    }),
  );
});

/**
 * Serialize stored jsonb diagnostics defensively: only known numeric/string
 * fields pass through; anything malformed becomes null (legacy semantics)
 * rather than failing the response.
 */
function serializeDiagnostics(raw: unknown): {
  extracted: number;
  metadataEvents: number;
  invalidUrls: number;
  unknownAnnotationTypes: string[];
  unknownShapes: number;
  redirectsResolved: number;
  redirectsFailed: number;
  observedShapes: string[];
  seenCitationKeys: string[];
  unparsedCitationKeys: string[];
} | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const strings = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((t): t is string => typeof t === "string") : [];
  if (typeof d["metadataEvents"] !== "number") return null;
  return {
    extracted: num(d["extracted"]),
    metadataEvents: num(d["metadataEvents"]),
    invalidUrls: num(d["invalidUrls"]),
    unknownAnnotationTypes: strings(d["unknownAnnotationTypes"]),
    unknownShapes: num(d["unknownShapes"]),
    redirectsResolved: num(d["redirectsResolved"]),
    redirectsFailed: num(d["redirectsFailed"]),
    observedShapes: strings(d["observedShapes"]),
    seenCitationKeys: strings(d["seenCitationKeys"]),
    unparsedCitationKeys: strings(d["unparsedCitationKeys"]),
  };
}

export default router;
