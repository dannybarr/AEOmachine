import { Router, type IRouter } from "express";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { db, promptRunsTable, promptsTable } from "@workspace/db";
import { getCompany } from "../lib/companyLookup";

const router: IRouter = Router();

/** Verbatim excerpt (±~160 chars) around the first brand mention. */
function extractExcerpt(answerText: string, brandName: string): string {
  const idx = answerText.toLowerCase().indexOf(brandName.toLowerCase());
  if (idx < 0) return "";
  const start = Math.max(0, idx - 160);
  const end = Math.min(answerText.length, idx + brandName.length + 160);
  let excerpt = answerText.slice(start, end).replace(/\s+/g, " ").trim();
  if (start > 0) excerpt = `…${excerpt}`;
  if (end < answerText.length) excerpt = `${excerpt}…`;
  return excerpt;
}

router.get("/perception", async (req, res): Promise<void> => {
  const company = await getCompany(Number(req.query["companyId"]));
  if (!company) {
    res.status(400).json({ error: "Unknown companyId" });
    return;
  }
  const days = Math.min(Math.max(Number(req.query["days"]) || 30, 1), 365);
  const brandName = company.name;

  const cutoff = sql`now() - make_interval(days => ${days})`;
  const rows = await db
    .select({
      runId: promptRunsTable.id,
      promptId: promptRunsTable.promptId,
      promptText: promptsTable.text,
      model: promptRunsTable.model,
      answerText: promptRunsTable.answerText,
      brandMentioned: promptRunsTable.brandMentioned,
      brandPosition: promptRunsTable.brandPosition,
      createdAt: promptRunsTable.createdAt,
    })
    .from(promptRunsTable)
    .innerJoin(promptsTable, eq(promptsTable.id, promptRunsTable.promptId))
    .where(
      and(eq(promptsTable.companyId, company.id), gt(promptRunsTable.createdAt, cutoff)),
    )
    .orderBy(desc(promptRunsTable.createdAt));

  const byModel = new Map<
    string,
    { runCount: number; mentionCount: number; excerpts: unknown[] }
  >();
  for (const row of rows) {
    let entry = byModel.get(row.model);
    if (!entry) {
      entry = { runCount: 0, mentionCount: 0, excerpts: [] };
      byModel.set(row.model, entry);
    }
    entry.runCount += 1;
    if (row.brandMentioned && brandName) {
      entry.mentionCount += 1;
      if (entry.excerpts.length < 10) {
        const excerpt = extractExcerpt(row.answerText, brandName);
        if (excerpt) {
          entry.excerpts.push({
            runId: row.runId,
            promptId: row.promptId,
            promptText: row.promptText,
            excerpt,
            position: row.brandPosition,
            createdAt: row.createdAt.toISOString(),
          });
        }
      }
    }
  }

  const result = [...byModel.entries()]
    .map(([model, e]) => ({
      model,
      runCount: e.runCount,
      mentionCount: e.mentionCount,
      mentionRatePct:
        e.runCount > 0 ? Math.round((e.mentionCount / e.runCount) * 1000) / 10 : 0,
      excerpts: e.excerpts,
    }))
    .sort((a, b) => b.runCount - a.runCount);

  res.json(result);
});

export default router;
