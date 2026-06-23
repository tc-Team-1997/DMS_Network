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
let viewerToken = "";

beforeAll(async () => {
  await knex.migrate.latest(); await knex.seed.run();
  const admin = await knex("users").where({ username: "admin" }).first();
  adminToken = signToken({ sub: admin.id, username: "admin" }, "t");

  // Fix 8: create a Viewer user (no user:create permission) for the 403 test
  const viewerRole = await knex("roles").where({ name: "Viewer" }).first();
  const [uid] = await knex("users").insert({
    username: "viewer_perm_test",
    password_hash: "x",
    status: "Active",
  }).returning("id");
  const viewerId = typeof uid === "object" ? (uid as any).id : uid;
  await knex("user_roles").insert({ user_id: viewerId, role_id: viewerRole.id });
  viewerToken = signToken({ sub: viewerId, username: "viewer_perm_test" }, "t");
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

  // Fix 8: valid token for user WITHOUT the required permission → 403
  it("403 for a valid token when user lacks the required permission", async () => {
    const res = await request(app).get("/secret").set("Authorization", `Bearer ${viewerToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("forbidden");
  });
});
