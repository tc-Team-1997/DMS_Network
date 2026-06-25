/**
 * P3 tests:
 *  - POST /workflows/:id/claim — assigns the current Pending step + guards.
 *  - GET  /workflows?status=  — cross-status review queue returns items in
 *    each status (Pending / Claimed / Approved / Rejected / Escalated / OnHold).
 *
 * SQLite, in-process. Authority stub allows the checker so /act works.
 */
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

const CHECKER_ID = "01910000-0000-7000-0000-0000000000a1";
const authority: AuthorityClient = {
  async check() {
    return { allowed: true, missing: [] };
  },
};
const config = loadConfig({ JWT_SECRET: "t" } as NodeJS.ProcessEnv);
const app = createApp({ knex, config, authority, events });

const makerToken = signToken(
  {
    sub: CHECKER_ID,
    username: "maker.sonam",
    permissions: ["workflow:act", "document:approve"],
    branch: "Thimphu",
  } as Parameters<typeof signToken>[0],
  "t",
);

// A second maker in the same branch (to test claim contention).
const otherMakerToken = signToken(
  {
    sub: "01910000-0000-7000-0000-0000000000b2",
    username: "maker.dawa",
    permissions: ["workflow:act", "document:approve"],
    branch: "Thimphu",
  } as Parameters<typeof signToken>[0],
  "t",
);

// A user in a different branch with NO cross-branch read.
const otherBranchToken = signToken(
  {
    sub: "01910000-0000-7000-0000-0000000000c3",
    username: "checker.paro",
    permissions: ["workflow:act", "document:approve"],
    branch: "Paro",
  } as Parameters<typeof signToken>[0],
  "t",
);

async function makeTemplate(): Promise<string> {
  const tpl = await request(app)
    .post("/templates")
    .set("Authorization", `Bearer ${makerToken}`)
    .send({
      name: `T-${Date.now()}-${Math.random()}`,
      steps_json: JSON.stringify([
        { name: "Maker Review", required_permissions: ["workflow:act"], sla_minutes: 60 },
        { name: "Checker Approval", required_permissions: ["document:approve"], sla_minutes: 30 },
      ]),
    });
  return tpl.body.template.id as string;
}

async function makeWorkflow(opts: { branch?: string; token?: string } = {}): Promise<string> {
  const templateId = await makeTemplate();
  const wf = await request(app)
    .post("/workflows")
    .set("Authorization", `Bearer ${opts.token ?? makerToken}`)
    .send({
      title: "Review case",
      doc_id: "DOC-X",
      template_id: templateId,
      doc_confidence: 0.99,
      branch: opts.branch,
    });
  return wf.body.workflow.id as string;
}

beforeAll(async () => {
  await knex.migrate.latest();
});
afterAll(async () => {
  await knex.destroy();
});

describe("POST /workflows/:id/claim", () => {
  it("401 without a token", async () => {
    const id = await makeWorkflow({ branch: "Thimphu" });
    const res = await request(app).post(`/workflows/${id}/claim`).send({});
    expect(res.status).toBe(401);
  });

  it("assigns the current Pending step to the acting user", async () => {
    const id = await makeWorkflow({ branch: "Thimphu" });
    const res = await request(app)
      .post(`/workflows/${id}/claim`)
      .set("Authorization", `Bearer ${makerToken}`);
    expect(res.status).toBe(200);
    const step1 = res.body.steps.find((s: { seq: number }) => s.seq === 1);
    expect(step1.claimed_by).toBe("maker.sonam");
    expect(step1.claimed_at).toBeTruthy();
  });

  it("guards: a different user cannot claim an already-claimed step (409)", async () => {
    const id = await makeWorkflow({ branch: "Thimphu" });
    await request(app).post(`/workflows/${id}/claim`).set("Authorization", `Bearer ${makerToken}`);
    const res = await request(app)
      .post(`/workflows/${id}/claim`)
      .set("Authorization", `Bearer ${otherMakerToken}`);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("already_claimed");
    expect(res.body.claimed_by).toBe("maker.sonam");
  });

  it("is idempotent: the same user can re-claim their own step (200)", async () => {
    const id = await makeWorkflow({ branch: "Thimphu" });
    await request(app).post(`/workflows/${id}/claim`).set("Authorization", `Bearer ${makerToken}`);
    const res = await request(app)
      .post(`/workflows/${id}/claim`)
      .set("Authorization", `Bearer ${makerToken}`);
    expect(res.status).toBe(200);
  });

  it("a claimed step can then be approved by the claimer (act still works)", async () => {
    const id = await makeWorkflow({ branch: "Thimphu" });
    await request(app).post(`/workflows/${id}/claim`).set("Authorization", `Bearer ${makerToken}`);
    const act = await request(app)
      .post(`/workflows/${id}/act`)
      .set("Authorization", `Bearer ${makerToken}`)
      .send({ action: "approve" });
    expect(act.status).toBe(200);
    const step1 = act.body.steps.find((s: { seq: number }) => s.seq === 1);
    expect(step1.status).toBe("Approved");
  });

  it("guards: claiming a non-existent workflow returns 404", async () => {
    const res = await request(app)
      .post(`/workflows/01910000-0000-7000-0000-000000000fff/claim`)
      .set("Authorization", `Bearer ${makerToken}`);
    expect(res.status).toBe(404);
  });
});

