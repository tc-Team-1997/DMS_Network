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
let viewerThimphuToken = "";
let nullBranchViewerToken = "";

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
  // Admin (CDO) gets all permissions + crossbranch:read embedded in JWT claims
  adminToken = signToken({ sub: admin.id, username: "admin", permissions: ALL_PERMISSIONS, roles: ["CDO"] }, "t");

  // a Viewer scoped to Thimphu (no crossbranch:read) — claims-based, no DB user lookup needed
  viewerThimphuToken = signToken({ sub: "019400000000700000000000001", username: "viewerT", permissions: ["document:read"], roles: ["Viewer"], branch: "Thimphu" }, "t");

  // IMPORTANT-2 / CRITICAL-1: a Viewer with NO branch assigned (branch = null/undefined)
  nullBranchViewerToken = signToken({ sub: "019400000000700000000000002", username: "viewerNoBranch", permissions: ["document:read"], roles: ["Viewer"] }, "t");

  await backend.index({ doc_id: "D1", ocr_text: "Loan Dorji", metadata_text: "", doc_type: "BOB_LOAN_APPLICATION", branch: "Thimphu", status: "indexed", risk_band: "low", legal_hold: false, expiry_status: "none", uploaded_by: "m", indexed_at: "2026-06-23T00:00:00Z" });
  await backend.index({ doc_id: "D2", ocr_text: "Loan Dorji", metadata_text: "", doc_type: "BOB_LOAN_APPLICATION", branch: "Paro", status: "indexed", risk_band: "high", legal_hold: false, expiry_status: "none", uploaded_by: "m", indexed_at: "2026-06-23T00:00:00Z" });
});
afterAll(async () => { await knex.destroy(); });

describe("POST /search", () => {
  it("requires authentication", async () => {
    expect((await request(app).post("/search").send({ text: "dorji", mode: "fulltext" })).status).toBe(401);
  });

  it("admin (crossbranch) sees results from all branches", async () => {
    const res = await request(app).post("/search").set("Authorization", `Bearer ${adminToken}`).send({ text: "dorji", mode: "fulltext" });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.facets.branch.length).toBe(2);
  });

  it("Thimphu Viewer (no crossbranch) only sees Thimphu results", async () => {
    const res = await request(app).post("/search").set("Authorization", `Bearer ${viewerThimphuToken}`).send({ text: "dorji", mode: "fulltext" });
    expect(res.status).toBe(200);
    expect(res.body.hits.map((h: any) => h.doc_id)).toEqual(["D1"]);
  });

  it("rejects a malformed query with 400", async () => {
    const res = await request(app).post("/search").set("Authorization", `Bearer ${adminToken}`).send({ mode: "regex" });
    expect(res.status).toBe(400);
  });

  // IMPORTANT-2 / CRITICAL-1: null-branch user must see zero results (fail-closed)
  it("user with null branch and no crossbranch:read sees zero results", async () => {
    const res = await request(app).post("/search").set("Authorization", `Bearer ${nullBranchViewerToken}`).send({ text: "dorji", mode: "fulltext" });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.hits).toHaveLength(0);
  });

  // IMPORTANT-2 / CRITICAL-2: boolean OR must not escape branch scope
  it("Thimphu Viewer using boolean OR does not see Paro results", async () => {
    // D1 is in Thimphu (contains "loan"), D2 is in Paro (contains "loan").
    // Without the fix, "loan OR dorji" would leak D2 via the top-level OR.
    const res = await request(app).post("/search").set("Authorization", `Bearer ${viewerThimphuToken}`).send({ text: "loan OR dorji", mode: "boolean" });
    expect(res.status).toBe(200);
    const ids = res.body.hits.map((h: any) => h.doc_id);
    expect(ids).toContain("D1");
    expect(ids).not.toContain("D2");
  });
});

describe("GET /facets", () => {
  it("returns facet dimensions for the caller scope", async () => {
    const res = await request(app).get("/facets").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.facets.doc_type.length).toBeGreaterThan(0);
  });
});
