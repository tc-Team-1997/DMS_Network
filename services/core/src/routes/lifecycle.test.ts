import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { makeTestApp } from "../testutil.js";

const h = await makeTestApp();
afterAll(async () => { await h.cleanup(); });

describe("GET /lifecycle/:docId", () => {
  it("returns the lifecycle trace for a document", async () => {
    const token = await h.tokenFor("admin");
    const ins = await h.knex("documents").insert({
      title: "LifecycleDoc", doc_no: "L9", doc_type: "LETTER", cid: "7", branch: "THI001",
      file_hash_sha256: "z", status: "Indexed", source_channel: "UPLOAD", page_count: 1, file_size_bytes: 0, current_version: 1,
    }).returning("id");
    const docId = typeof ins[0] === "object" ? (ins[0] as any).id : ins[0];

    const res = await request(h.app).get(`/lifecycle/${docId}`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.trace.document_id).toBe(docId);
    expect(res.body.trace.stages.length).toBe(5);
  });

  it("returns 404 for a non-existent document", async () => {
    const token = await h.tokenFor("admin");
    const res = await request(h.app).get("/lifecycle/999999").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it("401 without a token", async () => {
    expect((await request(h.app).get("/lifecycle/1")).status).toBe(401);
  });
});
