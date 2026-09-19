import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { Server } from "node:http";
import {
  audienceRecommendationsTable,
  companiesTable,
  db,
  moneyTopicsTable,
  promptsTable,
  websiteAssessmentJobsTable,
} from "@workspace/db";

// Onboarding idempotency is an HTTP/transaction concern, not an assessment
// provider test. Keep this suite from initiating crawl/model work.
vi.mock("../../lib/simulate", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, isConfigured: () => false };
});
import app from "../../app";

describe("POST /api/discovery/recommendations/bulk-add", () => {
  let server: Server;
  let base: string;
  let companyId: number;

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    const address = server.address();
    base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
    const [company] = await db
      .insert(companiesTable)
      .values({ name: "Canonical Topic Test", domain: `canonical-topic-${Date.now()}.example` })
      .returning();
    companyId = company!.id;
  });

  afterAll(async () => {
    await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("uses an equivalent prompt's existing topic instead of persisting conflicting recommendation topic data", async () => {
    const [canonicalTopic] = await db
      .insert(moneyTopicsTable)
      .values({ companyId, topic: "Canonical topic" })
      .returning();
    await db.insert(moneyTopicsTable).values({ companyId, topic: "Generated topic" });
    const [prompt] = await db
      .insert(promptsTable)
      .values({
        companyId,
        text: "What should a buyer choose?",
        topic: "Canonical topic",
        moneyTopicId: canonicalTopic!.id,
      })
      .returning();
    const [job] = await db.insert(websiteAssessmentJobsTable).values({ companyId }).returning();
    const [recommendation] = await db
      .insert(audienceRecommendationsTable)
      .values({
        jobId: job!.id,
        companyId,
        question: prompt!.text,
        normalizedQuestion: prompt!.text.toLowerCase(),
        moneyTopic: "Generated topic",
        persona: "Buyer",
        intent: "Evaluate options",
        rationale: "A buyer question.",
        researchEvidence: [],
      })
      .returning();

    const listResponse = await fetch(
      `${base}/api/discovery/recommendations?companyId=${companyId}&status=all`,
    );
    expect(listResponse.status).toBe(200);
    const listed = await listResponse.json() as Array<{ id: number }>;
    expect(listed.some((item) => item.id === recommendation!.id)).toBe(true);

    const response = await fetch(
      `${base}/api/discovery/recommendations/bulk-add?companyId=${companyId}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ recommendationIds: [recommendation!.id] }),
      },
    );
    expect(response.status).toBe(200);
    const [updated] = await db
      .select()
      .from(audienceRecommendationsTable)
      .where(eq(audienceRecommendationsTable.id, recommendation!.id));
    expect(updated!.createdPromptId).toBe(prompt!.id);
    expect(updated!.moneyTopicId).toBe(canonicalTopic!.id);
    expect(updated!.moneyTopic).toBe(canonicalTopic!.topic);
  });

  it("serializes concurrent onboarding for one normalized domain", async () => {
    const domain = `onboarding-idempotency-${Date.now()}-${Math.random().toString(36).slice(2)}.example`;
    const payload = { name: "Idempotent onboarding", domain: ` HTTPS://${domain}/ ` };
    const responses = await Promise.all(
      [fetch(`${base}/api/companies`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }), fetch(`${base}/api/companies`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      })],
    );
    expect(responses.map((response) => response.status)).toEqual([201, 201]);
    const companies = await Promise.all(responses.map((response) => response.json())) as Array<{ id: number }>;
    expect(companies[0]!.id).toBe(companies[1]!.id);

    const rows = await db
      .select()
      .from(companiesTable)
      .where(eq(companiesTable.domain, domain));
    expect(rows).toHaveLength(1);
    await db.delete(companiesTable).where(eq(companiesTable.id, companies[0]!.id));
  });
});