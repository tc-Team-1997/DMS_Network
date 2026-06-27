/**
 * docTypesApi.ts — Admin DOC TYPES management (P5 core) + AI field
 * auto-detection (P6 ai).
 *
 * Endpoints (see .superpowers/sdd/p5-backend-report.md + p6-ai-report.md):
 *   GET    SVC.core/doc-types                         — list all types
 *   POST   SVC.core/doc-types                         — create custom type
 *   PUT    SVC.core/doc-types/:code                   — edit description/fields
 *   DELETE SVC.core/doc-types/:code                   — delete custom type
 *   POST   SVC.core/doc-types/:code/apply-fields      — replace stored schema
 *   POST   SVC.core/doc-types/from-suggestion         — persist suggested type
 *   POST   SVC.ai/idp/infer-fields  (multipart)       — infer fields from sample
 *
 * Write endpoints require the `doctype:write` permission server-side.
 */
import { SVC } from "../config.js";
import { getToken } from "./client.js";

// ─── Field-object shape (P5 + P6 aligned) ────────────────────────────────────

/** Stored field schema entry — `{ name, type?, mandatory }` per P5. */
export interface FieldObject {
  name: string;
  type?: string;       // "string" | "date" | "number" | "enum"
  mandatory: boolean;
}

/** A document type as returned by GET /doc-types. */
export interface DocType {
  code: string;
  description: string;
  jurisdiction: string;
  issuer: string;
  category: string;
  system: boolean;
  created_at: string;
  updated_at?: string | null;
  mandatoryFields: FieldObject[];
  optionalFields: FieldObject[];
  /** Group C training config. */
  promptClassify?: string | null;
  promptExtract?: string | null;
  folderPathTemplate?: string | null;
  hasSample?: boolean;
}

/** Human-approved training output: per-type prompts + folder routing template. */
export interface TrainingPayload {
  promptClassify?: string | null;
  promptExtract?: string | null;
  folderPathTemplate?: string | null;
}

export interface DocTypesResponse {
  docTypes: DocType[];
  total: number;
}

/** Payload accepted by POST/PUT/apply-fields. Field lists are field-objects. */
export interface DocTypeWritePayload {
  code?: string;
  description?: string;
  category?: string;
  jurisdiction?: string;
  issuer?: string;
  mandatory_fields?: FieldObject[];
  optional_fields?: FieldObject[];
}

/** AI-proposed field from POST /idp/infer-fields. */
export interface InferredField {
  name: string;
  label?: string;
  type?: string;       // string | date | number | enum
  mandatory: boolean;
  sample_value?: string | null;
}

export interface InferFieldsResult {
  doc_type_hint?: string | null;
  fields: InferredField[];
  degraded: boolean;
  note?: string | null;
}

/** Suggested-new-type body for POST /doc-types/from-suggestion. */
export interface FromSuggestionPayload {
  proposedName: string;
  reason?: string;
  sampleFields?: string[];
  category?: string;
  jurisdiction?: string;
  issuer?: string;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function jsonHeaders(): Record<string, string> {
  return { ...authHeaders(), "Content-Type": "application/json" };
}

async function unwrap<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status, body });
  }
  if (res.status === 204) return undefined as unknown as T;
  return res.json() as Promise<T>;
}

// ─── API ────────────────────────────────────────────────────────────────────

export const docTypesApi = {
  /** GET /doc-types — list all registered + observed doc types. */
  async list(): Promise<DocTypesResponse> {
    const res = await fetch(`${SVC.core}/doc-types`, { method: "GET", headers: jsonHeaders() });
    return unwrap<DocTypesResponse>(res);
  },

  /** POST /doc-types — create a custom type (201). */
  async create(payload: DocTypeWritePayload): Promise<{ docType: DocType }> {
    const res = await fetch(`${SVC.core}/doc-types`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify(payload),
    });
    return unwrap<{ docType: DocType }>(res);
  },

  /** PUT /doc-types/:code — edit description / fields. */
  async update(code: string, payload: DocTypeWritePayload): Promise<{ docType: DocType }> {
    const res = await fetch(`${SVC.core}/doc-types/${encodeURIComponent(code)}`, {
      method: "PUT",
      headers: jsonHeaders(),
      body: JSON.stringify(payload),
    });
    return unwrap<{ docType: DocType }>(res);
  },

  /** DELETE /doc-types/:code — only custom (non-system) types. */
  async remove(code: string): Promise<{ deleted: boolean; code: string }> {
    const res = await fetch(`${SVC.core}/doc-types/${encodeURIComponent(code)}`, {
      method: "DELETE",
      headers: jsonHeaders(),
    });
    return unwrap<{ deleted: boolean; code: string }>(res);
  },

  /** POST /doc-types/:code/apply-fields — replace stored schema wholesale. */
  async applyFields(
    code: string,
    fields: { mandatory_fields: FieldObject[]; optional_fields: FieldObject[] },
  ): Promise<{ docType: DocType }> {
    const res = await fetch(`${SVC.core}/doc-types/${encodeURIComponent(code)}/apply-fields`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify(fields),
    });
    return unwrap<{ docType: DocType }>(res);
  },

  /** POST /doc-types/:code/apply-training — set per-type prompts + folder template. */
  async applyTraining(code: string, payload: TrainingPayload): Promise<{ docType: DocType }> {
    const res = await fetch(`${SVC.core}/doc-types/${encodeURIComponent(code)}/apply-training`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify(payload),
    });
    return unwrap<{ docType: DocType }>(res);
  },

  /** POST /doc-types/from-suggestion — persist an AI-suggested new type. */
  async fromSuggestion(payload: FromSuggestionPayload): Promise<{ docType: DocType }> {
    const res = await fetch(`${SVC.core}/doc-types/from-suggestion`, {
      method: "POST",
      headers: jsonHeaders(),
      body: JSON.stringify(payload),
    });
    return unwrap<{ docType: DocType }>(res);
  },

  /**
   * POST SVC.ai/idp/infer-fields — upload a sample doc, get AI-proposed fields.
   * Always HTTP 200 (may be `degraded:true` with empty fields).
   */
  async inferFields(file: File, docTypeHint?: string): Promise<InferFieldsResult> {
    const form = new FormData();
    form.append("file", file);
    if (docTypeHint) form.append("doc_type_hint", docTypeHint);
    const res = await fetch(`${SVC.ai}/idp/infer-fields`, {
      method: "POST",
      headers: authHeaders(), // no Content-Type — browser sets multipart boundary
      body: form,
    });
    return unwrap<InferFieldsResult>(res);
  },
};
