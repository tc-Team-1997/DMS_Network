import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { makeTestApp } from "../testutil.js";

const h = await makeTestApp();
afterAll(async () => { await h.cleanup(); });

describe("folders routes", () => {
  it("401 without a token", async () => {
    expect((await request(h.app).get("/folders")).status).toBe(401);
  });

  it("admin can create and list folders", async () => {
    const token = await h.tokenFor("admin");
    const created = await request(h.app).post("/folders").set("Authorization", `Bearer ${token}`)
      .send({ name: "Customers", domain: "Customers" });
    expect(created.status).toBe(201);
    expect(created.body.folder.path).toBe("/BoB/Customers");

    const list = await request(h.app).get("/folders").set("Authorization", `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.tree.some((n: any) => n.name === "Customers")).toBe(true);
  });
});
