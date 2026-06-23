import cron from "node-cron";
import type { Knex } from "knex";
import { findOverdueSteps, type SlaStep } from "../engine/sla.js";
import { writeAudit } from "../audit.js";
import type { EventBus } from "../events.js";

export interface SlaDeps {
  knex: Knex;
  events?: EventBus;
}

export async function escalateOverdue(deps: SlaDeps, now: Date = new Date()): Promise<number> {
  const { knex, events } = deps;
  const rows: SlaStep[] = await knex("workflow_steps as s")
    .join("workflows as w", "w.id", "s.workflow_id")
    .where("w.status", "Active")
    .select(
      "s.id as id",
      "s.workflow_id as workflow_id",
      "s.status as status",
      "s.due_at as due_at",
    );

  const overdue = findOverdueSteps(rows, now);

  // F5: deduplicate by workflow_id so multi-step workflows don't emit duplicate events.
  const uniqueWorkflowIds = [...new Set(overdue.map((s) => s.workflow_id))];

  let escalated = 0;
  for (const wfId of uniqueWorkflowIds) {
    await knex("workflows").where({ id: wfId }).update({ status: "Escalated" });

    // F5: mark the overdue step(s) for this workflow as Escalated (not left as Pending).
    const stepIds = overdue.filter((s) => s.workflow_id === wfId).map((s) => s.id);
    await knex("workflow_steps")
      .whereIn("id", stepIds)
      .update({ status: "Escalated" });

    await writeAudit(knex, {
      action: "WORKFLOW_ESCALATE",
      entity: "workflow",
      entity_id: String(wfId),
      details: "SLA breach",
    });
    await events?.emit("workflow.escalated", { id: wfId, reason: "sla_breach" });
    escalated++;
  }
  return escalated;
}

export function startSlaCron(deps: SlaDeps): cron.ScheduledTask {
  return cron.schedule("* * * * *", () => {
    void escalateOverdue(deps).catch((err) =>
      console.error("sla_escalation_error", err),
    );
  });
}
