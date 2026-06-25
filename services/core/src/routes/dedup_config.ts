/**
 * Admin: Dedup Config endpoints
 *
 * GET  /admin/dedup-config   (RBAC: admin:read)
 * PUT  /admin/dedup-config   (RBAC: admin:write)
 *
 * Shape: { enabled:boolean, matchBy:string[], action:"flag"|"auto_version", fuzzyThreshold:number }
 */

import { Router } from "express";
import { requireAuth, requirePermission } from "@zordms/auth";
import type { CoreDeps } from "../deps.js";
import { getDedupConfig, setDedupConfig } from "../repo/duplicates.js";

const VALID_MATCH_BY = new Set(["hash", "cid", "doc_no"]);
const VALID_ACTIONS = new Set(["flag", "auto_version"]);

export function dedupConfigRouter(): Router {
  const r = Router();
  r.use(requireAuth);

  // GET /admin/dedup-config
  r.get("/dedup-config", requirePermission("admin:access"), async (req, res) => {
    try {
      const { knex } = req.app.locals.deps as CoreDeps;
      const cfg = await getDedupConfig(knex);
      res.json({ dedupConfig: cfg });
    } catch (e: any) {
      res.status(500).json({ error: "internal", detail: String(e?.message ?? e) });
    }
  });

  // PUT /admin/dedup-config
  r.put("/dedup-config", requirePermission("admin:access"), async (req, res) => {
    try {
      const { knex } = req.app.locals.deps as CoreDeps;
      const body = req.body as Record<string, unknown>;

      // Validate
      const errors: string[] = [];

      if (body.enabled !== undefined && typeof body.enabled !== "boolean") {
        errors.push("enabled must be boolean");
      }
      if (body.matchBy !== undefined) {
        if (!Array.isArray(body.matchBy)) {
          errors.push("matchBy must be an array");
        } else {
          const invalid = (body.matchBy as string[]).filter((m) => !VALID_MATCH_BY.has(m));
          if (invalid.length > 0) errors.push(`matchBy contains invalid values: ${invalid.join(", ")}`);
        }
      }
      if (body.action !== undefined && !VALID_ACTIONS.has(body.action as string)) {
        errors.push(`action must be one of: ${[...VALID_ACTIONS].join(", ")}`);
      }
      if (body.fuzzyThreshold !== undefined) {
        const ft = Number(body.fuzzyThreshold);
        if (isNaN(ft) || ft < 0 || ft > 1) errors.push("fuzzyThreshold must be a number between 0 and 1");
      }

      if (errors.length > 0) {
        res.status(422).json({ errors });
        return;
      }

      const updated = await setDedupConfig(knex, {
        enabled: body.enabled as boolean | undefined,
        matchBy: body.matchBy as string[] | undefined,
        action: body.action as "flag" | "auto_version" | undefined,
        fuzzyThreshold: body.fuzzyThreshold !== undefined ? Number(body.fuzzyThreshold) : undefined,
      });

      res.json({ dedupConfig: updated });
    } catch (e: any) {
      res.status(500).json({ error: "internal", detail: String(e?.message ?? e) });
    }
  });

  return r;
}
