import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { buildServiceKnex } from "@zordms/db";
import { loadConfig } from "@zordms/config";
import { createApp } from "../app.js";
import { InMemoryEventSink } from "../events/sink.js";
import { signBody } from "../webhooks/hmac.js";

const migrationsDir = new URL("../migrations", import.meta.url).pathname;
const seedsDir = new URL("../seeds", import.meta.url).pathname;
const db = { client: "sqlite3" as const, host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "" };
const knex = buildServiceKnex({ migrationsDir, seedsDir, db });
const events = new InMemoryEventSink();
const app = createApp({ knex, config: loadConfig({ JWT_SECRET: "t" } as NodeJS.ProcessEnv), events });
const SECRET = "whsec_cbs";

beforeAll(async () => {
  await knex.migrate.latest(); await knex.seed.run();
  await knex("integration_config").where({ system: "cbs" }).update({ secret: SECRET });
});
afterAll(async () => { await knex.destroy(); });

describe("inbound webhooks", () => {
  it("accepts a correctly signed CBS webhook and emits the event", async () => {
    const body = JSON.stringify({ cid: "C1", name: "Dorji" });
    const sig = signBody(body, SECRET);
    const res = await request(app)
      .post("/webhooks/cbs/customer-updated")
      .set("Content-Type", "application/json")
      .set("X-ZorDMS-Signature", sig)
      .send(body);
    expect(res.status).toBe(202);
    expect(events.emitted.some((e) => e.event === "cbs.customer.updated")).toBe(true);
    const handoff = await knex("integration_logs")
      .where({ system: "cbs", direction: "inbound", endpoint: "cbs.customer.updated" }).first();
    expect(handoff).toBeTruthy();
  });

  it("rejects a wrongly signed webhook with 401 and emits nothing", async () => {
    const before = events.emitted.length;
    const body = JSON.stringify({ cid: "C2" });
    const res = await request(app)
      .post("/webhooks/cbs/customer-updated")
      .set("Content-Type", "application/json")
      .set("X-ZorDMS-Signature", "sha256=deadbeef")
      .send(body);
    expect(res.status).toBe(401);
    expect(events.emitted.length).toBe(before);
  });

  it("routes LOS and KYC webhooks to their events", async () => {
    await knex("integration_config").where({ system: "los" }).update({ secret: "whsec_los" });
    await knex("integration_config").where({ system: "kyc" }).update({ secret: "whsec_kyc" });
    const losBody = JSON.stringify({ applicationId: "A1", cid: "C1", amount: 50000 });
    await request(app).post("/webhooks/los/loan-application")
      .set("Content-Type", "application/json").set("X-ZorDMS-Signature", signBody(losBody, "whsec_los")).send(losBody);
    const kycBody = JSON.stringify({ cid: "C1", decision: "PASS" });
    await request(app).post("/webhooks/kyc/verification-result")
      .set("Content-Type", "application/json").set("X-ZorDMS-Signature", signBody(kycBody, "whsec_kyc")).send(kycBody);
    expect(events.emitted.some((e) => e.event === "los.loan.created")).toBe(true);
    expect(events.emitted.some((e) => e.event === "kyc.result")).toBe(true);
  });
});
