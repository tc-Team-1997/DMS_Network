/**
 * P10 — CLI entry to (re)generate the on-disk OpenAPI spec.
 *
 *   pnpm --filter @zordms/core gen:openapi
 *
 * Writes docs/superpowers/specs/openapi/core.json from the live zod-derived spec.
 */
import { fileURLToPath } from "node:url";
import { writeOpenApiSpec } from "./index.js";

const OUT = fileURLToPath(
  new URL("../../../../docs/superpowers/specs/openapi/core.json", import.meta.url),
);

writeOpenApiSpec(OUT)
  .then(() => {
    // eslint-disable-next-line no-console
    console.log(`OpenAPI spec written to ${OUT}`);
  })
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exitCode = 1;
  });
