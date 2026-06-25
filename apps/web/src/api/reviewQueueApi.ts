/**
 * Review Queue API — backs the ZorDMS Human-Review Queue with the WORKFLOW
 * service (the source of truth), replacing the old AI /idp/review path that
 * only ever returned PENDING items.
 *
 * All requests go to /svc/workflow (proxied to http://localhost:4002).
 *
 * The workflow service exposes a unified, branch-scoped, cross-status review
 * queue at `GET /workflows?status=` plus per-item actions:
 *   - POST /workflows/:id/claim   → claim the current Pending step
 *   - POST /workflows/:id/act     → approve | reject | escalate | hold
 *
 * The queue is keyed off each workflow's *current step* + workflow status.
 * The backend derives a `queue_status` so the UI tabs map cleanly:
 *
 *   UI Tab          queue status filter (?status=)
 *   ───────────     ──────────────────────────────
 *   Pending         Pending     (Active workflow, current step unclaimed)
 *   Claimed         Claimed     (Active workflow, current step claimed)
 *   Resolved        Approved + Rejected  (fetched as two calls, merged)
 *   Escalated       Escalated
 *   SLA Breached    (derived client-side from sla_due_at across all items)
 */
import { http, SVC } from "./http.js";

const WF = SVC.workflow;

/* ── Types (mirror the backend cross-status queue item shape) ── */

export type QueueStatus =
  | "Pending"
  | "Claimed"
  | "Approved"
  | "Rejected"
  | "Escalated"
  | "OnHold";

export type WorkflowStatus =
  | "Active"
  | "Approved"
  | "Rejected"
  | "Escalated"
  | "OnHold";

export interface QueueCurrentStep {
  id: string;
  seq: number;
  name: string;
  status: string;
  claimed_by: string | null;
  claimed_at: string | null;
  due_at: string | null;
  required_permissions: string[];
}

/** A single enriched review-queue item as returned by GET /workflows. */
export interface ReviewQueueItem {
  id: string;
  ref_code: string;
  title: string;
  doc_id: string | null;
  branch: string | null;
  priority: string;
  status: WorkflowStatus;
  /** Derived tab-facing status (Pending/Claimed/Approved/Rejected/Escalated/OnHold). */
  queue_status: QueueStatus;
  stage: string;
  sla_due_at: string | null;
  assignee: string | null;
  created_by: string | null;
  created_at: string | null;
  current_step: QueueCurrentStep | null;
}

export interface WorkflowDetail {
  id: string;
  ref_code: string;
  title: string;
  doc_id?: string | null;
  stage: string;
  priority: string;
  status: WorkflowStatus;
  sla_due_at?: string | null;
  assigned_to?: string | null;
}

export interface WorkflowStepDetail {
  id: string;
  workflow_id: string;
  seq: number;
  name: string;
  status: string;
  claimed_by?: string | null;
  claimed_at?: string | null;
}

export type QueueAction = "approve" | "reject" | "escalate" | "hold";

/* ── API calls ── */

/**
 * Fetch the cross-status review queue for a single queue status.
 * `status` maps 1:1 to the backend `?status=` derived queue status.
 */
export async function listReviewQueue(status: QueueStatus): Promise<ReviewQueueItem[]> {
  const res = await http.get<{ workflows: ReviewQueueItem[] }>(
    `${WF}/workflows?status=${encodeURIComponent(status)}`,
  );
  return res.workflows ?? [];
}

/**
 * Fetch ALL review-queue items across every status in one shot. Used for the
 * KPI counters and the SLA-Breached tab (which is derived client-side from the
 * sla_due_at deadline across the whole queue).
 *
 * The backend filters Pending/Claimed/Escalated/OnHold by the *current step*
 * + workflow status, and Approved/Rejected by the workflow status column. We
 * fetch each status branch and merge, de-duplicating by workflow id.
 */
export async function listAllReviewQueue(): Promise<ReviewQueueItem[]> {
  const statuses: QueueStatus[] = [
    "Pending",
    "Claimed",
    "Approved",
    "Rejected",
    "Escalated",
    "OnHold",
  ];
  const results = await Promise.all(statuses.map((s) => listReviewQueue(s)));
  const byId = new Map<string, ReviewQueueItem>();
  for (const items of results) {
    for (const it of items) byId.set(it.id, it);
  }
  return Array.from(byId.values());
}

/** Claim the current Pending step of a workflow for the acting JWT user. */
export async function claimWorkflow(
  id: string,
): Promise<{ workflow: WorkflowDetail; steps: WorkflowStepDetail[] }> {
  return http.post(`${WF}/workflows/${id}/claim`);
}

/** Act on a workflow's current step (approve | reject | escalate | hold). */
export async function actOnWorkflow(
  id: string,
  action: QueueAction,
  comment?: string,
): Promise<{ workflow: WorkflowDetail; steps: WorkflowStepDetail[] }> {
  return http.post(`${WF}/workflows/${id}/act`, { action, comment });
}
