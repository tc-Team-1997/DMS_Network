/**
 * P10 — boundary validation + OpenAPI spec serving tests.
 */
import { describe, it, expect, afterAll } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { makeTestApp } from "../testutil.js";
import { collectMountedRoutes, routeKeys } from "./routes.js";
import { buildOpenApiDocument } from "./document.js";

const h = await makeTestApp();
afterAll(async () => { await h.cleanup(); });

describe("zod boundary validation", () => {
  it("a bad body to a mutating route returns 400 validation_error with issues", async () => {
    const token = await h.tokenFor("admin");
    // POST /folders requires a non-empty string `name`; send a number instead.
    const res = await request(h.app)
      .post("/folders")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: 12345 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
    expect(Array.isArray(res.body.issues)).toBe(true);
    expect(res.body.issues.length).toBeGreaterThan(0);
    expect(res.body.issues[0].path).toContain("name");
  });

  it("a missing required field on an internal route returns 400 validation_error", async () => {
    const TOKEN = "change-me-internal"; // default config.internalServiceToken in tests
    const res = await request(h.app)
      .post("/integration/customer-upsert")
      .set("x-internal-token", TOKEN)
      .send({ name: "No CID" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
  });

  it("a valid body still passes through unchanged (201)", async () => {
    const token = await h.tokenFor("admin");
    const res = await request(h.app)
      .post("/folders")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "ValidFolder", domain: "Customers" });
    expect(res.status).toBe(201);
    expect(res.body.folder.name).toBe("ValidFolder");
  });
});

describe("GET /openapi.json", () => {
  it("returns the OpenAPI 3.1 spec with the expected paths + security schemes", async () => {
    const res = await request(h.app).get("/openapi.json");
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe("3.1.0");
    expect(res.body.info.title).toContain("Core");

    const paths = Object.keys(res.body.paths);
    expect(paths).toContain("/folders");
    expect(paths).toContain("/documents/{id}");
    expect(paths).toContain("/integration/customer-upsert");
    expect(paths).toContain("/index/{documentId}");

    // Auth schemes documented: bearer JWT + internal token.
    const schemes = res.body.components.securitySchemes;
    expect(schemes.bearerAuth.scheme).toBe("bearer");
    expect(schemes.internalToken.name).toBe("x-internal-token");

    // Request schema derived from zod is present as a component.
    expect(res.body.components.schemas.CreateFolder).toBeDefined();
    expect(res.body.components.schemas.ValidationError).toBeDefined();
  });

  it("serves the raw spec at GET /openapi", async () => {
    const res = await request(h.app).get("/openapi");
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.text);
    expect(parsed.openapi).toBe("3.1.0");
  });
});

describe("OpenAPI route-coverage contract", () => {
  // Build the set of {METHOD path} pairs the OpenAPI document declares.
  function specOperationKeys(spec: any): string[] {
    const out: string[] = [];
    for (const [path, ops] of Object.entries<any>(spec.paths)) {
      for (const method of Object.keys(ops)) {
        if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
        out.push(`${method.toUpperCase()} ${path}`);
      }
    }
    return [...new Set(out)].sort();
  }

  it("documents EVERY mounted route (no undocumented routes) and no phantom routes", async () => {
    const res = await request(h.app).get("/openapi.json");
    const spec = res.body;

    const mounted = routeKeys(collectMountedRoutes(h.app));
    const documented = specOperationKeys(spec);

    const undocumented = mounted.filter((k) => !documented.includes(k));
    const phantom = documented.filter((k) => !mounted.includes(k));

    // Every live route is in the spec…
    expect(undocumented, `undocumented routes: ${undocumented.join(", ")}`).toEqual([]);
    // …and the spec contains no paths the service does not actually serve.
    expect(phantom, `phantom (documented-but-unmounted) routes: ${phantom.join(", ")}`).toEqual([]);

    // The set is non-trivial (guards against an accidentally-empty walk).
    expect(mounted.length).toBeGreaterThanOrEqual(55);
  });

  it("the on-disk spec (docs/superpowers/specs/openapi/core.json) is regenerated/in-sync", async () => {
    const onDiskPath = fileURLToPath(
      new URL("../../../../docs/superpowers/specs/openapi/core.json", import.meta.url),
    );
    const onDisk = JSON.parse(await readFile(onDiskPath, "utf8"));
    const built = buildOpenApiDocument();
    // Path set + operation set must match (run `pnpm --filter @zordms/core gen:openapi`).
    expect(Object.keys(onDisk.paths).sort()).toEqual(Object.keys((built as any).paths).sort());
    expect(specOperationKeys(onDisk)).toEqual(specOperationKeys(built));
  });

  it("documents the standard response codes per operation class", async () => {
    const res = await request(h.app).get("/openapi.json");
    const spec = res.body;

    // A mutating, bearer-guarded JSON route documents 400/401/403.
    const createFolder = spec.paths["/folders"].post;
    for (const code of ["201", "400", "401", "403"]) {
      expect(createFolder.responses[code], `POST /folders missing ${code}`).toBeDefined();
    }

    // A 404-bearing fetch route documents 404.
    expect(spec.paths["/documents/{id}"].get.responses["404"]).toBeDefined();

    // The dedup-config PUT keeps its 422 (NOT 400) documented error contract.
    const dedupPut = spec.paths["/admin/dedup-config"].put;
    expect(dedupPut.responses["422"]).toBeDefined();
    expect(dedupPut.responses["400"]).toBeUndefined();

    // Conflict + forbidden documented where the handlers emit them.
    expect(spec.paths["/doc-types"].post.responses["409"]).toBeDefined();
    expect(spec.paths["/doc-types/{code}"].delete.responses["403"]).toBeDefined();
  });

  it("every documented response code carries a JSON (or binary) schema", async () => {
    const res = await request(h.app).get("/openapi.json");
    const spec = res.body;
    for (const [path, ops] of Object.entries<any>(spec.paths)) {
      for (const [method, op] of Object.entries<any>(ops)) {
        if (!["get", "post", "put", "patch", "delete"].includes(method)) continue;
        for (const [code, resp] of Object.entries<any>(op.responses)) {
          // 204 may legitimately have no body.
          if (code === "204") continue;
          const content = resp.content ?? {};
          const media = content["application/json"] ?? content["application/octet-stream"];
          expect(media?.schema, `${method.toUpperCase()} ${path} ${code} has no schema`).toBeDefined();
        }
      }
    }
  });
});

describe("query-parameter boundary validation", () => {
  it("rejects a bad ?status enum on GET /jobs with 400 validation_error", async () => {
    const token = await h.tokenFor("admin");
    const res = await request(h.app)
      .get("/jobs?status=not-a-real-status")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
    expect(res.body.issues[0].path).toContain("status");
  });

  it("rejects a non-numeric ?limit on GET /jobs with 400 validation_error", async () => {
    const token = await h.tokenFor("admin");
    const res = await request(h.app)
      .get("/jobs?limit=abc")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
  });

  it("accepts a valid ?status + ?limit on GET /jobs (200)", async () => {
    const token = await h.tokenFor("admin");
    const res = await request(h.app)
      .get("/jobs?status=queued&limit=10")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("counts");
  });

  it("rejects a non-numeric ?limit on GET /compliance/audit with 400", async () => {
    const token = await h.tokenFor("admin");
    const res = await request(h.app)
      .get("/compliance/audit?limit=not-a-number")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
  });

  it("accepts valid audit filters (200)", async () => {
    const token = await h.tokenFor("admin");
    const res = await request(h.app)
      .get("/compliance/audit?action=create&limit=5")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("rows");
  });
});
