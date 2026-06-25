/**
 * jobsApi.ts — ZorDMS P8 background job queue client.
 *
 * Surfaces the durable, DB-backed job queue exposed by core:
 *   GET /jobs/:id            — poll a single job's status (any authenticated user)
 *   GET /jobs?status=&type=  — admin monitor: counts by status + recent jobs
 *
 * Job lifecycle: queued → running → succeeded | failed → (retries) → dead.
 * `dead` is the dead-letter state (retries exhausted).
 *
 * All base paths come from SVC in config.ts — no hard-coded URLs.
 */
import { http, SVC } from "./http.js";

const BASE = SVC.core;

/** Terminal + transient job states from the core queue (queue/index.ts). */
export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "dead";

/** Statuses at which polling should stop — no further transitions occur. */
export const TERMINAL_JOB_STATUSES: ReadonlySet<JobStatus> = new Set<JobStatus>([
  "succeeded",
  "failed",
  "dead",
]);

export function isTerminalJobStatus(status: JobStatus | string | undefined): boolean {
  return status != null && TERMINAL_JOB_STATUSES.has(status as JobStatus);
}

/** Single-job poll shape returned by GET /jobs/:id. */
export interface JobStatusResponse {
  id: string;
  type: string;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  result: unknown;
  /** snake_case in the single-job endpoint */
  last_error: string | null;
  availableAt: string;
  createdAt: string;
  updatedAt: string;
}

/** Decoded job row in the admin monitor list (GET /jobs). */
export interface MonitorJob {
  id: string;
  type: string;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  /** camelCase in the list endpoint */
  lastError: string | null;
  result: unknown;
  idempotencyKey: string | null;
  priority: number;
  availableAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface JobsMonitorResponse {
  /** counts keyed by status, e.g. { queued: 2, running: 1, succeeded: 9, dead: 1 } */
  counts: Partial<Record<JobStatus, number>> & Record<string, number>;
  jobs: MonitorJob[];
}

export interface ListJobsFilter {
  status?: JobStatus;
  type?: string;
  limit?: number;
}

/** Poll a single job (queued/running/succeeded/failed/dead). */
export async function getJob(id: string): Promise<JobStatusResponse> {
  return http.get<JobStatusResponse>(`${BASE}/jobs/${id}`);
}

/** Admin monitor — counts by status + recent jobs (RBAC admin:access on the backend). */
export async function listJobs(filter: ListJobsFilter = {}): Promise<JobsMonitorResponse> {
  const params = new URLSearchParams();
  if (filter.status) params.set("status", filter.status);
  if (filter.type) params.set("type", filter.type);
  if (filter.limit != null) params.set("limit", String(filter.limit));
  const qs = params.toString();
  return http.get<JobsMonitorResponse>(`${BASE}/jobs${qs ? `?${qs}` : ""}`);
}

export const jobsApi = { getJob, listJobs };
