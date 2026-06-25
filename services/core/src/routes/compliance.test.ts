import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { makeTestApp } from "../testutil.js";
import { newId } from "@zordms/db";

const h = await makeTestApp();
afterAll(async () => { await h.cleanup(); });

describe("compliance routes", () => {
  it("auditor reads the scorecard and matrix", async () => {
    // CDO (admin) has compliance:read
    const adminToken = await h.tokenFor("admin");
    const sc = await request(h.app).get("/compliance/scorecard").set("Authorization", `Bearer ${adminToken}`);
    expect(sc.status).toBe(200);
    expect(typeof sc.body.scorecard.score).toBe("number");
    const mx = await request(h.app).get("/compliance/matrix").set("Authorization", `Bearer ${adminToken}`);
    expect(mx.body.matrix.length).toBeGreaterThan(0);
  });

  it("forbids a Maker (no compliance:read)", async () => {
    const makerRole = await h.knex("roles").where({ name: "Maker" }).first();
    const mid = newId();
    await h.knex("users").insert({ id: mid, username: "maker_comp", password_hash: "x", status: "Active" });
    await h.knex("user_roles").insert({ user_id: mid, role_id: makerRole.id });
    const makerToken = await h.tokenFor("maker_comp");
    expect((await request(h.app).get("/compliance/scorecard").set("Authorization", `Bearer ${makerToken}`)).status).toBe(403);
  });

  it("verifies the tamper-evident chain", async () => {
    const adminToken = await h.tokenFor("admin");
    const res = await request(h.app).get("/compliance/verify").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.verification.ok).toBe(true);
  });
});
