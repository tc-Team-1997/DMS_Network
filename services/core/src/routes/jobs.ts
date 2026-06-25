/**
 * P8: Job status + monitor endpoints.
 *
 *   GET /jobs/:id              -> { status, attempts, result, last_error, ... }
 *                                 (any authenticated user — poll your own job)
 *   GET /jobs?status=&type=    -> { counts, jobs } admin monitor (RBAC admin:access)
 */
import { Router } from "express";
import { requireAuth, requirePermission } from "@zordms/auth";
import type { CoreDeps } from "../deps.js";
import { getJob, listJobs, jobCounts, type JobStatus } from "../queue/index.js";

const STATUSES: JobStatus[] = ["queued", "running", "succeeded", "failed", "dead"];

export function jobsRouter(): Router {
  const r = Router();
  r.use(requireAuth);

  // Admin monitor: counts + recent jobs (optionally filtered). RBAC: admin:access.
  r.get("/", requirePermission("admin:access"), async (req, res) => {
    const deps = req.app.locals.deps as CoreDeps;
    const status = typeof req.query.status === "string" && STATUSES.includes(req.query.status as JobStatus)
      ? (req.query.status as JobStatus)
      : undefined;
    const type = typeof req.query.type === "string" ? req.query.type : undefined;
    const limit = req.query.limit ? Math.min(Number(req.query.limit) || 50, 200) : 50;

    const [counts, jobs] = await Promise.all([
      jobCounts(deps.knex),
      listJobs(deps.knex, { status, type, limit }),
    ]);
    res.json({ counts, jobs });
  });

  // Single job status (poll). Any authenticated user.
  r.get("/:id", async (req, res) => {
    const deps = req.app.locals.deps as CoreDeps;
    const job = await getJob(deps.knex, req.params.id);
    if (!job) { res.status(404).json({ error: "not_found" }); return; }
    res.json({
      id: job.id,
      type: job.type,
      status: job.status,
      attempts: job.attempts,
      maxAttempts: job.maxAttempts,
      result: job.result,
      last_error: job.lastError,
      availableAt: job.availableAt,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    });
  });

  return r;
}
