import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { buildServiceKnex } from "@zordms/db";
import { loadConfig } from "@zordms/config";
import { signToken } from "@zordms/auth";
import { createApp } from "./app.js";
import { InMemoryEventSink } from "./events/sink.js";
import { buildConnector } from "./connectors/registry.js";
import { cbsCustomerLookup } from "./adapters/cbs.js";
import { signBody } from "./webhooks/hmac.js";

const migrationsDir = new URL("./migrations", import.meta.url).pathname;
const seedsDir = new URL("./seeds", import.meta.url).pathname;
const db = { client: "sqlite3" as const, host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "" };
const knex = buildServiceKnex({ migrationsDir, seedsDir, db });
const events = new InMemoryEventSink();
const app = createApp({ knex, config: loadConfig({ JWT_SECRET: "t" } as NodeJS.ProcessEnv), events });
let adminToken = "";

beforeAll(async () => {
  await knex.migrate.latest(); await knex.seed.run();
  await knex("integration_config").where({ system: "cbs" }).update({ secret: "whsec_cbs" });
  const admin = await knex("users").where({ username: "admin" }).first();
  adminToken = signToken({ sub: admin.id, username: "admin" }, "t");
});
afterAll(async () => { await knex.destroy(); });

describe("integration hub smoke", () => {
  it("connector call is logged, webhook emits an event, management reads it back", async () => {
    const cbs = buildConnector("cbs", { knex });
    const lookup = await cbsCustomerLookup(cbs, "C1000");
    expect(lookup.ok).toBe(true);

    const body = JSON.stringify({ cid: "C1000", name: "Dorji" });
    const wh = await request(app).post("/webhooks/cbs/customer-updated")
      .set("Content-Type", "application/json").set("X-ZorDMS-Signature", signBody(body, "whsec_cbs")).send(body);
    expect(wh.status).toBe(202);
    expect(events.emitted.some((e) => e.event === "cbs.customer.updated")).toBe(true);

    const logs = await request(app).get("/integration/logs?system=cbs").set("Authorization", `Bearer ${adminToken}`);
    expect(logs.body.logs.length).toBeGreaterThanOrEqual(2); // connector call + inbound webhook

    const systems = await request(app).get("/integration/systems").set("Authorization", `Bearer ${adminToken}`);
    expect(systems.body.systems.find((s: any) => s.system === "cbs")).toBeTruthy();
  });
});
