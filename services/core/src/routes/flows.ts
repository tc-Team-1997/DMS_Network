import { Router } from "express";
import { requireAuth, requirePermission } from "@zordms/auth";
import { listFlowLanes, getFlowLane } from "../modules/flows.js";

/**
 * SC-07 — system-flow lane definitions for the Document Lifecycle screen.
 * Read-only; gated on lifecycle:read.
 */
export function flowsRouter(): Router {
  const r = Router();
  r.use(requireAuth);

  r.get("/", requirePermission("document:read"), (_req, res) => {
    res.json({ lanes: listFlowLanes() });
  });

  r.get("/:lane", requirePermission("document:read"), (req, res) => {
    const lane = getFlowLane(req.params.lane);
    if (!lane) { res.status(404).json({ error: "not_found" }); return; }
    res.json({ lane });
  });

  return r;
}
