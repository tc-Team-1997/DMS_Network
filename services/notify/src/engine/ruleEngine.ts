import type { ChannelKey } from "../channels/types.js";
import type { DomainEvent } from "../bus/types.js";

export interface AlertRule {
  id: string;
  name: string;
  trigger: string;
  params: Record<string, unknown>;
  channels: ChannelKey[];
  escalationTarget?: string | null;
  scope?: string | null;
  enabled: boolean;
  /** Optional email-template key — when set, matching alerts render their email
   *  through that curated template (formatted HTML + merge tags). */
  templateKey?: string | null;
}

export interface Recipient { kind: "role" | "group" | "user" | "external"; value: string; }

export interface RuleDecision {
  fire: boolean;
  level: "info" | "warning" | "critical";
  channels: ChannelKey[];
  recipients: Recipient[];
  title: string;
  reason: string;
}

function noFire(reason: string): RuleDecision {
  return { fire: false, level: "info", channels: [], recipients: [], title: "", reason };
}

export function evaluateRule(rule: AlertRule, event: DomainEvent): RuleDecision {
  if (!rule.enabled) return noFire("rule_disabled");
  if (rule.trigger !== event.type) return noFire("trigger_mismatch");

  const payload = (event.payload ?? {}) as Record<string, any>;
  // Fail-closed: if scope is set and branch is absent or mismatched, do not fire
  if (rule.scope && payload.branch !== rule.scope) return noFire("out_of_scope");

  if (event.type === "document.expiring") {
    const days = Number(payload.daysToExpiry ?? Infinity);
    const level: RuleDecision["level"] = days <= 7 ? "critical" : days <= 30 ? "warning" : "info";
    const recipients: Recipient[] = [];
    if (payload.branchManager) recipients.push({ kind: "role", value: String(payload.branchManager) });
    if (payload.relationshipOfficer) recipients.push({ kind: "role", value: String(payload.relationshipOfficer) });
    if (payload.customerMobile) recipients.push({ kind: "external", value: String(payload.customerMobile) });
    const docType = payload.docType ?? "document";
    return {
      fire: true, level, channels: rule.channels, recipients,
      title: `${docType} expiring in ${days} day(s)`,
      reason: "expiry_match",
    };
  }

  if (event.type === "workflow.escalated") {
    const recipients: Recipient[] = [];
    if (rule.escalationTarget) recipients.push({ kind: "role", value: rule.escalationTarget });
    for (const a of (payload.assignees as string[] | undefined) ?? []) recipients.push({ kind: "user", value: a });
    return {
      fire: true, level: "critical", channels: rule.channels, recipients,
      title: `Workflow ${payload.workflowId ?? "?"} escalated`,
      reason: "escalation_match",
    };
  }

  // generic match: fire info-level with no extra recipients
  return { fire: true, level: "info", channels: rule.channels, recipients: [], title: `Event ${event.type}`, reason: "generic_match" };
}

export function parseRule(row: {
  id: string; name: string; trigger: string; params_json: string; channels: string;
  escalation_target: string | null; scope: string | null; enabled: number | boolean;
  template_key?: string | null;
}): AlertRule {
  return {
    id: row.id, name: row.name, trigger: row.trigger,
    params: JSON.parse(row.params_json || "{}"),
    channels: JSON.parse(row.channels || "[]") as ChannelKey[],
    escalationTarget: row.escalation_target, scope: row.scope,
    enabled: Boolean(row.enabled),
    templateKey: row.template_key ?? null,
  };
}
