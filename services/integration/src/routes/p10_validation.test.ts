import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { buildServiceKnex } from "@zordms/db";
import { loadConfig } from "@zordms/config";
import { signToken } from "@zordms/auth";
import { createApp } from "../app.js";
import { InMemoryEventSink } from "../events/sink.js";
import { signBody } from "../webhooks/hmac.js";

const migrationsDir = new URL("../migrations", import.meta.url).pathname;
const seedsDir = new URL("../seeds", import.meta.url).pathname;
const db = { client: "sqlite3" as const, host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "" };
const knex = buildServiceKnex({ migrationsDir, seedsDir, db });
const events = new InMemoryEventSink();
const app = createApp({ knex, config: loadConfig({ JWT_SECRET: "t" } as NodeJS.ProcessEnv), events });
let adminToken = "";
const CBS_SECRET = "whsec_cbs";

beforeAll(async () => {
  await knex.migrate.latest();
  await knex.seed.run();
  await knex("integration_config").where({ system: "cbs" }).update({ secret: CBS_SECRET });
  const admin = await knex("users").where({ username: "admin" }).first();
  adminToken = signToken(
    { sub: admin.id, username: "admin", roles: ["CDO"], permissions: ["integration:read", "integration:manage"] },
    "t",
  );
});
afterAll(async () => { await knex.destroy(); });

describe("P10 zod boundary validation", () => {
  it("POST /outbound with a bad body returns 400 validation_error", async () => {
    const res = await request(app)
      .post("/outbound")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ url: "not-a-url", events: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
    expect(Array.isArray(res.body.issues)).toBe(true);
    expect(res.body.issues.length).toBeGreaterThan(0);
  });

  it("POST /outbound/test without an event returns 400 validation_error", async () => {
    const res = await request(app)
      .post("/outbound/test")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ payload: { a: 1 } });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
  });

  it("a correctly-signed inbound webhook with an invalid payload returns 400 validation_error", async () => {
    const before = events.emitted.length;
    // valid signature over the raw body, but missing required `cid`
    const body = JSON.stringify({ name: "no-cid" });
    const res = await request(app)
      .post("/webhooks/cbs/customer-updated")
      .set("Content-Type", "application/json")
      .set("X-ZorDMS-Signature", signBody(body, CBS_SECRET))
      .send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
    // nothing emitted on validation failure
    expect(events.emitted.length).toBe(before);
  });

  it("a bad signature still returns 401 (not 400) even with an invalid payload", async () => {
    const body = JSON.stringify({ name: "no-cid" });
    const res = await request(app)
      .post("/webhooks/cbs/customer-updated")
      .set("Content-Type", "application/json")
      .set("X-ZorDMS-Signature", "sha256=deadbeef")
      .send(body);
    expect(res.status).toBe(401);
  });
});

describe("P10 OpenAPI document", () => {
  it("GET /openapi.json returns a 3.1 spec with the expected paths and security schemes", async () => {
    const res = await request(app).get("/openapi.json");
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe("3.1.0");
    const paths = Object.keys(res.body.paths);
    expect(paths).toContain("/webhooks/cbs/customer-updated");
    expect(paths).toContain("/outbound");
    expect(paths).toContain("/outbound/test");
    expect(paths).toContain("/integration/logs");
    const schemes = res.body.components.securitySchemes;
    expect(schemes.bearerAuth).toBeTruthy();
    expect(schemes.internalToken.name).toBe("x-internal-token");
    expect(schemes.hmacSignature.name).toBe("x-zordms-signature");
  });

  it("GET /openapi also serves the raw spec", async () => {
    const res = await request(app).get("/openapi");
    expect(res.status).toBe(200);
    expect(res.body.info.title).toContain("Integration");
  });
});
