/**
 * DocumentLifecycle screen API module.
 * All calls go through the /svc/core proxy (http://localhost:4001).
 */
import { http, SVC } from "./http.js";

const BASE = SVC.core;

export interface LifecycleStage {
  stage: string;
  at: string | null;
  actor?: string;
  detail?: string;
  complete: boolean;
}

export interface LifecycleVersion {
  version_no: number;
  file_hash_sha256: string;
  created_at?: string;
  created_by?: string;
}

export interface LifecycleFunnel {
  capture: number;
  index: number;
  workflow: number;
  archive: number;
  disposal: number;
}

export interface LifecycleTrace {
  document_id: string;
  doc_no?: string;
  doc_type: string;
  stages: LifecycleStage[];
  versions: LifecycleVersion[];
  funnel: LifecycleFunnel;
}

export interface DocumentSummary {
  id: string;
  doc_no?: string;
  doc_type: string;
  status: string;
  branch?: string;
  created_at?: string;
}

export const documentLifecycleApi = {
  getTrace: (docId: number | string) =>
    http.get<{ trace: LifecycleTrace }>(`${BASE}/lifecycle/${docId}`),

  searchDocuments: (query?: string, status?: string) => {
    const qs = new URLSearchParams();
    if (query) qs.set("q", query);
    if (status) qs.set("status", status);
    const q = qs.toString();
    return http.get<{ documents: DocumentSummary[] }>(
      `${BASE}/documents${q ? `?${q}` : ""}`
    );
  },
};
