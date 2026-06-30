/**
 * SC-02 — GET /documents/export returns a CSV of the filtered document set.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { makeTestApp } from "../testutil.js";

const h = await makeTestApp();
afterAll(async () => { await h.cleanup(); });

describe("GET /documents/export (SC-02)", () => {
  it("requires auth", async () => {
    expect((await request(h.app).get("/documents/export")).status).toBe(401);
  });

  it("returns a CSV with a header row covering the uploaded doc", async () => {
    const token = await h.tokenFor("admin");
    const up = await request(h.app).post("/documents").set("Authorization", `Bearer ${token}`)
      .field("title", "Export Subject").attach("file", Buffer.from("bytes"), "x.png");
    expect(up.status).toBe(201);

    const res = await request(h.app).get("/documents/export").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/csv");
    const lines = res.text.split("\n");
    expect(lines[0]).toBe("id,title,doc_type,branch,status,confidence,ingest_timestamp,original_filename");
    expect(res.text).toContain("Export Subject");
  });

  it("applies a status filter (no match → header only)", async () => {
    const token = await h.tokenFor("admin");
    const res = await request(h.app).get("/documents/export?status=Disposed").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    // freshly-uploaded docs are Active, so a Disposed filter yields just the header
    expect(res.text.split("\n").filter((l) => l.trim()).length).toBe(1);
  });
});
