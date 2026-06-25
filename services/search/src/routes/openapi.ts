import { Router } from "express";
import { buildOpenApiDocument } from "../openapi.js";

// The spec is deterministic; build it once at module load.
const document = buildOpenApiDocument();

export function openapiRouter(): Router {
  const r = Router();
  // Public, unauthenticated: API discovery / tooling.
  r.get("/openapi.json", (_req, res) => {
    res.json(document);
  });
  // Raw alias.
  r.get("/openapi", (_req, res) => {
    res.json(document);
  });
  return r;
}

export { document as openApiDocument };
