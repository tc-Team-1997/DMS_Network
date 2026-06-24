import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { buildServiceKnex } from "@zordms/db";
import { loadConfig } from "@zordms/config";
import { signToken } from "@zordms/auth";
import { createApp } from "../app.js";

const migrationsDir = new URL("../migrations", import.meta.url).pathname;
const seedsDir = new URL("../seeds", import.meta.url).pathname;
const db = { client: "sqlite3" as const, host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "" };
const knex = buildServiceKnex({ migrationsDir, seedsDir, db });
const app = createApp({ knex, config: loadConfig({ JWT_SECRET: "t" } as NodeJS.ProcessEnv) });
let adminToken = "";

beforeAll(async () => {
  await knex.migrate.latest(); await knex.seed.run();
  const admin = await knex("users").where({ username: "admin" }).first();
  adminToken = signToken({ sub: admin.id, username: "admin", roles: ["CDO"], permissions: ["integration:read", "integration:manage"] }, "t");
});
afterAll(async () => { await knex.destroy(); });

describe("outbound webhook routes", () => {
  it("registers a webhook (integration:manage) and lists it with secret redacted", async () => {
    const create = await request(app).post("/outbound").set("Authorization", `Bearer ${adminToken}`)
      .send({ url: "http://c/hook", events: ["cbs.customer.updated"], auth_method: "hmac", secret: "s1" });
    expect(create.status).toBe(201);
    const list = await request(app).get("/outbound").set("Authorization", `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    expect(list.body.webhooks[0].url).toBe("http://c/hook");
    expect(list.body.webhooks[0].secret).toBeUndefined();
  });

  it("requires a token", async () => {
    expect((await request(app).get("/outbound")).status).toBe(401);
  });
});
