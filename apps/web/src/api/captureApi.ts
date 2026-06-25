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
  id: string;
  title: string;
  doc_type?: string;
  confidence?: number;
  extraction_status?: "PENDING" | "RUNNING" | "DONE" | "FAILED" | "SKIPPED";
  extracted_at?: string;
  catalog_category?: string;
  retention_years?: number;
  folder_id?: string;
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
  folderId: string;
  path: string;
  acls: Array<{ role: string; access: string; inherited: boolean }>;
}

export interface SuggestedNewType {
  proposedName: string;
  reason: string;
  sampleFields: string[];
}

/** Quality/completeness scoring returned by the extraction and PATCH endpoints */
export interface ExtractionQuality {
  /** 0–100 composite score (40% mandatory completeness + 60% AI confidence) */
  score: number;
  /** 0–1 ratio of mandatory fields present */
  completeness: number;
  /** field names that are mandatory but absent */
  mandatoryMissing: string[];
  /** AI confidence passed through from classification */
  confidence: number;
}

/** Single duplicate entry returned by the extraction pipeline */
export interface ExtractionDuplicate {
  id: string;
  title: string;
  doc_type: string;
  branch: string;
  ingest_timestamp: string;
  matchType: "hash" | "cid" | "doc_no";
}

export interface ExtractionResult {
  document: UploadedDocument;
  classification: ExtractionClassification;
  mappedFields: ExtractionMappedFields;
  catalog: ExtractionCatalog;
  folder: ExtractionFolder | null;
  suggestedNewType: SuggestedNewType | null;
  source: "ai" | "ocr-fallback";
  /** Quality/completeness score — present in extraction response */
  quality?: ExtractionQuality;
  /** Detected duplicates — empty array when dedup disabled or no match */
  duplicates?: ExtractionDuplicate[];
  /** true when a hash duplicate caused auto-versioning */
  autoVersioned?: boolean;
  /** Full raw AI extraction object — ALL keys, even those not in the schema */
  rawMetadata?: Record<string, unknown> | null;
}

// ─── Doc-types endpoint shapes ────────────────────────────────────────────────

export interface DocType {
  code: string;
  description: string;
  jurisdiction: string;
  issuer: string;
  category: string;
  system: boolean;
  created_at: string;
  mandatoryFields: string[];
  optionalFields: string[];
}

export interface DocTypesResponse {
  docTypes: DocType[];
  total: number;
}

// ─── PATCH /documents/:id shapes ─────────────────────────────────────────────

export interface PatchDocumentPayload {
  doc_type?: string;
  catalog_category?: string;
  cid?: string;
  doc_no?: string;
  folder_id?: string;
  metadata?: Record<string, string | number | null>;
}

export interface PatchDocumentResponse {
  document: UploadedDocument;
  quality: ExtractionQuality;
  catalog: ExtractionCatalog;
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
export async function extractDocument(id: string): Promise<ExtractionResult> {
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

/** 202 response from the async-extract path (P8 durable job queue). */
export interface EnqueuedExtraction {
  jobId: string;
  status: "queued";
}

/**
 * P8 — Enqueue AI extraction as a durable background job instead of running it
 * synchronously on the request. Returns 202 { jobId, status:"queued" }. The
 * document's extraction_status reflects QUEUED → RUNNING → DONE/FAILED, and the
 * job can be polled via getJob(jobId) until a terminal status.
 *
 * Sends `{ async: true }` to POST /documents/:id/extract (the route also accepts
 * POST /documents/:id/extract-async). Idempotent per document id on the backend.
 */
export async function extractDocumentAsync(id: string): Promise<EnqueuedExtraction> {
  const res = await fetch(`${SVC.core}/documents/${id}/extract`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ async: true }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status, body });
  }
  return res.json();
}

/**
 * Fetch all registered document types, including mandatoryFields / optionalFields.
 * GET SVC.core/doc-types
 */
export async function getDocTypes(): Promise<DocTypesResponse> {
  const res = await fetch(`${SVC.core}/doc-types`, {
    method: "GET",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status, body });
  }
  return res.json();
}

/**
 * Save uploader corrections for a captured document.
 * PATCH SVC.core/documents/:id
 * Metadata fields are MERGED into existing metadata (not replaced).
 * Returns updated document record with recomputed quality.
 */
export async function patchDocument(
  id: string,
  payload: PatchDocumentPayload
): Promise<PatchDocumentResponse> {
  const res = await fetch(`${SVC.core}/documents/${id}`, {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status, body });
  }
  return res.json();
}
