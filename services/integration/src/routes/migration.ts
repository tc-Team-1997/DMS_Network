import { Router, type NextFunction, type Request, type Response } from "express";
import type { Knex } from "knex";
import { requireAuth, requirePermission } from "@zordms/auth";
import { RunMigrationSchema, parseOr400 } from "../validation.js";
import { JsonlSourceAdapter, ObjectSourceAdapter } from "../migration/jsonl.js";
import { runMigration, StagingDocumentSink } from "../migration/run.js";

/**
 * §6.15 Krystal legacy-migration routes. Accepts a JSONL manifest (or inline
 * records), runs the source-format-agnostic staging pipeline, and reports a job
 * summary. The real Krystal export format/transport plugs in as a SourceAdapter
 * (blocked on §9.6); until then JSONL is the intermediate the export targets.
 */
export function migrationRouter(): Router {
  const r = Router();
  r.use(requireAuth);

  r.post("/krystal/run", requirePermission("integration:manage"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { knex } = req.app.locals.deps as { knex: Knex };
      const body = parseOr400(RunMigrationSchema, req.body, res);
      if (!body) return;
      const adapter = body.manifest != null
        ? new JsonlSourceAdapter(body.manifest)
        : new ObjectSourceAdapter(body.records ?? []);
      const result = await runMigration(knex, {
        source: body.source ?? "krystal",
        adapter,
        sink: new StagingDocumentSink(),
        dryRun: body.dryRun,
      });
      res.status(200).json(result);
    } catch (err) { next(err); }
  });

  r.get("/jobs", requirePermission("integration:read"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { knex } = req.app.locals.deps as { knex: Knex };
      const jobs = (await knex("migration_jobs").orderBy("started_at", "desc").limit(50))
        .map((j: any) => ({ ...j, dry_run: Boolean(j.dry_run) }));
      res.json({ jobs });
    } catch (err) { next(err); }
  });

  r.get("/jobs/:id", requirePermission("integration:read"), async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { knex } = req.app.locals.deps as { knex: Knex };
      const job = await knex("migration_jobs").where({ id: req.params.id }).first();
      if (!job) { res.status(404).json({ error: "not_found" }); return; }
      const records = await knex("migration_records").where({ job_id: req.params.id }).limit(500);
      res.json({ job: { ...job, dry_run: Boolean(job.dry_run) }, records });
    } catch (err) { next(err); }
  });

  return r;
}
