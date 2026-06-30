/**
 * SC-06 — retention-rule CRUD on /records/file-plan.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { makeTestApp } from "../testutil.js";

const h = await makeTestApp();
afterAll(async () => { await h.cleanup(); });

describe("Retention rules (SC-06)", () => {
  it("creates a rule, lists it, updates it, deletes it", async () => {
    const token = await h.tokenFor("admin");

    const created = await request(h.app).post("/records/file-plan").set("Authorization", `Bearer ${token}`)
      .send({ doc_class: "TEST_CLASS", retention_years: 7, trigger: "ingest", regulation: "RMA Test" });
    expect(created.status).toBe(201);
    expect(created.body.policy.doc_class).toBe("TEST_CLASS");
    const id = created.body.policy.id;

    const list = await request(h.app).get("/records/file-plan").set("Authorization", `Bearer ${token}`);
    expect(list.body.policies.some((p: any) => p.doc_class === "TEST_CLASS")).toBe(true);

    const upd = await request(h.app).put(`/records/file-plan/${id}`).set("Authorization", `Bearer ${token}`)
      .send({ retention_years: 10 });
    expect(upd.status).toBe(200);
    expect(upd.body.policy.retention_years).toBe(10);

    const del = await request(h.app).delete(`/records/file-plan/${id}`).set("Authorization", `Bearer ${token}`);
    expect(del.status).toBe(200);
    expect((await request(h.app).put(`/records/file-plan/${id}`).set("Authorization", `Bearer ${token}`).send({ retention_years: 1 })).status).toBe(404);
  });

  it("upsert updates an existing doc_class instead of duplicating", async () => {
    const token = await h.tokenFor("admin");
    await request(h.app).post("/records/file-plan").set("Authorization", `Bearer ${token}`).send({ doc_class: "DUP_CLASS", retention_years: 5 });
    await request(h.app).post("/records/file-plan").set("Authorization", `Bearer ${token}`).send({ doc_class: "DUP_CLASS", retention_years: 9 });
    const list = await request(h.app).get("/records/file-plan").set("Authorization", `Bearer ${token}`);
    const matches = list.body.policies.filter((p: any) => p.doc_class === "DUP_CLASS");
    expect(matches.length).toBe(1);
    expect(matches[0].retention_years).toBe(9);
  });

  it("rejects a malformed body with 400 validation_error", async () => {
    const token = await h.tokenFor("admin");
    const res = await request(h.app).post("/records/file-plan").set("Authorization", `Bearer ${token}`).send({ doc_class: "X" }); // missing retention_years
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
  });
});
