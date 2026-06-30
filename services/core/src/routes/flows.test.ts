/**
 * SC-07 — system-flow lane definitions.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { makeTestApp } from "../testutil.js";

const h = await makeTestApp();
afterAll(async () => { await h.cleanup(); });

describe("System flows (SC-07)", () => {
  it("requires auth", async () => {
    expect((await request(h.app).get("/flows")).status).toBe(401);
  });

  it("returns the four lanes each with nodes", async () => {
    const token = await h.tokenFor("admin");
    const res = await request(h.app).get("/flows").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    const lanes = res.body.lanes.map((l: any) => l.lane);
    expect(lanes).toEqual(["document", "ai", "workflow", "integration"]);
    for (const l of res.body.lanes) {
      expect(Array.isArray(l.nodes)).toBe(true);
      expect(l.nodes.length).toBeGreaterThan(0);
      expect(l.nodes[0]).toHaveProperty("detail");
    }
  });

  it("fetches a single lane and 404s an unknown one", async () => {
    const token = await h.tokenFor("admin");
    const ok = await request(h.app).get("/flows/workflow").set("Authorization", `Bearer ${token}`);
    expect(ok.status).toBe(200);
    expect(ok.body.lane.label).toContain("Workflow");
    expect((await request(h.app).get("/flows/nope").set("Authorization", `Bearer ${token}`)).status).toBe(404);
  });
});
