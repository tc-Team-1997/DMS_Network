/**
 * API client for Dashboard, Capture, and Indexing screens.
 * Unique module name to avoid collisions with parallel agents.
 * Calls core service via /svc/core proxy.
 */
import { http, SVC } from "./http.js";
import { getToken } from "./client.js";

export interface DashboardSummary {
  totalDocuments: number;
  pendingReview: number;
  indexedToday: number;
  byCategory: Record<string, number>;
}

export interface DocumentRecord {
  id: number;
  title: string;
  original_filename?: string;
  mime_type?: string;
  branch?: string;
  catalog_category?: string;
  status: string;
  doc_type?: string;
  ingest_timestamp?: string;
  review_flag?: boolean;
  confidence?: number;
  source_channel?: string;
  page_count?: number;
  file_size_bytes?: number;
}

export interface FolderNode {
  id: number;
  name: string;
  path: string;
  domain?: string;
  children: FolderNode[];
}

export interface CaptureQueueItem {
  id: number;
  title: string;
  original_filename?: string;
  mime_type?: string;
  status: string;
  source_channel?: string;
  confidence?: number;
  catalog_category?: string;
  branch?: string;
  ingest_timestamp?: string;
}

export const dashboardCaptureApi = {
  // Dashboard
  dashboardSummary: (): Promise<DashboardSummary> =>
    http.get<DashboardSummary>(`${SVC.core}/dashboard/summary`),

  // Capture / Documents
  listDocuments: (params?: { status?: string; branch?: string }): Promise<{ documents: DocumentRecord[] }> => {
    const qs = params ? "?" + new URLSearchParams(params as Record<string, string>).toString() : "";
    return http.get<{ documents: DocumentRecord[] }>(`${SVC.core}/documents${qs}`);
  },

  listFolders: (): Promise<{ tree: FolderNode[] }> =>
    http.get<{ tree: FolderNode[] }>(`${SVC.core}/folders`),

  getDocument: (id: number): Promise<{ document: DocumentRecord }> =>
    http.get<{ document: DocumentRecord }>(`${SVC.core}/documents/${id}`),

  uploadDocument: async (form: FormData): Promise<{ document: DocumentRecord }> => {
    const headers: Record<string, string> = {};
    const token = getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(`${SVC.core}/documents`, { method: "POST", headers, body: form });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status, body });
    }
    return res.json();
  },

  deleteDocument: (id: number): Promise<unknown> =>
    http.delete(`${SVC.core}/documents/${id}`),

  // Indexing
  indexDocument: (
    id: number,
    body: { doc_type: string; fields: Record<string, unknown>; confidence?: number }
  ): Promise<{ document: DocumentRecord }> =>
    http.post<{ document: DocumentRecord }>(`${SVC.core}/index/${id}`, body),

  catalogDocument: (
    id: number,
    body: { docType: string; confidence: number; fields: Record<string, unknown> }
  ): Promise<unknown> =>
    http.post(`${SVC.core}/catalog/${id}`, body),
};
