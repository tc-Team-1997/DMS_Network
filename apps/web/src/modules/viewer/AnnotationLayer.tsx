/**
 * AnnotationLayer — floating toolbar + overlay layer for the viewer preview pane.
 *
 * Tools:
 *   highlight  — yellow semi-transparent drag rect
 *   redact     — black opaque drag rect; "Export redacted" burns into PDF via pdf-lib
 *   stamp      — click-to-place SVG overlay (Approved / Rejected / Confidential / Draft)
 *   signature  — freehand canvas draw, saved as PNG data-URL overlay
 *
 * Coordinates are stored normalised (0–1) so they survive container resize.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useMutation } from '@tanstack/react-query';
import { Highlighter, Square, Stamp, PenLine, Trash2, Download, Save } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui';
import { saveAnnotations, type Annotation, type AnnotationKind } from './api';

// ── types ─────────────────────────────────────────────────────────────────

type Tool = AnnotationKind | 'select';

interface DragState {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  active: boolean;
}

const STAMP_OPTIONS = [
  { label: 'Approved',     src: '/stamps/approved.svg',     w: 160, h: 60 },
  { label: 'Rejected',     src: '/stamps/rejected.svg',     w: 160, h: 60 },
  { label: 'Confidential', src: '/stamps/confidential.svg', w: 190, h: 60 },
  { label: 'Draft',        src: '/stamps/draft.svg',        w: 120, h: 60 },
] as const;

type StampLabel = (typeof STAMP_OPTIONS)[number]['label'];

// ── helpers ───────────────────────────────────────────────────────────────

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function toNorm(
  containerRect: DOMRect,
  px: number,
  py: number,
): { x: number; y: number } {
  return {
    x: clamp01((px - containerRect.left) / containerRect.width),
    y: clamp01((py - containerRect.top)  / containerRect.height),
  };
}

// ── main component ────────────────────────────────────────────────────────

export interface AnnotationLayerProps {
  /** Numeric document id for persistence */
  documentId: number;
  /** Whether the source document is a PDF (enables "Export redacted") */
  isPdf: boolean;
  /** Raw src URL passed to the viewer's iframe/img */
  src: string;
  /** className forwarded to the outer wrapper */
  className?: string;
  children: React.ReactNode;
}

