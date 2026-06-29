/**
 * §4.10 Reports module — run engine, library CRUD, CSV export.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { makeTestApp } from "../testutil.js";

const h = await makeTestApp();
afterAll(async () => { await h.cleanup(); });

async function seedDocs() {
  // Insert a few documents directly so group-by has something to aggregate.
  const rows = [
    { id: "rpt-d1", title: "A", doc_type: "BT_CID_4G", branch: "THM-HQ", status: "Active", confidence: 0.9 },
    { id: "rpt-d2", title: "B", doc_type: "BT_CID_4G", branch: "PAR-01", status: "Active", confidence: 0.7 },
    { id: "rpt-d3", title: "C", doc_type: "BOB_LOAN_APPLICATION", branch: "THM-HQ", status: "Active", confidence: 0.5 },
  ];
  for (const r of rows) {
    await h.knex("documents").insert({
      id: r.id, title: r.title, original_filename: `${r.id}.pdf`, mime_type: "application/pdf",
      current_version: 1, file_hash_sha256: "0".repeat(64), source_channel: "SCAN", ingest_user_id: "admin",
      doc_type: r.doc_type, branch: r.branch, status: r.status, confidence: r.confidence,
    }).onConflict("id").ignore(); // idempotent: this helper runs in multiple tests
  }
}

describe("Reports module (/reports)", () => {
  it("requires auth", async () => {
    expect((await request(h.app).get("/reports/library")).status).toBe(401);
  });

  it("lists whitelisted sources", async () => {
    const token = await h.tokenFor("admin");
    const res = await request(h.app).get("/reports/sources").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const names = res.body.sources.map((s: any) => s.source);
    expect(names).toContain("documents");
    expect(names).toContain("jobs");
  });

  it("runs an ad-hoc group-by report with count + avg", async () => {
    await seedDocs();
    const token = await h.tokenFor("admin");
    const res = await request(h.app)
      .post("/reports/run")
      .set("Authorization", `Bearer ${token}`)
      .send({ source: "documents", group_by: ["doc_type"], measures: [{ fn: "count", alias: "n" }, { fn: "avg", field: "confidence", alias: "avg_conf" }] });
    expect(res.status).toBe(200);
    expect(res.body.columns).toEqual(["doc_type", "n", "avg_conf"]);
    const cid = res.body.rows.find((r: any) => r.doc_type === "BT_CID_4G");
    // The dev seed already contains BT_CID_4G docs, so assert ">= our 2", not "== 2".
    expect(cid.n).toBeGreaterThanOrEqual(2);
    expect(typeof cid.avg_conf).toBe("number");
  });

  it("rejects a non-whitelisted group_by column with 400", async () => {
    const token = await h.tokenFor("admin");
    const res = await request(h.app)
      .post("/reports/run")
      .set("Authorization", `Bearer ${token}`)
      .send({ source: "documents", group_by: ["password_hash"] });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toContain("invalid group_by");
  });

  it("rejects an unknown source via zod with 400 validation_error", async () => {
    const token = await h.tokenFor("admin");
    const res = await request(h.app)
      .post("/reports/run")
      .set("Authorization", `Bearer ${token}`)
      .send({ source: "secret_table" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
  });

  it("saves a definition, lists it, exports CSV, deletes it", async () => {
    await seedDocs();
    const token = await h.tokenFor("admin");
    const created = await request(h.app)
      .post("/reports/library")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "By branch", source: "documents", group_by: ["branch"], measures: [{ fn: "count", alias: "count" }] });
    expect(created.status).toBe(201);
    const id = created.body.report.id;

    const lib = await request(h.app).get("/reports/library").set("Authorization", `Bearer ${token}`);
    expect(lib.body.reports.some((r: any) => r.id === id)).toBe(true);

    const csv = await request(h.app).get(`/reports/library/${id}/export`).set("Authorization", `Bearer ${token}`);
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toContain("text/csv");
    expect(csv.text.split("\n")[0]).toBe("branch,count");

    const del = await request(h.app).delete(`/reports/library/${id}`).set("Authorization", `Bearer ${token}`);
    expect(del.status).toBe(200);
    expect((await request(h.app).get(`/reports/library/${id}`).set("Authorization", `Bearer ${token}`)).status).toBe(404);
  });
});
