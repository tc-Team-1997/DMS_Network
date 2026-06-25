import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { makeTestApp } from "../testutil.js";
import { newId } from "@zordms/db";

const h = await makeTestApp();
afterAll(async () => { await h.cleanup(); });

describe("branch network routes", () => {
  it("admin adds a branch then can list it", async () => {
    const adminToken = await h.tokenFor("admin");
    const add = await request(h.app).post("/branches").set("Authorization", `Bearer ${adminToken}`)
      .send({ code: "THI001", name: "Thimphu Main", region: "West", replication_mode: "sync" });
    expect(add.status).toBe(201);
    const list = await request(h.app).get("/branches").set("Authorization", `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    expect(list.body.branches.map((b: any) => b.code)).toContain("THI001");
  });

  it("forbids adding a branch without admin:access (Viewer role)", async () => {
    const viewerRole = await h.knex("roles").where({ name: "Viewer" }).first();
    const vid = newId();
    await h.knex("users").insert({ id: vid, username: "viewer_br", password_hash: "x", status: "Active" });
    await h.knex("user_roles").insert({ user_id: vid, role_id: viewerRole.id });
    const viewerToken = await h.tokenFor("viewer_br");

    const res = await request(h.app).post("/branches").set("Authorization", `Bearer ${viewerToken}`)
      .send({ code: "X", name: "Nope" });
    expect(res.status).toBe(403);
  });

  it("fail-closed: Viewer with no branch sees nothing from /branches", async () => {
    const viewerToken = await h.tokenFor("viewer_br");
    // Viewer has no crossbranch:read => 403
    const res = await request(h.app).get("/branches").set("Authorization", `Bearer ${viewerToken}`);
    expect(res.status).toBe(403);
  });

  it("sets and lists a cross-branch access policy", async () => {
    const adminToken = await h.tokenFor("admin");
    await request(h.app).post("/branches").set("Authorization", `Bearer ${adminToken}`)
      .send({ code: "PAR002", name: "Paro" });
    const set = await request(h.app).post("/branches/access").set("Authorization", `Bearer ${adminToken}`)
      .send({ source_branch: "THI001", target_branch: "PAR002", policy: "read" });
    expect(set.status).toBe(201);
    const list = await request(h.app).get("/branches/access").set("Authorization", `Bearer ${adminToken}`);
    expect(list.body.policies.some((p: any) => p.source_branch === "THI001" && p.policy === "read")).toBe(true);
  });
});
