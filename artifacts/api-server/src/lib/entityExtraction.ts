import OpenAI from "openai";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db, promptRunsTable, runAnswerEntitiesTable } from "@workspace/db";
import { logger } from "./logger";
import { classifyEntityRelationship, type EntityRelationship } from "./visibilityRung";

export const ENTITY_EXTRACTOR_VERSION = "answer-entities-v3";
export const ENTITY_EXTRACTION_MODEL = "openai/gpt-5-mini";

const MAX_ANSWER_CHARS = 12_000;
const MAX_ENTITIES = 20;
const MAX_ATTEMPTS = 2;
const MODEL_TIMEOUT_MS = 45_000;
const BACKFILL_PAGE_SIZE = 100;
const MAX_BACKFILL_PAGES = 10;
export type { EntityRelationship };

export interface ProposedEntity {
  name: string;
}

export interface GroundedEntity {
  name: string;
  normalizedName: string;
  relationship: EntityRelationship;
  observedReason: string;
  evidenceExcerpt: string;
}

export function normalizeEntityName(name: string): string {
  return name.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function entityMatch(answerText: string, name: string): RegExpExecArray | null {
  const cleaned = name.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (cleaned.length < 2 || cleaned.length > 120) return null;
  const escaped = cleaned
    .split(" ")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "iu").exec(
    answerText,
  );
}

/** Build auditable evidence from the original answer, never from model-supplied text. */
export function evidenceExcerptFor(
  answerText: string,
  name: string,
  contextChars = 100,
): string | null {
  const match = entityMatch(answerText, name);
  if (!match) return null;
  const start = Math.max(0, match.index - contextChars);
  const end = Math.min(answerText.length, match.index + match[0].length + contextChars);
  return `${start > 0 ? "…" : ""}${answerText.slice(start, end).trim()}${
    end < answerText.length ? "…" : ""
  }`;
}

/**
 * Validate, ground and deduplicate untrusted model output. The first occurrence
 * wins, preserving model order while ensuring every persisted name occurs as a
 * whole entity name in the answer.
 */
export function groundAndDedupeEntities(
  answerText: string,
  proposed: ProposedEntity[],
  limit = MAX_ENTITIES,
): GroundedEntity[] {
  const grounded: GroundedEntity[] = [];
  const seen = new Set<string>();
  for (const candidate of proposed) {
    if (grounded.length >= limit) break;
    if (
      !candidate ||
      typeof candidate.name !== "string"
    ) {
      continue;
    }
    const normalizedName = normalizeEntityName(candidate.name);
    if (!normalizedName || seen.has(normalizedName)) continue;
    const match = entityMatch(answerText, candidate.name);
    if (!match) continue;
    // Prefer the complete organisation name when the model also emits a
    // nested prefix (for example "Acme" and "Acme Labs" at the same offset).
    const nestedInLongerName = proposed.some((other) => {
      if (other === candidate || typeof other.name !== "string") return false;
      const otherNormalized = normalizeEntityName(other.name);
      if (
        otherNormalized.length <= normalizedName.length ||
        !otherNormalized.startsWith(`${normalizedName} `)
      ) {
        return false;
      }
      const otherMatch = entityMatch(answerText, other.name);
      return otherMatch?.index === match.index;
    });
    if (nestedInLongerName) continue;
    const evidenceExcerpt = evidenceExcerptFor(answerText, candidate.name);
    if (!evidenceExcerpt) continue;
    seen.add(normalizedName);
    const relationship = classifyEntityRelationship(answerText, match[0]);
    grounded.push({
      name: match[0],
      normalizedName,
      relationship,
      observedReason:
        relationship === "recommended"
          ? `The saved answer recommended ${match[0]}.`
          : relationship === "compared"
            ? `The saved answer compared ${match[0]}.`
            : `The saved answer explicitly mentioned ${match[0]}.`,
      evidenceExcerpt,
    });
  }
  return grounded;
}

export function statusAfterFailure(attempts: number): "pending" | "failed" {
  return attempts >= MAX_ATTEMPTS ? "failed" : "pending";
}

