import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { buildServiceKnex } from "@zordms/db";
import { loadConfig } from "@zordms/config";
import { signToken } from "@zordms/auth";
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
const config = loadConfig({ JWT_SECRET: "t" } as NodeJS.ProcessEnv);
const app = createApp({ knex, config, events });

// Mint a JWT with workflow:act permission embedded in the payload.
// signToken types only accept {sub, username} but jwt.sign passes through
// all payload fields — the permissions claim is read by requireAuth.
const actorToken = signToken(
  { sub: "01910000-0000-7000-0000-000000000001", username: "maker1", permissions: ["workflow:act"] } as Parameters<typeof signToken>[0],
  "t",
);

beforeAll(async () => { await knex.migrate.latest(); });
afterAll(async () => { await knex.destroy(); });

describe("workflow CRUD + instantiation", () => {
  let templateId = "";

  it("F1: 401 without a token on POST /templates", async () => {
    const res = await request(app).post("/templates").send({
      name: "Unauthed",
      steps_json: JSON.stringify([{ name: "Step" }]),
    });
    expect(res.status).toBe(401);
  });

  it("F1: 403 without the workflow:act permission on POST /templates", async () => {
    const readonlyToken = signToken(
      { sub: "01910000-0000-7000-0000-000000000099", username: "readonly", permissions: [] } as Parameters<typeof signToken>[0],
      "t",
    );
    const res = await request(app)
      .post("/templates")
      .set("Authorization", `Bearer ${readonlyToken}`)
      .send({ name: "X", steps_json: JSON.stringify([{ name: "S" }]) });
    expect(res.status).toBe(403);
  });

  it("creates a template", async () => {
    const res = await request(app)
      .post("/templates")
      .set("Authorization", `Bearer ${actorToken}`)
      .send({
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
    expect(typeof templateId).toBe("string");
    expect(templateId.length).toBe(36);
    // F12: active should be a boolean true, not integer 1
    expect(res.body.template.active).toBe(true);
  });

  it("instantiates a workflow with ordered steps and emits workflow.created", async () => {
    const res = await request(app)
      .post("/workflows")
      .set("Authorization", `Bearer ${actorToken}`)
      .send({
        title: "KYC for CID 11503001234",
        doc_id: "DOC-1",
        template_id: templateId,
        priority: "High",
        assigned_to: "checker1",
        doc_confidence: 0.97,
      });
    expect(res.status).toBe(201);
    expect(res.body.workflow.ref_code).toMatch(/^WF-/);
    expect(res.body.steps).toHaveLength(2);
    expect(res.body.steps[0].seq).toBe(1);
    expect(res.body.requires_manual_review).toBe(false);
    expect(events.events.some((e) => e.event === "workflow.created")).toBe(true);
  });

  it("flags low-confidence documents for manual review", async () => {
    const res = await request(app)
      .post("/workflows")
      .set("Authorization", `Bearer ${actorToken}`)
      .send({ title: "Low conf", doc_id: "DOC-2", template_id: templateId, doc_confidence: 0.5 });
    expect(res.status).toBe(201);
    expect(res.body.requires_manual_review).toBe(true);
  });

  it("lists and fetches a workflow with its steps", async () => {
    const list = await request(app)
      .get("/workflows")
      .set("Authorization", `Bearer ${actorToken}`);
    expect(list.body.workflows.length).toBeGreaterThan(0);
    const id = list.body.workflows[0].id;
    expect(typeof id).toBe("string");
    expect(id.length).toBe(36);
    const one = await request(app)
      .get(`/workflows/${id}`)
      .set("Authorization", `Bearer ${actorToken}`);
    expect(one.status).toBe(200);
    expect(Array.isArray(one.body.steps)).toBe(true);
  });
});
