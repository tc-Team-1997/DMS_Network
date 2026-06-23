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

beforeAll(async () => {
  await knex.migrate.latest();
  await knex.seed.run();
  const admin = await knex("users").where({ username: "admin" }).first();
  adminToken = signToken({ sub: admin.id, username: "admin" }, "t");
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
});
