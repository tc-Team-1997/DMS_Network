// P10 — emit the workflow OpenAPI 3.1 document to docs/.../openapi/workflow.json
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildOpenApiDocument } from "../src/openapi.js";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../../../docs/superpowers/specs/openapi/workflow.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(buildOpenApiDocument(), null, 2) + "\n");
console.log("wrote", out);
