import { Router } from "express";
import type { Knex } from "knex";
import type { AppConfig } from "@zordms/config";
import { verifyPassword, verifyTotp, signToken, resolveUserAuthz } from "@zordms/auth";
import type { LoginRequest } from "@zordms/types";
import { writeAudit } from "../middleware/audit.js";
import { requireAuth } from "../middleware/requireAuth.js";

export function authRouter(): Router {
  const r = Router();

  r.post("/login", async (req, res) => {
    try {
      const { knex, config } = req.app.locals.deps as { knex: Knex; config: AppConfig };
      const { username, password, totp } = req.body as LoginRequest;
      const user = await knex("users").where({ username }).first();

      // Fix 1: check Locked BEFORE verifyPassword to prevent password oracle
      if (user && user.status === "Locked") {
        res.status(403).json({ error: "account_locked" }); return;
      }
      // Fix 1: only now verify password — wrong password or missing user → 401
      if (!user || !(await verifyPassword(password, user.password_hash))) {
        res.status(401).json({ error: "invalid_credentials" }); return;
      }

      if (user.mfa_enabled) {
        // Fix 5: guard null mfa_secret — treat as MFA not configured
        if (!user.mfa_secret) {
          res.status(401).json({ error: "mfa_required", mfaRequired: true }); return;
        }
        if (!totp || !verifyTotp(user.mfa_secret, totp)) {
          res.status(401).json({ mfaRequired: true, error: "mfa_required" }); return;
        }
      }

      // user.id is now a UUID string; cast to any to satisfy the legacy number signature in resolveUserAuthz
      const authz = await resolveUserAuthz(knex, user.id as any);
      // Embed RBAC claims so downstream microservices can authorize from the
      // token without their own user DB (the gateway re-checks status on its
      // own routes; downstream services trust the gateway-issued claims).
      const token = signToken({
        sub: user.id,
        username: user.username,
        roles: authz.roles,
        permissions: authz.permissions,
        branch: user.branch ?? undefined,
        region: user.region ?? undefined,
      }, config.jwtSecret);
      await writeAudit(knex, { actor_id: user.id, actor_username: user.username, action: "LOGIN" });
      res.json({
        token,
        user: { id: user.id, username: user.username, roles: authz.roles, permissions: authz.permissions, branch: user.branch, region: user.region },
      });
    } catch {
      // Fix 5: catch unhandled errors — return 500 rather than crashing
      res.status(500).json({ error: "login_failed" });
    }
  });

  r.get("/me", requireAuth, (req, res) => res.json({ user: req.authUser }));

  return r;
}
