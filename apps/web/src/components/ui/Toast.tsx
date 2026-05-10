import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/cn';
import { X, CheckCircle, AlertCircle, AlertTriangle, Info } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: string;
  variant: ToastVariant;
  title: string;
  message?: string;
  /** Auto-dismiss after this many ms. 0 = never. Defaults to 4000. */
  duration?: number;
}

interface UseToast {
  /** Fire a toast. Returns its generated id. */
  toast: (item: Omit<ToastItem, 'id'>) => string;
  /** Manually dismiss a toast by id. */
  dismiss: (id: string) => void;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const ToastContext = createContext<UseToast | null>(null);

export function useToast(): UseToast {
  const ctx = useContext(ToastContext);
  if (ctx === null) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

// ─── Individual toast ─────────────────────────────────────────────────────────

const variantStyles: Record<ToastVariant, string> = {
  success: 'border-success/30 bg-success-bg',
  error:   'border-danger/30 bg-danger-bg',
  warning: 'border-warning/30 bg-warning-bg',
  info:    'border-brand-sky/30 bg-brand-skyLight',
};

const iconMap: Record<ToastVariant, ReactNode> = {
  success: <CheckCircle size={16} className="text-success" />,
  error:   <AlertCircle size={16} className="text-danger" />,
  warning: <AlertTriangle size={16} className="text-warning" />,
  info:    <Info size={16} className="text-brand-sky" />,
};

const titleStyles: Record<ToastVariant, string> = {
  success: 'text-success',
  error:   'text-danger',
  warning: 'text-warning',
  info:    'text-brand-blue',
};

const DEFAULT_DURATION = 4_000;
const MAX_TOASTS = 5;

interface SingleToastProps {
  item: ToastItem;
  onDismiss: (id: string) => void;
}

function SingleToast({ item, onDismiss }: SingleToastProps) {
  const duration = item.duration ?? DEFAULT_DURATION;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const remainingRef = useRef<number>(duration);
  const startRef = useRef<number>(Date.now());

  const startTimer = useCallback(() => {
    if (duration === 0) return;
    timerRef.current = setTimeout(() => onDismiss(item.id), remainingRef.current);
    startRef.current = Date.now();
  }, [duration, item.id, onDismiss]);

  const pauseTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
      remainingRef.current = Math.max(0, remainingRef.current - (Date.now() - startRef.current));
    }
  }, []);

  useEffect(() => {
    startTimer();
    return () => { if (timerRef.current !== null) clearTimeout(timerRef.current); };
  // startTimer identity is stable due to useCallback; safe dep.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      className={cn(
        'flex w-80 items-start gap-3 rounded-card border p-4 shadow-card',
        variantStyles[item.variant],
      )}
      onMouseEnter={pauseTimer}
      onMouseLeave={startTimer}
    >
      <span className="mt-0.5 shrink-0">{iconMap[item.variant]}</span>
      <div className="flex-1 min-w-0">
        <p className={cn('text-sm font-semibold leading-snug', titleStyles[item.variant])}>
          {item.title}
        </p>
        {item.message !== undefined && (
          <p className="mt-0.5 text-xs text-ink-sub">{item.message}</p>
        )}
      </div>
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={() => onDismiss(item.id)}
        className="shrink-0 rounded p-0.5 text-muted hover:text-ink focus:outline-none focus:ring-2 focus:ring-brand-blue"
      >
        <X size={14} />
      </button>
    </div>
  );
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((item: Omit<ToastItem, 'id'>): string => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((prev) => {
      const next = [{ ...item, id }, ...prev];
      // Keep newest MAX_TOASTS; discard oldest.
      return next.slice(0, MAX_TOASTS);
    });
    return id;
  }, []);

  return (
    <ToastContext.Provider value={{ toast, dismiss }}>
      {children}
      {createPortal(
        <div
          role="region"
          aria-label="Notifications"
          aria-live="polite"
          aria-atomic="false"
          className="fixed right-4 top-4 z-[60] flex flex-col gap-2"
        >
          {toasts.map((item) => (
            <SingleToast key={item.id} item={item} onDismiss={dismiss} />
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}
