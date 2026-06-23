import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildServiceKnex } from "@zordms/db";
import { buildConnector } from "./registry.js";

const migrationsDir = new URL("../migrations", import.meta.url).pathname;
const db = { client: "sqlite3" as const, host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "" };
const knex = buildServiceKnex({ migrationsDir, db });

beforeAll(async () => { await knex.migrate.latest(); });
afterAll(async () => { await knex.destroy(); });

describe("buildConnector", () => {
  it("falls back to a logging-wrapped MOCK connector for a known system", async () => {
    const c = buildConnector("cbs", { knex });
    expect(c.system).toBe("cbs");
    const res = await c.call("customer.lookup", { cid: "C1" });
    expect(res.ok).toBe(true);
    expect(res.mock).toBe(true);
    const row = await knex("integration_logs").where({ system: "cbs", endpoint: "customer.lookup" }).first();
    expect(row).toBeTruthy(); // logging wrapper fired
  });

  it("returns a connector even for an unknown system (empty mock)", async () => {
    const c = buildConnector("erp", { knex });
    const res = await c.call("anything", {});
    expect(res.status).toBe(501);
  });
});
