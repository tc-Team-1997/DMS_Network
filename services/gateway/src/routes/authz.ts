import { Router } from "express";
import type { Knex } from "knex";
import type { AppConfig } from "@zordms/config";
import { resolveUserAuthz, canAll } from "@zordms/auth";
import { timingSafeEqual } from "crypto";

export function authzRouter(): Router {
  const r = Router();

  r.post("/check", async (req, res) => {
    const { knex, config } = req.app.locals.deps as { knex: Knex; config: AppConfig };

    // Fix 2: require internal service token to prevent unauthenticated permission enumeration
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

    // Validate input — userId must be a non-empty string, permissions must be array of strings
    const { userId, permissions } = req.body as { userId: unknown; permissions: unknown };
    if (typeof userId !== "string" || userId.trim() === "") {
      res.status(400).json({ error: "userId must be a non-empty string" }); return;
    }
    if (!Array.isArray(permissions) || permissions.some((p) => typeof p !== "string")) {
      res.status(400).json({ error: "permissions must be an array of strings" }); return;
    }

    const authz = await resolveUserAuthz(knex, userId as any);
    const missing = permissions.filter((p) => !authz.permissions.includes(p));
    res.json({ allowed: canAll(authz, permissions), missing });
  });

  return r;
}
