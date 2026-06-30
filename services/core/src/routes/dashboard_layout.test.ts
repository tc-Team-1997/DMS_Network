/**
 * SC-01 — per-user dashboard layout persistence.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { makeTestApp } from "../testutil.js";

const h = await makeTestApp();
afterAll(async () => { await h.cleanup(); });

describe("Dashboard layout (SC-01)", () => {
  it("requires auth", async () => {
    expect((await request(h.app).get("/dashboard/layout")).status).toBe(401);
  });

  it("returns {} before any save, then persists + reloads the saved config", async () => {
    const token = await h.tokenFor("admin");
    const first = await request(h.app).get("/dashboard/layout").set("Authorization", `Bearer ${token}`);
    expect(first.status).toBe(200);
    expect(first.body.config).toEqual({});

    const cfg = { inflowChart: "bar", donutMetric: "doc_type" };
    const put = await request(h.app).put("/dashboard/layout").set("Authorization", `Bearer ${token}`).send({ config: cfg });
    expect(put.status).toBe(200);
    expect(put.body.config).toEqual(cfg);

    const reload = await request(h.app).get("/dashboard/layout").set("Authorization", `Bearer ${token}`);
    expect(reload.body.config).toEqual(cfg);
  });

  it("rejects a malformed body with 400 validation_error", async () => {
    const token = await h.tokenFor("admin");
    const res = await request(h.app).put("/dashboard/layout").set("Authorization", `Bearer ${token}`).send({ notConfig: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
  });
});
