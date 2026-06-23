import { Router } from "express";
import type { RealtimeHub } from "../realtime/hub.js";
import { sseHandler } from "../realtime/sse.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { requirePermission } from "../middleware/requirePermission.js";

export function streamRouter(hub: RealtimeHub): Router {
  const r = Router();
  r.get("/stream", requireAuth, requirePermission("alert:read"), sseHandler(hub));
  return r;
}
