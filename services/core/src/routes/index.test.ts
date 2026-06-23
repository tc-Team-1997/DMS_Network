import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { makeTestApp } from "../testutil.js";
import { EVENTS } from "../events/index.js";

const h = await makeTestApp();
afterAll(async () => { await h.cleanup(); });

async function uploadDoc(token: string): Promise<number> {
  const up = await request(h.app).post("/documents").set("Authorization", `Bearer ${token}`)
    .field("title", "CID").field("branch", "Thimphu").attach("file", Buffer.from("cid"), "cid.png");
  return up.body.document.id;
}

describe("index route", () => {
  it("persists valid CID metadata and emits document.indexed", async () => {
    const token = await h.tokenFor("admin");
    const id = await uploadDoc(token);
    const res = await request(h.app).post(`/index/${id}`).set("Authorization", `Bearer ${token}`).send({
      doc_type: "BT_CID_4G", confidence: 0.97,
      fields: { cid_no: "10112345678", full_name: "Tashi Dorji", dob: "1990-05-01", issue_date: "2020-01-01", expiry_date: "2030-01-01", dzongkhag: "Thimphu" },
    });
    expect(res.status).toBe(200);
    expect(res.body.document.doc_type).toBe("BT_CID_4G");
    expect(res.body.document.review_flag).toBe(false);
    expect(JSON.parse(res.body.document.metadata).cid_no).toBe("10112345678");
    expect(h.events.events.some((e) => e.type === EVENTS.DOCUMENT_INDEXED)).toBe(true);
  });

  it("sets review_flag when confidence < 0.85", async () => {
    const token = await h.tokenFor("admin");
    const id = await uploadDoc(token);
    const res = await request(h.app).post(`/index/${id}`).set("Authorization", `Bearer ${token}`).send({
      doc_type: "BT_CID_4G", confidence: 0.7,
      fields: { cid_no: "10112345678", full_name: "T", dob: "1990-05-01", issue_date: "2020-01-01", expiry_date: "2030-01-01", dzongkhag: "Thimphu" },
    });
    expect(res.status).toBe(200);
    expect(res.body.document.review_flag).toBe(true);
  });

  it("returns 422 with errors/missing on invalid metadata", async () => {
    const token = await h.tokenFor("admin");
    const id = await uploadDoc(token);
    const res = await request(h.app).post(`/index/${id}`).set("Authorization", `Bearer ${token}`).send({
      doc_type: "BT_CID_4G", fields: { cid_no: "bad", full_name: "T", dob: "1990-05-01", issue_date: "2020-01-01", dzongkhag: "Thimphu" },
    });
    expect(res.status).toBe(422);
    expect(res.body.missing).toContain("expiry_date");
    expect(res.body.errors.length).toBeGreaterThan(0);
  });
});
