/**
 * §4.7 AI capability console — feature config + metrics.
 */
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { makeTestApp } from "../testutil.js";

const h = await makeTestApp();
afterAll(async () => { await h.cleanup(); });

describe("AI console (/ai-config)", () => {
  it("requires auth", async () => {
    expect((await request(h.app).get("/ai-config/features")).status).toBe(401);
  });

  it("lists the seeded 10 features with latest metric merged", async () => {
    const token = await h.tokenFor("admin");
    const res = await request(h.app).get("/ai-config/features").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.features.length).toBe(10);
    const classify = res.body.features.find((f: any) => f.featureKey === "classify");
    expect(classify.enabled).toBe(true);
    expect(classify.threshold).toBe(0.92);
    expect(classify.latestMetric.accuracy).toBeGreaterThan(0);
  });

  it("PATCH toggles enabled + tunes threshold and audits", async () => {
    const token = await h.tokenFor("admin");
    const res = await request(h.app)
      .patch("/ai-config/features/classify")
      .set("Authorization", `Bearer ${token}`)
      .send({ enabled: false, threshold: 0.8 });
    expect(res.status).toBe(200);
    expect(res.body.feature.enabled).toBe(false);
    expect(res.body.feature.threshold).toBe(0.8);
    expect(res.body.feature.updatedBy).toBe("admin");

    const rows = await h.knex("audit_log").where({ action: "AI_FEATURE_SET", entity_id: "classify" });
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it("PATCH on unknown feature is 404", async () => {
    const token = await h.tokenFor("admin");
    expect((await request(h.app).patch("/ai-config/features/nope").set("Authorization", `Bearer ${token}`).send({ enabled: true })).status).toBe(404);
  });

  it("rejects an out-of-range threshold with 400 validation_error", async () => {
    const token = await h.tokenFor("admin");
    const res = await request(h.app)
      .patch("/ai-config/features/classify")
      .set("Authorization", `Bearer ${token}`)
      .send({ threshold: 5 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("validation_error");
  });

  it("records and lists metrics by feature", async () => {
    const token = await h.tokenFor("admin");
    const post = await request(h.app)
      .post("/ai-config/metrics")
      .set("Authorization", `Bearer ${token}`)
      .send({ feature_key: "extract", accuracy: 0.88, throughput: 75, period: "7d" });
    expect(post.status).toBe(201);

    const list = await request(h.app).get("/ai-config/metrics?feature=extract").set("Authorization", `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.metrics.every((m: any) => m.featureKey === "extract")).toBe(true);
    expect(list.body.metrics[0].accuracy).toBe(0.88); // most recent first
  });
});
