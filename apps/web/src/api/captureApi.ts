/**
 * captureApi.ts — ZorDMS Capture screen API
 *
 * Handles document upload (multipart POST /documents) and
 * AI extraction (POST /documents/:id/extract).
 *
 * All base paths come from SVC in config.js — no hard-coded URLs.
 */
import { SVC } from "../config.js";
import { getToken } from "./client.js";

// ─── Response shapes from backend contract ───────────────────────────────────

export interface UploadedDocument {
  id: number;
  title: string;
  doc_type?: string;
  confidence?: number;
  extraction_status?: "PENDING" | "RUNNING" | "DONE" | "FAILED" | "SKIPPED";
  extracted_at?: string;
  catalog_category?: string;
  retention_years?: number;
  folder_id?: number;
  review_flag?: boolean;
  cid?: string;
  doc_no?: string;
  metadata?: string;
  source_channel?: string;
  original_filename?: string;
  mime_type?: string;
  branch?: string;
  status?: string;
  ingest_timestamp?: string;
}

export interface ExtractionClassification {
  doc_type: string;
  confidence: number;
  review_flag: boolean;
}

export interface ExtractionMappedFields {
  cid: string | null;
  doc_no: string | null;
  mappedKeys: string[];
  data: Record<string, string | number | null>;
  partial: boolean;
  errors: string[];
}

export interface ExtractionCatalog {
  category: string;
  route: "AUTO" | "TENTATIVE" | "HUMAN_REVIEW";
  mandatoryOk: boolean;
  missing: string[];
  retentionYears: number;
  alertRule: string | null;
}

export interface ExtractionFolder {
  folderId: number;
  path: string;
  acls: Array<{ role: string; access: string; inherited: boolean }>;
}

export interface SuggestedNewType {
  proposedName: string;
  reason: string;
  sampleFields: string[];
}

export interface ExtractionResult {
  document: UploadedDocument;
  classification: ExtractionClassification;
  mappedFields: ExtractionMappedFields;
  catalog: ExtractionCatalog;
  folder: ExtractionFolder | null;
  suggestedNewType: SuggestedNewType | null;
  source: "ai" | "ocr-fallback";
}

// ─── API functions ────────────────────────────────────────────────────────────

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Upload a document file (single side or combined) via multipart POST.
 * Returns the created document record.
 */
export async function uploadDocument(
  file: File,
  meta: { title: string; branch: string; source_channel?: string }
): Promise<{ document: UploadedDocument }> {
  const form = new FormData();
  form.append("file", file);
  form.append("title", meta.title);
  form.append("branch", meta.branch);
  if (meta.source_channel) form.append("source_channel", meta.source_channel);

  const res = await fetch(`${SVC.core}/documents`, {
    method: "POST",
    headers: authHeaders(),
    body: form,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status, body });
  }
  return res.json();
}

/**
 * Upload multiple files in one request (bulk upload).
 * Sends each file separately and resolves all in parallel.
 */
export async function bulkUploadDocuments(
  files: File[],
  meta: { branch: string }
): Promise<{ document: UploadedDocument }[]> {
  return Promise.all(
    files.map((f) =>
      uploadDocument(f, { title: f.name.replace(/\.[^.]+$/, ""), branch: meta.branch })
    )
  );
}

/**
 * Trigger AI extraction pipeline for an already-uploaded document.
 * POST /documents/:id/extract
 */
export async function extractDocument(id: number): Promise<ExtractionResult> {
  const res = await fetch(`${SVC.core}/documents/${id}/extract`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status, body });
  }
  return res.json();
}
