import {
  useEffect,
  useRef,
  useId,
  type ReactNode,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';
import { X } from 'lucide-react';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Dialog width preset. Defaults to 'md'. */
  size?: ModalSize;
  /** Rendered in the dialog header. */
  title?: ReactNode;
  children: ReactNode;
  /** Dismiss the dialog when the backdrop is clicked. Defaults to true. */
  closeOnBackdropClick?: boolean;
}

const sizeClasses: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

/** All focusable element selectors. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function getFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE));
}

export function Modal({
  open,
  onClose,
  size = 'md',
  title,
  children,
  closeOnBackdropClick = true,
}: ModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  /** Element that had focus before the modal opened — restored on close. */
  const previousFocusRef = useRef<{ el: Element | null }>({ el: null });

  // Capture focus target on open; restore on close.
  useEffect(() => {
    if (open) {
      previousFocusRef.current.el = document.activeElement;
      requestAnimationFrame(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const focusable = getFocusable(dialog);
        (focusable[0] ?? dialog).focus();
      });
    } else {
      if (previousFocusRef.current.el instanceof HTMLElement) {
        previousFocusRef.current.el.focus();
      }
    }
  }, [open]);

  // Lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Escape key closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Tab') return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = getFocusable(dialog);
    if (focusable.length === 0) {
      e.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
  }

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={closeOnBackdropClick ? onClose : undefined}
    >
      {/* Scrim */}
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-sm" aria-hidden="true" />

      {/* Dialog panel */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title !== undefined ? titleId : undefined}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          'relative z-10 w-full rounded-card bg-surface shadow-card',
          sizeClasses[size],
          'focus:outline-none',
        )}
      >
        {/* Header */}
        {title !== undefined && (
          <div className="flex items-center justify-between border-b border-divider px-6 py-4">
            <h2 id={titleId} className="text-md font-semibold text-ink">
              {title}
            </h2>
            <button
              type="button"
              aria-label="Close dialog"
              onClick={onClose}
              className="rounded-input p-1 text-muted hover:text-ink focus:outline-none focus:ring-2 focus:ring-brand-blue"
            >
              <X size={16} />
            </button>
          </div>
        )}
        {/* Body */}
        <div className="p-6">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
