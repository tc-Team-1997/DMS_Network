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

const CDO_PERMISSIONS = ["alert:read", "alert:manage", "alert_rule:manage"];
let adminToken = "";

beforeAll(async () => {
  await knex.migrate.latest(); await knex.seed.run();
  const admin = await knex("users").where({ username: "admin" }).first();
  adminToken = signToken({ sub: admin.id, username: "admin", roles: ["CDO"], permissions: CDO_PERMISSIONS, branch: "HQ" }, "t");
});
afterAll(async () => { await knex.destroy(); });

describe("OpenAPI document", () => {
  it("GET /openapi.json returns a 3.1 spec with the expected paths", async () => {
    const res = await request(app).get("/openapi.json");
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe("3.1.0");
    const paths = Object.keys(res.body.paths);
    for (const p of [
      "/health",
      "/openapi.json",
      "/alerts",
      "/alerts/stream",
      "/alerts/{id}/read",
      "/alerts/{id}/escalate",
      "/rules",
      "/rules/{id}",
    ]) {
      expect(paths).toContain(p);
    }
    // inbound cross-service security schemes documented
    expect(res.body.components.securitySchemes.internalToken.name).toBe("x-internal-token");
    expect(res.body.components.securitySchemes.hmacSignature.name).toBe("x-signature");
    // bearer JWT security scheme is documented
    expect(res.body.components.securitySchemes.bearerAuth.scheme).toBe("bearer");
    // request body for POST /rules references the zod-derived schema
    expect(res.body.paths["/rules"].post.requestBody.content["application/json"].schema.$ref)
      .toBe("#/components/schemas/CreateRuleBody");
  });

  it("GET /openapi (raw alias) also returns the spec", async () => {
    const res = await request(app).get("/openapi");
    expect(res.status).toBe(200);
    expect(res.body.info.title).toContain("Notify");
  });
});

describe("boundary validation", () => {
  it("POST /rules with a bad body returns 400 validation_error", async () => {
    const res = await request(app).post("/rules")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "", trigger: "" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
    expect(Array.isArray(res.body.issues)).toBe(true);
    expect(res.body.issues.length).toBeGreaterThan(0);
  });

  it("PATCH /rules/:id with an invalid channel returns 400 validation_error", async () => {
    const res = await request(app).patch("/rules/some-id")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ channels: ["carrier-pigeon"] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
  });

  it("GET /alerts with an invalid level query returns 400 validation_error", async () => {
    const res = await request(app).get("/alerts?level=bogus")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
  });
});
