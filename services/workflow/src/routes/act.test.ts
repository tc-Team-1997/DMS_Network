import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { buildServiceKnex } from "@zordms/db";
import { loadConfig } from "@zordms/config";
import { createApp } from "../app.js";
import { createRecordingBus } from "../events.js";
import type { AuthorityClient } from "../authority.js";

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

// Authority stub: allows actor 1 (checker), denies actor 2 (viewer).
const authority: AuthorityClient = {
  async check(userId, permissions) {
    if (userId === 1) return { allowed: true, missing: [] };
    return { allowed: false, missing: permissions };
  },
};

const app = createApp({
  knex,
  config: loadConfig({ JWT_SECRET: "t" } as NodeJS.ProcessEnv),
  authority,
  events,
});

async function makeWorkflow(): Promise<number> {
  const tpl = await request(app).post("/templates").send({
    name: "T",
    steps_json: JSON.stringify([
      { name: "Maker", required_permissions: ["workflow:act"] },
      { name: "Checker", required_permissions: ["document:approve"] },
    ]),
  });
  const wf = await request(app)
    .post("/workflows")
    .send({ title: "W", template_id: tpl.body.template.id, doc_confidence: 0.99 });
  return wf.body.workflow.id;
}

beforeAll(async () => {
  await knex.migrate.latest();
});
afterAll(async () => {
  await knex.destroy();
});

describe("POST /workflows/:id/act", () => {
  it("403 when the gateway denies authority (no state change)", async () => {
    const id = await makeWorkflow();
    const res = await request(app)
      .post(`/workflows/${id}/act`)
      .send({ userId: 2, action: "approve" });
    expect(res.status).toBe(403);
    expect(res.body.missing.length).toBeGreaterThan(0);
    const wf = await knex("workflows").where({ id }).first();
    expect(wf.status).toBe("Active");
  });

  it("advances on approve when authority is granted and emits workflow.approved", async () => {
    const id = await makeWorkflow();
    const res = await request(app)
      .post(`/workflows/${id}/act`)
      .send({ userId: 1, action: "approve" });
    expect(res.status).toBe(200);
    expect(res.body.workflow.stage).toBe("Checker"); // advanced to step 2
    const step1 = await knex("workflow_steps").where({ workflow_id: id, seq: 1 }).first();
    expect(step1.status).toBe("Approved");
    expect(step1.actor_id).toBe(1);
    expect(events.events.some((e) => e.event === "workflow.approved")).toBe(true);
  });

  it("completes the workflow as Approved on the final approval", async () => {
    const id = await makeWorkflow();
    await request(app).post(`/workflows/${id}/act`).send({ userId: 1, action: "approve" }); // step 1
    const res = await request(app)
      .post(`/workflows/${id}/act`)
      .send({ userId: 1, action: "approve" }); // step 2
    expect(res.body.workflow.status).toBe("Approved");
  });

  it("rejects the workflow and emits workflow.rejected", async () => {
    const id = await makeWorkflow();
    const res = await request(app)
      .post(`/workflows/${id}/act`)
      .send({ userId: 1, action: "reject", comment: "bad scan" });
    expect(res.body.workflow.status).toBe("Rejected");
    expect(events.events.some((e) => e.event === "workflow.rejected")).toBe(true);
  });

  it("escalates and emits workflow.escalated", async () => {
    const id = await makeWorkflow();
    const res = await request(app)
      .post(`/workflows/${id}/act`)
      .send({ userId: 1, action: "escalate" });
    expect(res.body.workflow.status).toBe("Escalated");
    expect(events.events.some((e) => e.event === "workflow.escalated")).toBe(true);
  });
});
