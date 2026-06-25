/**
 * API client for Repository and Viewer screens.
 * Uses /svc/core proxy path (-> http://localhost:4001).
 */
import { http, SVC } from "./http.js";
import { getToken } from "./client.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FolderNode {
  id: number;
  parent_id?: number | null;
  name: string;
  path: string;
  domain?: string;
  created_by?: string;
  created_at?: string;
  children: FolderNode[];
}

export interface DocumentRecord {
  id: number;
  folder_id?: number | null;
  title: string;
  original_filename?: string;
  mime_type?: string;
  current_version: number;
  file_hash_sha256: string;
  source_channel: string;
  ingest_user_id?: string;
  page_count: number;
  file_size_bytes: number;
  retention_years?: number;
  destruction_date?: string;
  doc_type?: string;
  metadata?: string;
  catalog_category?: string;
  review_flag: boolean;
  confidence?: number;
  branch?: string;
  status: "Active" | "Deleted";
  ingest_timestamp?: string | number;  // API returns Unix ms (number); accept both
}

export interface DocumentVersion {
  id: number;
  document_id: number;
  version_no: number;
  storage_key: string;
  file_hash_sha256: string;
  file_size_bytes: number;
  mime_type?: string;
  created_by?: string;
  comment?: string;
  created_at?: string;
}

export interface Annotation {
  id: number;
  document_id: number;
  page: number;
  kind: "note" | "highlight" | "redaction" | "stamp";
  x: number;
  y: number;
  width: number;
  height: number;
  content?: string;
  color?: string;
  created_by?: string;
  created_at?: string;
}

export interface DashboardSummary {
  totalDocuments: number;
  pendingReview: number;
  indexedToday: number;
  byCategory: Record<string, number>;
}

// ── Upload helper (multipart) ─────────────────────────────────────────────────

async function uploadDoc(form: FormData): Promise<{ document: DocumentRecord }> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${SVC.core}/documents`, { method: "POST", headers, body: form });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error("upload_failed"), { status: res.status, body });
  }
  return res.json();
}

// ── API ───────────────────────────────────────────────────────────────────────

export const repositoryViewerApi = {
  // Folders
  listFolders: (): Promise<{ tree: FolderNode[] }> =>
    http.get(`${SVC.core}/folders`),

  createFolder: (body: { name: string; parentId?: number | null; domain?: string }): Promise<{ folder: FolderNode }> =>
    http.post(`${SVC.core}/folders`, body),

  // Documents
  listDocuments: (params?: { folderId?: number; branch?: string; status?: string }): Promise<{ documents: DocumentRecord[] }> => {
    const qs = new URLSearchParams();
    if (params?.folderId != null) qs.set("folder_id", String(params.folderId));
    if (params?.branch) qs.set("branch", params.branch);
    if (params?.status) qs.set("status", params.status);
    const query = qs.toString() ? `?${qs}` : "";
    return http.get(`${SVC.core}/documents${query}`);
  },

  getDocument: (id: number): Promise<{ document: DocumentRecord }> =>
    http.get(`${SVC.core}/documents/${id}`),

  deleteDocument: (id: number): Promise<void> =>
    http.delete(`${SVC.core}/documents/${id}`),

  uploadDocument: (form: FormData) => uploadDoc(form),

  // Versions
  listVersions: (docId: number): Promise<{ versions: DocumentVersion[] }> =>
    http.get(`${SVC.core}/documents/${docId}/versions`),

  rollback: (docId: number, version: number): Promise<{ version: DocumentVersion }> =>
    http.post(`${SVC.core}/documents/${docId}/rollback`, { version }),

  // Annotations
  listAnnotations: (docId: number): Promise<{ annotations: Annotation[] }> =>
    http.get(`${SVC.core}/documents/${docId}/annotations`),

  createAnnotation: (
    docId: number,
    body: { kind: string; page: number; x: number; y: number; width: number; height: number; content?: string; color?: string }
  ): Promise<{ annotation: Annotation }> =>
    http.post(`${SVC.core}/documents/${docId}/annotations`, body),

  deleteAnnotation: (docId: number, annId: number): Promise<void> =>
    http.delete(`${SVC.core}/documents/${docId}/annotations/${annId}`),

  // Dashboard
  dashboardSummary: (): Promise<DashboardSummary> =>
    http.get(`${SVC.core}/dashboard/summary`),
};
