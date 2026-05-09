/**
 * api.ts — Face Match KYC API calls
 * Contract: docs/contracts/face-match-kyc.md §5 (Node/SPA surface)
 *
 * All photos are sent as multipart/form-data via postForm().
 * Consent token is stored in sessionStorage — never localStorage.
 * No fetch() calls; everything routes through src/lib/http.ts.
 */

import { get, post, postForm } from '@/lib/http';
import {
  ConsentTemplateSchema,
  ConsentTokenResponseSchema,
  FaceMatchResultSchema,
  type FaceMatchResult,
  type ConsentTemplate,
  type ConsentTokenResponse,
} from './schemas';

const BASE = '/spa/api/face-match';

// ── Consent ────────────────────────────────────────────────────────────────────

/**
 * Fetch the biometric consent template text for the current tenant.
 * Cached by React Query — stable until tenant config changes.
 */
export function getConsent(): Promise<ConsentTemplate> {
  return get(`${BASE}/consent-template`, ConsentTemplateSchema);
}

/**
 * Record that the user accepted consent and receive a 24-hour JWT token.
 * The token must be included in every subsequent performMatch() call.
 *
 * @param customerCid   The customer's CID from the CID input field.
 * @param signedAt      ISO-8601 timestamp of when the user clicked Accept.
 */
export function acceptConsent(
  customerCid: string,
  signedAt: string,
): Promise<ConsentTokenResponse> {
  return post(
    `${BASE}/consent-token`,
    {
      customer_cid: customerCid,
      signed_at: signedAt,
      // The SPA uses the customer CID + timestamp hash as the approval signal.
      // The real cryptographic signature lives server-side (JWT issuance).
      signature: btoa(`${customerCid}:${signedAt}`),
    },
    ConsentTokenResponseSchema,
  );
}

// ── Face match ─────────────────────────────────────────────────────────────────

/**
 * Submit ID photo and live photo for face matching.
 *
 * Privacy invariants enforced here:
 * - Photos are sent as multipart/form-data binary — never base64-encoded in
 *   the request body, which would inflate logs.
 * - EXIF stripping is performed by PhotoUploadSlot before the File reaches
 *   this function (canvas re-encode trick).
 * - The server must NOT return raw image bytes in the response (contract §4).
 *
 * @param idPhoto       EXIF-stripped JPEG/PNG Blob — from ID document.
 * @param livePhoto     EXIF-stripped JPEG/PNG Blob — live selfie or webcam.
 * @param customerCid   Customer CID for audit linkage.
 * @param consentToken  JWT from acceptConsent(). Required by the backend.
 * @param docId         Optional document ID for audit trail.
 */
export async function performMatch(
  idPhoto: Blob,
  livePhoto: Blob,
  customerCid: string,
  consentToken: string,
  docId?: number,
): Promise<FaceMatchResult> {
  const form = new FormData();
  form.append('id_photo', idPhoto, 'id_photo.jpg');
  form.append('live_photo', livePhoto, 'live_photo.jpg');
  form.append('customer_cid', customerCid);
  form.append('consent_token', consentToken);
  if (docId !== undefined) {
    form.append('doc_id', String(docId));
  }
  return postForm(BASE, form, FaceMatchResultSchema);
}
