/**
 * ComplianceAudit screen API module.
 * All calls go through the /svc/core proxy (http://localhost:4001).
 */
import { http, SVC } from "./http.js";

const BASE = SVC.core;

export interface ComplianceScorecard {
  score: number;
  frameworks: { framework: string; met: number; total: number }[];
}

export interface FrameworkRow {
  framework: string;
  control: string;
  status: "Met" | "Partial" | "Gap";
  evidence?: string;
}

export interface ChainVerification {
  ok: boolean;
  checked: number;
  brokenAt: number | null;
}

export interface AuditRow {
  id: number;
  actor_username?: string;
  action: string;
  entity?: string;
  entity_id?: string;
  details?: string;
  created_at?: string;
}

export const complianceAuditApi = {
  getScorecard: () =>
    http.get<{ scorecard: ComplianceScorecard }>(`${BASE}/compliance/scorecard`),

  getMatrix: () =>
    http.get<{ matrix: FrameworkRow[] }>(`${BASE}/compliance/matrix`),

  getVerification: () =>
    http.get<{ verification: ChainVerification }>(`${BASE}/compliance/verify`),

  getAuditTrail: (params?: {
    action?: string;
    entity?: string;
    actor?: string;
    limit?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.action) qs.set("action", params.action);
    if (params?.entity) qs.set("entity", params.entity);
    if (params?.actor) qs.set("actor", params.actor);
    if (params?.limit) qs.set("limit", String(params.limit));
    const q = qs.toString();
    return http.get<{ rows: AuditRow[] }>(
      `${BASE}/compliance/audit${q ? `?${q}` : ""}`
    );
  },
};