const SYSTEM_PROMPT = `Extract named companies, organisations, products, and services explicitly present in the answer as subjects that are discussed.
Do not infer entities from URLs, citation domains, products without an explicitly named organisation, or outside knowledge.
Return one JSON object exactly shaped as {"entities":[{"name":"exact name from answer"}]}.
Return {"entities":[]} when none qualify. Include no more than ${MAX_ENTITIES} entities.`;

function parseProposals(content: string): ProposedEntity[] {
  const parsed: unknown = JSON.parse(content);
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { entities?: unknown }).entities)) {
    throw new Error("Entity extractor returned an invalid JSON object");
  }
  return (parsed as { entities: unknown[] }).entities
    .slice(0, MAX_ENTITIES)
    .filter((item): item is ProposedEntity => {
      if (!item || typeof item !== "object") return false;
      const value = item as Record<string, unknown>;
      return typeof value.name === "string";
    });
}

async function requestProposals(answerText: string): Promise<ProposedEntity[]> {
  const baseURL = process.env["OPENAI_BASE_URL"];
  const client = new OpenAI({
    apiKey: process.env["OPENAI_API_KEY"],
    ...(baseURL ? { baseURL } : {}),
    timeout: MODEL_TIMEOUT_MS,
    maxRetries: 0,
  });
  const response = await client.chat.completions.create(
    {
      model: ENTITY_EXTRACTION_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: answerText.slice(0, MAX_ANSWER_CHARS) },
      ],
      response_format: {
        type: "json_object",
      },
      max_completion_tokens: 2_000,
    },
    { timeout: MODEL_TIMEOUT_MS },
  );
  const content = response.choices[0]?.message.content;
  if (!content) throw new Error("Entity extractor returned no content");
  return parseProposals(content);
}

async function extractWithOneRetry(answerText: string): Promise<GroundedEntity[]> {
  if (!answerText.trim()) return [];
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      return groundAndDedupeEntities(answerText, await requestProposals(answerText));
    } catch (err) {
      lastError = err;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw lastError;
}

async function claimNextRun(): Promise<typeof promptRunsTable.$inferSelect | null> {
  const [candidate] = await db
    .select()
    .from(promptRunsTable)
    .where(
      and(
        eq(promptRunsTable.entityExtractionStatus, "pending"),
        eq(promptRunsTable.entityExtractorVersion, ENTITY_EXTRACTOR_VERSION),
        sql`${promptRunsTable.entityExtractionAttempts} < ${MAX_ATTEMPTS}`,
      ),
    )
    .orderBy(desc(promptRunsTable.createdAt), desc(promptRunsTable.id))
    .limit(1);
  if (!candidate) return null;
  const [claimed] = await db
    .update(promptRunsTable)
    .set({
      entityExtractionStatus: "running",
      entityExtractionAttempts: sql`${promptRunsTable.entityExtractionAttempts} + 1`,
      entityExtractionStartedAt: new Date(),
      entityExtractionFinishedAt: null,
      entityExtractionError: null,
    })
    .where(
      and(
        eq(promptRunsTable.id, candidate.id),
        eq(promptRunsTable.entityExtractionStatus, "pending"),
        eq(promptRunsTable.entityExtractorVersion, ENTITY_EXTRACTOR_VERSION),
      ),
    )
    .returning();
  return claimed ?? null;
}

async function processOne(): Promise<"processed" | "retry_later" | "empty"> {
  const run = await claimNextRun();
  if (!run) return "empty";
  try {
    const entities = await extractWithOneRetry(run.answerText);
    await db.transaction(async (tx) => {
      await tx
        .delete(runAnswerEntitiesTable)
        .where(
          and(
            eq(runAnswerEntitiesTable.runId, run.id),
            eq(runAnswerEntitiesTable.extractorVersion, ENTITY_EXTRACTOR_VERSION),
          ),
        );
      if (entities.length > 0) {
        await tx.insert(runAnswerEntitiesTable).values(
          entities.map((entity) => ({
            runId: run.id,
            ...entity,
            extractorVersion: ENTITY_EXTRACTOR_VERSION,
          })),
        );
      }
      await tx
        .update(promptRunsTable)
        .set({
          entityExtractionStatus: "completed",
          entityExtractionFinishedAt: new Date(),
          entityExtractionError: null,
        })
        .where(eq(promptRunsTable.id, run.id));
    });
    logger.info({ runId: run.id, entityCount: entities.length }, "Answer entity extraction completed");
    return "processed";
  } catch (err) {
    const status = statusAfterFailure(run.entityExtractionAttempts);
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(promptRunsTable)
      .set({
        entityExtractionStatus: status,
        entityExtractionError: message.slice(0, 500),
        entityExtractionFinishedAt: status === "failed" ? new Date() : null,
      })
      .where(eq(promptRunsTable.id, run.id));
    logger.warn(
      { err, runId: run.id, attempts: run.entityExtractionAttempts, status },
      "Answer entity extraction failed",
    );
    return status === "pending" ? "retry_later" : "processed";
  }
}

