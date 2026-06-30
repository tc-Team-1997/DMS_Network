/**
 * RecordsManagement API module — typed wrappers for /svc/core/records
 */
import { http, SVC } from "./http.js";

export interface RetentionPolicy {
  id: string;
  doc_class: string;
  retention_years: number;
  trigger: string;
  regulation?: string;
}

export interface LegalHold {
  id: string;
  ref: string;
  scope: string;
  status: "Active" | "Released";
  doc_count: number;
  placed_by?: string;
  placed_at?: string;
  released_at?: string;
}

export interface DisposalCandidate {
  document_id: string;
  doc_no?: string;
  doc_type: string;
  destruction_date: string;
  on_hold: boolean;
}

export async function fetchFilePlan(): Promise<RetentionPolicy[]> {
  const data = await http.get<{ policies: RetentionPolicy[] }>(`${SVC.core}/records/file-plan`);
  return data.policies;
}

// SC-06: create-or-update (by doc_class) and delete retention rules.
export async function saveRetentionRule(payload: { doc_class: string; retention_years: number; trigger?: string; regulation?: string }): Promise<RetentionPolicy> {
  return (await http.post<{ policy: RetentionPolicy }>(`${SVC.core}/records/file-plan`, payload)).policy;
}

export async function deleteRetentionRule(id: string): Promise<void> {
  await http.delete(`${SVC.core}/records/file-plan/${id}`);
}

export async function fetchLegalHolds(): Promise<LegalHold[]> {
  const data = await http.get<{ holds: LegalHold[] }>(`${SVC.core}/records/holds`);
  return data.holds;
}

export async function fetchDisposalCandidates(): Promise<DisposalCandidate[]> {
  const data = await http.get<{ candidates: DisposalCandidate[] }>(`${SVC.core}/records/disposal/eligibility`);
  return data.candidates;
}

export async function placeLegalHold(payload: {
  ref: string;
  scope: string;
}): Promise<LegalHold> {
  const data = await http.post<{ hold: LegalHold }>(`${SVC.core}/records/holds`, payload);
  return data.hold;
}

export async function releaseLegalHold(ref: string): Promise<LegalHold> {
  const data = await http.post<{ hold: LegalHold }>(`${SVC.core}/records/holds/${ref}/release`);
  return data.hold;
}

export async function certifyDisposal(documentId: string): Promise<{ certificate: string }> {
  return http.post<{ certificate: string }>(`${SVC.core}/records/disposal/${documentId}/certify`);
}
