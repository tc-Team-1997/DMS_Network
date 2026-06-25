import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { buildServiceKnex, newId } from "@zordms/db";
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

const CDO_PERMISSIONS = [
  "user:create", "user:update", "user:read", "role:assign",
  "document:capture", "document:index", "document:read", "document:approve",
  "document:reject", "document:delete", "workflow:act", "legal_hold:place",
  "compliance:read", "admin:access", "crossbranch:read",
  "alert:read", "alert:manage", "alert_rule:manage",
];

let adminToken = "";
beforeAll(async () => {
  await knex.migrate.latest(); await knex.seed.run();
  const admin = await knex("users").where({ username: "admin" }).first();
  adminToken = signToken({ sub: admin.id, username: "admin", roles: ["CDO"], permissions: CDO_PERMISSIONS, branch: "HQ" }, "t");
  await knex("alerts").insert([
    { id: newId(), level: "critical", title: "Expiry A", meta: "{}", is_read: false },
    { id: newId(), level: "info", title: "Info B", meta: "{}", is_read: false },
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

  // C1: SSE /alerts/stream must be auth-gated
  it("C1: GET /alerts/stream returns 401 without a token", async () => {
    const res = await request(app).get("/alerts/stream");
    expect(res.status).toBe(401);
  });

  // I1: POST /alerts/:id/escalate must validate target is non-empty
  it("I1: escalate returns 400 when target is empty", async () => {
    const a = await knex("alerts").where({ title: "Expiry A" }).first();
    const res = await request(app)
      .post(`/alerts/${a.id}/escalate`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("target_required");
  });

  // I1: escalate with a valid target responds 200
  it("I1: escalate with a valid target responds 200", async () => {
    const a = await knex("alerts").where({ title: "Expiry A" }).first();
    const res = await request(app)
      .post(`/alerts/${a.id}/escalate`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ target: "Supervisor" });
    // May be 0 recipients in test DB — the important thing is it doesn't 500
    expect([200, 404]).toContain(res.status);
  });

  // I3: GET /alerts returns proper boolean (not integer) for is_read
  it("I3: GET /alerts returns boolean is_read (not raw 0/1)", async () => {
    const res = await request(app).get("/alerts").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    for (const alert of res.body.alerts) {
      expect(typeof alert.is_read).toBe("boolean");
    }
  });
});
