import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { buildServiceKnex } from "@zordms/db";
import { loadConfig } from "@zordms/config";
import { signToken } from "@zordms/auth";
import { createApp } from "../app.js";
import { SqlSearchBackend } from "../backend/SqlSearchBackend.js";

const migrationsDir = new URL("../migrations", import.meta.url).pathname;
const seedsDir = new URL("../seeds", import.meta.url).pathname;
const db = { client: "sqlite3" as const, host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "" };
const knex = buildServiceKnex({ migrationsDir, seedsDir, db });
const backend = new SqlSearchBackend(knex);
const app = createApp({ knex, config: loadConfig({ JWT_SECRET: "t" } as NodeJS.ProcessEnv), backend });
let token = "";

beforeAll(async () => {
  await knex.migrate.latest();
  await knex.seed.run();
  const admin = await knex("users").where({ username: "admin" }).first();
  token = signToken({ sub: admin.id, username: "admin", permissions: ["document:read"], roles: ["CDO"] }, "t");
});
afterAll(async () => { await knex.destroy(); });

describe("GET /openapi.json", () => {
  it("serves the OpenAPI 3.1 spec with the expected paths (no auth required)", async () => {
    const res = await request(app).get("/openapi.json");
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe("3.1.0");
    const paths = Object.keys(res.body.paths);
    expect(paths).toContain("/search");
    expect(paths).toContain("/facets");
    expect(paths).toContain("/search/export.csv");
    expect(paths).toContain("/saved");
    expect(paths).toContain("/saved/{id}/run");
    expect(paths).toContain("/admin/reindex");
    expect(paths).toContain("/health");
    // Auth schemes documented.
    expect(Object.keys(res.body.components.securitySchemes)).toEqual(
      expect.arrayContaining(["bearerAuth", "internalToken", "hmacSignature"]),
    );
  });

  it("serves the raw spec at GET /openapi", async () => {
    const res = await request(app).get("/openapi");
    expect(res.status).toBe(200);
    expect(res.body.info.title).toContain("Search");
  });
});

describe("zod boundary validation", () => {
  it("POST /saved with a bad body returns 400 validation_error", async () => {
    const res = await request(app)
      .post("/saved")
      .set("Authorization", `Bearer ${token}`)
      // name missing, query.mode invalid -> two issues
      .send({ query: { text: "x", mode: "regex" } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
    expect(Array.isArray(res.body.issues)).toBe(true);
    expect(res.body.issues.length).toBeGreaterThan(0);
  });

  it("POST /search with a malformed body returns 400 validation_error", async () => {
    const res = await request(app)
      .post("/search")
      .set("Authorization", `Bearer ${token}`)
      .send({ mode: "regex" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
  });

  it("POST /admin/reindex with a non-array docs body returns 400 validation_error", async () => {
    const adminToken = signToken(
      { sub: "00000000-0000-0000-0000-0000000000ad", username: "reindexer", permissions: ["admin:access"], roles: ["CDO"] },
      "t",
    );
    const res = await request(app)
      .post("/admin/reindex")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ docs: "not-an-array" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
  });
});
