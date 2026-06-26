import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import knexLib from "knex";
import { buildKnexConfig, newId } from "@zordms/db";
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

describe("seeded admin email (P1)", () => {
  it("the seeded admin user has a non-null email", async () => {
    const admin = await knex("users").where({ username: "admin" }).first();
    expect(admin.email).toBeTruthy();
    expect(admin.email).toBe("admin@bobl.bt");
  });

  it("GET /users returns email in the response payload", async () => {
    const res = await request(app).get("/users").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const admin = (res.body.users as Array<{ username: string; email?: string }>)
      .find((u) => u.username === "admin");
    expect(admin).toBeTruthy();
    expect(admin!.email).toBe("admin@bobl.bt");
  });

  it("GET /users attaches each user's role names", async () => {
    const res = await request(app).get("/users").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const admin = (res.body.users as Array<{ username: string; roles?: string[] }>).find((u) => u.username === "admin");
    expect(admin!.roles).toContain("CDO");
  });

  it("GET /users/roles lists role names for assignment pickers", async () => {
    const res = await request(app).get("/users/roles").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const names = (res.body.roles as Array<{ name: string }>).map((r) => r.name);
    expect(names).toContain("CDO");
    expect(names).toContain("Supervisor");
  });
});

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
    const vid = newId();
    await knex("users").insert({ id: vid, username: "v1", password_hash: "x", status: "Active" });
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

  // Boundary validation (zod) — missing username → 400 validation_error
  it("returns 400 validation_error when username is missing in POST /users", async () => {
    const res = await request(app).post("/users").set("Authorization", `Bearer ${adminToken}`)
      .send({ password: "pw123456", roles: ["Viewer"] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
    expect(res.body.issues.some((i: any) => i.path.includes("username"))).toBe(true);
  });

  // Boundary validation (zod) — roles not an array → 400 validation_error
  it("returns 400 validation_error when roles is not an array in POST /users", async () => {
    const res = await request(app).post("/users").set("Authorization", `Bearer ${adminToken}`)
      .send({ username: "newuser", password: "pw123456", roles: "Viewer" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
    expect(res.body.issues.some((i: any) => i.path.includes("roles")).valueOf()).toBe(true);
  });
});
