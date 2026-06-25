/**
 * ZorDMS Case Management API module.
 * Calls the workflow service's /cases routes via /svc/workflow proxy.
 */
import { http, SVC } from "./http.js";

const WF = SVC.workflow;

/* ── Types ── */

export interface CaseRow {
  id: string;
  case_ref: string;
  case_type: "KYC" | "Loan" | "Account" | "AML" | string;
  title: string;
  status: "Open" | "InReview" | "Resolved" | "Rejected" | string;
  assigned_to?: string | null;
  due_at?: string | null;
  workflow_id?: string | null;
  resolution?: string | null;
  created_by?: string | null;
  created_at?: string;
  resolved_at?: string | null;
}

export interface CaseMetrics {
  total: number;
  open: number;
  resolved: number;
  by_type: Record<string, number>;
  avg_resolution_minutes: number;
}

export interface CaseDocument {
  id: string;
  case_id: string;
  doc_id: string;
  label?: string | null;
  attached_at?: string;
}

/* ── API calls ── */

export const listCases = (): Promise<{ cases: CaseRow[] }> =>
  http.get(`${WF}/cases`);

export const getCaseMetrics = (): Promise<CaseMetrics> =>
  http.get(`${WF}/cases/metrics`);

export const getCase = (id: string): Promise<{ case: CaseRow; documents: CaseDocument[]; workflow?: unknown }> =>
  http.get(`${WF}/cases/${id}`);

export const createCase = (body: {
  case_type: string;
  title: string;
  assigned_to?: string;
  due_at?: string;
  template_id?: string;
  doc_confidence?: number;
}) => http.post<{ case: CaseRow }>(`${WF}/cases`, body);

export const attachDocument = (id: string, body: { doc_id: string; label?: string }) =>
  http.post<{ document: CaseDocument }>(`${WF}/cases/${id}/documents`, body);

export const resolveCase = (id: string, body: { status: "Resolved" | "Rejected"; resolution: string }) =>
  http.post<{ case: CaseRow }>(`${WF}/cases/${id}/resolve`, body);
