/**
 * API client for Repository and Viewer screens.
 * Uses /svc/core proxy path (-> http://localhost:4001).
 */
import { http, SVC } from "./http.js";
import { getToken, handleUnauthorized } from "./client.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FolderNode {
  id: string;
  parent_id?: string | null;
  name: string;
  path: string;
  domain?: string;
  created_by?: string;
  created_at?: string;
  children: FolderNode[];
}

export interface DocumentRecord {
  id: string;
  folder_id?: string | null;
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
  id: string;
  document_id: string;
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
  id: string;
  document_id: string;
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

/**
 * A normalized redaction region (0..1 of page size, TOP-LEFT origin — matches
 * the browser/viewer coordinate system the P4 backend expects). `page` is
 * 1-based; omit to apply to the single image / first page.
 */
export interface RedactionRegion {
  page?: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Result of a stamp/redact burn — a brand-new (current) document version. */
export interface BurnResult {
  version: DocumentVersion;
  download: string;
  redaction?: { rasterized: boolean; guarantee: string };
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

  createFolder: (body: { name: string; parentId?: string | null; domain?: string }): Promise<{ folder: FolderNode }> =>
    http.post(`${SVC.core}/folders`, body),

  // Documents
  listDocuments: (params?: { folderId?: string; branch?: string; status?: string }): Promise<{ documents: DocumentRecord[] }> => {
    const qs = new URLSearchParams();
    if (params?.folderId != null) qs.set("folder_id", params.folderId);
    if (params?.branch) qs.set("branch", params.branch);
    if (params?.status) qs.set("status", params.status);
    const query = qs.toString() ? `?${qs}` : "";
    return http.get(`${SVC.core}/documents${query}`);
  },

  getDocument: (id: string): Promise<{ document: DocumentRecord }> =>
    http.get(`${SVC.core}/documents/${id}`),

  /** POST /documents/:id/summarize — (re)generate + persist the AI summary. */
  summarize: (id: string): Promise<{ summary: string }> =>
    http.post(`${SVC.core}/documents/${id}/summarize`),

  /**
   * Fetch the raw document file (with the auth header) and return a blob object
   * URL + mime type. `<img>`/`<iframe>` can't send an Authorization header, so
   * we fetch here and hand them a same-origin blob: URL. Caller must
   * URL.revokeObjectURL() when done. Throws { status } on 401/403/404.
   */
  fetchFileObjectUrl: async (id: string): Promise<{ url: string; mime: string }> => {
    const headers: Record<string, string> = {};
    const token = getToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(`${SVC.core}/documents/${id}/download?inline=1`, { headers });
    if (!res.ok) {
      if (res.status === 401) handleUnauthorized(res.status, `${SVC.core}/documents/${id}/download`);
      throw Object.assign(new Error(`file_fetch_failed`), { status: res.status });
    }
    const blob = await res.blob();
    return { url: URL.createObjectURL(blob), mime: blob.type || res.headers.get("content-type") || "application/octet-stream" };
  },

  deleteDocument: (id: string): Promise<void> =>
    http.delete(`${SVC.core}/documents/${id}`),

  uploadDocument: (form: FormData) => uploadDoc(form),

  // Versions
  listVersions: (docId: string): Promise<{ versions: DocumentVersion[] }> =>
    http.get(`${SVC.core}/documents/${docId}/versions`),

  rollback: (docId: string, version: number): Promise<{ version: DocumentVersion }> =>
    http.post(`${SVC.core}/documents/${docId}/rollback`, { version }),

  // Annotations
  listAnnotations: (docId: string): Promise<{ annotations: Annotation[] }> =>
    http.get(`${SVC.core}/documents/${docId}/annotations`),

  createAnnotation: (
    docId: string,
    body: { kind: string; page: number; x: number; y: number; width: number; height: number; content?: string; color?: string }
  ): Promise<{ annotation: Annotation }> =>
    http.post(`${SVC.core}/documents/${docId}/annotations`, body),

  deleteAnnotation: (docId: string, annId: string): Promise<void> =>
    http.delete(`${SVC.core}/documents/${docId}/annotations/${annId}`),

  // Burn-in operations (P4) — each produces a NEW current version.
  /**
   * Burn an approval stamp into the document (RBAC `document:approve`).
   * Returns the new version; reload the document afterwards to show it.
   */
  stamp: (
    docId: string,
    body: { by?: string; date?: string; label?: string; page?: number; ref?: string },
  ): Promise<BurnResult> =>
    http.post(`${SVC.core}/documents/${docId}/stamp`, body),

  /**
   * Burn one or more redaction regions into the document (RBAC `document:write`).
   * DESTRUCTIVE: the covered content is physically removed from the new version.
   * `regions` use normalized 0..1, top-left origin coordinates.
   */
  redact: (
    docId: string,
    regions: RedactionRegion[],
  ): Promise<BurnResult> =>
    http.post(`${SVC.core}/documents/${docId}/redact`, { regions }),

  // Dashboard
  dashboardSummary: (): Promise<DashboardSummary> =>
    http.get(`${SVC.core}/dashboard/summary`),
};
