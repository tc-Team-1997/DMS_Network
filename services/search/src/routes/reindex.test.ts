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
let adminToken = "";
let viewerToken = "";

// CDO has all permissions including admin:access and crossbranch:read
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
  // Admin (CDO) token carries all permissions in claims
  adminToken = signToken({ sub: admin.id, username: "admin", permissions: ALL_PERMISSIONS, roles: ["CDO"] }, "t");

  // IMPORTANT-4: a non-admin Viewer — has document:read but NOT admin:access (claims-based)
  viewerToken = signToken({ sub: "019400000000700000000000003", username: "viewerReindex", permissions: ["document:read"], roles: ["Viewer"], branch: "Thimphu" }, "t");
});
afterAll(async () => { await knex.destroy(); });

describe("POST /admin/reindex", () => {
  it("reindexes the supplied docs (admin only)", async () => {
    const res = await request(app).post("/admin/reindex").set("Authorization", `Bearer ${adminToken}`).send({
      docs: [{ doc_id: "R1", ocr_text: "alpha", metadata_text: "", doc_type: "X", branch: "Thimphu", status: "indexed", risk_band: "low", legal_hold: false, expiry_status: "none", uploaded_by: "u", indexed_at: "2026-06-23T00:00:00Z" }],
    });
    expect(res.status).toBe(200);
    expect(res.body.reindexed).toBe(1);
  });

  it("401 without a token", async () => {
    expect((await request(app).post("/admin/reindex").send({ docs: [] })).status).toBe(401);
  });

  // IMPORTANT-4: authenticated non-admin must be denied with 403
  it("403 for authenticated non-admin user", async () => {
    const res = await request(app).post("/admin/reindex").set("Authorization", `Bearer ${viewerToken}`).send({ docs: [] });
    expect(res.status).toBe(403);
  });

  // IMPORTANT-4: doc_id validation — empty doc_id must return 400
  it("400 when a doc is missing doc_id", async () => {
    const res = await request(app).post("/admin/reindex").set("Authorization", `Bearer ${adminToken}`).send({
      docs: [{ doc_id: "", ocr_text: "alpha", metadata_text: "", doc_type: "X", branch: "Thimphu", status: "indexed", risk_band: "low", legal_hold: false, expiry_status: "none", uploaded_by: "u", indexed_at: "2026-06-23T00:00:00Z" }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_doc");
  });
});
