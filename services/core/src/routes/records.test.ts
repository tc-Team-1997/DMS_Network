import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { makeTestApp } from "../testutil.js";

const h = await makeTestApp();
afterAll(async () => { await h.cleanup(); });

describe("records routes", () => {
  it("lists the file plan with compliance:read", async () => {
    const adminToken = await h.tokenFor("admin");
    await h.knex("retention_policies").insert({ doc_class: "GENERAL_LETTER", retention_years: 7, trigger: "ingest", regulation: "Default" });
    const res = await request(h.app).get("/records/file-plan").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.policies.map((p: any) => p.doc_class)).toContain("GENERAL_LETTER");
  });

  it("forbids placing a hold without legal_hold:place (Viewer role)", async () => {
    const viewerRole = await h.knex("roles").where({ name: "Viewer" }).first();
    const inserted = await h.knex("users").insert({ username: "viewer_rec", password_hash: "x", status: "Active" }).returning("id");
    const vid = typeof inserted[0] === "object" ? (inserted[0] as any).id : inserted[0];
    await h.knex("user_roles").insert({ user_id: vid, role_id: viewerRole.id });
    const viewerToken = await h.tokenFor("viewer_rec");

    const res = await request(h.app).post("/records/holds").set("Authorization", `Bearer ${viewerToken}`)
      .send({ ref: "LH-X", scope: "branch:THI001" });
    expect(res.status).toBe(403);
  });

  it("admin places and releases a legal hold", async () => {
    const adminToken = await h.tokenFor("admin");
    const place = await request(h.app).post("/records/holds").set("Authorization", `Bearer ${adminToken}`)
      .send({ ref: "LH-2026-09", scope: "branch:THI001" });
    expect(place.status).toBe(201);
    const rel = await request(h.app).post("/records/holds/LH-2026-09/release").set("Authorization", `Bearer ${adminToken}`);
    expect(rel.status).toBe(200);
    expect(rel.body.hold.status).toBe("Released");
  });

  it("legal hold blocks certified disposal", async () => {
    const adminToken = await h.tokenFor("admin");
    // Insert a doc in branch THI001
    const ins = await h.knex("documents").insert({
      title: "HoldDoc", doc_type: "BOB_LOAN_APPLICATION", cid: "1", branch: "THI001",
      file_hash_sha256: "hh", status: "Active", source_channel: "UPLOAD", page_count: 1, file_size_bytes: 0, current_version: 1,
    }).returning("id");
    const docId = typeof ins[0] === "object" ? (ins[0] as any).id : ins[0];

    // Place hold on branch:THI001
    await request(h.app).post("/records/holds").set("Authorization", `Bearer ${adminToken}`)
      .send({ ref: "LH-BLOCK-01", scope: "branch:THI001" });

    // Disposal should be refused (409)
    const cert = await request(h.app).post(`/records/disposal/${docId}/certify`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(cert.status).toBe(409);
    expect(cert.body.error).toMatch(/legal_hold/);
  });
});
