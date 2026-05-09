import { z } from 'zod';

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

export const ReportFormatSchema = z.enum(['pdf', 'csv', 'jsonld']);
export type ReportFormat = z.infer<typeof ReportFormatSchema>;

export const TemplateSchema = z.object({
  id: z.number().int(),
  tenant_id: z.string(),
  regulator: z.string(),
  name: z.string(),
  parameters_schema_json: z.string(),
  query_template: z.string(),
  output_template_path: z.string().nullable(),
  format: ReportFormatSchema,
  is_active: z.boolean(),
  schedule_cron: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Template = z.infer<typeof TemplateSchema>;

export const TemplateListSchema = z.object({
  templates: z.array(TemplateSchema),
});

export const TemplateCreateResponseSchema = z.object({
  id: z.number().int(),
});

export const TemplateUpdateResponseSchema = z.object({
  id: z.number().int(),
  updated: z.boolean(),
});

export type TemplateIn = {
  regulator: string;
  name: string;
  parameters_schema_json: string;
  query_template: string;
  output_template_path?: string | null;
  format: ReportFormat;
  is_active: boolean;
  schedule_cron?: string | null;
};

// ---------------------------------------------------------------------------
// Pre-flight
// ---------------------------------------------------------------------------

export const PreflightCheckSchema = z.object({
  check: z.string(),
  status: z.enum(['pass', 'warn', 'fail', 'error']),
  detail: z.string(),
});
export type PreflightCheck = z.infer<typeof PreflightCheckSchema>;

export const PreflightResultSchema = z.object({
  template_id: z.number().int(),
  ready: z.boolean(),
  checks: z.array(PreflightCheckSchema),
});
export type PreflightResult = z.infer<typeof PreflightResultSchema>;

// ---------------------------------------------------------------------------
// Signature manifest (from services/signing.py::sign_detached)
// ---------------------------------------------------------------------------

export const SignatureManifestSchema = z.object({
  file: z.string(),
  sha256: z.string(),
  signer: z.string(),
  reason: z.string(),
  signed_at: z.string(),
  cert_fingerprint_sha256: z.string(),
  algorithm: z.string(),
});
export type SignatureManifest = z.infer<typeof SignatureManifestSchema>;

// ---------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------

export const GenerateResponseSchema = z.object({
  receipt_id: z.number().int(),
  sha256: z.string(),
  file_path: z.string(),
  format: ReportFormatSchema,
  generated_at: z.string(),
  rows: z.number().int(),
  signature: SignatureManifestSchema.nullable(),
  data_base64: z.string().nullable(),
});
export type GenerateResponse = z.infer<typeof GenerateResponseSchema>;

// ---------------------------------------------------------------------------
// Submission receipt
// ---------------------------------------------------------------------------

export const SubmissionSchema = z.object({
  id: z.number().int(),
  report_template_id: z.number().int(),
  regulator: z.string(),
  template_name: z.string(),
  generated_at: z.string(),
  generated_by: z.string().nullable(),
  sha256: z.string().nullable(),
  /** Raw JSON string of the signature manifest (or null if unsigned). */
  signature: z.string().nullable(),
  submitted_at: z.string().nullable(),
  regulator_endpoint: z.string().nullable(),
  response_code: z.number().int().nullable(),
  params_json: z.string(),
});
export type Submission = z.infer<typeof SubmissionSchema>;

export const SubmissionListSchema = z.object({
  submissions: z.array(SubmissionSchema),
});

export const SubmitResponseSchema = z.object({
  receipt_id: z.number().int(),
  status: z.string(),
  regulator_endpoint: z.string().optional(),
  submitted_at: z.string().optional(),
  response_code: z.number().int().optional(),
  note: z.string().optional(),
});
export type SubmitResponse = z.infer<typeof SubmitResponseSchema>;
