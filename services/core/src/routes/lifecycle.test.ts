import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { makeTestApp } from "../testutil.js";
import { newId } from "@zordms/db";

const h = await makeTestApp();
afterAll(async () => { await h.cleanup(); });

describe("GET /lifecycle/:docId", () => {
  it("returns the lifecycle trace for a document", async () => {
    const token = await h.tokenFor("admin");
    const docId = newId();
    await h.knex("documents").insert({
      id: docId,
      title: "LifecycleDoc", doc_no: "L9", doc_type: "LETTER", cid: "7", branch: "THI001",
      file_hash_sha256: "z", status: "Indexed", source_channel: "UPLOAD", page_count: 1, file_size_bytes: 0, current_version: 1,
    });

    const res = await request(h.app).get(`/lifecycle/${docId}`).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.trace.document_id).toBe(docId);
    expect(res.body.trace.stages.length).toBe(5);
  });

  it("returns 404 for a non-existent document", async () => {
    const token = await h.tokenFor("admin");
    const res = await request(h.app).get("/lifecycle/018f4e3a-0000-7000-0000-000000000000").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it("401 without a token", async () => {
    expect((await request(h.app).get("/lifecycle/018f4e3a-0000-7000-0000-000000000001")).status).toBe(401);
  });
});
