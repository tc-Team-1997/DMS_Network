/**
 * BranchNetwork API module — typed wrappers for /svc/core/branches
 */
import { http, SVC } from "./http.js";

export interface Branch {
  id: string;
  code: string;
  name: string;
  region?: string;
  replication_mode: "sync" | "async" | "none";
  status: "Active" | "Degraded" | "Offline";
  created_at?: string;
}

export interface BranchAccess {
  id: string;
  source_branch: string;
  target_branch: string;
  policy: "read" | "write";
  created_at?: string;
}

export interface BranchStats {
  total: number;
  active: number;
  degraded: number;
  offline: number;
}

/** Summary data from the dashboard endpoint — used for KPIs derived from the document corpus. */
export interface NetworkSummary {
  totalDocuments: number;
  indexedToday: number;
  pendingReview: number;
}

export async function fetchBranches(): Promise<Branch[]> {
  const data = await http.get<{ branches: Branch[] }>(`${SVC.core}/branches`);
  return data.branches;
}

export async function fetchAccessPolicies(): Promise<BranchAccess[]> {
  const data = await http.get<{ policies: BranchAccess[] }>(`${SVC.core}/branches/access`);
  return data.policies;
}

/** Fetch network-level summary (documents indexed today, totals) from the core dashboard endpoint. */
export async function fetchNetworkSummary(): Promise<NetworkSummary> {
  return http.get<NetworkSummary>(`${SVC.core}/dashboard/summary`);
}

export async function createBranch(payload: {
  code: string;
  name: string;
  region?: string;
  replication_mode?: "sync" | "async" | "none";
  status?: "Active" | "Degraded" | "Offline";
}): Promise<Branch> {
  const data = await http.post<{ branch: Branch }>(`${SVC.core}/branches`, payload);
  return data.branch;
}

export async function setAccessPolicy(payload: {
  source_branch: string;
  target_branch: string;
  policy?: "read" | "write";
}): Promise<BranchAccess> {
  const data = await http.post<{ policy: BranchAccess }>(`${SVC.core}/branches/access`, payload);
  return data.policy;
}
