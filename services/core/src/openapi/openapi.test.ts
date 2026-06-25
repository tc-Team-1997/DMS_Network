/**
 * P10 — boundary validation + OpenAPI spec serving tests.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { makeTestApp } from "../testutil.js";

const h = await makeTestApp();
afterAll(async () => { await h.cleanup(); });

describe("zod boundary validation", () => {
  it("a bad body to a mutating route returns 400 validation_error with issues", async () => {
    const token = await h.tokenFor("admin");
    // POST /folders requires a non-empty string `name`; send a number instead.
    const res = await request(h.app)
      .post("/folders")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: 12345 });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
    expect(Array.isArray(res.body.issues)).toBe(true);
    expect(res.body.issues.length).toBeGreaterThan(0);
    expect(res.body.issues[0].path).toContain("name");
  });

  it("a missing required field on an internal route returns 400 validation_error", async () => {
    const TOKEN = "change-me-internal"; // default config.internalServiceToken in tests
    const res = await request(h.app)
      .post("/integration/customer-upsert")
      .set("x-internal-token", TOKEN)
      .send({ name: "No CID" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
  });

  it("a valid body still passes through unchanged (201)", async () => {
    const token = await h.tokenFor("admin");
    const res = await request(h.app)
      .post("/folders")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "ValidFolder", domain: "Customers" });
    expect(res.status).toBe(201);
    expect(res.body.folder.name).toBe("ValidFolder");
  });
});

describe("GET /openapi.json", () => {
  it("returns the OpenAPI 3.1 spec with the expected paths + security schemes", async () => {
    const res = await request(h.app).get("/openapi.json");
    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe("3.1.0");
    expect(res.body.info.title).toContain("Core");

    const paths = Object.keys(res.body.paths);
    expect(paths).toContain("/folders");
    expect(paths).toContain("/documents/{id}");
    expect(paths).toContain("/integration/customer-upsert");
    expect(paths).toContain("/index/{documentId}");

    // Auth schemes documented: bearer JWT + internal token.
    const schemes = res.body.components.securitySchemes;
    expect(schemes.bearerAuth.scheme).toBe("bearer");
    expect(schemes.internalToken.name).toBe("x-internal-token");

    // Request schema derived from zod is present as a component.
    expect(res.body.components.schemas.CreateFolder).toBeDefined();
    expect(res.body.components.schemas.ValidationError).toBeDefined();
  });

  it("serves the raw spec at GET /openapi", async () => {
    const res = await request(h.app).get("/openapi");
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.text);
    expect(parsed.openapi).toBe("3.1.0");
  });
});
