/**
 * Viewer v2 — API layer.
 *
 * All fetches go through @/lib/http (axios + zod). No raw fetch(), no `any`.
 * Covers:
 *   - Document fetch
 *   - Annotations CRUD  → /spa/api/documents/:id/annotations
 *   - Versions list     → /spa/api/documents/:id/versions
 *   - Audit log         → /spa/api/documents/:id/audit
 */

import { get, post, patch, del } from '@/lib/http';
import { DocumentSchema } from '@/lib/schemas';
import { z } from 'zod';

// ── document ──────────────────────────────────────────────────────────────────

export { DocumentSchema };
export const fetchDocument = (id: number) =>
  get(`/spa/api/documents/${id}`, DocumentSchema);

// ── annotation schemas ────────────────────────────────────────────────────────

export const AnnotationTypeSchema = z.enum([
  'highlight',
  'comment',
  'stamp',
  'signature',
  'redact',
]);
export type AnnotationType = z.infer<typeof AnnotationTypeSchema>;

/**
 * @deprecated used only by the legacy AnnotationLayer — kept for backward compat
 */
export const AnnotationKindSchema = z.enum(['highlight', 'redact', 'stamp', 'signature']);
export type AnnotationKind = z.infer<typeof AnnotationKindSchema>;

/**
 * Local (client-side) annotation object used by AnnotationLayer before saving.
 * Structurally identical to LegacyAnnotation — defined here so AnnotationLayer
 * can import it by name without a separate definition.
 */
export interface Annotation {
  id:      string;
  kind:    AnnotationKind;
  x:       number;
  y:       number;
  w:       number;
  h:       number;
  payload?: string | undefined;
}

export const BboxSchema = z.object({
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});
export type Bbox = z.infer<typeof BboxSchema>;

export const ServerAnnotationSchema = z.object({
  id: z.number().int(),
  doc_id: z.number().int(),
  user_id: z.number().int().nullable(),
  page: z.number().int(),
  kind: AnnotationTypeSchema,
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  /** text for comment/highlight, stampId for stamp, dataURL for signature */
  text: z.string().nullable(),
  color: z.string().nullable(),
  created_at: z.string(),
  username: z.string().nullable().optional(),
});
export type ServerAnnotation = z.infer<typeof ServerAnnotationSchema>;

const ServerAnnotationListSchema = z.array(ServerAnnotationSchema);

export const CreateAnnotationBodySchema = z.object({
  type: AnnotationTypeSchema,
  page: z.number().int().min(0),
  bbox: BboxSchema,
  payload: z.string().optional(),
  color: z.string().optional(),
});
export type CreateAnnotationBody = z.infer<typeof CreateAnnotationBodySchema>;

export const UpdateAnnotationBodySchema = z.object({
  payload: z.string().optional(),
  color: z.string().optional(),
  page: z.number().int().min(0).optional(),
  bbox: BboxSchema.optional(),
});
export type UpdateAnnotationBody = z.infer<typeof UpdateAnnotationBodySchema>;

const OkSchema = z.object({ ok: z.literal(true) });

// ── annotation API calls ──────────────────────────────────────────────────────

export const fetchAnnotations = (docId: number): Promise<ServerAnnotation[]> =>
  get(`/spa/api/documents/${docId}/annotations`, ServerAnnotationListSchema);

export const createAnnotation = (
  docId: number,
  body: CreateAnnotationBody,
): Promise<ServerAnnotation> =>
  post(`/spa/api/documents/${docId}/annotations`, body, ServerAnnotationSchema);

export const updateAnnotation = (
  docId: number,
  annId: number,
  body: UpdateAnnotationBody,
): Promise<ServerAnnotation> =>
  patch(`/spa/api/documents/${docId}/annotations/${annId}`, body, ServerAnnotationSchema);

export const deleteAnnotation = (
  docId: number,
  annId: number,
): Promise<{ ok: true }> =>
  del(`/spa/api/documents/${docId}/annotations/${annId}`, OkSchema);

// ── versions ──────────────────────────────────────────────────────────────────

export const DocVersionSchema = z.object({
  id: z.number().int(),
  doc_id: z.number().int(),
  version: z.string(),
  filename: z.string(),
  size: z.number().int().nullable(),
  changed_by: z.number().int().nullable(),
  change_note: z.string().nullable(),
  created_at: z.string(),
});
export type DocVersion = z.infer<typeof DocVersionSchema>;

const DocVersionListSchema = z.array(DocVersionSchema);

export const fetchVersions = (docId: number): Promise<DocVersion[]> =>
  get(`/spa/api/documents/${docId}/versions`, DocVersionListSchema);

// ── audit log ─────────────────────────────────────────────────────────────────

export const AuditEventSchema = z.object({
  id: z.number().int(),
  user_id: z.number().int().nullable(),
  action: z.string(),
  entity: z.string(),
  entity_id: z.union([z.number().int(), z.string()]).nullable(),
  details: z.string().nullable(),
  tenant_id: z.string(),
  created_at: z.string(),
  username: z.string().nullable().optional(),
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;

const AuditListSchema = z.array(AuditEventSchema);

export const fetchDocumentAudit = (docId: number): Promise<AuditEvent[]> =>
  get(`/spa/api/documents/${docId}/audit`, AuditListSchema);

// ── legacy AnnotationLayer shape (kept for backward compat) ──────────────────

export interface LegacyAnnotation {
  id: string;
  kind: AnnotationKind;
  x: number;
  y: number;
  w: number;
  h: number;
  payload?: string | undefined;
}

/**
 * @deprecated  The bulk save endpoint was a 404.
 * New code uses createAnnotation / updateAnnotation / deleteAnnotation.
 * This stub satisfies existing AnnotationLayer imports without a network call.
 */
export const saveAnnotations = (
  _docId: number,
  _annotations: LegacyAnnotation[],
): Promise<{ ok: true }> => Promise.resolve({ ok: true as const });
