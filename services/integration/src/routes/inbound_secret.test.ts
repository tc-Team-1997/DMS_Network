import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { buildServiceKnex } from "@zordms/db";
import { loadConfig } from "@zordms/config";
import { signToken } from "@zordms/auth";
import { createApp } from "../app.js";
import { InMemoryEventSink } from "../events/sink.js";
import { signBody } from "../webhooks/hmac.js";
import { CoreIngestClient } from "../core/ingest.js";

const migrationsDir = new URL("../migrations", import.meta.url).pathname;
const seedsDir = new URL("../seeds", import.meta.url).pathname;
const db = { client: "sqlite3" as const, host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "" };

// The seed inserts this LOCAL/DEV inbound secret for the cbs system so the signed
// inbound webhook chain is demoable out of the box (no manual secret wiring).
const SEEDED_CBS_SECRET = "cbs-local-inbound-secret";

describe("seeded inbound secret + management rotation (full signed chain)", () => {
  const knex = buildServiceKnex({ migrationsDir, seedsDir, db });
  const events = new InMemoryEventSink();

  // Capture forwards to core so we can assert the full chain fires.
  const calls: Array<{ url: string; token: string | null; body: unknown }> = [];
  const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers as HeadersInit);
    calls.push({ url: String(url), token: headers.get("x-internal-token"), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ change: "created", cid: "C1" }), {
      status: 201, headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;

  const coreIngest = new CoreIngestClient({ coreUrl: "http://core:4001", internalServiceToken: "tok-xyz", fetchImpl: fakeFetch });
  const app = createApp({ knex, config: loadConfig({ JWT_SECRET: "t" } as NodeJS.ProcessEnv), events, coreIngest });

  let adminToken = "";
  let readOnlyToken = "";

  beforeAll(async () => {
    await knex.migrate.latest();
    await knex.seed.run();
    const admin = await knex("users").where({ username: "admin" }).first();
    adminToken = signToken({ sub: admin.id, username: "admin", roles: ["CDO"], permissions: ["integration:read", "integration:manage"] }, "t");
    readOnlyToken = signToken({ sub: admin.id, username: "auditor", roles: ["Auditor"], permissions: ["integration:read"] }, "t");
  });
  afterAll(async () => { await knex.destroy(); });

  it("seeds a known inbound secret so a correctly-signed CBS webhook passes HMAC, forwards to core, and is marked consumed", async () => {
    // Sanity: the seed actually populated the inbound secret for cbs.
    const cfg = await knex("integration_config").where({ system: "cbs" }).first();
    expect(cfg.secret).toBe(SEEDED_CBS_SECRET);

    const body = JSON.stringify({ cid: "C1", name: "Dorji", branch: "Thimphu" });
    const sig = signBody(body, SEEDED_CBS_SECRET); // sha256=<hmac-sha256(secret, raw body)>

    const res = await request(app)
      .post("/webhooks/cbs/customer-updated")
      .set("Content-Type", "application/json")
      .set("X-ZorDMS-Signature", sig)
      .send(body);

    // signature trusted -> 202, forwarded to core, consumed=true (the full chain)
    expect(res.status).toBe(202);
    expect(res.body.consumed).toBe(true);

    expect(calls.length).toBe(1);
    expect(calls[0].url).toBe("http://core:4001/integration/customer-upsert");
    expect(calls[0].token).toBe("tok-xyz");
    expect((calls[0].body as { cid: string }).cid).toBe("C1");

    const log = await knex("integration_logs")
      .where({ system: "cbs", direction: "inbound", endpoint: "cbs.customer.updated" })
      .orderBy("id", "desc").first();
    expect(Boolean(log.consumed)).toBe(true);
  });

  it("still rejects a wrongly-signed webhook with 401", async () => {
    const body = JSON.stringify({ cid: "C2" });
    const res = await request(app)
      .post("/webhooks/cbs/customer-updated")
      .set("Content-Type", "application/json")
      .set("X-ZorDMS-Signature", "sha256=deadbeef")
      .send(body);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("invalid_signature");
  });

  it("PUT /integration/systems/:id/inbound-secret rotates the secret (admin RBAC) so the new secret verifies and the old one 401s", async () => {
    const rotated = "cbs-rotated-secret-001";
    const put = await request(app)
      .put("/integration/systems/cbs/inbound-secret")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ secret: rotated });
    expect(put.status).toBe(200);
    expect(put.body).toEqual({ system: "cbs", inboundSecretSet: true });

    const body = JSON.stringify({ cid: "C3", name: "Pema" });

    // old (seeded) secret now fails
    const oldRes = await request(app)
      .post("/webhooks/cbs/customer-updated")
      .set("Content-Type", "application/json")
      .set("X-ZorDMS-Signature", signBody(body, SEEDED_CBS_SECRET))
      .send(body);
    expect(oldRes.status).toBe(401);

    // new secret verifies and completes the chain
    const newRes = await request(app)
      .post("/webhooks/cbs/customer-updated")
      .set("Content-Type", "application/json")
      .set("X-ZorDMS-Signature", signBody(body, rotated))
      .send(body);
    expect(newRes.status).toBe(202);
    expect(newRes.body.consumed).toBe(true);
  });

  it("requires integration:manage permission to set an inbound secret (403 for read-only)", async () => {
    const res = await request(app)
      .put("/integration/systems/cbs/inbound-secret")
      .set("Authorization", `Bearer ${readOnlyToken}`)
      .send({ secret: "another-secret-value" });
    expect(res.status).toBe(403);
  });

  it("returns 404 when the target system does not exist", async () => {
    const res = await request(app)
      .put("/integration/systems/does-not-exist/inbound-secret")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ secret: "some-secret-value" });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("system_not_found");
  });

  it("validates the secret body (400 on too-short / missing secret)", async () => {
    const res = await request(app)
      .put("/integration/systems/cbs/inbound-secret")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ secret: "short" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
  });
});
