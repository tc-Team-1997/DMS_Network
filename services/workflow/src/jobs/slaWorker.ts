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
  let escalated = 0;
  for (const step of overdue) {
    await knex("workflows").where({ id: step.workflow_id }).update({ status: "Escalated" });
    await writeAudit(knex, {
      action: "WORKFLOW_ESCALATE",
      entity: "workflow",
      entity_id: String(step.workflow_id),
      details: "SLA breach",
    });
    await events?.emit("workflow.escalated", { id: step.workflow_id, reason: "sla_breach" });
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
