import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import knexLib from "knex";
import { buildKnexConfig } from "@zordms/db";
import { loadConfig } from "@zordms/config";
import { createApp } from "./app.js";

const knex = knexLib(buildKnexConfig({
  client: "sqlite3", host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "",
}));
const app = createApp({
  knex,
  config: loadConfig({ JWT_SECRET: "t", INTERNAL_SERVICE_TOKEN: "test-internal-token" } as NodeJS.ProcessEnv),
});

beforeAll(async () => { await knex.migrate.latest(); await knex.seed.run(); });
afterAll(async () => { await knex.destroy(); });

describe("zod boundary validation", () => {
  it("POST /auth/login with a bad body returns 400 validation_error", async () => {
    const res = await request(app).post("/auth/login").send({ username: "" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
    expect(Array.isArray(res.body.issues)).toBe(true);
    expect(res.body.issues.length).toBeGreaterThan(0);
  });

  it("POST /authz/check with a bad body (valid token) returns 400 validation_error", async () => {
    const res = await request(app)
      .post("/authz/check")
      .set("x-internal-token", "test-internal-token")
      .send({ userId: "u1", permissions: "not-an-array" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
  });
});

describe("OpenAPI document", () => {
  it("GET /openapi.json returns the 3.1 spec with the expected paths", async () => {
    const res = await request(app).get("/openapi.json");
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe("3.1.0");
    const paths = Object.keys(res.body.paths);
    expect(paths).toContain("/auth/login");
    expect(paths).toContain("/auth/me");
    expect(paths).toContain("/users");
    expect(paths).toContain("/users/{id}/roles");
    expect(paths).toContain("/users/{id}/lock");
    expect(paths).toContain("/authz/check");
    expect(paths).toContain("/health");
    // SSO routes
    expect(paths).toContain("/auth/config");
    expect(paths).toContain("/auth/ldap/login");
    expect(paths).toContain("/auth/oidc/login");
    expect(paths).toContain("/auth/oidc/callback");
    expect(paths).toContain("/auth/saml/login");
    expect(paths).toContain("/auth/saml/callback");
    // bearer JWT security scheme present
    expect(res.body.components.securitySchemes.bearerAuth.scheme).toBe("bearer");
    expect(res.body.components.securitySchemes.bearerAuth.bearerFormat).toBe("JWT");
    // internal token scheme present for service-to-service / inbound
    expect(res.body.components.securitySchemes.internalToken.name).toBe("x-internal-token");
    // SSO token-handoff scheme documented
    expect(res.body.components.securitySchemes.ssoHandoff.type).toBe("oauth2");
  });

  it("GET /openapi returns the same raw spec", async () => {
    const res = await request(app).get("/openapi");
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe("3.1.0");
  });
});
