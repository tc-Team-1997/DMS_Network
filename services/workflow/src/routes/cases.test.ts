import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { buildServiceKnex } from "@zordms/db";
import { loadConfig } from "@zordms/config";
import { createApp } from "../app.js";
import { createRecordingBus } from "../events.js";

const migrationsDir = new URL("../migrations", import.meta.url).pathname;
const db = {
  client: "sqlite3" as const,
  host: "",
  port: 0,
  user: "",
  password: "",
  name: "",
  oracleConnectString: "",
};
const knex = buildServiceKnex({ migrationsDir, db });
const events = createRecordingBus();
const app = createApp({
  knex,
  config: loadConfig({ JWT_SECRET: "t" } as NodeJS.ProcessEnv),
  events,
});

beforeAll(async () => {
  await knex.migrate.latest();
});
afterAll(async () => {
  await knex.destroy();
});

describe("case management", () => {
  let caseId = 0;
  let templateId = 0;

  it("creates a KYC case with an embedded workflow and emits case.created", async () => {
    const tpl = await request(app).post("/templates").send({
      name: "KYC",
      steps_json: JSON.stringify([
        { name: "Verify", required_permissions: ["document:approve"] },
      ]),
    });
    templateId = tpl.body.template.id;

    const res = await request(app).post("/cases").send({
      case_type: "KYC",
      title: "Onboard Dorji",
      assigned_to: "checker1",
      template_id: templateId,
      doc_confidence: 0.98,
      created_by: "maker1",
    });
    expect(res.status).toBe(201);
    expect(res.body.case.case_ref).toMatch(/^CASE-KYC-/);
    expect(res.body.case.workflow_id).toBeTruthy();
    caseId = res.body.case.id;
    expect(events.events.some((e) => e.event === "case.created")).toBe(true);
  });

  it("rejects an invalid case_type", async () => {
    const res = await request(app).post("/cases").send({ case_type: "Mortgage", title: "x" });
    expect(res.status).toBe(400);
  });

  it("attaches a document and fetches the case bundle", async () => {
    const att = await request(app)
      .post(`/cases/${caseId}/documents`)
      .send({ doc_id: "DOC-99", label: "CID front" });
    expect(att.status).toBe(201);
    const bundle = await request(app).get(`/cases/${caseId}`);
    expect(bundle.body.documents).toHaveLength(1);
    expect(bundle.body.workflow).toBeTruthy();
  });

  it("resolves a case and records resolution metrics", async () => {
    const res = await request(app)
      .post(`/cases/${caseId}/resolve`)
      .send({ status: "Resolved", resolution: "KYC verified" });
    expect(res.status).toBe(200);
    expect(res.body.case.status).toBe("Resolved");
    expect(res.body.case.resolved_at).toBeTruthy();

    const metrics = await request(app).get("/cases/metrics");
    expect(metrics.body.total).toBeGreaterThan(0);
    expect(metrics.body.resolved).toBeGreaterThan(0);
    expect(metrics.body.by_type.KYC).toBeGreaterThan(0);
  });

  it("lists cases", async () => {
    const res = await request(app).get("/cases");
    expect(Array.isArray(res.body.cases)).toBe(true);
  });
});
