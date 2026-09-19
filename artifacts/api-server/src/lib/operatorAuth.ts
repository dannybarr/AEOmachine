import { createHash, timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";

/**
 * Operator-only route guard for endpoints that trigger paid provider work.
 *
 * The caller must present `x-operator-token`. The expected token is
 * `OPERATOR_TOKEN` when set; otherwise it is derived from SESSION_SECRET
 * (sha256 of "operator:" + SESSION_SECRET), so the guard is always
 * configured wherever the app can run and the session secret itself never
 * travels in a request. If neither secret exists the guard fails closed.
 *
 * An operator with workspace access prints the derived token with:
 *   node -e 'console.log(require("crypto").createHash("sha256").update("operator:"+process.env.SESSION_SECRET).digest("hex"))'
 */
export function expectedOperatorToken(): string | null {
  const explicit = process.env["OPERATOR_TOKEN"];
  if (explicit && explicit.length >= 16) return explicit;
  const sessionSecret = process.env["SESSION_SECRET"];
  if (!sessionSecret) return null;
  return createHash("sha256").update(`operator:${sessionSecret}`).digest("hex");
}

export function requireOperator(req: Request, res: Response, next: NextFunction): void {
  const expected = expectedOperatorToken();
  if (!expected) {
    res.status(503).json({ error: "Operator authentication is not configured" });
    return;
  }
  const provided = req.header("x-operator-token") ?? "";
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  if (!timingSafeEqual(a, b)) {
    res.status(401).json({ error: "Operator token required" });
    return;
  }
  next();
}
