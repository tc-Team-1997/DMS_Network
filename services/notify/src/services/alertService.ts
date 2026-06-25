import type { Knex } from "knex";
import { newId } from "@zordms/db";
import type { ChannelRegistry } from "../channels/registry.js";
import type { DeliveryResult } from "../channels/types.js";
import type { RealtimeHub } from "../realtime/hub.js";
import type { EventBus } from "../bus/types.js";
import type { RuleDecision } from "../engine/ruleEngine.js";

export interface AlertDeps { knex: Knex; registry: ChannelRegistry; hub: RealtimeHub; bus: EventBus; }

export interface RaiseInput {
  decision: RuleDecision;
  ruleId?: string;
  branch?: string;
  meta?: Record<string, unknown>;
}

export async function raiseAlert(deps: AlertDeps, input: RaiseInput): Promise<{ alertId: string; results: DeliveryResult[] }> {
  const { knex, registry, hub, bus } = deps;
  const { decision } = input;

  const alertId = newId();
  await knex("alerts").insert({
    id: alertId,
    level: decision.level,
    title: decision.title,
    meta: JSON.stringify(input.meta ?? {}),
    rule_id: input.ruleId ?? null,
    branch: input.branch ?? null,
  });

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
        id: newId(),
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
