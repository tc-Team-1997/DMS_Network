/**
 * §4.6 Validation module — rules CRUD + run engine + results.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { makeTestApp } from "../testutil.js";

const h = await makeTestApp();
afterAll(async () => { await h.cleanup(); });

describe("Validation module (/validation)", () => {
  it("requires auth", async () => {
    expect((await request(h.app).get("/validation/rules")).status).toBe(401);
  });

  it("lists seeded rules and filters by doc_type", async () => {
    const token = await h.tokenFor("admin");
    const all = await request(h.app).get("/validation/rules").set("Authorization", `Bearer ${token}`);
    expect(all.status).toBe(200);
    expect(all.body.rules.length).toBeGreaterThanOrEqual(2);

    const cid = await request(h.app).get("/validation/rules?doc_type=BT_CID_4G").set("Authorization", `Bearer ${token}`);
    expect(cid.status).toBe(200);
    expect(cid.body.rules.every((r: any) => r.docType === "BT_CID_4G")).toBe(true);
  });

  it("creates, updates and deletes a rule", async () => {
    const token = await h.tokenFor("admin");
    const created = await request(h.app)
      .post("/validation/rules")
      .set("Authorization", `Bearer ${token}`)
      .send({ doc_type: "BT_PASSPORT", field_key: "passport_no", rule_type: "min_length", params: { min: 6 }, severity: "warning" });
    expect(created.status).toBe(201);
    const id = created.body.rule.id;
    expect(created.body.rule.ruleType).toBe("min_length");

    const updated = await request(h.app)
      .put(`/validation/rules/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ enabled: false });
    expect(updated.status).toBe(200);
    expect(updated.body.rule.enabled).toBe(false);

    const del = await request(h.app).delete(`/validation/rules/${id}`).set("Authorization", `Bearer ${token}`);
    expect(del.status).toBe(200);
    expect((await request(h.app).put(`/validation/rules/${id}`).set("Authorization", `Bearer ${token}`).send({ enabled: true })).status).toBe(404);
  });

  it("rejects a malformed rule body with 400 validation_error", async () => {
    const token = await h.tokenFor("admin");
    const res = await request(h.app)
      .post("/validation/rules")
      .set("Authorization", `Bearer ${token}`)
      .send({ field_key: "x", rule_type: "not_a_real_type" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
  });

  it("runs rules against data — regex pass/fail reflected in summary", async () => {
    const token = await h.tokenFor("admin");
    // seeded BT_CID_4G rule: cid_no must match ^[0-9]{11}$
    const good = await request(h.app)
      .post("/validation/run")
      .set("Authorization", `Bearer ${token}`)
      .send({ doc_type: "BT_CID_4G", data: { cid_no: "11504000231" } });
    expect(good.status).toBe(200);
    expect(good.body.summary.failed).toBe(0);

    const bad = await request(h.app)
      .post("/validation/run")
      .set("Authorization", `Bearer ${token}`)
      .send({ doc_type: "BT_CID_4G", data: { cid_no: "ABC" } });
    expect(bad.status).toBe(200);
    expect(bad.body.summary.failed).toBeGreaterThanOrEqual(1);
    expect(bad.body.summary.errors).toBeGreaterThanOrEqual(1);
  });

  it("persists results per-document and lists them", async () => {
    const token = await h.tokenFor("admin");
    await request(h.app)
      .post("/validation/run")
      .set("Authorization", `Bearer ${token}`)
      .send({ documentId: "doc-under-test", doc_type: "BT_CID_4G", data: { cid_no: "bad" } });

    const results = await request(h.app)
      .get("/validation/results?document_id=doc-under-test")
      .set("Authorization", `Bearer ${token}`);
    expect(results.status).toBe(200);
    expect(results.body.results.length).toBeGreaterThanOrEqual(1);
    expect(results.body.results.some((r: any) => r.passed === false)).toBe(true);
  });

  it("GET /results without document_id is 400", async () => {
    const token = await h.tokenFor("admin");
    expect((await request(h.app).get("/validation/results").set("Authorization", `Bearer ${token}`)).status).toBe(400);
  });
});
