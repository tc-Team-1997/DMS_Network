import { z } from 'zod';
import { del, get, http, patch, post } from '@/lib/http';
import { OkSchema } from '@/lib/schemas';

export const FIELD_TYPES = ['text', 'textarea', 'date', 'number', 'email', 'tel'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const AI_EXTRACT_KEYS = [
  'customer_cid', 'customer_name', 'doc_number', 'dob',
  'issue_date', 'expiry_date', 'issuing_authority', 'address',
] as const;
export type AiExtractKey = (typeof AI_EXTRACT_KEYS)[number];

export const INFERENCE_STATUSES = ['draft', 'live'] as const;
export type InferenceStatus = (typeof INFERENCE_STATUSES)[number];

export const FieldDefSchema = z.object({
  key: z.string().min(1).max(50),
  label: z.string().min(1).max(120),
  type: z.enum(FIELD_TYPES),
  required: z.boolean(),
  ai_extract_from: z.enum(AI_EXTRACT_KEYS).optional(),
});
export type FieldDef = z.infer<typeof FieldDefSchema>;

export const DocumentTypeSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  description: z.string().nullable(),
  fields: z.array(FieldDefSchema),
  active: z.number().int(),
  tenant_id: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  inference_status: z.enum(['manual', 'draft', 'live']).optional(),
  autofill_floor: z.number().min(0).max(1).optional(),
  high_confidence: z.number().min(0).max(1).optional(),
  tested_with_sample_id: z.number().int().nullable().optional(),
  default_folder_id: z.number().int().positive().nullable().optional(),
  default_folder_name: z.string().nullable().optional(),
  // DocTypes v2 (migration 0032)
  notify_days: z.string().optional(),
  translate_extracted_to_dz: z.boolean().optional(),
});
export type DocumentType = z.infer<typeof DocumentTypeSchema>;

export const DocumentTypeInputSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(500).optional(),
  fields: z.array(FieldDefSchema),
  active: z.boolean().optional(),
  autofill_floor: z.number().min(0).max(1).optional(),
  high_confidence: z.number().min(0).max(1).optional(),
  default_folder_id: z.number().int().positive().nullable().optional(),
  // DocTypes v2 (migration 0032)
  notify_days: z.string().optional(),
  translate_extracted_to_dz: z.boolean().optional(),
});
export type DocumentTypeInput = z.infer<typeof DocumentTypeInputSchema>;

// ── Schema versioning (migration 0032) ───────────────────────────────────────

export const DOCTYPE_VERSION_STATUSES = ['draft', 'live', 'archived'] as const;
export type DoctypeVersionStatus = (typeof DOCTYPE_VERSION_STATUSES)[number];

export const DoctypeVersionSchema = z.object({
  id: z.number().int(),
  doctype_id: z.number().int(),
  version: z.number().int(),
  schema_json: z.string(),
  created_by: z.string().nullable(),
  created_at: z.string(),
  status: z.enum(DOCTYPE_VERSION_STATUSES),
});
export type DoctypeVersion = z.infer<typeof DoctypeVersionSchema>;

export const BboxSourceValues = ['confirmed', 'ai_proposed'] as const;
export type BboxSource = (typeof BboxSourceValues)[number];

export const DoctypeFieldBboxSchema = z.object({
  id: z.number().int(),
  doctype_version_id: z.number().int(),
  field_name: z.string(),
  page: z.number().int(),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  source: z.enum(BboxSourceValues),
});
export type DoctypeFieldBbox = z.infer<typeof DoctypeFieldBboxSchema>;

export const DoctypeVersionDiffSchema = z.object({
  version_a: z.object({ id: z.number().int(), version: z.number().int(), status: z.string() }),
  version_b: z.object({ id: z.number().int(), version: z.number().int(), status: z.string() }),
  diff: z.object({
    added: z.array(z.record(z.string(), z.unknown())),
    removed: z.array(z.record(z.string(), z.unknown())),
    modified: z.array(z.record(z.string(), z.unknown())),
  }),
});
export type DoctypeVersionDiff = z.infer<typeof DoctypeVersionDiffSchema>;

