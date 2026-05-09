import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';
import { eventBus } from '@/lib/events';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SourceSpan {
  text: string;
  page: number;
  bbox?: { x: number; y: number; w: number; h: number };
}

export interface AiConfidenceBadgeProps {
  confidence: number;
  model: string;
  promptId: string;
  sourceSpan: SourceSpan;
  documentId: string;
  /** Called when the reviewer clicks "Override". The caller owns the edit surface. */
  onOverride?: () => void;
  /** Called when the reviewer confirms the AI value is correct. */
  onConfirm?: () => void;
}

// ─── Confidence band helpers ──────────────────────────────────────────────────

type Band = 'low' | 'medium' | 'high' | 'excellent';

function getBand(confidence: number): Band {
  if (confidence < 40) return 'low';
  if (confidence < 70) return 'medium';
  if (confidence < 90) return 'high';
  return 'excellent';
}

const bandStyles: Record<Band, { badge: string; dot: string; label: string }> = {
  low:       { badge: 'bg-danger-bg text-danger',           dot: 'bg-danger',        label: 'Low confidence' },
  medium:    { badge: 'bg-warning-bg text-warning',         dot: 'bg-warning',       label: 'Medium confidence' },
  high:      { badge: 'bg-brand-skyLight text-brand-blue',  dot: 'bg-brand-sky',     label: 'High confidence' },
  excellent: { badge: 'bg-success-bg text-success',         dot: 'bg-success',       label: 'Excellent confidence' },
};

// ─── Popover positioning ──────────────────────────────────────────────────────

function getPopoverCoords(
  trigger: DOMRect,
  scrollX: number,
  scrollY: number,
): { top: number; left: number } {
  return {
    top: trigger.bottom + scrollY + 8,
    left: Math.max(8, trigger.left + scrollX + trigger.width / 2 - 160),
  };
}

// ─── Component ───────────────────────────────────────────────────────────────

export function AiConfidenceBadge({
  confidence,
  model,
  promptId,
  sourceSpan,
  documentId,
  onOverride,
  onConfirm,
}: AiConfidenceBadgeProps) {
  const band = getBand(confidence);
  const styles = bandStyles[band];
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  function openPopover() {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (rect !== undefined) {
      setCoords(getPopoverCoords(rect, window.scrollX, window.scrollY));
    }
    setOpen(true);
  }

  function closePopover() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function handleShowInDocument() {
    const bbox = sourceSpan.bbox;
    eventBus.emit({
      type: 'viewer:scroll-to-span',
      payload: {
        documentId,
        span: {
          page: sourceSpan.page,
          ...(bbox !== undefined
            ? { x: bbox.x, y: bbox.y, w: bbox.w, h: bbox.h }
            : {}),
        },
      },
    });
    closePopover();
  }

  function handleConfirm() {
    onConfirm?.();
    closePopover();
  }

  function handleOverride() {
    onOverride?.();
    closePopover();
  }

  // ESC + click-outside
  function handlePopoverKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') closePopover();
  }

  // Close on click outside
  function handleBackdropPointerDown(e: React.PointerEvent) {
    if (
      !popoverRef.current?.contains(e.target as Node) &&
      !triggerRef.current?.contains(e.target as Node)
    ) {
      closePopover();
    }
  }

  const pct = Math.round(Math.max(0, Math.min(100, confidence)));

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={`AI confidence ${pct}% — ${styles.label}. Click to view details.`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={open ? closePopover : openPopover}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-badge px-2.5 py-1 text-xs font-medium',
          'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue focus-visible:ring-offset-1',
          'transition-opacity hover:opacity-80',
          styles.badge,
        )}
      >
        {/* Single restrained indicator dot — no animation */}
        <span
          aria-hidden="true"
          className={cn('h-1.5 w-1.5 rounded-full shrink-0', styles.dot)}
        />
        <span>AI · {pct}%</span>
      </button>

      {open &&
        createPortal(
          <>
            {/* Invisible backdrop to handle click-outside */}
            <div
              className="fixed inset-0 z-40"
              aria-hidden="true"
              onPointerDown={handleBackdropPointerDown}
            />
            <div
              ref={popoverRef}
              role="dialog"
              aria-modal="false"
              aria-label="AI confidence details"
              onKeyDown={handlePopoverKeyDown}
              className={cn(
                'fixed z-50 w-80 rounded-card border border-divider bg-surface p-4 shadow-card',
              )}
              style={{ top: coords.top, left: coords.left }}
            >
              {/* Header row */}
              <div className="mb-3 flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold text-ink-sub uppercase tracking-wide">
                    AI Confidence
                  </p>
                  <p className={cn('text-xl font-bold tabular', styles.badge.includes('success') ? 'text-success' : styles.badge.includes('warning') ? 'text-warning' : styles.badge.includes('danger') ? 'text-danger' : 'text-brand-blue')}>
                    {pct}%
                  </p>
                </div>
                <span
                  className={cn(
                    'inline-flex items-center rounded-badge px-2 py-0.5 text-2xs font-semibold',
                    styles.badge,
                  )}
                >
                  {styles.label}
                </span>
              </div>

              {/* Source span */}
              <div className="mb-3 rounded-input border border-divider bg-divider/50 p-3">
                <p className="mb-1 text-2xs font-semibold uppercase tracking-wide text-muted">
                  Source excerpt · page {sourceSpan.page}
                </p>
                <p className="text-xs text-ink line-clamp-3">
                  &ldquo;{sourceSpan.text}&rdquo;
                </p>
              </div>

              {/* Metadata */}
              <dl className="mb-4 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                <dt className="text-muted">Model</dt>
                <dd className="font-mono text-ink truncate" title={model}>{model}</dd>
                <dt className="text-muted">Prompt ID</dt>
                <dd className="font-mono text-ink truncate" title={promptId}>{promptId}</dd>
              </dl>

              {/* Action buttons */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleConfirm}
                  className={cn(
                    'flex-1 rounded-input border border-success bg-success-bg px-3 py-1.5 text-xs font-medium text-success',
                    'hover:bg-success/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-success focus-visible:ring-offset-1',
                    'transition-colors',
                  )}
                >
                  Confirm
                </button>
                {onOverride !== undefined && (
                  <button
                    type="button"
                    onClick={handleOverride}
                    className={cn(
                      'flex-1 rounded-input border border-warning bg-warning-bg px-3 py-1.5 text-xs font-medium text-warning',
                      'hover:bg-warning/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-warning focus-visible:ring-offset-1',
                      'transition-colors',
                    )}
                  >
                    Override
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleShowInDocument}
                  className={cn(
                    'flex-1 rounded-input border border-border bg-surface px-3 py-1.5 text-xs font-medium text-ink-sub',
                    'hover:bg-divider focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue focus-visible:ring-offset-1',
                    'transition-colors',
                  )}
                >
                  Show in doc
                </button>
              </div>
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
