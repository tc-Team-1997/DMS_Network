/**
 * BboxOverlay — transparent <canvas> drawn over PdfCanvas to display
 * per-field bounding boxes colour-coded by AI confidence.
 *
 * Confidence bands (mirror CC4 / AiConfidenceBadge):
 *   < 40   → danger  #E24B4A (red)
 *   40-70  → warning #EF9F27 (amber)
 *   70-90  → brand-sky #2196F3 (blue)
 *   ≥ 90   → success #1D9E75 (green)
 *
 * The overlay is sized to match the underlying PDF canvas via a
 * ResizeObserver on the parent container. Boxes are drawn at 40% opacity
 * fill + full-opacity 2px stroke.
 *
 * When bbox data is absent (DocBrain v2 not yet shipped), nothing is drawn.
 */

import { useEffect, useLayoutEffect, useRef } from 'react';
import { CONFIDENCE_BAND, getConfidenceBand } from '../schemas';
import type { AnalysisResponse } from '../schemas';

export interface BboxOverlayProps {
  /** Width of the underlying PDF canvas in CSS pixels. */
  canvasWidth: number;
  /** Height of the underlying PDF canvas in CSS pixels. */
  canvasHeight: number;
  analysis: AnalysisResponse | null;
  /** 1-based page number currently displayed. */
  currentPage: number;
  /** Field key whose bbox should be highlighted with a thicker stroke. */
  activeFieldKey: string | null;
  /** Called when user clicks a bbox — passes the matching field key. */
  onBboxClick: (fieldKey: string) => void;
  className?: string;
}

interface Rect {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  confidence: number;
}

function buildRects(
  analysis: AnalysisResponse | null,
  page: number,
  cw: number,
  ch: number,
): Rect[] {
  if (!analysis) return [];
  const rects: Rect[] = [];
  for (const [key, field] of Object.entries(analysis.fields)) {
    // bbox.page is 1-based to match PdfCanvas page prop.
    // When bbox has no page field we assume page 1.
    if (!field.bbox) continue;
    const bboxPage = (field.bbox as { x: number; y: number; w: number; h: number; page?: number }).page ?? 1;
    if (bboxPage !== page) continue;
    rects.push({
      key,
      x: field.bbox.x * cw,
      y: field.bbox.y * ch,
      w: field.bbox.w * cw,
      h: field.bbox.h * ch,
      confidence: field.confidence * 100,
    });
  }
  return rects;
}

export function BboxOverlay({
  canvasWidth,
  canvasHeight,
  analysis,
  currentPage,
  activeFieldKey,
  onBboxClick,
  className,
}: BboxOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Keep rects in a ref for click handling without re-registering listeners.
  const rectsRef = useRef<Rect[]>([]);

  // Draw whenever inputs change.
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    canvas.style.width = `${canvasWidth}px`;
    canvas.style.height = `${canvasHeight}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    const rects = buildRects(analysis, currentPage, canvasWidth, canvasHeight);
    rectsRef.current = rects;

    for (const rect of rects) {
      const band = getConfidenceBand(rect.confidence);
      const color = CONFIDENCE_BAND[band].color;
      const isActive = rect.key === activeFieldKey;

      ctx.save();
      ctx.globalAlpha = isActive ? 0.35 : 0.2;
      ctx.fillStyle = color;
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = color;
      ctx.lineWidth = isActive ? 3 : 1.5;
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
      ctx.restore();
    }
  }, [analysis, currentPage, canvasWidth, canvasHeight, activeFieldKey]);

  // Click handler — hit-test rects.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function onClick(e: MouseEvent) {
      const cr = canvas!.getBoundingClientRect();
      const mx = e.clientX - cr.left;
      const my = e.clientY - cr.top;
      for (const rect of rectsRef.current) {
        if (mx >= rect.x && mx <= rect.x + rect.w && my >= rect.y && my <= rect.y + rect.h) {
          onBboxClick(rect.key);
          return;
        }
      }
    }

    canvas.addEventListener('click', onClick);
    return () => canvas.removeEventListener('click', onClick);
  }, [onBboxClick]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      data-testid="indexing-bbox-overlay"
      className={className}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        pointerEvents: rectsRef.current.length > 0 ? 'auto' : 'none',
        cursor: 'crosshair',
      }}
    />
  );
}
