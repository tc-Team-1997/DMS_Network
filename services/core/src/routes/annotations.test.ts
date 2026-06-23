import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { makeTestApp } from "../testutil.js";

const h = await makeTestApp();
afterAll(async () => { await h.cleanup(); });

describe("annotations routes", () => {
  it("creates, lists, and deletes coordinate annotations", async () => {
    const token = await h.tokenFor("admin");
    const up = await request(h.app).post("/documents").set("Authorization", `Bearer ${token}`)
      .field("title", "Doc").field("branch", "Thimphu").attach("file", Buffer.from("x"), "x.png");
    const id = up.body.document.id;

    const create = await request(h.app).post(`/documents/${id}/annotations`).set("Authorization", `Bearer ${token}`)
      .send({ kind: "redaction", page: 1, x: 12, y: 34, width: 56, height: 78 });
    expect(create.status).toBe(201);
    expect(create.body.annotation.kind).toBe("redaction");

    const list = await request(h.app).get(`/documents/${id}/annotations`).set("Authorization", `Bearer ${token}`);
    expect(list.body.annotations).toHaveLength(1);

    const del = await request(h.app).delete(`/documents/${id}/annotations/${create.body.annotation.id}`).set("Authorization", `Bearer ${token}`);
    expect(del.status).toBe(204);
  });
});
