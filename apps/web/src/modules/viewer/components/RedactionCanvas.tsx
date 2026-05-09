/**
 * RedactionCanvas — transparent overlay on the PDF preview container.
 *
 * When redact mode is active this component:
 *   - Changes cursor to crosshair.
 *   - Lets users drag rectangles (pointer events).
 *   - Shows placed rectangles as semi-transparent black with a small
 *     reason picker and a delete button.
 *   - Provides a "Manual" keyboard-accessible alternative: x/y/w/h number
 *     inputs + "Add region" button.
 *   - Announces region count changes via a sr-only live region.
 *
 * Coordinates stored are normalised 0–1 relative to the container div.
 */

import {
  useCallback,
  useId,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button, Input } from '@/components/ui';
import { REASON_LABELS, REASON_OPTIONS } from '../redaction/schemas';
import type { CanvasRegion, Reason } from '../redaction/schemas';

// ── drag state ────────────────────────────────────────────────────────────────

interface DragState {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

// ── props ─────────────────────────────────────────────────────────────────────

export interface RedactionCanvasProps {
  /** Placed regions */
  regions: CanvasRegion[];
  /** Whether drag-to-draw mode is active */
  active: boolean;
  /** Called when a new region is drawn */
  onAddRegion: (r: Omit<CanvasRegion, 'id'>) => void;
  /** Remove a region by id */
  onRemoveRegion: (id: string) => void;
  /** Update reason for a region */
  onSetReason: (id: string, reason: Reason) => void;
  /** Content underneath (iframe / img) */
  children: React.ReactNode;
  className?: string;
}

// ── component ─────────────────────────────────────────────────────────────────

export function RedactionCanvas({
  regions,
  active,
  onAddRegion,
  onRemoveRegion,
  onSetReason,
  children,
  className,
}: RedactionCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [manualMode, setManualMode] = useState(false);

  // Manual input state
  const [manualX, setManualX] = useState('');
  const [manualY, setManualY] = useState('');
  const [manualW, setManualW] = useState('');
  const [manualH, setManualH] = useState('');
  const [manualReason, setManualReason] = useState<Reason>('pii');
  const manualBaseId = useId();

  const getRect = useCallback(
    () => containerRef.current?.getBoundingClientRect() ?? null,
    [],
  );

  // ── pointer drag ────────────────────────────────────────────────────────────

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!active || manualMode) return;
      // Don't intercept clicks on region overlays or their controls
      if ((e.target as HTMLElement).closest('[data-redact-region]')) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag({ startX: e.clientX, startY: e.clientY, currentX: e.clientX, currentY: e.clientY });
    },
    [active, manualMode],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!drag) return;
      setDrag((d) => d ? { ...d, currentX: e.clientX, currentY: e.clientY } : null);
    },
    [drag],
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!drag) return;
      const rect = getRect();
      if (!rect) { setDrag(null); return; }

      const x1 = Math.min(drag.startX, e.clientX);
      const y1 = Math.min(drag.startY, e.clientY);
      const x2 = Math.max(drag.startX, e.clientX);
      const y2 = Math.max(drag.startY, e.clientY);

      const nx = clamp01((x1 - rect.left) / rect.width);
      const ny = clamp01((y1 - rect.top) / rect.height);
      const nw = clamp01((x2 - rect.left) / rect.width) - nx;
      const nh = clamp01((y2 - rect.top) / rect.height) - ny;

      if (nw > 0.005 && nh > 0.005) {
        onAddRegion({ page: 0, x: nx, y: ny, w: nw, h: nh, reason: 'pii' });
      }
      setDrag(null);
    },
    [drag, getRect, onAddRegion],
  );

  // ── manual add ──────────────────────────────────────────────────────────────

  const handleManualAdd = useCallback(() => {
    const x = parseFloat(manualX) / 100;
    const y = parseFloat(manualY) / 100;
    const w = parseFloat(manualW) / 100;
    const h = parseFloat(manualH) / 100;
    if (
      Number.isNaN(x) || Number.isNaN(y) ||
      Number.isNaN(w) || Number.isNaN(h) ||
      w <= 0 || h <= 0
    ) return;
    onAddRegion({
      page: 0,
      x: clamp01(x),
      y: clamp01(y),
      w: clamp01(w),
      h: clamp01(h),
      reason: manualReason,
    });
    setManualX('');
    setManualY('');
    setManualW('');
    setManualH('');
  }, [manualX, manualY, manualW, manualH, manualReason, onAddRegion]);

  // ── drag ghost ──────────────────────────────────────────────────────────────

  const dragGhost = (() => {
    if (!drag) return null;
    const rect = getRect();
    if (!rect) return null;
    const left = Math.min(drag.startX, drag.currentX) - rect.left;
    const top = Math.min(drag.startY, drag.currentY) - rect.top;
    const width = Math.abs(drag.currentX - drag.startX);
    const height = Math.abs(drag.currentY - drag.startY);
    return { left, top, width, height };
  })();

  return (
    <div className={cn('flex flex-col gap-0', className)}>
      {/* Overlay container */}
      <div
        ref={containerRef}
        data-testid="redact-canvas"
        className={cn(
          'relative overflow-hidden',
          active && !manualMode && 'cursor-crosshair',
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {children}

        {/* Placed region overlays */}
        {regions.map((region, idx) => (
          <RegionOverlay
            key={region.id}
            region={region}
            index={idx}
            onRemove={onRemoveRegion}
            onSetReason={onSetReason}
          />
        ))}

        {/* Live drag ghost */}
        {dragGhost && (
          <div
            aria-hidden="true"
            className="absolute pointer-events-none bg-ink/70 border-2 border-ink"
            style={{
              left: dragGhost.left,
              top: dragGhost.top,
              width: dragGhost.width,
              height: dragGhost.height,
            }}
          />
        )}
      </div>

      {/* Accessibility: live region for screen readers */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {regions.length === 0
          ? 'No regions selected'
          : `${regions.length} region${regions.length === 1 ? '' : 's'} selected`}
      </div>

      {/* Manual mode toggle + inputs */}
      {active && (
        <div className="mt-2 border border-divider rounded-card bg-white p-3 space-y-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid="redact-manual-toggle"
              aria-pressed={manualMode}
              onClick={() => setManualMode((m) => !m)}
              className={cn(
                'inline-flex items-center gap-1 px-2 py-1 rounded-input text-xs border transition-colors',
                manualMode
                  ? 'bg-brand-blue text-white border-brand-blue'
                  : 'bg-white border-border text-ink hover:bg-divider',
              )}
            >
              Manual mode
            </button>
            <span className="text-xs text-muted">
              {manualMode
                ? 'Enter percent-based coordinates (0–100)'
                : 'Click and drag on the document to draw regions'}
            </span>
          </div>

          {manualMode && (
            <div
              role="group"
              aria-label="Manual region coordinates (percent)"
              className="grid grid-cols-2 gap-3 sm:grid-cols-4"
            >
              <Input
                id={`${manualBaseId}-x`}
                data-testid="redact-manual-x"
                label="X (%)"
                type="number"
                min={0}
                max={100}
                step={0.5}
                value={manualX}
                onChange={(e) => setManualX(e.target.value)}
                placeholder="0"
              />
              <Input
                id={`${manualBaseId}-y`}
                data-testid="redact-manual-y"
                label="Y (%)"
                type="number"
                min={0}
                max={100}
                step={0.5}
                value={manualY}
                onChange={(e) => setManualY(e.target.value)}
                placeholder="0"
              />
              <Input
                id={`${manualBaseId}-w`}
                data-testid="redact-manual-w"
                label="Width (%)"
                type="number"
                min={0.1}
                max={100}
                step={0.5}
                value={manualW}
                onChange={(e) => setManualW(e.target.value)}
                placeholder="20"
              />
              <Input
                id={`${manualBaseId}-h`}
                data-testid="redact-manual-h"
                label="Height (%)"
                type="number"
                min={0.1}
                max={100}
                step={0.5}
                value={manualH}
                onChange={(e) => setManualH(e.target.value)}
                placeholder="5"
              />

              <div className="sm:col-span-3">
                <label className="block">
                  <span className="label">Reason</span>
                  <select
                    value={manualReason}
                    onChange={(e) => setManualReason(e.target.value as Reason)}
                    className="input"
                  >
                    {REASON_OPTIONS.map((r) => (
                      <option key={r} value={r}>{REASON_LABELS[r]}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="flex items-end">
                <Button
                  size="sm"
                  onClick={handleManualAdd}
                  disabled={!manualX || !manualY || !manualW || !manualH}
                >
                  Add region
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── RegionOverlay ─────────────────────────────────────────────────────────────

interface RegionOverlayProps {
  region: CanvasRegion;
  index: number;
  onRemove: (id: string) => void;
  onSetReason: (id: string, reason: Reason) => void;
}

function RegionOverlay({ region, index, onRemove, onSetReason }: RegionOverlayProps) {
  return (
    <div
      data-redact-region
      data-testid={`redact-region-${index}`}
      style={{
        position: 'absolute',
        left: `${region.x * 100}%`,
        top: `${region.y * 100}%`,
        width: `${region.w * 100}%`,
        height: `${region.h * 100}%`,
        zIndex: 10,
        pointerEvents: 'auto',
      }}
      className="bg-ink/75 group border border-ink"
    >
      {/* Reason picker — visible on hover or when region is small enough */}
      <div
        className={cn(
          'absolute -bottom-7 left-0 z-20',
          'opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity',
        )}
      >
        <select
          data-testid={`redact-region-reason-${index}`}
          aria-label={`Reason for region ${index + 1}`}
          value={region.reason}
          onChange={(e) => onSetReason(region.id, e.target.value as Reason)}
          onClick={(e) => e.stopPropagation()}
          className="h-6 rounded-input border border-border bg-white px-1 text-2xs shadow"
        >
          {REASON_OPTIONS.map((r) => (
            <option key={r} value={r}>{REASON_LABELS[r]}</option>
          ))}
        </select>
      </div>

      {/* Delete button */}
      <button
        type="button"
        data-testid={`redact-region-delete-${index}`}
        aria-label={`Delete region ${index + 1}`}
        onClick={(e) => { e.stopPropagation(); onRemove(region.id); }}
        className={cn(
          'absolute -top-3 -right-3 w-6 h-6 rounded-full z-20',
          'bg-danger text-white flex items-center justify-center',
          'opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity',
          'text-xs leading-none',
        )}
      >
        <X size={12} />
      </button>
    </div>
  );
}