export const AbTestResultSchema = z.object({
  version_a: z.object({
    version: z.number().int(),
    results: z.array(z.record(z.string(), z.unknown())),
  }),
  version_b: z.object({
    version: z.number().int(),
    results: z.array(z.record(z.string(), z.unknown())),
  }),
  note: z.string().optional(),
});
export type AbTestResult = z.infer<typeof AbTestResultSchema>;

// ── Version API calls ─────────────────────────────────────────────────────────

export const listVersions = (doctypeId: number): Promise<DoctypeVersion[]> =>
  get(`/spa/api/document-types/${doctypeId}/versions`, z.array(DoctypeVersionSchema));

export const createVersion = (doctypeId: number, schemaJson: string): Promise<DoctypeVersion> =>
  post(
    `/spa/api/document-types/${doctypeId}/versions`,
    { schema_json: schemaJson },
    DoctypeVersionSchema,
  );

export const publishVersion = (
  doctypeId: number,
  versionId: number,
  reason: string,
): Promise<DoctypeVersion> =>
  post(
    `/spa/api/document-types/${doctypeId}/versions/${versionId}/publish`,
    { reason },
    DoctypeVersionSchema,
  );

export const rollbackVersion = (
  doctypeId: number,
  versionId: number,
  reason: string,
): Promise<DoctypeVersion> =>
  post(
    `/spa/api/document-types/${doctypeId}/versions/${versionId}/rollback`,
    { reason },
    DoctypeVersionSchema,
  );

export const diffVersions = (
  doctypeId: number,
  versionId: number,
  compareId?: number,
): Promise<DoctypeVersionDiff> =>
  get(
    `/spa/api/document-types/${doctypeId}/versions/${versionId}/diff`,
    DoctypeVersionDiffSchema,
    compareId !== undefined ? { compare: compareId } : undefined,
  );

// ── Bbox API calls ────────────────────────────────────────────────────────────

export const listBboxes = (doctypeId: number, versionId: number): Promise<DoctypeFieldBbox[]> =>
  get(
    `/spa/api/document-types/${doctypeId}/versions/${versionId}/bbox`,
    z.array(DoctypeFieldBboxSchema),
  );

export const saveBbox = (
  doctypeId: number,
  versionId: number,
  bbox: { field_name: string; page: number; x: number; y: number; w: number; h: number; source: BboxSource },
): Promise<DoctypeFieldBbox> =>
  post(
    `/spa/api/document-types/${doctypeId}/versions/${versionId}/bbox`,
    bbox,
    DoctypeFieldBboxSchema,
  );

export const deleteBbox = (doctypeId: number, versionId: number, bboxId: number): Promise<{ ok: boolean }> =>
  del(`/spa/api/document-types/${doctypeId}/versions/${versionId}/bbox/${bboxId}`, z.object({ ok: z.boolean() }));

// ── A/B test API call ─────────────────────────────────────────────────────────

export const runAbTest = (
  doctypeId: number,
  payload: { sample_doc_ids: number[]; version_a: number; version_b: number },
): Promise<AbTestResult> =>
  post(`/spa/api/document-types/${doctypeId}/ab-test`, payload, AbTestResultSchema);

// ── Infer / commit ────────────────────────────────────────────────────────────

export const PerSampleSchema = z.object({
  filename: z.string(),
  ocr_preview: z.string(),
  extracted_fields: z.record(z.string(), z.string()),
  ocr_backend: z.string().optional(),
  confidence: z.number().optional(),
});
export type PerSample = z.infer<typeof PerSampleSchema>;

export const InferredFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(FIELD_TYPES),
  required: z.boolean(),
  ai_extract_from: z.enum(AI_EXTRACT_KEYS).optional(),
  seen_in_samples: z.number().int().optional(),
  total_samples: z.number().int().optional(),
});
export type InferredField = z.infer<typeof InferredFieldSchema>;

