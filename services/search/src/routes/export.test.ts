import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { buildServiceKnex } from "@zordms/db";
import { loadConfig } from "@zordms/config";
import { signToken } from "@zordms/auth";
import { createApp } from "../app.js";
import { SqlSearchBackend } from "../backend/SqlSearchBackend.js";
import { toCsv } from "./export.js";
import type { SearchHit } from "../types.js";

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
  await backend.index({ doc_id: "D1", ocr_text: 'Loan, Dorji "VIP"', metadata_text: "", doc_type: "BOB_LOAN_APPLICATION", branch: "Thimphu", status: "indexed", risk_band: "low", legal_hold: false, expiry_status: "none", uploaded_by: "m", indexed_at: "2026-06-23T00:00:00Z" });
});
afterAll(async () => { await knex.destroy(); });

describe("toCsv", () => {
  it("emits a header and quotes fields containing commas/quotes", () => {
    const csv = toCsv([{ doc_id: "D1", doc_type: "T,X", branch: "Th", status: "ok", snippet: "", score: 0.5, indexed_at: "2026-06-23" } as SearchHit]);
    const [header, row] = csv.trim().split("\n");
    expect(header).toBe("doc_id,doc_type,branch,status,score,indexed_at");
    expect(row).toContain('"T,X"');
  });
});

describe("POST /search/export.csv", () => {
  it("returns a CSV attachment of scoped results", async () => {
    const res = await request(app).post("/search/export.csv").set("Authorization", `Bearer ${adminToken}`).send({ text: "dorji", mode: "fulltext" });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.headers["content-disposition"]).toMatch(/attachment/);
    expect(res.text).toMatch(/^doc_id,doc_type,branch,status,score,indexed_at/);
    expect(res.text).toContain("D1");
  });

  it("401 without a token", async () => {
    expect((await request(app).post("/search/export.csv").send({ text: "x", mode: "fulltext" })).status).toBe(401);
  });
});
