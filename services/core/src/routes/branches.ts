import { Router } from "express";
import { requireAuth, requirePermission } from "@zordms/auth";
import { listBranches, addBranch, listAccessPolicies, setAccessPolicy } from "../modules/branches.js";
import type { CoreDeps } from "../deps.js";

export function branchesRouter(): Router {
  const r = Router();
  r.use(requireAuth);

  r.get("/", requirePermission("crossbranch:read"), async (req, res) => {
    try {
      const { knex } = req.app.locals.deps as CoreDeps;
      res.json({ branches: await listBranches(knex) });
    } catch (e: any) { res.status(500).json({ error: "internal" }); }
  });

  r.post("/", requirePermission("admin:access"), async (req, res) => {
    try {
      const { knex } = req.app.locals.deps as CoreDeps;
      if (!req.body?.code || !req.body?.name) { res.status(400).json({ error: "code_and_name_required" }); return; }
      res.status(201).json({ branch: await addBranch(knex, req.body) });
    } catch (e: any) { res.status(500).json({ error: "internal" }); }
  });

  r.get("/access", requirePermission("crossbranch:read"), async (req, res) => {
    try {
      const { knex } = req.app.locals.deps as CoreDeps;
      res.json({ policies: await listAccessPolicies(knex) });
    } catch (e: any) { res.status(500).json({ error: "internal" }); }
  });

  r.post("/access", requirePermission("admin:access"), async (req, res) => {
    try {
      const { knex } = req.app.locals.deps as CoreDeps;
      const { source_branch, target_branch } = req.body ?? {};
      if (!source_branch || !target_branch) { res.status(400).json({ error: "source_and_target_required" }); return; }
      res.status(201).json({ policy: await setAccessPolicy(knex, req.body) });
    } catch (e: any) { res.status(500).json({ error: "internal" }); }
  });

  return r;
}
