/**
 * Notify service API helpers — talks to /svc/notify (proxy -> :4003)
 * Named notifyApi.ts to avoid collision with other parallel agents.
 */
import { http, SVC } from "./http.js";

const BASE = SVC.notify;

export type AlertLevel = "info" | "warning" | "critical";

export interface Alert {
  id: string;
  level: AlertLevel;
  title: string;
  meta: Record<string, unknown> | string;
  is_read: boolean;
  rule_id: string | null;
  branch: string | null;
  created_at: string;
}

export interface AlertRule {
  id: string;
  name: string;
  trigger: string;
  params: Record<string, unknown>;
  channels: string[];
  escalation_target: string | null;
  scope: string | null;
  enabled: boolean;
  /** Bound email-template key (camelCase from the parsed rule). */
  templateKey?: string | null;
  created_by?: string;
  created_at?: string;
}

export interface CreateRuleRequest {
  name: string;
  trigger: string;
  params?: Record<string, unknown>;
  channels?: string[];
  escalationTarget?: string;
  scope?: string;
  /** Email template to render for the email channel; null/omitted = plain title. */
  templateKey?: string | null;
}

export const notifyApi = {
  /** GET /alerts?level=…&unread=true */
  listAlerts: (params?: { level?: AlertLevel; unread?: boolean }) => {
    const qs = new URLSearchParams();
    if (params?.level) qs.set("level", params.level);
    if (params?.unread) qs.set("unread", "true");
    const q = qs.toString();
    return http.get<{ alerts: Alert[] }>(`${BASE}/alerts${q ? `?${q}` : ""}`);
  },

  /** POST /alerts/:id/read */
  markRead: (id: string) =>
    http.post<{ ok: boolean }>(`${BASE}/alerts/${id}/read`),

  /** POST /alerts/:id/escalate — to a role (default) or a specific user. */
  escalate: (id: string, target: string, kind: "role" | "user" = "role") =>
    http.post<{ escalatedTo: number }>(`${BASE}/alerts/${id}/escalate`, { target, kind }),

  /** GET /rules */
  listRules: () =>
    http.get<{ rules: AlertRule[] }>(`${BASE}/rules`),

  /** POST /rules */
  createRule: (body: CreateRuleRequest) =>
    http.post<{ id: string }>(`${BASE}/rules`, body),

  /** PATCH /rules/:id */
  patchRule: (id: string, patch: Partial<CreateRuleRequest & { enabled: boolean }>) =>
    http.patch<{ ok: boolean }>(`${BASE}/rules/${id}`, patch),
};
