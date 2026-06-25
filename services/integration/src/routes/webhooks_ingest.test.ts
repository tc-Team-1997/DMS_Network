import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { buildServiceKnex } from "@zordms/db";
import { loadConfig } from "@zordms/config";
import { createApp } from "../app.js";
import { InMemoryEventSink } from "../events/sink.js";
import { signBody } from "../webhooks/hmac.js";
import { CoreIngestClient } from "../core/ingest.js";

const migrationsDir = new URL("../migrations", import.meta.url).pathname;
const seedsDir = new URL("../seeds", import.meta.url).pathname;
const db = { client: "sqlite3" as const, host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "" };

const CBS_SECRET = "whsec_cbs";

describe("inbound webhook -> core ingest forwarding", () => {
  it("forwards a verified CBS webhook to core and marks the log consumed", async () => {
    const knex = buildServiceKnex({ migrationsDir, seedsDir, db });
    await knex.migrate.latest(); await knex.seed.run();
    await knex("integration_config").where({ system: "cbs" }).update({ secret: CBS_SECRET });

    const calls: Array<{ url: string; token: string | null; body: unknown }> = [];
    const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers as HeadersInit);
      calls.push({ url: String(url), token: headers.get("x-internal-token"), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ change: "created", cid: "C1" }), { status: 201, headers: { "Content-Type": "application/json" } });
    }) as unknown as typeof fetch;

    const coreIngest = new CoreIngestClient({ coreUrl: "http://core:4001", internalServiceToken: "tok-123", fetchImpl: fakeFetch });
    const app = createApp({ knex, config: loadConfig({ JWT_SECRET: "t" } as NodeJS.ProcessEnv), events: new InMemoryEventSink(), coreIngest });

    const body = JSON.stringify({ cid: "C1", name: "Dorji", branch: "Thimphu" });
    const res = await request(app)
      .post("/webhooks/cbs/customer-updated")
      .set("Content-Type", "application/json")
      .set("X-ZorDMS-Signature", signBody(body, CBS_SECRET))
      .send(body);

    expect(res.status).toBe(202);
    expect(res.body.consumed).toBe(true);

    // core was called with the right path, token, and payload
    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe("http://core:4001/integration/customer-upsert");
    expect(calls[0].token).toBe("tok-123");
    expect((calls[0].body as { cid: string }).cid).toBe("C1");

    const log = await knex("integration_logs")
      .where({ system: "cbs", direction: "inbound", endpoint: "cbs.customer.updated" })
      .orderBy("id", "desc").first();
    expect(Boolean(log.consumed)).toBe(true);
    await knex.destroy();
  });

  it("records consumed=false (and still 202s) when core is down", async () => {
    const knex = buildServiceKnex({ migrationsDir, seedsDir, db });
    await knex.migrate.latest(); await knex.seed.run();
    await knex("integration_config").where({ system: "los" }).update({ secret: "whsec_los" });

    const downFetch = (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
    const coreIngest = new CoreIngestClient({ coreUrl: "http://core:4001", internalServiceToken: "tok", fetchImpl: downFetch });
    const app = createApp({ knex, config: loadConfig({ JWT_SECRET: "t" } as NodeJS.ProcessEnv), events: new InMemoryEventSink(), coreIngest });

    const body = JSON.stringify({ applicationId: "A1", cid: "C1", amount: 50000 });
    const res = await request(app)
      .post("/webhooks/los/loan-application")
      .set("Content-Type", "application/json")
      .set("X-ZorDMS-Signature", signBody(body, "whsec_los"))
      .send(body);

    // best-effort: sender is not 500'd when core is briefly down
    expect(res.status).toBe(202);
    expect(res.body.consumed).toBe(false);

    const log = await knex("integration_logs")
      .where({ system: "los", direction: "inbound", endpoint: "los.loan.created" })
      .orderBy("id", "desc").first();
    expect(Boolean(log.consumed)).toBe(false);
    expect(log.error).toContain("ECONNREFUSED");
    await knex.destroy();
  });

  it("leaves consumed null for events without a core ingest route (kyc.result)", async () => {
    const knex = buildServiceKnex({ migrationsDir, seedsDir, db });
    await knex.migrate.latest(); await knex.seed.run();
    await knex("integration_config").where({ system: "kyc" }).update({ secret: "whsec_kyc" });

    let called = false;
    const fakeFetch = (async () => { called = true; return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
    const coreIngest = new CoreIngestClient({ coreUrl: "http://core:4001", internalServiceToken: "tok", fetchImpl: fakeFetch });
    const app = createApp({ knex, config: loadConfig({ JWT_SECRET: "t" } as NodeJS.ProcessEnv), events: new InMemoryEventSink(), coreIngest });

    const body = JSON.stringify({ cid: "C1", decision: "PASS" });
    const res = await request(app)
      .post("/webhooks/kyc/verification-result")
      .set("Content-Type", "application/json")
      .set("X-ZorDMS-Signature", signBody(body, "whsec_kyc"))
      .send(body);

    expect(res.status).toBe(202);
    expect(res.body.consumed).toBeNull();
    expect(called).toBe(false); // no route -> core not called
    const log = await knex("integration_logs")
      .where({ system: "kyc", direction: "inbound", endpoint: "kyc.result" })
      .orderBy("id", "desc").first();
    expect(log.consumed).toBeNull();
    await knex.destroy();
  });
});
