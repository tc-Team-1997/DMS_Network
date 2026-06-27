import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { makeTestApp } from "../testutil.js";
import { newId } from "@zordms/db";

const h = await makeTestApp();
afterAll(async () => { await h.cleanup(); });

describe("sysadmin routes", () => {
  it("admin reads health, dr and schedules", async () => {
    const adminToken = await h.tokenFor("admin");
    const health = await request(h.app).get("/admin/health").set("Authorization", `Bearer ${adminToken}`);
    expect(health.status).toBe(200);
    expect(health.body.health.find((s: any) => s.service === "core")?.status).toBe("Up");

    const dr = await request(h.app).get("/admin/dr").set("Authorization", `Bearer ${adminToken}`);
    expect(dr.status).toBe(200);
    expect(dr.body.dr.rpo_minutes).toBe(15);

    const sch = await request(h.app).get("/admin/schedules").set("Authorization", `Bearer ${adminToken}`);
    expect(sch.status).toBe(200);
    expect(sch.body.schedules.length).toBeGreaterThan(0);
  });

  it("forbids a Viewer (no admin:access)", async () => {
    const viewerRole = await h.knex("roles").where({ name: "Viewer" }).first();
    const vid = newId();
    await h.knex("users").insert({ id: vid, username: "viewer_admin", password_hash: "x", status: "Active" });
    await h.knex("user_roles").insert({ user_id: vid, role_id: viewerRole.id });
    const viewerToken = await h.tokenFor("viewer_admin");
    expect((await request(h.app).get("/admin/health").set("Authorization", `Bearer ${viewerToken}`)).status).toBe(403);
  });

  it("GET /admin/settings returns defaults", async () => {
    const adminToken = await h.tokenFor("admin");
    const res = await request(h.app).get("/admin/settings").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.settings.defaultRetentionYears).toBe(7);
    expect(Array.isArray(res.body.settings.branches)).toBe(true);
    expect(res.body.settings.aiConfidenceThreshold).toBe(0.7);
  });

  it("PUT /admin/settings persists a valid update", async () => {
    const adminToken = await h.tokenFor("admin");
    const put = await request(h.app).put("/admin/settings").set("Authorization", `Bearer ${adminToken}`)
      .send({ defaultRetentionYears: 12, branches: ["HQ", "Paro"], aiConfidenceThreshold: 0.85, autoFolderRouting: false });
    expect(put.status).toBe(200);
    expect(put.body.settings.defaultRetentionYears).toBe(12);
    expect(put.body.settings.branches).toEqual(["HQ", "Paro"]);
    expect(put.body.settings.autoFolderRouting).toBe(false);
    // Persisted across a re-read.
    const get = await request(h.app).get("/admin/settings").set("Authorization", `Bearer ${adminToken}`);
    expect(get.body.settings.aiConfidenceThreshold).toBe(0.85);
  });

  it("PUT /admin/settings rejects invalid values with 422", async () => {
    const adminToken = await h.tokenFor("admin");
    const res = await request(h.app).put("/admin/settings").set("Authorization", `Bearer ${adminToken}`)
      .send({ aiConfidenceThreshold: 5 });
    expect(res.status).toBe(422);
    expect(Array.isArray(res.body.errors)).toBe(true);
  });
});
