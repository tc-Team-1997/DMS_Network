import { Router } from "express";
import type { RealtimeHub } from "../realtime/hub.js";
import { sseHandler } from "../realtime/sse.js";

export function streamRouter(hub: RealtimeHub): Router {
  const r = Router();
  r.get("/stream", sseHandler(hub));
  return r;
}
