import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { buildServiceKnex } from "@zordms/db";
import { loadConfig } from "@zordms/config";
import { signToken } from "@zordms/auth";
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

// UUID strings for the two actors used in this test suite.
const CHECKER_ID = "01910000-0000-7000-0000-000000000001";
const VIEWER_ID  = "01910000-0000-7000-0000-000000000002";

// Authority stub: allows checker (CHECKER_ID), denies viewer (VIEWER_ID).
const authority: AuthorityClient = {
  async check(userId, permissions) {
    if (userId === CHECKER_ID) return { allowed: true, missing: [] };
    return { allowed: false, missing: permissions };
  },
};

const config = loadConfig({ JWT_SECRET: "t" } as NodeJS.ProcessEnv);
const app = createApp({ knex, config, authority, events });

// F2/F14: Tokens are signed with permissions embedded; actor identity comes
// from the verified JWT (req.authUser.id) — NOT from request body.
// userId=CHECKER_ID → allowed by authority stub above.
// userId=VIEWER_ID → denied by authority stub.
const checkerToken = signToken(
  { sub: CHECKER_ID, username: "checker1", permissions: ["workflow:act"] } as Parameters<typeof signToken>[0],
  "t",
);
const viewerToken = signToken(
  { sub: VIEWER_ID, username: "viewer1", permissions: ["workflow:act"] } as Parameters<typeof signToken>[0],
  "t",
);

async function makeWorkflow(): Promise<string> {
  const tpl = await request(app)
    .post("/templates")
    .set("Authorization", `Bearer ${checkerToken}`)
    .send({
      name: `T-${Date.now()}-${Math.random()}`,
      steps_json: JSON.stringify([
        { name: "Maker", required_permissions: ["workflow:act"] },
        { name: "Checker", required_permissions: ["document:approve"] },
      ]),
    });
  const wf = await request(app)
    .post("/workflows")
    .set("Authorization", `Bearer ${checkerToken}`)
    .send({ title: "W", template_id: tpl.body.template.id, doc_confidence: 0.99 });
  return wf.body.workflow.id as string;
}

beforeAll(async () => {
  await knex.migrate.latest();
});
afterAll(async () => {
  await knex.destroy();
});

describe("POST /workflows/:id/act", () => {
  it("F1: 401 without a Bearer token", async () => {
    const id = await makeWorkflow();
    const res = await request(app).post(`/workflows/${id}/act`).send({ action: "approve" });
    expect(res.status).toBe(401);
  });

  it("F2: actor identity comes from JWT (not body) — viewer denied because authority stub rejects VIEWER_ID", async () => {
    const id = await makeWorkflow();
    // viewerToken has sub=VIEWER_ID which authority stub denies
    const res = await request(app)
      .post(`/workflows/${id}/act`)
      .set("Authorization", `Bearer ${viewerToken}`)
      .send({ action: "approve" }); // no userId in body
    expect(res.status).toBe(403);
    expect(res.body.missing.length).toBeGreaterThan(0);
    const wf = await knex("workflows").where({ id }).first();
    expect(wf.status).toBe("Active");
  });

  it("403 when the gateway denies authority (no state change)", async () => {
    const id = await makeWorkflow();
    // viewerToken → sub=VIEWER_ID → authority stub denies
    const res = await request(app)
      .post(`/workflows/${id}/act`)
      .set("Authorization", `Bearer ${viewerToken}`)
      .send({ action: "approve" });
    expect(res.status).toBe(403);
    expect(res.body.missing.length).toBeGreaterThan(0);
    const wf = await knex("workflows").where({ id }).first();
    expect(wf.status).toBe("Active");
  });

  it("advances on approve when authority is granted and emits workflow.approved", async () => {
    const id = await makeWorkflow();
    const res = await request(app)
      .post(`/workflows/${id}/act`)
      .set("Authorization", `Bearer ${checkerToken}`)
      .send({ action: "approve" });
    expect(res.status).toBe(200);
    expect(res.body.workflow.stage).toBe("Checker"); // advanced to step 2
    const step1 = await knex("workflow_steps").where({ workflow_id: id, seq: 1 }).first();
    expect(step1.status).toBe("Approved");
    expect(step1.actor_id).toBe(CHECKER_ID); // actor from JWT sub=CHECKER_ID
    expect(events.events.some((e) => e.event === "workflow.approved")).toBe(true);
  });

  it("completes the workflow as Approved on the final approval", async () => {
    const id = await makeWorkflow();
    await request(app).post(`/workflows/${id}/act`).set("Authorization", `Bearer ${checkerToken}`).send({ action: "approve" }); // step 1
    const res = await request(app)
      .post(`/workflows/${id}/act`)
      .set("Authorization", `Bearer ${checkerToken}`)
      .send({ action: "approve" }); // step 2
    expect(res.body.workflow.status).toBe("Approved");
  });

  it("rejects the workflow and emits workflow.rejected", async () => {
    const id = await makeWorkflow();
    const res = await request(app)
      .post(`/workflows/${id}/act`)
      .set("Authorization", `Bearer ${checkerToken}`)
      .send({ action: "reject", comment: "bad scan" });
    expect(res.body.workflow.status).toBe("Rejected");
    expect(events.events.some((e) => e.event === "workflow.rejected")).toBe(true);
  });

  it("escalates and emits workflow.escalated", async () => {
    const id = await makeWorkflow();
    const res = await request(app)
      .post(`/workflows/${id}/act`)
      .set("Authorization", `Bearer ${checkerToken}`)
      .send({ action: "escalate" });
    expect(res.body.workflow.status).toBe("Escalated");
    expect(events.events.some((e) => e.event === "workflow.escalated")).toBe(true);
  });

  it("F4: OnHold workflow cannot receive act action", async () => {
    const id = await makeWorkflow();
    // First hold the workflow
    const holdRes = await request(app)
      .post(`/workflows/${id}/act`)
      .set("Authorization", `Bearer ${checkerToken}`)
      .send({ action: "hold" });
    expect(holdRes.body.workflow.status).toBe("OnHold");

    // Now try to approve the held workflow — should be 409
    const approveRes = await request(app)
      .post(`/workflows/${id}/act`)
      .set("Authorization", `Bearer ${checkerToken}`)
      .send({ action: "approve" });
    expect(approveRes.status).toBe(409);
    expect(approveRes.body.error).toBe("workflow_inactive");
  });

  it("F4: Escalated workflow cannot receive act action", async () => {
    const id = await makeWorkflow();
    // Escalate the workflow
    await request(app)
      .post(`/workflows/${id}/act`)
      .set("Authorization", `Bearer ${checkerToken}`)
      .send({ action: "escalate" });

    // Try to approve the escalated workflow — should be 409
    const res = await request(app)
      .post(`/workflows/${id}/act`)
      .set("Authorization", `Bearer ${checkerToken}`)
      .send({ action: "approve" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("workflow_inactive");
  });
});
