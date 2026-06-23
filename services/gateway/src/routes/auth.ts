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
    const { knex, config } = req.app.locals.deps as { knex: Knex; config: AppConfig };
    const { username, password, totp } = req.body as LoginRequest;
    const user = await knex("users").where({ username }).first();
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      res.status(401).json({ error: "invalid_credentials" }); return;
    }
    if (user.status === "Locked") { res.status(403).json({ error: "account_locked" }); return; }
    if (user.mfa_enabled) {
      if (!totp || !verifyTotp(user.mfa_secret, totp)) {
        res.status(401).json({ mfaRequired: true, error: "mfa_required" }); return;
      }
    }
    const authz = await resolveUserAuthz(knex, user.id);
    const token = signToken({ sub: user.id, username: user.username }, config.jwtSecret);
    await writeAudit(knex, { actor_id: user.id, actor_username: user.username, action: "LOGIN" });
    res.json({
      token,
      user: { id: user.id, username: user.username, roles: authz.roles, permissions: authz.permissions, branch: user.branch, region: user.region },
    });
  });

  r.get("/me", requireAuth, (req, res) => res.json({ user: req.authUser }));

  return r;
}
