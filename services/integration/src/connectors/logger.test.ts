import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildServiceKnex } from "@zordms/db";
import { MockConnector } from "./mock.js";
import { withLogging } from "./logger.js";

const migrationsDir = new URL("../migrations", import.meta.url).pathname;
const db = { client: "sqlite3" as const, host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "" };
const knex = buildServiceKnex({ migrationsDir, db });

beforeAll(async () => { await knex.migrate.latest(); });
afterAll(async () => { await knex.destroy(); });

describe("withLogging", () => {
  it("writes an integration_logs row for a successful call", async () => {
    const c = withLogging(new MockConnector("cbs", { ping: { ok: true, status: 200 } }), knex);
    const res = await c.call("ping", {});
    expect(res.ok).toBe(true);
    const row = await knex("integration_logs").where({ system: "cbs", endpoint: "ping" }).first();
    expect(row).toBeTruthy();
    expect(row.status).toBe(200);
    expect(row.success).toBeTruthy();
    expect(row.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it("records failures with success=false and the error text", async () => {
    const c = withLogging(new MockConnector("los", {}), knex);
    await c.call("missing", {});
    const row = await knex("integration_logs").where({ system: "los", endpoint: "missing" }).first();
    expect(row.success).toBeFalsy();
    expect(row.status).toBe(501);
    expect(row.error).toBe("unhandled_mock_op");
  });
});
