import { z } from 'zod';

// ---------------------------------------------------------------------------
// Lock
// ---------------------------------------------------------------------------

export const LockSchema = z.object({
  user_name:  z.string(),
  user_id:    z.number().int().optional(),
  expires_at: z.string(),
});
export type Lock = z.infer<typeof LockSchema>;

// ---------------------------------------------------------------------------
// Queue row — returned by GET /spa/api/indexing
// ---------------------------------------------------------------------------

export const IndexingRowSchema = z.object({
  id:                z.number().int(),
  filename:          z.string(),
  original_name:     z.string().nullable(),
  doc_type:          z.string().nullable(),
  customer_cid:      z.string().nullable(),
  customer_name:     z.string().nullable(),
  doc_number:        z.string().nullable(),
  dob:               z.string().nullable(),
  issue_date:        z.string().nullable(),
  expiry_date:       z.string().nullable(),
  issuing_authority: z.string().nullable(),
  branch:            z.string().nullable(),
  status:            z.string(),
  ocr_confidence:    z.number().nullable(),
  uploaded_at:       z.string(),
  notes:             z.string().nullable(),
  lock:              LockSchema.nullable(),
});
export type IndexingRow = z.infer<typeof IndexingRowSchema>;

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export const IndexingStatsSchema = z.object({
  low_confidence: z.number().int(),
  missing_type:   z.number().int(),
  missing_owner:  z.number().int(),
  missing_number: z.number().int(),
});
export type IndexingStats = z.infer<typeof IndexingStatsSchema>;

// ---------------------------------------------------------------------------
// Patch
// ---------------------------------------------------------------------------

export const IndexingPatchSchema = z.object({
  doc_type:          z.string().nullable().optional(),
  customer_cid:      z.string().nullable().optional(),
  customer_name:     z.string().nullable().optional(),
  doc_number:        z.string().nullable().optional(),
  dob:               z.string().nullable().optional(),
  issue_date:        z.string().nullable().optional(),
  expiry_date:       z.string().nullable().optional(),
  issuing_authority: z.string().nullable().optional(),
  notes:             z.string().nullable().optional(),
});
export type IndexingPatch = z.infer<typeof IndexingPatchSchema>;

// ---------------------------------------------------------------------------
// Per-field analysis (from metadata_json._ai_fields via the analysis endpoint)
// bbox is absent until DocBrain v2 ships — optional, never null.
// ---------------------------------------------------------------------------

export const FieldBboxSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});
export type FieldBbox = z.infer<typeof FieldBboxSchema>;

export const AnalysisFieldSchema = z.object({
  value:      z.string().nullable(),
  confidence: z.number(),
  bbox:       FieldBboxSchema.optional(),
});
export type AnalysisField = z.infer<typeof AnalysisFieldSchema>;

export const AnalysisResponseSchema = z.object({
  document_id: z.number().int(),
  fields:      z.record(z.string(), AnalysisFieldSchema),
});
export type AnalysisResponse = z.infer<typeof AnalysisResponseSchema>;

// ---------------------------------------------------------------------------
// Claim response
// ---------------------------------------------------------------------------

export const ClaimResponseSchema = z.object({
  ok:          z.literal(true),
  expires_at:  z.string(),
  ttl_minutes: z.number().int(),
});
export type ClaimResponse = z.infer<typeof ClaimResponseSchema>;

// ---------------------------------------------------------------------------
// Field definition used by the form
// ---------------------------------------------------------------------------

export const FIELD_DEFS = [
  { key: 'doc_type' as const,          label: 'Doc type',          type: 'text' as const  },
  { key: 'customer_name' as const,     label: 'Customer name',     type: 'text' as const  },
  { key: 'customer_cid' as const,      label: 'Customer CID',      type: 'text' as const  },
  { key: 'doc_number' as const,        label: 'Doc number',        type: 'text' as const  },
  { key: 'dob' as const,               label: 'Date of birth',     type: 'date' as const  },
  { key: 'issue_date' as const,        label: 'Issue date',        type: 'date' as const  },
  { key: 'expiry_date' as const,       label: 'Expiry date',       type: 'date' as const  },
  { key: 'issuing_authority' as const, label: 'Issuing authority', type: 'text' as const  },
  { key: 'notes' as const,             label: 'Notes',             type: 'text' as const  },
] as const satisfies ReadonlyArray<{
  key:   keyof IndexingPatch;
  label: string;
  type:  'text' | 'date';
}>;

export type FieldKey = (typeof FIELD_DEFS)[number]['key'];

// Confidence colour bands — mirror CC4 / AiConfidenceBadge bands.
// Values are Tailwind design-token hex values from tailwind.config.ts.
// Kept here (not in TSX) so BboxOverlay canvas also uses the same palette.
export const CONFIDENCE_BAND = {
  low:       { min: 0,  max: 40,  color: '#E24B4A', label: 'Low' },       // danger
  medium:    { min: 40, max: 70,  color: '#EF9F27', label: 'Medium' },     // warning
  high:      { min: 70, max: 90,  color: '#2196F3', label: 'High' },       // brand-sky
  excellent: { min: 90, max: 101, color: '#1D9E75', label: 'Excellent' },  // success
} as const;

export type ConfidenceBand = keyof typeof CONFIDENCE_BAND;

export function getConfidenceBand(pct: number): ConfidenceBand {
  if (pct < 40) return 'low';
  if (pct < 70) return 'medium';
  if (pct < 90) return 'high';
  return 'excellent';
}
