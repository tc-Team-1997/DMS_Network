import { z } from 'zod';

// ── Feature flag ─────────────────────────────────────────────────────────────
// Default off; explicitly opt-in with VITE_FF_REDACTION=true
export const FF_REDACTION: boolean =
  import.meta.env['VITE_FF_REDACTION'] === 'true';

// ── Region reason ─────────────────────────────────────────────────────────────
export const REASON_OPTIONS = [
  'pii',
  'financial-secret',
  'commercial-confidential',
  'legal-hold',
  'other',
] as const;

export const ReasonSchema = z.enum(REASON_OPTIONS);
export type Reason = z.infer<typeof ReasonSchema>;

export const REASON_LABELS: Record<Reason, string> = {
  'pii':                    'PII',
  'financial-secret':       'Financial secret',
  'commercial-confidential':'Commercial confidential',
  'legal-hold':             'Legal hold',
  'other':                  'Other',
};

// ── Region ───────────────────────────────────────────────────────────────────
export const RedactionRegionSchema = z.object({
  /** 0-based page index */
  page: z.number().int().min(0),
  /** Pixel coordinates in PDF space (non-normalised) */
  x: z.number().min(0),
  y: z.number().min(0),
  w: z.number().min(1),
  h: z.number().min(1),
  reason: ReasonSchema,
});
export type RedactionRegion = z.infer<typeof RedactionRegionSchema>;

// ── Local canvas region (normalised 0-1, pre-submit) ─────────────────────────
export const CanvasRegionSchema = z.object({
  /** Client-assigned unique id for React keys / test IDs */
  id: z.string(),
  /** 0-based page index (all canvas regions are page 0 in single-iframe view) */
  page: z.number().int().min(0),
  /** Normalised 0–1 coordinates relative to the canvas container */
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  w: z.number().min(0).max(1),
  h: z.number().min(0).max(1),
  reason: ReasonSchema,
});
export type CanvasRegion = z.infer<typeof CanvasRegionSchema>;

// ── API request / response ────────────────────────────────────────────────────
export const RedactRequestSchema = z.object({
  regions: z.array(RedactionRegionSchema).min(1),
  reason: ReasonSchema,
  preserve_metadata: z.boolean().default(false),
});
export type RedactRequest = z.infer<typeof RedactRequestSchema>;

export const RedactResponseSchema = z.object({
  redacted_document_id: z.number(),
  parent_id: z.number(),
  version: z.string(),
  regions_redacted: z.number(),
  redacted_by: z.string(),
  created_at: z.string().datetime(),
});
export type RedactResponse = z.infer<typeof RedactResponseSchema>;
