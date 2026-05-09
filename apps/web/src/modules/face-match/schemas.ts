/**
 * schemas.ts — Face Match KYC zod schemas
 * Contract: docs/contracts/face-match-kyc.md §4
 *
 * NOTE: Live-photo raw bytes are never stored server-side (GDPR AC-5).
 * The result card deliberately omits id_photo / live_photo fields —
 * only filename + decision are surfaced.
 */

import { z } from 'zod';

// ── Consent ────────────────────────────────────────────────────────────────────

export const ConsentTemplateSchema = z.object({
  consent_text: z.string(),
  tenant_id: z.string(),
  version: z.string(),
  language: z.string(),
});
export type ConsentTemplate = z.infer<typeof ConsentTemplateSchema>;

export const ConsentTokenRequestSchema = z.object({
  customer_cid: z.string().min(1),
  signed_at: z.string().datetime(),
  signature: z.string().min(1),
});
export type ConsentTokenRequest = z.infer<typeof ConsentTokenRequestSchema>;

export const ConsentTokenResponseSchema = z.object({
  consent_token: z.string().min(1),
  expires_at: z.string().datetime(),
});
export type ConsentTokenResponse = z.infer<typeof ConsentTokenResponseSchema>;

// ── Face match result ─────────────────────────────────────────────────────────

export const FaceMatchResultSchema = z.object({
  match: z.boolean(),
  distance: z.number().min(0).max(1).nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  face_geometry_ok: z.boolean(),
  id_photo_face_count: z.number().int().nonnegative().optional(),
  live_photo_face_count: z.number().int().nonnegative().optional(),
  decision_at: z.string().datetime(),
  idempotency_key: z.string().optional(),
  /** Human-readable detail for poor-geometry / error cases */
  detail: z.string().optional(),
  /**
   * Audit record ID — used by MatchResultCard to build a link to the
   * biometric_match record for auditors.
   */
  match_id: z.number().int().positive().optional(),
});
export type FaceMatchResult = z.infer<typeof FaceMatchResultSchema>;

// ── Error envelope ────────────────────────────────────────────────────────────

export const FaceMatchErrorSchema = z.object({
  error: z.enum([
    'consent_required',
    'invalid_image',
    'no_faces_detected',
    'multiple_faces_detected',
    'poor_geometry',
    'image_too_large',
    'feature_disabled',
    'rate_limit_exceeded',
  ]),
  message: z.string(),
});
export type FaceMatchError = z.infer<typeof FaceMatchErrorSchema>;
