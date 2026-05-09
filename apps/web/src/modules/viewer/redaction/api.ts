import { post } from '@/lib/http';
import { RedactResponseSchema } from './schemas';
import type { CanvasRegion, Reason, RedactResponse } from './schemas';

/**
 * CANVAS_SIZE_PX — the logical pixel size we assume the canvas container
 * occupies so we can convert normalised (0–1) coordinates to pixel coords
 * for the backend.  The Python service applies these to the raw PDF page,
 * so precision here only needs to be proportional.
 *
 * At 72 dpi, a standard A4 page is 595 × 842 pts.  We use 595 × 842 as
 * the reference frame; the viewer iframe renders the full page so the
 * aspect ratio matches.
 */
const REF_W = 595;
const REF_H = 842;

/** Convert a canvas region (0–1 normalised) to PDF pixel coordinates. */
function toPdfCoords(r: CanvasRegion) {
  return {
    page: r.page,
    x: Math.round(r.x * REF_W),
    y: Math.round(r.y * REF_H),
    w: Math.max(1, Math.round(r.w * REF_W)),
    h: Math.max(1, Math.round(r.h * REF_H)),
    reason: r.reason,
  };
}

/**
 * POST /spa/api/documents/{id}/redact
 *
 * Creates a permanent redacted copy of the document.  Original is preserved
 * and linked via `parent_id` on the new row.
 */
export function redactDocument(
  documentId: number,
  regions: CanvasRegion[],
  overallReason: Reason,
): Promise<RedactResponse> {
  const payload = {
    regions: regions.map(toPdfCoords),
    reason: overallReason,
    preserve_metadata: false,
  };
  return post(
    `/spa/api/documents/${documentId}/redact`,
    payload,
    RedactResponseSchema,
  );
}
