import { get, post } from '@/lib/http';
import { DocumentSchema } from '@/lib/schemas';
import { z } from 'zod';

export const fetchDocument = (id: number) =>
  get(`/spa/api/documents/${id}`, DocumentSchema);

// ---------- annotations ---------------------------------------------------

export const AnnotationKindSchema = z.enum(['highlight', 'redact', 'stamp', 'signature']);
export type AnnotationKind = z.infer<typeof AnnotationKindSchema>;

export const AnnotationSchema = z.object({
  id: z.string(),
  kind: AnnotationKindSchema,
  /** Normalised 0–1 coordinates relative to the preview container */
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  /** stamp label or base64 PNG data-URL for signature */
  payload: z.string().optional(),
});
export type Annotation = z.infer<typeof AnnotationSchema>;

const SaveAnnotationsResponseSchema = z.object({ ok: z.literal(true) });

export const saveAnnotations = (docId: number, annotations: Annotation[]) =>
  post(
    `/spa/api/documents/${docId}/annotations`,
    { annotations },
    SaveAnnotationsResponseSchema,
  );
