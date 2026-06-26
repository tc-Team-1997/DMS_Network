import type { Knex } from "knex";
import { newId } from "@zordms/db";
import type { ChannelRegistry } from "../channels/registry.js";
import type { DeliveryResult } from "../channels/types.js";
import type { RealtimeHub } from "../realtime/hub.js";
import type { EventBus } from "../bus/types.js";
import type { Recipient, RuleDecision } from "../engine/ruleEngine.js";
import type { ChannelKey } from "../channels/types.js";
import { resolveRecipients } from "./escalation.js";
import { renderEmail, type RenderContext } from "../templates/render.js";

interface TemplateRow {
  subject_template: string;
  html_body_template: string;
  text_body_template: string | null;
  enabled: boolean | number;
}

/**
 * Build the render context for a templated alert email from the decision + the
 * domain-event meta. Maps common payload fields onto the template's tag schema
 * (doc.id → {{doc.link}}, workflowId → {{workflow.link}}, etc.).
 */
function buildRenderContext(
  decision: RuleDecision,
  meta: Record<string, unknown> | undefined,
  recipientAddress: string,
): RenderContext {
  const m = meta ?? {};
  return {
    alert: { title: decision.title, level: decision.level },
    recipient: { name: recipientAddress.split("@")[0], email: recipientAddress },
    doc: {
      id: m.docId ?? m.documentId ?? undefined,
      title: m.docTitle ?? m.title ?? m.docType ?? "document",
    },
    workflow: { id: m.workflowId ?? undefined },
    branch: m.branch ?? "",
    ...m,
  };
}

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
  /** Optional email-template key (from the rule). When set + enabled, the email
   *  channel renders this template instead of the plain decision title. */
  templateKey?: string | null;
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

  // Load the bound email template once (if any). A missing/disabled template
  // falls back to the plain decision title — never blocks delivery.
  let template: TemplateRow | null = null;
  if (input.templateKey) {
    try {
      const row = (await knex("email_templates").where({ key: input.templateKey }).first()) as TemplateRow | undefined;
      if (row && Boolean(row.enabled)) template = row;
    } catch { /* table may be absent in minimal setups — fall back to plain */ }
  }

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
        // Default to the plain decision title; render the bound template for the
        // email channel so automated alerts go out formatted with live links.
        let subject = decision.title;
        let body = decision.title;
        let html: string | undefined;
        if (channel === "email" && template) {
          const ctx = buildRenderContext(decision, input.meta, address);
          const rendered = renderEmail(template, ctx);
          subject = rendered.subject || decision.title;
          body = rendered.text || decision.title;
          html = rendered.html;
        }

        const [d] = await registry.dispatch([channel], {
          recipient: address,
          subject,
          body,
          html,
          meta: input.meta,
        });
        results.push(d);
        await knex("notifications").insert({
          id: newId(),
          alert_id: alertId,
          user_id: channel === "email" ? (emailUserId.get(address) ?? null) : null,
          channel: d.channel,
          recipient: d.recipient,
          subject,
          body,
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
