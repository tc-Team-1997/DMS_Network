import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { makeTestApp } from "./testutil.js";

const h = await makeTestApp();
afterAll(async () => { await h.cleanup(); });

describe("core health", () => {
  it("GET /health returns ok", async () => {
    const res = await request(h.app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.service).toBe("core");
  });
});
