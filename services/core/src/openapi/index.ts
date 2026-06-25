/**
 * P10 — OpenAPI spec serving + on-disk generation.
 *
 * `openapiRouter()` mounts:
 *   GET /openapi.json — the generated OpenAPI 3.1 document
 *   GET /openapi.yaml — alias content-type for the same JSON (raw spec)
 *
 * The document is built once and cached (it is static for a given build).
 */
import { Router } from "express";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { buildOpenApiDocument } from "./document.js";

export { buildOpenApiDocument } from "./document.js";

let cached: Record<string, unknown> | null = null;

export function getOpenApiDocument(): Record<string, unknown> {
  if (!cached) cached = buildOpenApiDocument();
  return cached;
}

export function openapiRouter(): Router {
  const r = Router();
  r.get("/openapi.json", (_req, res) => {
    res.json(getOpenApiDocument());
  });
  // Raw spec alias (same JSON body; consumers that ask for the "raw" spec).
  r.get("/openapi", (_req, res) => {
    res.type("application/json").send(JSON.stringify(getOpenApiDocument(), null, 2));
  });
  return r;
}

/** Persist the spec to disk (used by the generation script / regen step). */
export async function writeOpenApiSpec(path: string): Promise<void> {
  const doc = buildOpenApiDocument();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(doc, null, 2) + "\n", "utf8");
}
