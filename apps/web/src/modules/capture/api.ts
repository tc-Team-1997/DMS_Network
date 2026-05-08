import { get, postForm } from '@/lib/http';
import { FolderSchema } from '@/lib/schemas';
import { z } from 'zod';

export const fetchFolders = () => get('/spa/api/folders', z.array(FolderSchema));

const UploadResponseSchema = z.object({ ok: z.literal(true), id: z.number().int() });
export type UploadResponse = z.infer<typeof UploadResponseSchema>;

export const uploadDocument = (form: FormData): Promise<UploadResponse> =>
  postForm('/spa/api/documents', form, UploadResponseSchema);

// ---------- AI preview (pre-upload auto-fill) ------------------------------

const ExtractedFieldSchema = z.object({
  value: z.string().nullable(),
  confidence: z.number(),
});

const ExtractionSchema = z.object({
  customer_cid: ExtractedFieldSchema,
  customer_name: ExtractedFieldSchema,
  doc_number: ExtractedFieldSchema,
  dob: ExtractedFieldSchema,
  issue_date: ExtractedFieldSchema,
  expiry_date: ExtractedFieldSchema,
  issuing_authority: ExtractedFieldSchema,
  address: ExtractedFieldSchema,
});
export type Extraction = z.infer<typeof ExtractionSchema>;

const ClassificationSchema = z.object({
  doc_class: z.string(),
  confidence: z.number(),
  reasoning: z.string(),
  alternative: z.string().nullable().optional(),
});
export type Classification = z.infer<typeof ClassificationSchema>;

const OcrSummarySchema = z.object({
  pages: z.number(),
  mean_confidence: z.number(),
  languages: z.array(z.string()),
  backend: z.string().default('tesseract'),
});

export const PreviewResponseSchema = z.object({
  classification: ClassificationSchema,
  extraction: ExtractionSchema,
  ocr: OcrSummarySchema,
  prefill: z.record(z.string(), z.string()),
  summary: z.string().default(''),
});
export type PreviewResponse = z.infer<typeof PreviewResponseSchema>;

export const previewDocument = (file: File): Promise<PreviewResponse> => {
  const form = new FormData();
  form.set('file', file);
  return postForm('/spa/api/docbrain/preview', form, PreviewResponseSchema);
};