export function AnnotationLayer({
  documentId,
  isPdf,
  src,
  className,
  children,
}: AnnotationLayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigCanvasRef  = useRef<HTMLCanvasElement>(null);

  const [tool, setTool]           = useState<Tool>('select');
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [selectedStamp, setSelectedStamp] = useState<StampLabel>('Approved');
  const [sigDrawing, setSigDrawing]   = useState(false);
  const [drag, setDrag]           = useState<DragState | null>(null);
  const [exportBusy, setExportBusy]   = useState(false);

  const saveMutation = useMutation({
    mutationFn: () => saveAnnotations(documentId, annotations),
  });

  // ── pointer helpers ───────────────────────────────────────────────────

  const getRect = useCallback(() =>
    containerRef.current?.getBoundingClientRect() ?? null
  , []);

  // ── drag-rect (highlight / redact) ───────────────────────────────────

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (tool !== 'highlight' && tool !== 'redact') return;
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag({
        startX: e.clientX,
        startY: e.clientY,
        currentX: e.clientX,
        currentY: e.clientY,
        active: true,
      });
    },
    [tool],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!drag?.active) return;
      setDrag((d) => d ? { ...d, currentX: e.clientX, currentY: e.clientY } : null);
    },
    [drag],
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!drag?.active) return;
      const rect = getRect();
      if (!rect) { setDrag(null); return; }

      const x1 = Math.min(drag.startX, e.clientX);
      const y1 = Math.min(drag.startY, e.clientY);
      const x2 = Math.max(drag.startX, e.clientX);
      const y2 = Math.max(drag.startY, e.clientY);

      const n1 = toNorm(rect, x1, y1);
      const n2 = toNorm(rect, x2, y2);
      const w  = n2.x - n1.x;
      const h  = n2.y - n1.y;

      if (w > 0.005 && h > 0.005) {
        const ann: Annotation = {
          id:   uid(),
          kind: tool as 'highlight' | 'redact',
          x: n1.x,
          y: n1.y,
          w,
          h,
        };
        setAnnotations((a) => [...a, ann]);
      }
      setDrag(null);
    },
    [drag, getRect, tool],
  );

  // ── stamp click ───────────────────────────────────────────────────────

  const onOverlayClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (tool !== 'stamp') return;
      const rect = getRect();
      if (!rect) return;
      const stamp = STAMP_OPTIONS.find((s) => s.label === selectedStamp);
      if (!stamp) return;
      // Place stamp centred on click, in normalised coords
      const normW = stamp.w / rect.width;
      const normH = stamp.h / rect.height;
      const norm  = toNorm(rect, e.clientX, e.clientY);
      const ann: Annotation = {
        id:      uid(),
        kind:    'stamp',
        x:       clamp01(norm.x - normW / 2),
        y:       clamp01(norm.y - normH / 2),
        w:       normW,
        h:       normH,
        payload: stamp.src,
      };
      setAnnotations((a) => [...a, ann]);
    },
    [tool, selectedStamp, getRect],
  );

  // ── signature canvas ──────────────────────────────────────────────────

  useEffect(() => {
    if (tool !== 'signature') return;
    const canvas = sigCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.strokeStyle = '#1565C0';
    ctx.lineWidth   = 2;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
  }, [tool]);

  const sigPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      if (tool !== 'signature') return;
      e.currentTarget.setPointerCapture(e.pointerId);
      setSigDrawing(true);
      const ctx = e.currentTarget.getContext('2d');
      if (!ctx) return;
      const r = e.currentTarget.getBoundingClientRect();
      ctx.beginPath();
      ctx.moveTo(e.clientX - r.left, e.clientY - r.top);
    },
    [tool],
  );

  const sigPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      if (!sigDrawing) return;
      const ctx = e.currentTarget.getContext('2d');
      if (!ctx) return;
      const r = e.currentTarget.getBoundingClientRect();
      ctx.lineTo(e.clientX - r.left, e.clientY - r.top);
      ctx.stroke();
    },
    [sigDrawing],
  );

  const sigPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      if (!sigDrawing) return;
      setSigDrawing(false);
      const canvas = e.currentTarget;
      const rect   = getRect();
      if (!rect) return;
      const dataUrl = canvas.toDataURL('image/png');
      const cRect   = canvas.getBoundingClientRect();
      const ann: Annotation = {
        id:      uid(),
        kind:    'signature',
        x:       (cRect.left - rect.left) / rect.width,
        y:       (cRect.top  - rect.top)  / rect.height,
        w:       cRect.width  / rect.width,
        h:       cRect.height / rect.height,
        payload: dataUrl,
      };
      setAnnotations((a) => [...a, ann]);
      // Clear canvas for next signature stroke
      const ctx = canvas.getContext('2d');
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
      setTool('select');
    },
    [sigDrawing, getRect],
  );

  // ── delete annotation ─────────────────────────────────────────────────

  const removeAnnotation = useCallback((id: string) => {
    setAnnotations((a) => a.filter((x) => x.id !== id));
  }, []);

  // ── export redacted PDF ───────────────────────────────────────────────

  const exportRedacted = useCallback(async () => {
    if (!isPdf) return;
    setExportBusy(true);
    try {
      const { PDFDocument, rgb } = await import('pdf-lib');
      const bytes   = await fetch(src).then((r) => r.arrayBuffer());
      const pdfDoc  = await PDFDocument.load(bytes);
      const pages   = pdfDoc.getPages();
      const rect    = getRect();
      if (!rect) return;

      const redacts = annotations.filter((a) => a.kind === 'redact');
      for (const ann of redacts) {
        // Apply redaction to every page (single-page assumption for now;
        // the overlay is full-container so we can only target page 0 reliably)
        const pg    = pages[0];
        if (!pg) continue;
        const { width, height } = pg.getSize();
        pg.drawRectangle({
          x:      ann.x * width,
          // PDF coords: origin bottom-left, so flip Y
          y:      height - (ann.y + ann.h) * height,
          width:  ann.w * width,
          height: ann.h * height,
          color:  rgb(0, 0, 0),
          opacity: 1,
        });
      }

      const out  = await pdfDoc.save();
      // pdf-lib returns Uint8Array<ArrayBufferLike>; Blob only accepts ArrayBuffer.
      const buf  = out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
      const blob = new Blob([buf], { type: 'application/pdf' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = 'redacted.pdf';
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExportBusy(false);
    }
  }, [isPdf, src, annotations, getRect]);

  // ── live drag ghost ───────────────────────────────────────────────────

  const dragGhost = drag && drag.active ? (() => {
    const rect = getRect();
    if (!rect) return null;
    const x1 = Math.min(drag.startX, drag.currentX) - rect.left;
    const y1 = Math.min(drag.startY, drag.currentY) - rect.top;
    const w  = Math.abs(drag.currentX - drag.startX);
    const h  = Math.abs(drag.currentY - drag.startY);
    return { x1, y1, w, h };
  })() : null;

  // ── render ────────────────────────────────────────────────────────────

  const hasRedact = annotations.some((a) => a.kind === 'redact');

  return (
    <div className={cn('flex flex-col gap-0', className)}>
      {/* Floating toolbar */}
      <div
        className={cn(
          'flex items-center gap-1 flex-wrap px-3 py-1.5',
          'rounded-t-card border border-b-0 border-divider bg-white',
        )}
        data-testid="annotation-toolbar"
      >
        <ToolButton
          active={tool === 'highlight'}
          onClick={() => setTool(tool === 'highlight' ? 'select' : 'highlight')}
          title="Highlight"
          data-testid="ann-tool-highlight"
        >
          <Highlighter size={14} />
          <span className="text-xs">Highlight</span>
        </ToolButton>

        <ToolButton
          active={tool === 'redact'}
          onClick={() => setTool(tool === 'redact' ? 'select' : 'redact')}
          title="Redact"
          data-testid="ann-tool-redact"
        >
          <Square size={14} className="fill-ink" />
          <span className="text-xs">Redact</span>
        </ToolButton>

        <ToolButton
          active={tool === 'stamp'}
          onClick={() => setTool(tool === 'stamp' ? 'select' : 'stamp')}
          title="Stamp"
          data-testid="ann-tool-stamp"
        >
          <Stamp size={14} />
          <span className="text-xs">Stamp</span>
        </ToolButton>

        {tool === 'stamp' && (
          <select
            value={selectedStamp}
            onChange={(e) => setSelectedStamp(e.target.value as StampLabel)}
            className="h-7 rounded-input border border-border bg-white px-2 text-xs"
            data-testid="ann-stamp-select"
          >
            {STAMP_OPTIONS.map((s) => (
              <option key={s.label} value={s.label}>{s.label}</option>
            ))}
          </select>
        )}

        <ToolButton
          active={tool === 'signature'}
          onClick={() => setTool(tool === 'signature' ? 'select' : 'signature')}
          title="Signature"
          data-testid="ann-tool-signature"
        >
          <PenLine size={14} />
          <span className="text-xs">Sign</span>
        </ToolButton>

        <div className="flex-1" />

        {annotations.length > 0 && (
          <>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => { saveMutation.mutate(); }}
              loading={saveMutation.isPending}
              data-testid="ann-save"
            >
              <Save size={12} /> Save
            </Button>

            <Button
              size="sm"
              variant="secondary"
              onClick={() => setAnnotations([])}
              data-testid="ann-clear"
            >
              <Trash2 size={12} /> Clear
            </Button>
          </>
        )}

        {isPdf && hasRedact && (
          <Button
            size="sm"
            onClick={exportRedacted}
            loading={exportBusy}
            data-testid="ann-export-redacted"
          >
            <Download size={12} /> Export redacted
          </Button>
        )}
      </div>

      {/* Preview container + overlay */}
      <div
        ref={containerRef}
        className={cn(
          'relative overflow-hidden rounded-b-card border border-divider bg-page',
          tool !== 'select' && tool !== 'signature' && 'cursor-crosshair',
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onClick={onOverlayClick}
        data-testid="annotation-container"
      >
        {/* Document content (iframe / img / fallback) */}
        {children}

        {/* Existing annotation overlays */}
        {annotations.map((ann) => (
          <AnnotationOverlay
            key={ann.id}
            ann={ann}
            onRemove={removeAnnotation}
          />
        ))}

        {/* Live drag ghost */}
        {dragGhost && (
          <div
            className={cn(
              'absolute pointer-events-none',
              tool === 'highlight' ? 'bg-warning/40 border border-warning' : 'bg-ink border border-ink',
            )}
            style={{
              left:   dragGhost.x1,
              top:    dragGhost.y1,
              width:  dragGhost.w,
              height: dragGhost.h,
            }}
          />
        )}

        {/* Signature canvas — shown on top when signature tool active */}
        {tool === 'signature' && (
          <canvas
            ref={sigCanvasRef}
            width={containerRef.current?.clientWidth  ?? 800}
            height={containerRef.current?.clientHeight ?? 600}
            className="absolute inset-0 cursor-crosshair touch-none"
            style={{ zIndex: 20 }}
            onPointerDown={sigPointerDown}
            onPointerMove={sigPointerMove}
            onPointerUp={sigPointerUp}
            data-testid="ann-sig-canvas"
          />
        )}
      </div>

      {/* Save status feedback */}
      {saveMutation.isSuccess && (
        <p className="text-xs text-success mt-1" data-testid="ann-save-ok">
          Annotations saved.
        </p>
      )}
      {saveMutation.isError && (
        <p className="text-xs text-danger mt-1" data-testid="ann-save-err">
          Save failed — annotations are preserved locally.
        </p>
      )}
    </div>
  );
}

// ── toolbar button ─────────────────────────────────────────────────────────

function ToolButton({
  active,
  onClick,
  title,
  children,
  'data-testid': testId,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
  'data-testid'?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      data-testid={testId}
      className={cn(
        'inline-flex items-center gap-1 px-2 py-1 rounded-input text-xs transition-colors',
        active
          ? 'bg-brand-blue text-white'
          : 'bg-white border border-border text-ink hover:bg-divider',
      )}
    >
      {children}
    </button>
  );
}

// ── single annotation overlay ──────────────────────────────────────────────

function AnnotationOverlay({
  ann,
  onRemove,
}: {
  ann: Annotation;
  onRemove: (id: string) => void;
}) {
  const style: React.CSSProperties = {
    position: 'absolute',
    left:   `${ann.x * 100}%`,
    top:    `${ann.y * 100}%`,
    width:  `${ann.w * 100}%`,
    height: `${ann.h * 100}%`,
    zIndex: 10,
    pointerEvents: 'auto',
  };

  if (ann.kind === 'highlight') {
    return (
      <div style={style} className="bg-warning/40 border border-warning group" data-testid={`ann-overlay-${ann.id}`}>
        <RemoveBtn onRemove={() => onRemove(ann.id)} />
      </div>
    );
  }

  if (ann.kind === 'redact') {
    return (
      <div style={style} className="bg-ink group" data-testid={`ann-overlay-${ann.id}`}>
        <RemoveBtn onRemove={() => onRemove(ann.id)} />
      </div>
    );
  }

  if (ann.kind === 'stamp' && ann.payload) {
    return (
      <div style={{ ...style, display: 'flex', alignItems: 'center', justifyContent: 'center' }} className="group" data-testid={`ann-overlay-${ann.id}`}>
        <img
          src={ann.payload}
          alt="stamp"
          className="w-full h-full object-contain opacity-80"
          draggable={false}
        />
        <RemoveBtn onRemove={() => onRemove(ann.id)} />
      </div>
    );
  }

  if (ann.kind === 'signature' && ann.payload) {
    return (
      <div style={style} className="group" data-testid={`ann-overlay-${ann.id}`}>
        <img
          src={ann.payload}
          alt="signature"
          className="w-full h-full object-contain"
          draggable={false}
        />
        <RemoveBtn onRemove={() => onRemove(ann.id)} />
      </div>
    );
  }

  return null;
}

function RemoveBtn({ onRemove }: { onRemove: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onRemove(); }}
      className={cn(
        'absolute -top-2.5 -right-2.5 w-5 h-5 rounded-full',
        'bg-danger text-white flex items-center justify-center',
        'opacity-0 group-hover:opacity-100 transition-opacity',
        'text-[10px] leading-none',
      )}
      aria-label="Remove annotation"
    >
      ×
    </button>
  );
}
