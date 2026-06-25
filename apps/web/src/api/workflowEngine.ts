/**
 * ZorDMS Workflow Engine API module.
 * Calls the workflow service via the /svc/workflow proxy.
 */
import { http, SVC } from "./http.js";

const WF = SVC.workflow;

/* ── Types ── */

export interface WorkflowRow {
  id: string;
  ref_code: string;
  title: string;
  doc_id?: string | null;
  template_id?: string | null;
  stage: string;
  priority: "Low" | "Normal" | "High" | "Urgent" | string;
  status: "Active" | "Approved" | "Rejected" | "OnHold" | "Escalated" | string;
  sla_due_at?: string | null;
  assigned_to?: string | null;
  created_by?: string | null;
  created_at?: string;
}

export interface WorkflowStepRow {
  id: string;
  workflow_id: string;
  seq: number;
  name: string;
  required_permissions: string; // JSON string
  min_confidence: number;
  status: "Pending" | "Approved" | "Rejected" | "Skipped" | string;
  actor_id?: string | null;
  acted_at?: string | null;
  sla_minutes?: number | null;
  due_at?: string | null;
}

export interface TemplateRow {
  id: string;
  name: string;
  doc_type?: string | null;
  steps_json: string;
  active: boolean;
  created_at?: string;
}

export type WorkflowAction = "approve" | "reject" | "escalate" | "hold";

/* ── API calls ── */

export const listWorkflows = (): Promise<{ workflows: WorkflowRow[] }> =>
  http.get(`${WF}/workflows`);

export const getWorkflow = (id: string): Promise<{ workflow: WorkflowRow; steps: WorkflowStepRow[] }> =>
  http.get(`${WF}/workflows/${id}`);

export const actOnWorkflow = (id: string, body: { action: WorkflowAction; comment?: string }) =>
  http.post<{ workflow: WorkflowRow; steps: WorkflowStepRow[] }>(`${WF}/workflows/${id}/act`, body);

export const listTemplates = (): Promise<{ templates: TemplateRow[] }> =>
  http.get(`${WF}/templates`);

export const createWorkflow = (body: {
  title: string;
  doc_id?: string;
  template_id: string;
  priority?: string;
  assigned_to?: string;
  doc_confidence?: number;
}) => http.post<{ workflow: WorkflowRow; steps: WorkflowStepRow[]; requires_manual_review: boolean }>(`${WF}/workflows`, body);