let draining = false;
let started = false;
let retryTimer: NodeJS.Timeout | null = null;
let wakeRequested = false;

export function wakeEntityExtractionWorker(): void {
  wakeRequested = true;
  if (!started || draining || !process.env["OPENAI_API_KEY"]) return;
  draining = true;
  wakeRequested = false;
  void (async () => {
    try {
      for (;;) {
        const result = await processOne();
        if (result === "empty") break;
        if (result === "retry_later") {
          retryTimer = setTimeout(() => {
            retryTimer = null;
            wakeEntityExtractionWorker();
          }, 2_000);
          retryTimer.unref();
          break;
        }
      }
    } catch (err) {
      logger.error({ err }, "Answer entity extraction worker stopped unexpectedly");
      retryTimer = setTimeout(() => {
        retryTimer = null;
        wakeEntityExtractionWorker();
      }, 5_000);
      retryTimer.unref();
    } finally {
      draining = false;
      if (wakeRequested && !retryTimer) wakeEntityExtractionWorker();
    }
  })();
}

async function prepareQueue(): Promise<void> {
  await db
    .update(promptRunsTable)
    .set({ entityExtractionStatus: "pending", entityExtractionStartedAt: null })
    .where(
      and(
        eq(promptRunsTable.entityExtractionStatus, "running"),
        sql`${promptRunsTable.entityExtractionAttempts} < ${MAX_ATTEMPTS}`,
      ),
    );
  await db
    .update(promptRunsTable)
    .set({
      entityExtractionStatus: "failed",
      entityExtractionError: "Interrupted after maximum extraction attempts",
      entityExtractionFinishedAt: new Date(),
    })
    .where(
      and(
        eq(promptRunsTable.entityExtractionStatus, "running"),
        sql`${promptRunsTable.entityExtractionAttempts} >= ${MAX_ATTEMPTS}`,
      ),
    );

  for (let page = 0; page < MAX_BACKFILL_PAGES; page += 1) {
    const rows = await db
      .select({ id: promptRunsTable.id })
      .from(promptRunsTable)
      .where(
        and(
          sql`${promptRunsTable.createdAt} >= now() - interval '90 days'`,
          sql`${promptRunsTable.entityExtractorVersion} is distinct from ${ENTITY_EXTRACTOR_VERSION}`,
        ),
      )
      .orderBy(asc(promptRunsTable.createdAt), asc(promptRunsTable.id))
      .limit(BACKFILL_PAGE_SIZE);
    if (rows.length === 0) break;
    await db
      .update(promptRunsTable)
      .set({
        entityExtractionStatus: "pending",
        entityExtractorVersion: ENTITY_EXTRACTOR_VERSION,
        entityExtractionAttempts: 0,
        entityExtractionError: null,
        entityExtractionStartedAt: null,
        entityExtractionFinishedAt: null,
      })
      .where(inArray(promptRunsTable.id, rows.map((row) => row.id)));
    if (rows.length < BACKFILL_PAGE_SIZE) break;
  }
}

/** Initialize durable recovery/backfill once; extraction remains fully asynchronous. */
export function startEntityExtractionWorker(): void {
  if (started) return;
  started = true;
  void prepareQueue()
    .then(() => {
      if (!process.env["OPENAI_API_KEY"]) {
        logger.warn("Answer entity extraction is pending because OPENAI_API_KEY is not configured");
        return;
      }
      wakeEntityExtractionWorker();
    })
    .catch((err: unknown) => logger.error({ err }, "Failed to initialize answer entity extraction"));
}