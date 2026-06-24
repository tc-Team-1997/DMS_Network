/**
 * Notify service API helpers — talks to /svc/notify (proxy -> :4003)
 * Named notifyApi.ts to avoid collision with other parallel agents.
 */
import { http, SVC } from "./http.js";

const BASE = SVC.notify;

export type AlertLevel = "info" | "warning" | "critical";

export interface Alert {
  id: number;
  level: AlertLevel;
  title: string;
  meta: Record<string, unknown> | string;
  is_read: boolean;
  rule_id: number | null;
  branch: string | null;
  created_at: string;
}

export interface AlertRule {
  id: number;
  name: string;
  trigger: string;
  params: Record<string, unknown>;
  channels: string[];
  escalation_target: string | null;
  scope: string | null;
  enabled: boolean;
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
  markRead: (id: number) =>
    http.post<{ ok: boolean }>(`${BASE}/alerts/${id}/read`),

  /** POST /alerts/:id/escalate */
  escalate: (id: number, target: string) =>
    http.post<{ escalatedTo: number }>(`${BASE}/alerts/${id}/escalate`, { target }),

  /** GET /rules */
  listRules: () =>
    http.get<{ rules: AlertRule[] }>(`${BASE}/rules`),

  /** POST /rules */
  createRule: (body: CreateRuleRequest) =>
    http.post<{ id: number }>(`${BASE}/rules`, body),

  /** PATCH /rules/:id */
  patchRule: (id: number, patch: Partial<CreateRuleRequest & { enabled: boolean }>) =>
    http.patch<{ ok: boolean }>(`${BASE}/rules/${id}`, patch),
};
