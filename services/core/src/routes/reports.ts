import { Router } from "express";
import type { Knex } from "knex";
import { requireAuth, requirePermission } from "@zordms/auth";
import { validateBody } from "../openapi/validate.js";
import { RunReportSchema, SaveReportSchema } from "../openapi/schemas.js";
import {
  runReport, toCsv, listSources, listDefinitions, getDefinition, createDefinition, deleteDefinition, ReportSpecError,
} from "../repo/reports.js";

/**
 * §4.10 Reports module — report builder over core-owned tables.
 * Admin-only (admin:access), behind the gateway-issued JWT.
 */
export function reportsRouter(): Router {
  const r = Router();
  r.use(requireAuth);
  r.use(requirePermission("admin:access"));

  // GET /reports/sources — whitelisted sources + groupable/numeric columns.
  r.get("/sources", (_req, res) => res.json({ sources: listSources() }));

  // POST /reports/run — ad-hoc report.
  r.post("/run", validateBody(RunReportSchema), async (req, res) => {
    try {
      const { knex } = req.app.locals.deps as { knex: Knex };
      const result = await runReport(knex, {
        source: req.body.source,
        groupBy: req.body.group_by,
        measures: req.body.measures,
        filters: req.body.filters,
      });
      res.json(result);
    } catch (e: any) {
      if (e instanceof ReportSpecError) { res.status(400).json({ error: e.message }); return; }
      res.status(500).json({ error: "internal", detail: String(e?.message ?? e) });
    }
  });

  // ── Library (saved definitions) ───────────────────────────────────────────
  r.get("/library", async (req, res) => {
    try {
      const { knex } = req.app.locals.deps as { knex: Knex };
      res.json({ reports: await listDefinitions(knex) });
    } catch (e: any) { res.status(500).json({ error: "internal", detail: String(e?.message ?? e) }); }
  });

  r.post("/library", validateBody(SaveReportSchema), async (req, res) => {
    try {
      const { knex } = req.app.locals.deps as { knex: Knex };
      const def = await createDefinition(knex, {
        name: req.body.name,
        description: req.body.description,
        source: req.body.source,
        groupBy: req.body.group_by,
        measures: req.body.measures,
        filters: req.body.filters,
        createdBy: req.authUser!.username,
      });
      res.status(201).json({ report: def });
    } catch (e: any) {
      if (e instanceof ReportSpecError) { res.status(400).json({ error: e.message }); return; }
      res.status(500).json({ error: "internal", detail: String(e?.message ?? e) });
    }
  });

  r.get("/library/:id", async (req, res) => {
    try {
      const { knex } = req.app.locals.deps as { knex: Knex };
      const def = await getDefinition(knex, req.params.id);
      if (!def) { res.status(404).json({ error: "not_found" }); return; }
      res.json({ report: def });
    } catch (e: any) { res.status(500).json({ error: "internal", detail: String(e?.message ?? e) }); }
  });

  r.delete("/library/:id", async (req, res) => {
    try {
      const { knex } = req.app.locals.deps as { knex: Knex };
      const ok = await deleteDefinition(knex, req.params.id);
      if (!ok) { res.status(404).json({ error: "not_found" }); return; }
      res.json({ deleted: true });
    } catch (e: any) { res.status(500).json({ error: "internal", detail: String(e?.message ?? e) }); }
  });

  // GET /reports/library/:id/export — run a saved report → CSV.
  r.get("/library/:id/export", async (req, res) => {
    try {
      const { knex } = req.app.locals.deps as { knex: Knex };
      const def = await getDefinition(knex, req.params.id);
      if (!def) { res.status(404).json({ error: "not_found" }); return; }
      const result = await runReport(knex, { source: def.source, groupBy: def.groupBy, measures: def.measures, filters: def.filters });
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="report-${def.id}.csv"`);
      res.send(toCsv(result));
    } catch (e: any) {
      if (e instanceof ReportSpecError) { res.status(400).json({ error: e.message }); return; }
      res.status(500).json({ error: "internal", detail: String(e?.message ?? e) });
    }
  });

  return r;
}
