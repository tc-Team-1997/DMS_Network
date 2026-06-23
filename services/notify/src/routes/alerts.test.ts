import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { buildServiceKnex } from "@zordms/db";
import { loadConfig } from "@zordms/config";
import { signToken } from "@zordms/auth";
import { ChannelRegistry } from "../channels/registry.js";
import { FakeAdapter } from "../channels/fake.js";
import { RealtimeHub } from "../realtime/hub.js";
import { InMemoryBus } from "../bus/fake.js";
import { createApp } from "../app.js";

const migrationsDir = new URL("../migrations", import.meta.url).pathname;
const seedsDir = new URL("../seeds", import.meta.url).pathname;
const db = { client: "sqlite3" as const, host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "" };
const knex = buildServiceKnex({ migrationsDir, seedsDir, db });
const registry = new ChannelRegistry();
registry.register(new FakeAdapter("email"));
const app = createApp({ knex, config: loadConfig({ JWT_SECRET: "t" } as NodeJS.ProcessEnv), registry, bus: new InMemoryBus(), hub: new RealtimeHub() });

let adminToken = "";
beforeAll(async () => {
  await knex.migrate.latest(); await knex.seed.run();
  const admin = await knex("users").where({ username: "admin" }).first();
  adminToken = signToken({ sub: admin.id, username: "admin" }, "t");
  await knex("alerts").insert([
    { level: "critical", title: "Expiry A", meta: "{}", is_read: false },
    { level: "info", title: "Info B", meta: "{}", is_read: false },
  ]);
});
afterAll(async () => { await knex.destroy(); });

describe("alert routes", () => {
  it("401 without a token", async () => {
    expect((await request(app).get("/alerts")).status).toBe(401);
  });

  it("lists alerts for an authorised user (admin has alert:read via CDO)", async () => {
    const res = await request(app).get("/alerts").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.alerts.length).toBeGreaterThanOrEqual(2);
  });

  it("filters by level", async () => {
    const res = await request(app).get("/alerts?level=critical").set("Authorization", `Bearer ${adminToken}`);
    expect(res.body.alerts.every((a: any) => a.level === "critical")).toBe(true);
  });

  it("marks an alert read", async () => {
    const a = await knex("alerts").where({ title: "Info B" }).first();
    const res = await request(app).post(`/alerts/${a.id}/read`).set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const after = await knex("alerts").where({ id: a.id }).first();
    expect(Boolean(after.is_read)).toBe(true);
  });
});
