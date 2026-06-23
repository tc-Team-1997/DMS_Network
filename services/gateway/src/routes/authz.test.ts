import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import knexLib from "knex";
import { buildKnexConfig } from "@zordms/db";
import { loadConfig } from "@zordms/config";
import { createApp } from "../app.js";

const knex = knexLib(buildKnexConfig({
  client: "sqlite3", host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "",
}));
const config = loadConfig({ JWT_SECRET: "t", INTERNAL_SERVICE_TOKEN: "test-internal-token" } as NodeJS.ProcessEnv);
const app = createApp({ knex, config });

beforeAll(async () => { await knex.migrate.latest(); await knex.seed.run(); });
afterAll(async () => { await knex.destroy(); });

describe("POST /authz/check", () => {
  it("confirms admin may approve documents (with valid internal token)", async () => {
    const admin = await knex("users").where({ username: "admin" }).first();
    const res = await request(app)
      .post("/authz/check")
      .set("x-internal-token", "test-internal-token")
      .send({ userId: admin.id, permissions: ["document:approve"] });
    expect(res.status).toBe(200);
    expect(res.body.allowed).toBe(true);
    expect(res.body.missing).toEqual([]);
  });

  // Fix 2: missing token → 401
  it("returns 401 when x-internal-token header is missing", async () => {
    const admin = await knex("users").where({ username: "admin" }).first();
    const res = await request(app)
      .post("/authz/check")
      .send({ userId: admin.id, permissions: ["document:approve"] });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("unauthorized");
  });

  // Fix 2: wrong token → 401
  it("returns 401 when x-internal-token is wrong", async () => {
    const admin = await knex("users").where({ username: "admin" }).first();
    const res = await request(app)
      .post("/authz/check")
      .set("x-internal-token", "wrong-token")
      .send({ userId: admin.id, permissions: ["document:approve"] });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("unauthorized");
  });

  // Fix 3: input validation — bad userId → 400
  it("returns 400 when userId is not a positive integer", async () => {
    const res = await request(app)
      .post("/authz/check")
      .set("x-internal-token", "test-internal-token")
      .send({ userId: "not-a-number", permissions: ["document:approve"] });
    expect(res.status).toBe(400);
  });

  // Fix 3: input validation — bad permissions → 400
  it("returns 400 when permissions is not an array of strings", async () => {
    const admin = await knex("users").where({ username: "admin" }).first();
    const res = await request(app)
      .post("/authz/check")
      .set("x-internal-token", "test-internal-token")
      .send({ userId: admin.id, permissions: "document:approve" });
    expect(res.status).toBe(400);
  });
});