export const InferResponseSchema = z.object({
  name: z.string(),
  description: z.string(),
  fields: z.array(InferredFieldSchema),
  confidence: z.number(),
  per_sample: z.array(PerSampleSchema),
  total_samples: z.number().int(),
});
export type InferResponse = z.infer<typeof InferResponseSchema>;

export const CommitRequestSchema = z.object({
  name: z.string().min(1).max(80),
  description: z.string().optional(),
  fields: z.array(FieldDefSchema),
  inference_status: z.enum(INFERENCE_STATUSES),
  per_sample: z.array(PerSampleSchema).optional(),
  autofill_floor: z.number().min(0).max(1).default(0.4),
  high_confidence: z.number().min(0).max(1).default(0.7),
});
export type CommitRequest = z.infer<typeof CommitRequestSchema>;

export const CommitResponseSchema = z.object({
  schema_id: z.number().int(),
  samples_saved: z.number().int(),
  vectors_indexed: z.number().int(),
});
export type CommitResponse = z.infer<typeof CommitResponseSchema>;

// ── Samples ───────────────────────────────────────────────────────────────────

export const SampleSchema = z.object({
  id: z.number().int(),
  schema_id: z.number().int(),
  filename: z.string(),
  thumbnail_url: z.string().nullable().optional(),
  ocr_backend: z.string().optional(),
  mean_confidence: z.number().optional(),
  uploaded_at: z.string(),
  uploader: z.string().optional(),
});
export type Sample = z.infer<typeof SampleSchema>;

export const SampleDetailSchema = z.object({
  id: z.number().int(),
  schema_id: z.number().int(),
  filename: z.string(),
  thumbnail_url: z.string().nullable().optional(),
  ocr_backend: z.string().optional(),
  mean_confidence: z.number().optional(),
  ocr_text_preview: z.string().optional(),
  uploaded_at: z.string(),
  uploader: z.string().optional(),
});
export type SampleDetail = z.infer<typeof SampleDetailSchema>;

// ── Classify-one ─────────────────────────────────────────────────────────────

export const ClassifyOneResponseSchema = z.object({
  best_match: z.object({
    schema_id: z.number().int(),
    name: z.string(),
    similarity: z.number(),
  }).nullable(),
  all_matches: z.array(z.object({
    schema_id: z.number().int(),
    name: z.string(),
    similarity: z.number(),
  })).optional(),
});
export type ClassifyOneResponse = z.infer<typeof ClassifyOneResponseSchema>;

// ── Tamper check ─────────────────────────────────────────────────────────────

export const TamperCheckResponseSchema = z.object({
  verdict: z.enum(['verified', 'needs_review', 'tampered']),
  reasons: z.array(z.string()),
  checked_at: z.string().optional(),
});
export type TamperCheckResponse = z.infer<typeof TamperCheckResponseSchema>;

// ── Reindex ───────────────────────────────────────────────────────────────────

export const ReindexResponseSchema = z.object({
  samples_reindexed: z.number().int(),
  new_schema_version: z.number().int(),
});
export type ReindexResponse = z.infer<typeof ReindexResponseSchema>;

// ── API calls ─────────────────────────────────────────────────────────────────

export const fetchDocumentTypes = (onlyActive = true) =>
  get('/spa/api/document-types', z.array(DocumentTypeSchema), onlyActive ? { active: 1 } : undefined);

export const fetchDocumentType = (id: number) =>
  get(`/spa/api/document-types/${id}`, DocumentTypeSchema);

export const createDocumentType = (body: DocumentTypeInput) =>
  post('/spa/api/document-types', DocumentTypeInputSchema.parse(body), DocumentTypeSchema);

export const patchDocumentType = (id: number, body: Partial<DocumentTypeInput>) =>
  patch(`/spa/api/document-types/${id}`, body, DocumentTypeSchema);

export const deleteDocumentType = (id: number) =>
  del(`/spa/api/document-types/${id}`, OkSchema);

export const inferDoctype = (files: File[]): Promise<InferResponse> => {
  const form = new FormData();
  for (const f of files) form.append('files', f);
  return http
    .post<unknown>('/spa/api/docbrain/doctypes/infer', form, { timeout: 300_000 })
    .then(({ data }) => InferResponseSchema.parse(data));
};

