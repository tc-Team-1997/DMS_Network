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
  await knex("integration_logs").insert([
    { system: "cbs", endpoint: "customer.lookup", method: "CALL", status: 200, latency_ms: 12, direction: "outbound", success: true },
    { system: "los", endpoint: "loan.status", method: "CALL", status: 503, latency_ms: 30, direction: "outbound", success: false, error: "http_503" },
  ]);
});
afterAll(async () => { await knex.destroy(); });

describe("integration management", () => {
  it("lists recent request logs", async () => {
    const res = await request(app).get("/integration/logs").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.logs.length).toBeGreaterThanOrEqual(2);
  });

  it("filters logs by system", async () => {
    const res = await request(app).get("/integration/logs?system=los").set("Authorization", `Bearer ${adminToken}`);
    expect(res.body.logs.every((l: any) => l.system === "los")).toBe(true);
  });

  it("reports connected-system status (los down, cbs up, disabled flagged)", async () => {
    const res = await request(app).get("/integration/systems").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const bySystem = Object.fromEntries(res.body.systems.map((s: any) => [s.system, s]));
    expect(bySystem.cbs.status).toBe("up");
    expect(bySystem.los.status).toBe("down");
    expect(bySystem.los.recentErrors).toBeGreaterThanOrEqual(1);
  });
});
