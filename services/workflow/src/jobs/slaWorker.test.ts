import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildServiceKnex } from "@zordms/db";
import { createRecordingBus } from "../events.js";
import { escalateOverdue } from "./slaWorker.js";

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

beforeAll(async () => {
  await knex.migrate.latest();
  // F13: seed template with at least one valid step (steps_json:"[]" violates schema).
  const tpl = await knex("workflow_templates")
    .insert({
      name: "T",
      steps_json: JSON.stringify([{ name: "Review", required_permissions: ["workflow:act"] }]),
      active: true,
    })
    .returning("id");
  const tplId = typeof tpl[0] === "object" ? (tpl[0] as { id: number }).id : tpl[0];
  const wf = await knex("workflows")
    .insert({
      ref_code: "WF-SLA",
      title: "overdue",
      template_id: tplId,
      stage: "review",
      priority: "High",
      status: "Active",
    })
    .returning("id");
  const wfId = typeof wf[0] === "object" ? (wf[0] as { id: number }).id : wf[0];
  await knex("workflow_steps").insert({
    workflow_id: wfId,
    seq: 1,
    name: "Review",
    required_permissions: "[]",
    min_confidence: 0.9,
    status: "Pending",
    due_at: "2020-01-01T00:00:00Z",
  });
});
afterAll(async () => {
  await knex.destroy();
});

describe("escalateOverdue", () => {
  it("escalates overdue workflows and emits workflow.escalated", async () => {
    const count = await escalateOverdue(
      { knex, events },
      new Date("2026-06-23T12:00:00Z"),
    );
    expect(count).toBe(1);
    const wf = await knex("workflows").where({ ref_code: "WF-SLA" }).first();
    expect(wf.status).toBe("Escalated");
    expect(events.events.some((e) => e.event === "workflow.escalated")).toBe(true);
  });

  it("is idempotent — already-escalated workflows are not re-counted", async () => {
    const count = await escalateOverdue(
      { knex, events },
      new Date("2026-06-23T12:00:00Z"),
    );
    expect(count).toBe(0);
  });
});