export const commitDoctype = (
  payload: CommitRequest,
  files: File[],
): Promise<CommitResponse> => {
  const form = new FormData();
  for (const f of files) form.append('files', f);
  form.append('blob', JSON.stringify(CommitRequestSchema.parse(payload)));
  return http
    .post<unknown>('/spa/api/docbrain/doctypes/commit', form, { timeout: 600_000 })
    .then(({ data }) => CommitResponseSchema.parse(data));
};

export const listSamples = (schemaId: number): Promise<Sample[]> =>
  get(`/spa/api/docbrain/doctypes/${schemaId}/samples`, z.array(SampleSchema));

export const getSample = (schemaId: number, sampleId: number): Promise<SampleDetail> =>
  get(`/spa/api/docbrain/doctypes/${schemaId}/samples/${sampleId}`, SampleDetailSchema);

export const deleteSample = (schemaId: number, sampleId: number): Promise<{ ok: true }> =>
  del(`/spa/api/docbrain/doctypes/${schemaId}/samples/${sampleId}`, OkSchema);

export const reindexDoctype = (schemaId: number): Promise<ReindexResponse> =>
  post(`/spa/api/docbrain/doctypes/${schemaId}/reindex`, {}, ReindexResponseSchema);

export const classifyOne = (file: File): Promise<ClassifyOneResponse> => {
  const form = new FormData();
  form.set('file', file);
  return http
    .post<unknown>('/spa/api/docbrain/doctypes/classify-one', form)
    .then(({ data }) => ClassifyOneResponseSchema.parse(data));
};

export const tamperCheck = (schemaId: number, documentId: number): Promise<TamperCheckResponse> =>
  post(
    `/spa/api/docbrain/doctypes/${schemaId}/tamper-check`,
    { document_id: documentId },
    TamperCheckResponseSchema,
  );

// ── OCR confidence threshold tuning ──────────────────────────────────────────

/**
 * Validated threshold update payload.
 * autofill_floor must be strictly less than high_confidence — the Python
 * backend rejects equality, so we keep the SPA constraint identical.
 */
export const ThresholdUpdateSchema = z
  .object({
    autofill_floor: z.number().min(0).max(1),
    high_confidence: z.number().min(0).max(1),
    tested_with_sample_id: z.number().int().nullable().optional(),
  })
  .refine((d) => d.autofill_floor < d.high_confidence, {
    message: 'autofill_floor must be strictly less than high_confidence',
    path: ['autofill_floor'],
  });
export type ThresholdUpdate = z.infer<typeof ThresholdUpdateSchema>;

/** A single field result from the test-thresholds endpoint. */
export const ExtractedFieldSchema = z.object({
  key: z.string(),
  value: z.string(),
  confidence: z.number().min(0).max(1),
});
export type ExtractedField = z.infer<typeof ExtractedFieldSchema>;

/** Response from POST /spa/api/document-types/:id/test-thresholds */
export const TestThresholdsResponseSchema = z.object({
  extracted_fields: z.array(ExtractedFieldSchema),
  /** Number of fields at or above autofill_floor */
  at_floor: z.number().int(),
  /** Number of fields at or above high_confidence */
  at_high: z.number().int(),
});
export type TestThresholdsResponse = z.infer<typeof TestThresholdsResponseSchema>;

/** Patch thresholds only — typed wrapper using validated schema. */
export const patchThresholds = (id: number, payload: ThresholdUpdate) =>
  patch(
    `/spa/api/document-types/${id}`,
    ThresholdUpdateSchema.parse(payload),
    DocumentTypeSchema,
  );

/** POST /spa/api/document-types/:id/test-thresholds */
export const testThresholds = (
  id: number,
  sampleId: number,
  autofill_floor: number,
  high_confidence: number,
): Promise<TestThresholdsResponse> =>
  post(
    `/spa/api/document-types/${id}/test-thresholds`,
    { sample_id: sampleId, autofill_floor, high_confidence },
    TestThresholdsResponseSchema,
  );
