import type { Knex } from "knex";
import { newId } from "@zordms/db";
import type { ChannelRegistry } from "../channels/registry.js";
import type { DeliveryResult } from "../channels/types.js";
import type { RealtimeHub } from "../realtime/hub.js";
import type { EventBus } from "../bus/types.js";
import type { Recipient, RuleDecision } from "../engine/ruleEngine.js";
import type { ChannelKey } from "../channels/types.js";
import { resolveRecipients } from "./escalation.js";

export interface AlertDeps { knex: Knex; registry: ChannelRegistry; hub: RealtimeHub; bus: EventBus; }

/**
 * For a single abstract recipient, compute the concrete address to use on a
 * given channel. Email/sms/whatsapp need a *real* destination; role/group
 * targets expand to the email of every active member, so those are resolved
 * up-front by the caller. inapp/teams are broadcast-style and only need a
 * human-readable label.
 */
function addressesForChannel(
  channel: ChannelKey,
  recipient: Recipient,
  emails: string[],
): string[] {
  if (channel === "email") {
    // Real, resolved email addresses. Fall back to the raw value only when
    // resolution produced nothing (e.g. an `external` phone-only target) so
    // behaviour for non-email targets is unchanged.
    return emails.length > 0 ? emails : [recipient.value];
  }
  if (channel === "sms" || channel === "whatsapp") {
    // SMS/WhatsApp need a phone number; only `external` targets carry one.
    return [recipient.value];
  }
  // inapp / teams: broadcast-style, label by the target value.
  return [recipient.value];
}

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
    // Resolve role/group/user targets to concrete email addresses (and capture
    // the owning userId for the audit row) BEFORE dispatch, so the email
    // channel receives real mailbox addresses rather than a role NAME string.
    const resolved = await resolveRecipients([recipient], { knex });
    const emailEntries = resolved.filter((x) => x.channel === "email");
    const emails = emailEntries.map((x) => x.address);
    const emailUserId = new Map(emailEntries.map((x) => [x.address, x.userId]));

    for (const channel of decision.channels) {
      const targets = addressesForChannel(channel, recipient, emails);
      if (channel === "email" && emails.length > 0) {
        console.log(`[notify dispatch] alert ${alertId}: email → ${emails.join(", ")} (target ${recipient.kind}:${recipient.value})`);
      }
      for (const address of targets) {
        const [d] = await registry.dispatch([channel], {
          recipient: address,
          subject: decision.title,
          body: decision.title,
          meta: input.meta,
        });
        results.push(d);
        await knex("notifications").insert({
          id: newId(),
          alert_id: alertId,
          user_id: channel === "email" ? (emailUserId.get(address) ?? null) : null,
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
  }

  const alert = await knex("alerts").where({ id: alertId }).first();
  hub.broadcast({ type: "alert.raised", alert });
  await bus.publish({ type: "alert.raised", payload: { ...alert, alertId, title: decision.title, level: decision.level } });

  return { alertId, results };
}
