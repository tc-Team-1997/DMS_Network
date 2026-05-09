import { z } from 'zod';
import { del, get, http, post } from '@/lib/http';
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
  default_folder_id: z.number().int().positive().nullable().optional(),
  default_folder_name: z.string().nullable().optional(),
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
});
export type DocumentTypeInput = z.infer<typeof DocumentTypeInputSchema>;

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

export const patchDocumentType = async (id: number, body: Partial<DocumentTypeInput>) => {
  const { data } = await http.patch(`/spa/api/document-types/${id}`, body);
  return DocumentTypeSchema.parse(data);
};

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
