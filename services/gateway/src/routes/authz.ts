import { Router } from "express";
import type { Knex } from "knex";
import { resolveUserAuthz, canAll } from "@zordms/auth";

export function authzRouter(): Router {
  const r = Router();
  r.post("/check", async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    const { userId, permissions } = req.body as { userId: number; permissions: string[] };
    const authz = await resolveUserAuthz(knex, userId);
    const missing = permissions.filter((p) => !authz.permissions.includes(p));
    res.json({ allowed: canAll(authz, permissions), missing });
  });
  return r;
}
