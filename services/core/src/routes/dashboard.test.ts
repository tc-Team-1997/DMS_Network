import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { makeTestApp } from "../testutil.js";

const h = await makeTestApp();
afterAll(async () => { await h.cleanup(); });

describe("dashboard summary", () => {
  it("returns counts including pendingReview and byCategory", async () => {
    const token = await h.tokenFor("admin");
    const up = await request(h.app).post("/documents").set("Authorization", `Bearer ${token}`)
      .field("title", "D").field("branch", "Thimphu").attach("file", Buffer.from("d"), "d.png");
    const id = up.body.document.id;
    await request(h.app).post(`/catalog/${id}`).set("Authorization", `Bearer ${token}`).send({
      docType: "BT_CID_4G", confidence: 0.97, fields: { full_name: "T", dob: "1990-01-01", expiry_date: "2030-01-01" },
    });

    const res = await request(h.app).get("/dashboard/summary").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.totalDocuments).toBeGreaterThanOrEqual(1);
    expect(res.body.byCategory["KYC / Identity"]).toBeGreaterThanOrEqual(1);
    expect(typeof res.body.pendingReview).toBe("number");
  });
});
