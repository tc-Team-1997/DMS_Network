/**
 * §4.13 Config module — system_config key/value CRUD.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { makeTestApp } from "../testutil.js";

const h = await makeTestApp();
afterAll(async () => { await h.cleanup(); });

describe("Config module (/config)", () => {
  it("requires auth", async () => {
    const res = await request(h.app).get("/config");
    expect(res.status).toBe(401);
  });

  it("lists seeded defaults", async () => {
    const token = await h.tokenFor("admin");
    const res = await request(h.app).get("/config").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.config)).toBe(true);
    const keys = res.body.config.map((c: any) => c.key);
    expect(keys).toContain("ai.classification_threshold");
    // value is JSON-decoded (a number, not a string)
    const thr = res.body.config.find((c: any) => c.key === "ai.classification_threshold");
    expect(typeof thr.value).toBe("number");
  });

  it("filters by category", async () => {
    const token = await h.tokenFor("admin");
    const res = await request(h.app).get("/config?category=upload").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.config.length).toBeGreaterThan(0);
    expect(res.body.config.every((c: any) => c.category === "upload")).toBe(true);
  });

  it("404 for an unknown key", async () => {
    const token = await h.tokenFor("admin");
    const res = await request(h.app).get("/config/does.not.exist").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it("upserts a new key (PUT) and reads it back with the JSON type preserved", async () => {
    const token = await h.tokenFor("admin");
    const put = await request(h.app)
      .put("/config/ai.classification_threshold")
      .set("Authorization", `Bearer ${token}`)
      .send({ value: 0.85, category: "ai" });
    expect(put.status).toBe(200);
    expect(put.body.config.value).toBe(0.85);

    const get = await request(h.app).get("/config/ai.classification_threshold").set("Authorization", `Bearer ${token}`);
    expect(get.status).toBe(200);
    expect(get.body.config.value).toBe(0.85);
    expect(get.body.config.updatedBy).toBe("admin");

    // array values round-trip too
    const arr = await request(h.app)
      .put("/config/upload.allowed_formats")
      .set("Authorization", `Bearer ${token}`)
      .send({ value: ["pdf", "png"] });
    expect(arr.status).toBe(200);
    expect(arr.body.config.value).toEqual(["pdf", "png"]);
  });

  it("rejects a malformed body with 400 validation_error", async () => {
    const token = await h.tokenFor("admin");
    const res = await request(h.app)
      .put("/config/some.key")
      .set("Authorization", `Bearer ${token}`)
      .send({ category: "ai" }); // missing required `value`
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
  });

  it("writes an audit row on PUT", async () => {
    const token = await h.tokenFor("admin");
    await request(h.app)
      .put("/config/general.test_audit")
      .set("Authorization", `Bearer ${token}`)
      .send({ value: "x" });
    const rows = await h.knex("audit_log").where({ action: "CONFIG_SET", entity_id: "general.test_audit" });
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });
});
