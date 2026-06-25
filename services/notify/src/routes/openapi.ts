import { Router } from "express";
import { buildOpenApiDocument } from "../openapi.js";

/**
 * Serves the OpenAPI 3.1 document at:
 *   GET /openapi.json  — the full spec (no auth; describes the public API)
 *   GET /openapi       — raw alias
 *
 * The document is generated once at startup from the zod schemas.
 */
export function openapiRouter(): Router {
  const r = Router();
  const doc = buildOpenApiDocument();
  r.get("/openapi.json", (_req, res) => res.json(doc));
  r.get("/openapi", (_req, res) => res.json(doc));
  return r;
}
