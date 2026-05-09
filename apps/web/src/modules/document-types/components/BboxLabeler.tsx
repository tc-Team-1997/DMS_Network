/**
 * BboxLabeler — drag-to-draw bounding box annotations on a PDF page.
 *
 * Wraps PdfCanvas (PDF.js) from the viewer module and overlays a transparent
 * canvas for mouse-draw interaction. Each completed rectangle triggers a
 * popover asking for field name + source. Saved boxes are rendered as:
 *   - solid green border  = confirmed
 *   - dashed amber border = ai_proposed
 *
 * Props:
 *   samplePdfUrl  — URL of the sample PDF to label (from /spa/api/docbrain/…/pdf)
 *   doctypeId     — ID of the doctype (for bbox API calls)
 *   versionId     — ID of the doctype version to label
 *   fieldNames    — ordered list of field keys to offer in the label popover
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Trash2, X } from 'lucide-react';
import { Badge, Button } from '@/components/ui';
import { cn } from '@/lib/cn';
import { PdfCanvas } from '@/modules/viewer/components/PdfCanvas';
import {
  deleteBbox,
  listBboxes,
  saveBbox,
  type BboxSource,
  type DoctypeFieldBbox,
} from '../api';

// ── types ─────────────────────────────────────────────────────────────────────

interface DragState {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

interface PendingBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ── colour helpers ─────────────────────────────────────────────────────────────

const CONFIRMED_COLOR = 'rgba(22,163,74,0.9)';    // brand success-green
const PROPOSED_COLOR  = 'rgba(234,179,8,0.9)';    // brand amber/warning

function drawBox(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  source: BboxSource,
  label: string,
  canvasWidth: number,
  canvasHeight: number,
) {
  const px = x * canvasWidth;
  const py = y * canvasHeight;
  const pw = w * canvasWidth;
  const ph = h * canvasHeight;

  ctx.save();
  ctx.lineWidth = 2;

  if (source === 'confirmed') {
    ctx.strokeStyle = CONFIRMED_COLOR;
    ctx.setLineDash([]);
  } else {
    ctx.strokeStyle = PROPOSED_COLOR;
    ctx.setLineDash([5, 3]);
  }

  ctx.fillStyle =
    source === 'confirmed'
      ? 'rgba(22,163,74,0.08)'
      : 'rgba(234,179,8,0.08)';

  ctx.fillRect(px, py, pw, ph);
  ctx.strokeRect(px, py, pw, ph);

  // Label text
  ctx.font = '11px system-ui';
  ctx.fillStyle = source === 'confirmed' ? CONFIRMED_COLOR : PROPOSED_COLOR;
  ctx.fillText(label, px + 3, py + 13);

  ctx.restore();
}

// ── component ─────────────────────────────────────────────────────────────────

export interface BboxLabelerProps {
  samplePdfUrl: string;
  doctypeId: number;
  versionId: number;
  fieldNames: readonly string[];
}

export function BboxLabeler({
  samplePdfUrl,
  doctypeId,
  versionId,
  fieldNames,
}: BboxLabelerProps) {
  const qc = useQueryClient();

  const [page, setPage] = useState(1);
  const [numPages, setNumPages] = useState(1);
  const [canvasSize, setCanvasSize] = useState<{ w: number; h: number } | null>(null);

  // Drag state
  const [drag, setDrag] = useState<DragState | null>(null);
  const [pending, setPending] = useState<PendingBox | null>(null);

  // Popover state
  const [popoverField, setPopoverField] = useState<string>('');
  const [popoverSource, setPopoverSource] = useState<BboxSource>('confirmed');
  const [popoverVisible, setPopoverVisible] = useState(false);
  const [popoverPos, setPopoverPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Canvas refs
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // ── bbox query ───────────────────────────────────────────────────────────────
  const bboxQuery = useQuery({
    queryKey: ['doctype-bbox', doctypeId, versionId, page],
    queryFn: () => listBboxes(doctypeId, versionId),
  });

  // ── save mutation ─────────────────────────────────────────────────────────────
  const saveMut = useMutation({
    mutationFn: (bbox: Parameters<typeof saveBbox>[2]) =>
      saveBbox(doctypeId, versionId, bbox),
    onSuccess: () => {
      setPending(null);
      setPopoverVisible(false);
      void qc.invalidateQueries({ queryKey: ['doctype-bbox', doctypeId, versionId] });
    },
  });

  const deleteMut = useMutation({
    mutationFn: (bboxId: number) => deleteBbox(doctypeId, versionId, bboxId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['doctype-bbox', doctypeId, versionId] });
    },
  });

  // ── Redraw overlay whenever bboxes / page / canvasSize change ─────────────────
  const redrawOverlay = useCallback(() => {
    const canvas = overlayRef.current;
    if (!canvas || !canvasSize) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const pageBboxes = (bboxQuery.data ?? []).filter((b) => b.page === page);
    for (const b of pageBboxes) {
      drawBox(ctx, b.x, b.y, b.w, b.h, b.source, b.field_name, canvas.width, canvas.height);
    }

    // Draw in-progress drag rectangle.
    if (drag) {
      const x = Math.min(drag.startX, drag.endX);
      const y = Math.min(drag.startY, drag.endY);
      const w = Math.abs(drag.endX - drag.startX);
      const h = Math.abs(drag.endY - drag.startY);
      ctx.save();
      ctx.strokeStyle = 'rgba(99,102,241,0.8)'; // indigo
      ctx.setLineDash([4, 2]);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x, y, w, h);
      ctx.restore();
    }
  }, [bboxQuery.data, page, drag, canvasSize]);

  useEffect(() => {
    redrawOverlay();
  }, [redrawOverlay]);

  // ── Size the overlay canvas to match the PDF canvas ───────────────────────────
  const syncOverlaySize = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const pdfCanvas = container.querySelector<HTMLCanvasElement>('[data-testid="pdf-canvas"]');
    if (!pdfCanvas) return;
    const w = pdfCanvas.offsetWidth;
    const h = pdfCanvas.offsetHeight;
    const overlay = overlayRef.current;
    if (!overlay) return;
    if (overlay.width !== w || overlay.height !== h) {
      overlay.width = w;
      overlay.height = h;
      overlay.style.width = `${w}px`;
      overlay.style.height = `${h}px`;
      setCanvasSize({ w, h });
    }
  }, []);

  // Sync size on mount and after PDF renders.
  useEffect(() => {
    const obs = new ResizeObserver(syncOverlaySize);
    if (containerRef.current) obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, [syncOverlaySize]);

  // ── Mouse handlers ────────────────────────────────────────────────────────────

  function getNormCoords(e: React.MouseEvent<HTMLCanvasElement>): { x: number; y: number } {
    const canvas = overlayRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) / rect.width,
      y: (e.clientY - rect.top) / rect.height,
    };
  }

  function onMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    if (popoverVisible) return;
    const { x, y } = getNormCoords(e);
    setDrag({ startX: x * (overlayRef.current?.width ?? 1), startY: y * (overlayRef.current?.height ?? 1), endX: x * (overlayRef.current?.width ?? 1), endY: y * (overlayRef.current?.height ?? 1) });
  }

  function onMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!drag) return;
    const canvas = overlayRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cx = (e.clientX - rect.left) / rect.width * canvas.width;
    const cy = (e.clientY - rect.top) / rect.height * canvas.height;
    setDrag((d) => d ? { ...d, endX: cx, endY: cy } : null);
  }

  function onMouseUp(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!drag) return;
    const canvas = overlayRef.current;
    if (!canvas) return;

    const x0 = Math.min(drag.startX, drag.endX) / canvas.width;
    const y0 = Math.min(drag.startY, drag.endY) / canvas.height;
    const w0 = Math.abs(drag.endX - drag.startX) / canvas.width;
    const h0 = Math.abs(drag.endY - drag.startY) / canvas.height;

    setDrag(null);

    // Require a minimum drag size (5% of canvas) to avoid accidental clicks.
    if (w0 < 0.02 || h0 < 0.02) return;

    setPending({ x: x0, y: y0, w: w0, h: h0 });
    setPopoverField(fieldNames[0] ?? '');
    setPopoverSource('confirmed');

    const rect = canvas.getBoundingClientRect();
    setPopoverPos({
      x: e.clientX - rect.left + 8,
      y: e.clientY - rect.top + 8,
    });
    setPopoverVisible(true);
  }

  function confirmLabel() {
    if (!pending || !popoverField.trim()) return;
    saveMut.mutate({
      field_name: popoverField.trim(),
      page,
      x: pending.x,
      y: pending.y,
      w: pending.w,
      h: pending.h,
      source: popoverSource,
    });
  }

  function cancelLabel() {
    setPending(null);
    setPopoverVisible(false);
  }

  const pageBboxes: DoctypeFieldBbox[] = (bboxQuery.data ?? []).filter((b) => b.page === page);

  return (
    <div className="space-y-3" data-testid="bbox-labeler">
      {/* Page navigation */}
      <div className="flex items-center gap-3">
        <span className="text-xs text-muted">
          Page {page} / {numPages}
        </span>
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => setPage((p) => p - 1)}
          className="text-xs text-brand-blue hover:underline disabled:opacity-40"
        >
          Prev
        </button>
        <button
          type="button"
          disabled={page >= numPages}
          onClick={() => setPage((p) => p + 1)}
          className="text-xs text-brand-blue hover:underline disabled:opacity-40"
        >
          Next
        </button>
        <span className="text-[10px] text-muted ml-auto">Drag to draw a field box</span>
      </div>

      {/* PDF + overlay stack */}
      <div ref={containerRef} className="relative select-none" data-testid="bbox-labeler-pdf-wrap">
        <PdfCanvas
          url={samplePdfUrl}
          page={page}
          zoom="fit-width"
          rotation={0}
          searchQuery=""
          highlight={null}
          onNumPages={setNumPages}
          onMatchCount={() => undefined}
        />

        {/* Drawing overlay */}
        <canvas
          ref={overlayRef}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            cursor: 'crosshair',
            zIndex: 20,
          }}
          aria-label="Bounding box drawing canvas"
          data-testid="bbox-overlay-canvas"
        />

        {/* Field label popover */}
        {popoverVisible && (
          <div
            className="absolute z-30 bg-white rounded-card border border-divider shadow-xl p-3 min-w-[220px]"
            style={{ left: popoverPos.x, top: popoverPos.y }}
            data-testid="bbox-popover"
          >
            <p className="text-xs font-semibold text-ink mb-2">Label this field</p>
            <label className="flex flex-col text-[11px] text-muted mb-2">
              Field
              <select
                value={popoverField}
                onChange={(e) => setPopoverField(e.target.value)}
                className="mt-0.5 h-8 rounded-input border border-border px-2 text-md text-ink"
                data-testid="bbox-field-select"
              >
                {fieldNames.map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
                {fieldNames.length === 0 && <option value="">— no fields —</option>}
              </select>
            </label>
            <label className="flex flex-col text-[11px] text-muted mb-3">
              Source
              <select
                value={popoverSource}
                onChange={(e) => setPopoverSource(e.target.value as BboxSource)}
                className="mt-0.5 h-8 rounded-input border border-border px-2 text-md text-ink"
                data-testid="bbox-source-select"
              >
                <option value="confirmed">Confirmed (solid green)</option>
                <option value="ai_proposed">AI-proposed (dashed amber)</option>
              </select>
            </label>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={confirmLabel}
                loading={saveMut.isPending}
                disabled={!popoverField.trim()}
                data-testid="bbox-confirm-btn"
              >
                <CheckCircle2 size={12} /> Save
              </Button>
              <button
                type="button"
                onClick={cancelLabel}
                className="text-xs text-muted hover:text-ink"
                data-testid="bbox-cancel-btn"
              >
                <X size={12} /> Cancel
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Saved boxes for this page */}
      {pageBboxes.length > 0 && (
        <div className="space-y-1" data-testid="bbox-list">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">
            Annotations on page {page}
          </p>
          {pageBboxes.map((b) => (
            <div
              key={b.id}
              className="flex items-center gap-2 rounded-input border border-divider px-2 py-1 bg-white text-xs"
              data-testid={`bbox-row-${b.id}`}
            >
              <span
                className={cn(
                  'inline-block w-2.5 h-2.5 rounded-sm shrink-0',
                  b.source === 'confirmed' ? 'bg-success' : 'bg-warning',
                )}
              />
              <span className="flex-1 font-mono text-ink">{b.field_name}</span>
              <Badge tone={b.source === 'confirmed' ? 'success' : 'warning'} className="text-[9px]">
                {b.source === 'confirmed' ? 'confirmed' : 'AI-proposed'}
              </Badge>
              <button
                type="button"
                onClick={() => deleteMut.mutate(b.id)}
                aria-label={`Delete bbox for ${b.field_name}`}
                className="text-muted hover:text-danger"
                data-testid={`bbox-delete-${b.id}`}
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
