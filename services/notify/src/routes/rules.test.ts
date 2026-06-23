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
const registry = new ChannelRegistry(); registry.register(new FakeAdapter("email"));
const app = createApp({ knex, config: loadConfig({ JWT_SECRET: "t" } as NodeJS.ProcessEnv), registry, bus: new InMemoryBus(), hub: new RealtimeHub() });
let adminToken = "";

beforeAll(async () => {
  await knex.migrate.latest(); await knex.seed.run();
  const admin = await knex("users").where({ username: "admin" }).first();
  adminToken = signToken({ sub: admin.id, username: "admin" }, "t");
});
afterAll(async () => { await knex.destroy(); });

describe("alert-rule CRUD", () => {
  it("creates a rule and lists it back parsed", async () => {
    const res = await request(app).post("/rules").set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Loan SLA", trigger: "workflow.escalated", params: { sla: 24 }, channels: ["email", "teams"], escalationTarget: "Supervisor" });
    expect(res.status).toBe(201);
    const list = await request(app).get("/rules").set("Authorization", `Bearer ${adminToken}`);
    const created = list.body.rules.find((r: any) => r.name === "Loan SLA");
    expect(created.channels).toEqual(["email", "teams"]);
    expect(created.escalationTarget).toBe("Supervisor");
  });

  it("toggles a rule with PATCH", async () => {
    const rule = await knex("alert_rules").where({ name: "Loan SLA" }).first();
    const res = await request(app).patch(`/rules/${rule.id}`).set("Authorization", `Bearer ${adminToken}`).send({ enabled: false });
    expect(res.status).toBe(200);
    const after = await knex("alert_rules").where({ id: rule.id }).first();
    expect(Boolean(after.enabled)).toBe(false);
  });
});
