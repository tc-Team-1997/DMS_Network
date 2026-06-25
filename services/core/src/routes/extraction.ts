/**
 * POST /documents/:id/extract  (RBAC: document:index)
 *
 * Enterprise AI Extraction + Auto-Classify pipeline.
 *
 * The full pipeline now lives in extraction/run.ts (runExtraction) so the SAME
 * logic is shared by:
 *   - this synchronous route (interactive single capture), and
 *   - the durable "extract" job handler (async / bulk, off the request path).
 *
 * Async mode (P8): POST /documents/:id/extract with { async: true } (or
 * POST /documents/:id/extract-async) ENQUEUES a durable "extract" job keyed by
 * document id (idempotent → never double-extracts) and returns 202
 * { jobId, status: "queued" }. The document's extraction_status reflects
 * queued → running → DONE / FAILED.
 */

import { Router } from "express";
import { requireAuth, requirePermission, makeViewer } from "@zordms/auth";
import type { CoreDeps } from "../deps.js";
import { runExtraction } from "../extraction/run.js";
import { enqueue } from "../queue/index.js";
import { extractIdempotencyKey } from "../worker/handlers.js";

function extractBearerToken(authHeader: string | undefined): string {
  if (!authHeader) return "";
  return authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
}

export function extractionRouter(): Router {
  const r = Router({ mergeParams: true });
  r.use(requireAuth);

  /** Shared async-enqueue path used by both ?async=true and /extract-async. */
  async function enqueueExtract(req: any, res: any): Promise<void> {
    const deps = req.app.locals.deps as CoreDeps;
    const docId = req.params.id;
    const viewer = makeViewer(req);

    // Branch-scoped existence check so we don't enqueue work for docs the
    // caller can't see (and so we can 404 like the sync path).
    const { getDocument } = await import("../repo/documents.js");
    const document = await getDocument(deps.knex, docId, viewer);
    if (!document) { res.status(404).json({ error: "not_found" }); return; }

    // Reflect queued state immediately so the UI can show progress.
    await deps.knex("documents").where({ id: docId }).update({ extraction_status: "QUEUED" });

    const job = await enqueue(
      deps.knex,
      "extract",
      { docId, bearer: extractBearerToken(req.headers.authorization), callerUsername: req.authUser!.username },
      { idempotencyKey: extractIdempotencyKey(docId), priority: 0 },
    );

    res.status(202).json({ jobId: job.id, status: "queued" });
  }

  /**
   * POST /documents/:id/extract
   * Sync: 200 on success, 404 not found, 500 on internal error.
   * Async (body.async===true): 202 { jobId, status:"queued" }.
   */
  r.post("/:id/extract", requirePermission("document:index"), async (req, res) => {
    if (req.body && req.body.async === true) { await enqueueExtract(req, res); return; }

    const deps = req.app.locals.deps as CoreDeps;
    const docId = req.params.id;
    const viewer = makeViewer(req);
    const bearer = extractBearerToken(req.headers.authorization);
    const callerUsername = req.authUser!.username;

    try {
      const outcome = await runExtraction(deps, docId, { bearer, callerUsername, viewer });
      if (!outcome.ok) {
        res.status(outcome.status).json({ error: outcome.reason });
        return;
      }
      res.json(outcome.result);
    } catch (err: any) {
      res.status(500).json({ error: "internal", detail: String(err?.message ?? err) });
    }
  });

  /** POST /documents/:id/extract-async — explicit async alias. */
  r.post("/:id/extract-async", requirePermission("document:index"), async (req, res) => {
    await enqueueExtract(req, res);
  });

  return r;
}
