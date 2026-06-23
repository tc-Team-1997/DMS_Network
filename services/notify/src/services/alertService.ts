import type { Knex } from "knex";
import type { ChannelRegistry } from "../channels/registry.js";
import type { DeliveryResult } from "../channels/types.js";
import type { RealtimeHub } from "../realtime/hub.js";
import type { EventBus } from "../bus/types.js";
import type { RuleDecision } from "../engine/ruleEngine.js";

export interface AlertDeps { knex: Knex; registry: ChannelRegistry; hub: RealtimeHub; bus: EventBus; }

export interface RaiseInput {
  decision: RuleDecision;
  ruleId?: number;
  branch?: string;
  meta?: Record<string, unknown>;
}

export async function raiseAlert(deps: AlertDeps, input: RaiseInput): Promise<{ alertId: number; results: DeliveryResult[] }> {
  const { knex, registry, hub, bus } = deps;
  const { decision } = input;

  const inserted = await knex("alerts").insert({
    level: decision.level,
    title: decision.title,
    meta: JSON.stringify(input.meta ?? {}),
    rule_id: input.ruleId ?? null,
    branch: input.branch ?? null,
  }).returning("id");

  // Handle both PostgreSQL returning (array of objects) and SQLite (array of numbers)
  const alertId = Array.isArray(inserted)
    ? (typeof inserted[0] === "object" && inserted[0] !== null ? (inserted[0] as { id: number }).id : inserted[0] as number)
    : inserted as unknown as number;

  const results: DeliveryResult[] = [];
  for (const recipient of decision.recipients) {
    const delivered = await registry.dispatch(decision.channels, {
      recipient: recipient.value,
      subject: decision.title,
      body: decision.title,
      meta: input.meta,
    });
    for (const d of delivered) {
      results.push(d);
      await knex("notifications").insert({
        alert_id: alertId,
        user_id: null,
        channel: d.channel,
        recipient: d.recipient,
        subject: decision.title,
        body: decision.title,
        status: d.status,
        error: d.error ?? null,
        sent_at: d.status === "sent" ? knex.fn.now() : null,
      });
    }
  }

  const alert = await knex("alerts").where({ id: alertId }).first();
  hub.broadcast({ type: "alert.raised", alert });
  await bus.publish({ type: "alert.raised", payload: { ...alert, alertId, title: decision.title, level: decision.level } });

  return { alertId, results };
}
