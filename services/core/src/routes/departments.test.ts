/**
 * §4.11 Master Data — Departments CRUD.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { makeTestApp } from "../testutil.js";

const h = await makeTestApp();
afterAll(async () => { await h.cleanup(); });

describe("Departments (/departments)", () => {
  it("requires auth", async () => {
    expect((await request(h.app).get("/departments")).status).toBe(401);
  });

  it("lists seeded departments", async () => {
    const token = await h.tokenFor("admin");
    const res = await request(h.app).get("/departments").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const codes = res.body.departments.map((d: any) => d.code);
    expect(codes).toEqual(expect.arrayContaining(["OPS", "RETAIL", "COMPLIANCE"]));
  });

  it("creates, fetches, updates and deletes a department", async () => {
    const token = await h.tokenFor("admin");
    const created = await request(h.app)
      .post("/departments")
      .set("Authorization", `Bearer ${token}`)
      .send({ code: "TRADE", name: "Trade Finance", head: "dorji" });
    expect(created.status).toBe(201);
    const id = created.body.department.id;
    expect(created.body.department.code).toBe("TRADE");

    const got = await request(h.app).get(`/departments/${id}`).set("Authorization", `Bearer ${token}`);
    expect(got.status).toBe(200);
    expect(got.body.department.head).toBe("dorji");

    const upd = await request(h.app)
      .put(`/departments/${id}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Trade & Supply-Chain Finance", status: "Inactive" });
    expect(upd.status).toBe(200);
    expect(upd.body.department.name).toBe("Trade & Supply-Chain Finance");
    expect(upd.body.department.status).toBe("Inactive");

    const del = await request(h.app).delete(`/departments/${id}`).set("Authorization", `Bearer ${token}`);
    expect(del.status).toBe(200);
    expect((await request(h.app).get(`/departments/${id}`).set("Authorization", `Bearer ${token}`)).status).toBe(404);
  });

  it("rejects a duplicate code with 409", async () => {
    const token = await h.tokenFor("admin");
    const res = await request(h.app)
      .post("/departments")
      .set("Authorization", `Bearer ${token}`)
      .send({ code: "OPS", name: "Duplicate Ops" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("duplicate_code");
  });

  it("rejects a malformed body with 400 validation_error", async () => {
    const token = await h.tokenFor("admin");
    const res = await request(h.app)
      .post("/departments")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "No code" }); // missing required code
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
  });
});
