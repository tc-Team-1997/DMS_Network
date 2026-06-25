import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { buildServiceKnex, newId } from "@zordms/db";
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
let adminToken = "";
let adminId = "";

// CDO has all permissions including crossbranch:read
const ALL_PERMISSIONS = [
  "user:create", "user:update", "user:read", "role:assign",
  "document:capture", "document:index", "document:read", "document:approve",
  "document:reject", "document:delete", "workflow:act", "legal_hold:place",
  "compliance:read", "admin:access", "crossbranch:read",
];

beforeAll(async () => {
  await knex.migrate.latest();
  await knex.seed.run();
  const admin = await knex("users").where({ username: "admin" }).first();
  adminId = admin.id;
  // Admin (CDO) token carries all permissions in claims including crossbranch:read
  adminToken = signToken({ sub: admin.id, username: "admin", permissions: ALL_PERMISSIONS, roles: ["CDO"] }, "t");
  await backend.index({ doc_id: "D1", ocr_text: "Loan Dorji", metadata_text: "", doc_type: "BOB_LOAN_APPLICATION", branch: "Thimphu", status: "indexed", risk_band: "low", legal_hold: false, expiry_status: "none", uploaded_by: "m", indexed_at: "2026-06-23T00:00:00Z" });
});
afterAll(async () => { await knex.destroy(); });

describe("saved searches", () => {
  let savedId = "";

  it("creates a private saved search", async () => {
    const res = await request(app).post("/saved").set("Authorization", `Bearer ${adminToken}`).send({
      name: "My loans", visibility: "private", query: { text: "dorji", mode: "fulltext" },
    });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("My loans");
    savedId = res.body.id;
  });

  it("lists the caller's own + public saved searches", async () => {
    const otherId = newId();
    await knex("saved_searches").insert({ id: newId(), user_id: otherId, name: "Shared", query_json: JSON.stringify({ text: "x", mode: "fulltext" }), visibility: "public" });
    await knex("saved_searches").insert({ id: newId(), user_id: otherId, name: "Hidden", query_json: JSON.stringify({ text: "x", mode: "fulltext" }), visibility: "private" });
    const res = await request(app).get("/saved").set("Authorization", `Bearer ${adminToken}`);
    const names = res.body.saved.map((s: any) => s.name);
    expect(names).toContain("My loans");
    expect(names).toContain("Shared");
    expect(names).not.toContain("Hidden");
  });

  it("runs a saved search with the caller's scope", async () => {
    const res = await request(app).post(`/saved/${savedId}/run`).set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.hits[0].doc_id).toBe("D1");
  });

  it("404s when running a private search owned by someone else", async () => {
    const otherId = newId();
    const privateId = newId();
    await knex("saved_searches").insert({ id: privateId, user_id: otherId, name: "Private other", query_json: JSON.stringify({ text: "x", mode: "fulltext" }), visibility: "private" });
    expect((await request(app).post(`/saved/${privateId}/run`).set("Authorization", `Bearer ${adminToken}`)).status).toBe(404);
  });
});
