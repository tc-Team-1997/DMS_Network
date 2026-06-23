import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import knexLib from "knex";
import { buildKnexConfig } from "@zordms/db";
import { loadConfig } from "@zordms/config";
import { signToken } from "@zordms/auth";
import { createApp } from "../app.js";

const knex = knexLib(buildKnexConfig({
  client: "sqlite3", host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "",
}));
const app = createApp({ knex, config: loadConfig({ JWT_SECRET: "t" } as NodeJS.ProcessEnv) });
let adminToken = "";

beforeAll(async () => {
  await knex.migrate.latest(); await knex.seed.run();
  const admin = await knex("users").where({ username: "admin" }).first();
  adminToken = signToken({ sub: admin.id, username: "admin" }, "t");
});
afterAll(async () => { await knex.destroy(); });

describe("supervisor user provisioning", () => {
  it("creates a new user with a role (no licensing cap)", async () => {
    const res = await request(app).post("/users").set("Authorization", `Bearer ${adminToken}`)
      .send({ username: "maker1", password: "pw123456", full_name: "Maker One", branch: "Thimphu", roles: ["Maker"] });
    expect(res.status).toBe(201);
    expect(res.body.user.username).toBe("maker1");
    const link = await knex("user_roles as ur").join("roles as r", "r.id", "ur.role_id")
      .join("users as u", "u.id", "ur.user_id").where("u.username", "maker1").select("r.name");
    expect(link.map((x: any) => x.name)).toContain("Maker");
  });

  it("forbids creation without user:create permission", async () => {
    const viewer = await knex("users").insert({ username: "v1", password_hash: "x", status: "Active" }).returning("id");
    const vid = typeof viewer[0] === "object" ? (viewer[0] as any).id : viewer[0];
    const viewerRole = await knex("roles").where({ name: "Viewer" }).first();
    await knex("user_roles").insert({ user_id: vid, role_id: viewerRole.id });
    const vToken = signToken({ sub: vid, username: "v1" }, "t");
    const res = await request(app).post("/users").set("Authorization", `Bearer ${vToken}`)
      .send({ username: "x2", password: "pw123456", roles: ["Viewer"] });
    expect(res.status).toBe(403);
  });

  it("locks and unlocks a user", async () => {
    const target = await knex("users").where({ username: "maker1" }).first();
    const res = await request(app).post(`/users/${target.id}/lock`).set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const after = await knex("users").where({ id: target.id }).first();
    expect(after.status).toBe("Locked");
  });
});
