import { Router } from "express";
import type { Knex } from "knex";
import type { AppConfig } from "@zordms/config";
import { resolveUserAuthz, canAll } from "@zordms/auth";
import { timingSafeEqual } from "crypto";
import { validate } from "../middleware/validate.js";
import { AuthzCheckBodySchema, type AuthzCheckBody } from "../schemas.js";

export function authzRouter(): Router {
  const r = Router();

  // Inbound integration auth: require the shared internal service token. (The
  // x-internal-token is verified in constant time; HMAC-signed inbound callers
  // present the same token alongside their signature at the integration layer.)
  function requireInternalToken(
    req: Parameters<Parameters<typeof r.post>[1]>[0],
    res: Parameters<Parameters<typeof r.post>[1]>[1],
    next: () => void,
  ): void {
    const { config } = req.app.locals.deps as { config: AppConfig };
    const provided = req.headers["x-internal-token"] ?? "";
    const expected = config.internalServiceToken;

    // Reject if configured token is empty (never allow)
    if (!expected || expected.length === 0) {
      res.status(401).json({ error: "unauthorized" }); return;
    }

    const providedBuf = Buffer.from(String(provided).padEnd(expected.length, "\0").slice(0, expected.length));
    const expectedBuf = Buffer.from(expected);
    const valid = providedBuf.length === expectedBuf.length && timingSafeEqual(providedBuf, expectedBuf);
    // Also reject when actual lengths differ (padded comparison above is safe but lengths must match too)
    if (!valid || String(provided).length !== expected.length) {
      res.status(401).json({ error: "unauthorized" }); return;
    }
    next();
  }

  r.post("/check", requireInternalToken, validate(AuthzCheckBodySchema), async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    const { userId, permissions } = req.body as AuthzCheckBody;

    const authz = await resolveUserAuthz(knex, userId as any);
    const missing = permissions.filter((p) => !authz.permissions.includes(p));
    res.json({ allowed: canAll(authz, permissions), missing });
  });

  return r;
}
