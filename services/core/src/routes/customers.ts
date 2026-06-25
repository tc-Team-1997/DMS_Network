import { Router } from "express";
import { requireAuth, requirePermission } from "@zordms/auth";
import { buildCustomerProfile } from "../modules/customer360.js";
import type { CoreDeps } from "../deps.js";

export function customersRouter(): Router {
  const r = Router();
  r.use(requireAuth);
  r.get("/:cid", requirePermission("document:read"), async (req, res) => {
    try {
      const { knex } = req.app.locals.deps as CoreDeps;
      const profile = await buildCustomerProfile(knex, req.params.cid);
      // P7: enrich with the CBS-sourced master record (upserted via /integration/customer-upsert)
      const master = await knex("customers").where({ cid: req.params.cid }).first();
      res.json({ profile: { ...profile, master: master ?? null } });
    } catch (e: any) { res.status(500).json({ error: "internal" }); }
  });
  return r;
}
