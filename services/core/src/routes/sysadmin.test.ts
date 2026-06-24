import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { makeTestApp } from "../testutil.js";

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
    const inserted = await h.knex("users").insert({ username: "viewer_admin", password_hash: "x", status: "Active" }).returning("id");
    const vid = typeof inserted[0] === "object" ? (inserted[0] as any).id : inserted[0];
    await h.knex("user_roles").insert({ user_id: vid, role_id: viewerRole.id });
    const viewerToken = await h.tokenFor("viewer_admin");
    expect((await request(h.app).get("/admin/health").set("Authorization", `Bearer ${viewerToken}`)).status).toBe(403);
  });
});
