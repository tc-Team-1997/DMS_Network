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

describe("workflow CRUD + instantiation", () => {
  let templateId = 0;

  it("creates a template", async () => {
    const res = await request(app).post("/templates").send({
      name: "KYC Approval",
      doc_type: "BT_CID_4G",
      steps_json: JSON.stringify([
        { name: "Maker submits", required_permissions: ["workflow:act"], sla_minutes: 60 },
        {
          name: "Checker approves",
          required_permissions: ["document:approve"],
          sla_minutes: 120,
          min_confidence: 0.9,
        },
      ]),
    });
    expect(res.status).toBe(201);
    templateId = res.body.template.id;
    expect(templateId).toBeGreaterThan(0);
  });

  it("instantiates a workflow with ordered steps and emits workflow.created", async () => {
    const res = await request(app).post("/workflows").send({
      title: "KYC for CID 11503001234",
      doc_id: "DOC-1",
      template_id: templateId,
      priority: "High",
      assigned_to: "checker1",
      doc_confidence: 0.97,
      created_by: "maker1",
    });
    expect(res.status).toBe(201);
    expect(res.body.workflow.ref_code).toMatch(/^WF-/);
    expect(res.body.steps).toHaveLength(2);
    expect(res.body.steps[0].seq).toBe(1);
    expect(res.body.requires_manual_review).toBe(false);
    expect(events.events.some((e) => e.event === "workflow.created")).toBe(true);
  });

  it("flags low-confidence documents for manual review", async () => {
    const res = await request(app).post("/workflows").send({
      title: "Low conf",
      doc_id: "DOC-2",
      template_id: templateId,
      doc_confidence: 0.5,
    });
    expect(res.status).toBe(201);
    expect(res.body.requires_manual_review).toBe(true);
  });

  it("lists and fetches a workflow with its steps", async () => {
    const list = await request(app).get("/workflows");
    expect(list.body.workflows.length).toBeGreaterThan(0);
    const id = list.body.workflows[0].id;
    const one = await request(app).get(`/workflows/${id}`);
    expect(one.status).toBe(200);
    expect(Array.isArray(one.body.steps)).toBe(true);
  });
});
