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

describe("catalog route", () => {
  it("auto-catalogs a high-confidence CID and persists retention + destruction_date", async () => {
    const token = await h.tokenFor("admin");
    const id = await uploadDoc(token);
    const res = await request(h.app).post(`/catalog/${id}`).set("Authorization", `Bearer ${token}`).send({
      docType: "BT_CID_4G", confidence: 0.97,
      fields: { full_name: "T", dob: "1990-01-01", expiry_date: "2030-01-01" },
    });
    expect(res.status).toBe(200);
    expect(res.body.result.category).toBe("KYC / Identity");
    const doc = await h.knex("documents").where({ id }).first();
    expect(doc.catalog_category).toBe("KYC / Identity");
    expect(doc.retention_years).toBe(10);
    expect(doc.destruction_date).toBeTruthy();
    expect(h.events.events.some((e) => e.type === EVENTS.DOCUMENT_CATALOGED)).toBe(true);
  });

  it("does not assign a category when routed to human review", async () => {
    const token = await h.tokenFor("admin");
    const id = await uploadDoc(token);
    const res = await request(h.app).post(`/catalog/${id}`).set("Authorization", `Bearer ${token}`).send({
      docType: "BT_CID_4G", confidence: 0.3, fields: { full_name: "T", dob: "1990-01-01", expiry_date: "2030-01-01" },
    });
    expect(res.body.result.route).toBe("HUMAN_REVIEW");
    const doc = await h.knex("documents").where({ id }).first();
    expect(doc.catalog_category).toBeFalsy();
  });
});
