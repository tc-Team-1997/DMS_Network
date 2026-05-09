import {
  useEffect,
  useRef,
  type KeyboardEvent,
  type ReactNode,
  type TouchEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';
import { X } from 'lucide-react';

export type DrawerSide = 'right' | 'left' | 'bottom';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  side?: DrawerSide;
  title?: ReactNode;
  children: ReactNode;
  /** CSS width for left/right drawers. Defaults to '400px'. */
  width?: string;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusable(el: HTMLElement): HTMLElement[] {
  return Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE));
}

const panelClasses: Record<DrawerSide, string> = {
  right:  'fixed inset-y-0 right-0 flex flex-col bg-surface shadow-card border-l border-divider',
  left:   'fixed inset-y-0 left-0 flex flex-col bg-surface shadow-card border-r border-divider',
  bottom: 'fixed inset-x-0 bottom-0 flex flex-col bg-surface shadow-card border-t border-divider rounded-t-card',
};

export function Drawer({
  open,
  onClose,
  side = 'right',
  title,
  children,
  width = '400px',
}: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<{ el: Element | null }>({ el: null });

  // Focus management
  useEffect(() => {
    if (open) {
      previousFocusRef.current.el = document.activeElement;
      requestAnimationFrame(() => {
        const panel = panelRef.current;
        if (!panel) return;
        const focusable = getFocusable(panel);
        (focusable[0] ?? panel).focus();
      });
    } else {
      if (previousFocusRef.current.el instanceof HTMLElement) {
        previousFocusRef.current.el.focus();
      }
    }
  }, [open]);

  // Body scroll lock
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // Escape key
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Focus trap
  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = getFocusable(panel);
    if (focusable.length === 0) { e.preventDefault(); return; }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) { e.preventDefault(); last?.focus(); }
    } else {
      if (document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }
  }

  // Bottom drawer: swipe-to-dismiss
  const touchStartY = useRef<number>(0);
  function handleTouchStart(e: TouchEvent<HTMLDivElement>) {
    touchStartY.current = e.touches[0]?.clientY ?? 0;
  }
  function handleTouchEnd(e: TouchEvent<HTMLDivElement>) {
    const endY = e.changedTouches[0]?.clientY ?? 0;
    if (endY - touchStartY.current > 80) onClose();
  }

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50">
      {/* Scrim */}
      <div
        className="absolute inset-0 bg-ink/40 backdrop-blur-sm"
        aria-hidden="true"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        onTouchStart={side === 'bottom' ? handleTouchStart : undefined}
        onTouchEnd={side === 'bottom' ? handleTouchEnd : undefined}
        style={side !== 'bottom' ? { width } : undefined}
        className={cn(panelClasses[side], 'focus:outline-none z-10')}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-divider px-5 py-4">
          {title !== undefined ? (
            <span className="text-md font-semibold text-ink">{title}</span>
          ) : (
            <span />
          )}
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="rounded-input p-1 text-muted hover:text-ink focus:outline-none focus:ring-2 focus:ring-brand-blue"
          >
            <X size={16} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
