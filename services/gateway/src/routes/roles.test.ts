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
  await knex.migrate.latest();
  await knex.seed.run();
  const admin = await knex("users").where({ username: "admin" }).first();
  adminToken = signToken({ sub: admin.id, username: "admin" }, "t");
});
afterAll(async () => { await knex.destroy(); });

const auth = () => ({ Authorization: `Bearer ${adminToken}` });

describe("Roles management (/roles)", () => {
  it("requires auth", async () => {
    expect((await request(app).get("/roles")).status).toBe(401);
  });

  it("lists roles with permissions + user counts; system roles flagged", async () => {
    const res = await request(app).get("/roles").set(auth());
    expect(res.status).toBe(200);
    const cdo = res.body.roles.find((r: any) => r.name === "CDO");
    expect(cdo).toBeTruthy();
    expect(cdo.system).toBe(true);
    expect(Array.isArray(cdo.permissions)).toBe(true);
    expect(cdo.permissions).toContain("admin:access");
    expect(typeof cdo.userCount).toBe("number");
  });

  it("creates a custom role with permissions, then updates and deletes it", async () => {
    const created = await request(app)
      .post("/roles").set(auth())
      .send({ name: "FrontDesk", description: "Branch front desk", permissions: ["user:read"] });
    expect(created.status).toBe(201);
    expect(created.body.role.system).toBe(false);
    expect(created.body.role.permissions).toEqual(["user:read"]);
    const id = created.body.role.id;

    const got = await request(app).get(`/roles/${id}`).set(auth());
    expect(got.status).toBe(200);
    expect(got.body.role.name).toBe("FrontDesk");

    const upd = await request(app)
      .put(`/roles/${id}`).set(auth())
      .send({ description: "Updated", permissions: ["user:read", "admin:read"] });
    expect(upd.status).toBe(200);
    expect(upd.body.role.permissions.sort()).toEqual(["admin:read", "user:read"]);

    const del = await request(app).delete(`/roles/${id}`).set(auth());
    expect(del.status).toBe(200);
    expect((await request(app).get(`/roles/${id}`).set(auth())).status).toBe(404);
  });

  it("rejects a duplicate role name with 409", async () => {
    const res = await request(app).post("/roles").set(auth()).send({ name: "CDO" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("role_exists");
  });

  it("protects system roles from edit + delete (409)", async () => {
    const cdo = await knex("roles").where({ name: "CDO" }).first();
    expect((await request(app).put(`/roles/${cdo.id}`).set(auth()).send({ description: "x" })).status).toBe(409);
    const del = await request(app).delete(`/roles/${cdo.id}`).set(auth());
    expect(del.status).toBe(409);
    expect(del.body.error).toBe("system_role_protected");
  });

  it("rejects a malformed body with 400 validation_error", async () => {
    const res = await request(app).post("/roles").set(auth()).send({ description: "no name" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
  });
});
