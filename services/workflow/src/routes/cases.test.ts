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

// Mint tokens with embedded permissions for case management.
// F1: All sensitive routes require authentication and the right permission.
const managerToken = signToken(
  {
    sub: "01910000-0000-7000-0000-000000000001",
    username: "manager1",
    permissions: ["case:create", "case:manage", "workflow:act"],
  } as Parameters<typeof signToken>[0],
  "t",
);

beforeAll(async () => {
  await knex.migrate.latest();
});
afterAll(async () => {
  await knex.destroy();
});

describe("case management", () => {
  let caseId = "";
  let templateId = "";

  it("F1: 401 without a token on POST /cases", async () => {
    const res = await request(app).post("/cases").send({ case_type: "KYC", title: "test" });
    expect(res.status).toBe(401);
  });

  it("F1: 403 without case:create permission on POST /cases", async () => {
    const noPermToken = signToken(
      { sub: "01910000-0000-7000-0000-000000000005", username: "noperm", permissions: [] } as Parameters<typeof signToken>[0],
      "t",
    );
    const res = await request(app)
      .post("/cases")
      .set("Authorization", `Bearer ${noPermToken}`)
      .send({ case_type: "KYC", title: "test" });
    expect(res.status).toBe(403);
  });

  it("creates a KYC case with an embedded workflow and emits case.created", async () => {
    const tpl = await request(app)
      .post("/templates")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({
        name: "KYC",
        steps_json: JSON.stringify([
          { name: "Verify", required_permissions: ["document:approve"] },
        ]),
      });
    templateId = tpl.body.template.id;

    const res = await request(app)
      .post("/cases")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({
        case_type: "KYC",
        title: "Onboard Dorji",
        assigned_to: "checker1",
        template_id: templateId,
        doc_confidence: 0.98,
      });
    expect(res.status).toBe(201);
    expect(res.body.case.case_ref).toMatch(/^CASE-KYC-/);
    expect(res.body.case.workflow_id).toBeTruthy();
    caseId = res.body.case.id;
    expect(typeof caseId).toBe("string");
    expect(caseId.length).toBe(36);
    expect(events.events.some((e) => e.event === "case.created")).toBe(true);
  });

  it("rejects an invalid case_type", async () => {
    const res = await request(app)
      .post("/cases")
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ case_type: "Mortgage", title: "x" });
    expect(res.status).toBe(400);
  });

  it("attaches a document and fetches the case bundle", async () => {
    const att = await request(app)
      .post(`/cases/${caseId}/documents`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ doc_id: "DOC-99", label: "CID front" });
    expect(att.status).toBe(201);
    const bundle = await request(app)
      .get(`/cases/${caseId}`)
      .set("Authorization", `Bearer ${managerToken}`);
    expect(bundle.body.documents).toHaveLength(1);
    expect(bundle.body.workflow).toBeTruthy();
  });

  it("resolves a case and records resolution metrics", async () => {
    const res = await request(app)
      .post(`/cases/${caseId}/resolve`)
      .set("Authorization", `Bearer ${managerToken}`)
      .send({ status: "Resolved", resolution: "KYC verified" });
    expect(res.status).toBe(200);
    expect(res.body.case.status).toBe("Resolved");
    expect(res.body.case.resolved_at).toBeTruthy();

    const metrics = await request(app)
      .get("/cases/metrics")
      .set("Authorization", `Bearer ${managerToken}`);
    expect(metrics.body.total).toBeGreaterThan(0);
    expect(metrics.body.resolved).toBeGreaterThan(0);
    expect(metrics.body.by_type.KYC).toBeGreaterThan(0);
  });

  it("lists cases", async () => {
    const res = await request(app)
      .get("/cases")
      .set("Authorization", `Bearer ${managerToken}`);
    expect(Array.isArray(res.body.cases)).toBe(true);
  });
});
