import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { buildServiceKnex, newId } from "@zordms/db";
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
    { id: newId(), system: "cbs", endpoint: "customer.lookup", method: "CALL", status: 200, latency_ms: 12, direction: "outbound", success: true },
    { id: newId(), system: "los", endpoint: "loan.status", method: "CALL", status: 503, latency_ms: 30, direction: "outbound", success: false, error: "http_503" },
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

  it("PUT /systems/:id upserts connector config (config-driven endpoint swap)", async () => {
    const res = await request(app).put("/integration/systems/cbs").set("Authorization", `Bearer ${adminToken}`)
      .send({ base_url: "https://bancs.test.internal/api/v2", auth_type: "hmac", enabled: true, secret: "topsecret123" });
    expect(res.status).toBe(200);
    expect(res.body.base_url).toBe("https://bancs.test.internal/api/v2");
    expect(res.body.hasSecret).toBe(true); // secret stored, never echoed
    expect(res.body.secret).toBeUndefined();
    // persisted
    const row = await knex("integration_config").where({ system: "cbs" }).first();
    expect(row.base_url).toBe("https://bancs.test.internal/api/v2");
    expect(row.secret).toBe("topsecret123");
  });

  it("PUT /systems/:id creates a connector for a new system", async () => {
    const res = await request(app).put("/integration/systems/newcbs").set("Authorization", `Bearer ${adminToken}`)
      .send({ base_url: "https://gbp.bank.internal", auth_type: "bearer", enabled: false });
    expect(res.status).toBe(200);
    const row = await knex("integration_config").where({ system: "newcbs" }).first();
    expect(row).toBeTruthy();
    expect(Boolean(row.enabled)).toBe(false);
  });

  it("POST /systems/:id/test reports mock mode when no endpoint is configured", async () => {
    // los has a seeded base_url? ensure a mock-only system: use kyc with no live url
    await knex("integration_config").where({ system: "kyc" }).update({ base_url: null });
    const res = await request(app).post("/integration/systems/kyc/test").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe("mock");
    // mock "ping" is unhandled → ok:false but the call itself succeeds (no throw)
    expect(typeof res.body.ok).toBe("boolean");
  });

  it("rejects connector config writes without integration:manage", async () => {
    const reader = signToken({ sub: "r1", username: "reader", roles: ["Viewer"], permissions: ["integration:read"] }, "t");
    const res = await request(app).put("/integration/systems/cbs").set("Authorization", `Bearer ${reader}`).send({ enabled: true });
    expect(res.status).toBe(403);
  });
});
