import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import knexLib from "knex";
import { buildKnexConfig } from "@zordms/db";
import { signToken } from "@zordms/auth";
import { requireAuth } from "./requireAuth.js";
import { requirePermission } from "./requirePermission.js";

const knex = knexLib(buildKnexConfig({
  client: "sqlite3", host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "",
}));
const app = express();
app.locals.deps = { knex, config: { jwtSecret: "t" } };
app.get("/secret", requireAuth, requirePermission("user:create"), (_req, res) => res.json({ ok: true }));

let adminToken = "";
beforeAll(async () => {
  await knex.migrate.latest(); await knex.seed.run();
  const admin = await knex("users").where({ username: "admin" }).first();
  adminToken = signToken({ sub: admin.id, username: "admin" }, "t");
});
afterAll(async () => { await knex.destroy(); });

describe("requirePermission", () => {
  it("401 without a token", async () => {
    expect((await request(app).get("/secret")).status).toBe(401);
  });
  it("200 for admin (CDO has user:create)", async () => {
    const res = await request(app).get("/secret").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });
});