describe("GET /workflows — cross-status review queue", () => {
  it("returns items in EACH status (Pending/Claimed/Approved/Rejected/Escalated/OnHold)", async () => {
    // Pending (untouched)
    const pendingId = await makeWorkflow({ branch: "Thimphu" });
    // Claimed
    const claimedId = await makeWorkflow({ branch: "Thimphu" });
    await request(app).post(`/workflows/${claimedId}/claim`).set("Authorization", `Bearer ${makerToken}`);
    // Approved (2-step → approve twice)
    const approvedId = await makeWorkflow({ branch: "Thimphu" });
    await request(app).post(`/workflows/${approvedId}/act`).set("Authorization", `Bearer ${makerToken}`).send({ action: "approve" });
    await request(app).post(`/workflows/${approvedId}/act`).set("Authorization", `Bearer ${makerToken}`).send({ action: "approve" });
    // Rejected
    const rejectedId = await makeWorkflow({ branch: "Thimphu" });
    await request(app).post(`/workflows/${rejectedId}/act`).set("Authorization", `Bearer ${makerToken}`).send({ action: "reject" });
    // Escalated
    const escalatedId = await makeWorkflow({ branch: "Thimphu" });
    await request(app).post(`/workflows/${escalatedId}/act`).set("Authorization", `Bearer ${makerToken}`).send({ action: "escalate" });
    // OnHold
    const holdId = await makeWorkflow({ branch: "Thimphu" });
    await request(app).post(`/workflows/${holdId}/act`).set("Authorization", `Bearer ${makerToken}`).send({ action: "hold" });

    async function listByStatus(status: string): Promise<Array<{ id: string; queue_status: string }>> {
      const res = await request(app)
        .get(`/workflows?status=${status}`)
        .set("Authorization", `Bearer ${makerToken}`);
      expect(res.status).toBe(200);
      return res.body.workflows;
    }

    const pending = await listByStatus("Pending");
    expect(pending.some((w) => w.id === pendingId)).toBe(true);
    expect(pending.every((w) => w.queue_status === "Pending")).toBe(true);

    const claimed = await listByStatus("Claimed");
    expect(claimed.some((w) => w.id === claimedId)).toBe(true);
    expect(claimed.every((w) => w.queue_status === "Claimed")).toBe(true);

    expect((await listByStatus("Approved")).some((w) => w.id === approvedId)).toBe(true);
    expect((await listByStatus("Rejected")).some((w) => w.id === rejectedId)).toBe(true);
    expect((await listByStatus("Escalated")).some((w) => w.id === escalatedId)).toBe(true);
    expect((await listByStatus("OnHold")).some((w) => w.id === holdId)).toBe(true);
  });

  it("includes sla_due_at, assignee, doc_id and current_step in each item", async () => {
    const id = await makeWorkflow({ branch: "Thimphu" });
    await request(app).post(`/workflows/${id}/claim`).set("Authorization", `Bearer ${makerToken}`);
    const res = await request(app)
      .get(`/workflows?status=Claimed`)
      .set("Authorization", `Bearer ${makerToken}`);
    const item = res.body.workflows.find((w: { id: string }) => w.id === id);
    expect(item).toBeTruthy();
    expect(item).toHaveProperty("sla_due_at");
    expect(item.assignee).toBe("maker.sonam");
    expect(item.doc_id).toBe("DOC-X");
    expect(item.current_step).not.toBeNull();
    expect(item.current_step.claimed_by).toBe("maker.sonam");
  });

  it("is branch-scoped: a user without crossbranch:read only sees their branch", async () => {
    const thimphuId = await makeWorkflow({ branch: "Thimphu" });
    const paroId = await makeWorkflow({ branch: "Paro", token: otherBranchToken });

    const res = await request(app)
      .get(`/workflows`)
      .set("Authorization", `Bearer ${otherBranchToken}`);
    const ids = res.body.workflows.map((w: { id: string }) => w.id);
    expect(ids).toContain(paroId);
    expect(ids).not.toContain(thimphuId);
  });

  it("rejects an unknown status filter (400)", async () => {
    const res = await request(app)
      .get(`/workflows?status=Bogus`)
      .set("Authorization", `Bearer ${makerToken}`);
    expect(res.status).toBe(400);
  });
});
