import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import type { Server } from "node:http";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

/**
 * Cost-abuse guard for the live contract audit: unauthorized callers and
 * callers inside the durable cooldown window must never be able to initiate
 * paid provider calls. runSimulation is mocked to detect any attempt.
 */
const runSimulationSpy = vi.hoisted(() =>
  vi.fn(async () => {
    throw new Error("provider call must not be initiated by guarded requests");
  }),
);
vi.mock("../../lib/simulate", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    isConfigured: () => true,
    runSimulation: runSimulationSpy,
  };
});

import modelsRouter from "../models";
import { claimAuditSlot, AUDIT_COOLDOWN_MINUTES } from "../../lib/contractAudit";
import { expectedOperatorToken } from "../../lib/operatorAuth";

let server: Server;
let base: string;

beforeAll(async () => {
  process.env["SESSION_SECRET"] = process.env["SESSION_SECRET"] || "test-session-secret";
  const app = express();
  app.use(modelsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function setLastStartedAt(sqlExpr: string): Promise<void> {
  await db.execute(sql`
    INSERT INTO contract_audit_state (id, last_started_at)
    VALUES (1, ${sql.raw(sqlExpr)})
    ON CONFLICT (id) DO UPDATE SET last_started_at = ${sql.raw(sqlExpr)}
  `);
}

describe("contract-audit operator guard", () => {
  it("derives a stable operator token from SESSION_SECRET when OPERATOR_TOKEN is unset", () => {
    const expected = createHash("sha256")
      .update(`operator:${process.env["SESSION_SECRET"]}`)
      .digest("hex");
    if (!process.env["OPERATOR_TOKEN"]) {
      expect(expectedOperatorToken()).toBe(expected);
    } else {
      expect(expectedOperatorToken()).toBe(process.env["OPERATOR_TOKEN"]);
    }
  });

  it("rejects POST without a token and initiates no provider calls", async () => {
    const res = await fetch(`${base}/models/contract-audit`, { method: "POST" });
    expect(res.status).toBe(401);
    expect(runSimulationSpy).not.toHaveBeenCalled();
  });

  it("rejects POST with a wrong token and initiates no provider calls", async () => {
    const res = await fetch(`${base}/models/contract-audit`, {
      method: "POST",
      headers: { "x-operator-token": "wrong-token-wrong-token" },
    });
    expect(res.status).toBe(401);
    expect(runSimulationSpy).not.toHaveBeenCalled();
  });

  it("rejects GET without a token (report is operator-only)", async () => {
    const res = await fetch(`${base}/models/contract-audit`);
    expect(res.status).toBe(401);
  });

  it("returns 429 inside the durable cooldown window without initiating provider calls", async () => {
    await setLastStartedAt("now()");
    const res = await fetch(`${base}/models/contract-audit`, {
      method: "POST",
      headers: { "x-operator-token": expectedOperatorToken()! },
    });
    expect(res.status).toBe(429);
    const body = (await res.json()) as { lastStartedAt?: string };
    expect(body.lastStartedAt).toBeTruthy();
    expect(runSimulationSpy).not.toHaveBeenCalled();
  });

  it("claimAuditSlot is atomic: one claim per cooldown window, even for racing callers", async () => {
    await setLastStartedAt(`now() - make_interval(mins => ${AUDIT_COOLDOWN_MINUTES + 1})`);
    const results = await Promise.all([claimAuditSlot(), claimAuditSlot(), claimAuditSlot()]);
    expect(results.filter((r) => r.claimed)).toHaveLength(1);
    // Window is now consumed durably.
    const again = await claimAuditSlot();
    expect(again.claimed).toBe(false);
    expect(again.lastStartedAt).toBeTruthy();
  });
});
