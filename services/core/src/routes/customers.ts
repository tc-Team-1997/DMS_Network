import { Router } from "express";
import { requireAuth, requirePermission } from "../middleware.js";
import { buildCustomerProfile } from "../modules/customer360.js";
import type { CoreDeps } from "../deps.js";

export function customersRouter(): Router {
  const r = Router();
  r.use(requireAuth);
  r.get("/:cid", requirePermission("document:read"), async (req, res) => {
    try {
      const { knex } = req.app.locals.deps as CoreDeps;
      res.json({ profile: await buildCustomerProfile(knex, req.params.cid) });
    } catch (e: any) { res.status(500).json({ error: "internal" }); }
  });
  return r;
}
