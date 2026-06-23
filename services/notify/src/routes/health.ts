import { Router } from "express";

export function healthRouter(): Router {
  const r = Router();
  r.get("/", (_req, res) => res.json({ status: "ok", service: "notify" }));
  return r;
}
