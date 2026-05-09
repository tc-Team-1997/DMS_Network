/**
 * CbsLinkDocumentDialog — modal to link a captured DMS document to a T24 transaction.
 *
 * A11y:
 * - Focus trap; ESC closes; first input focused on open.
 * - All form fields have visible labels + aria-describedby.
 * - Success/error states announced via aria-live.
 *
 * Idempotency: same submission twice returns the same link_id (server-side).
 * The UI surfaces the success state without flicker on duplicate submit.
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { useMutation } from '@tanstack/react-query';
import { X, CheckCircle2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui';
import { HttpError } from '@/lib/http';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import { linkDocumentToCbs } from '../api';
import { TransactionTypeEnum } from '../schemas';

// ── Transaction type options ──────────────────────────────────────────────

const TX_TYPES = TransactionTypeEnum.options;

// ── Error map ─────────────────────────────────────────────────────────────

function mapLinkError(err: unknown): string {
  if (!(err instanceof HttpError)) return t('cbs.error_network');
  switch (err.status) {
    case 400: return t('cbs.error_link_invalid');
    case 403: return t('cbs.error_forbidden');
    case 404: return t('cbs.error_not_found');
    case 409: return t('cbs.error_link_conflict');
    case 429: return t('cbs.error_rate_limited', { s: '?' });
    case 502: return t('cbs.error_proxy');
    case 503: return t('cbs.error_unavailable');
    case 504: return t('cbs.error_timeout');
    default:  return t('cbs.error_generic');
  }
}

// ── Component ─────────────────────────────────────────────────────────────

export interface CbsLinkDocumentDialogProps {
  cif: string;
  documentId: number;
  onClose: () => void;
  /** Called after a successful link. */
  onLinked?: (transactionRef: string) => void;
}

export function CbsLinkDocumentDialog({
  cif,
  documentId,
  onClose,
  onLinked,
}: CbsLinkDocumentDialogProps) {
  const dialogId   = useId();
  const titleId    = `${dialogId}-title`;
  const liveId     = `${dialogId}-live`;
  const refHintId  = `${dialogId}-ref-hint`;

  const [txRef, setTxRef]   = useState('');
  const [txType, setTxType] = useState<typeof TX_TYPES[number]>(TX_TYPES[0] ?? 'loan_disbursement');
  const [refErr, setRefErr] = useState<string | null>(null);
  const [liveMsg, setLiveMsg] = useState('');
  const [succeeded, setSucceeded] = useState(false);

  const firstInputRef = useRef<HTMLInputElement>(null);
  const dialogRef     = useRef<HTMLDivElement>(null);

  // Focus first input on open
  useEffect(() => {
    firstInputRef.current?.focus();
  }, []);

  // ESC closes (unless success already achieved)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // Focus trap within dialog
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last  = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last)  { e.preventDefault(); first.focus(); }
      }
    };
    dialog.addEventListener('keydown', handler);
    return () => dialog.removeEventListener('keydown', handler);
  }, []);

  const link = useMutation({
    mutationFn: () =>
      linkDocumentToCbs(cif, {
        document_id:      documentId,
        transaction_ref:  txRef.trim(),
        transaction_type: txType,
      }),
    onSuccess: (result) => {
      setSucceeded(true);
      setLiveMsg(t('cbs.link_success_announce', { ref: result.transaction_ref }));
      onLinked?.(result.transaction_ref);
      // Optimistic close after brief delay so screen reader can read the message
      setTimeout(onClose, 1_200);
    },
    onError: (err: unknown) => {
      setLiveMsg(mapLinkError(err));
    },
  });

  const handleSubmit = useCallback(() => {
    const trimmed = txRef.trim();
    if (!trimmed) {
      setRefErr(t('cbs.error_ref_required'));
      return;
    }
    setRefErr(null);
    link.mutate();
  }, [txRef, link]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSubmit();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      data-testid="cbs-link-dialog"
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]"
        aria-hidden="true"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        ref={dialogRef}
        className="relative z-10 w-full max-w-md rounded-card bg-surface shadow-card"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-divider px-5 py-4">
          <h2 id={titleId} className="text-md font-semibold text-ink">
            {t('cbs.link_title')}
          </h2>
          <button
            type="button"
            aria-label={t('cbs.close')}
            onClick={onClose}
            className="rounded-input p-1 text-muted hover:bg-divider hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-4 px-5 py-4">
          {/* Live region */}
          <span id={liveId} aria-live="polite" aria-atomic="true" className="sr-only">
            {liveMsg}
          </span>

          {/* Success state */}
          {succeeded && (
            <div
              data-testid="cbs-link-success-toast"
              className="flex items-center gap-2 rounded-input border border-success/30 bg-success/10 px-3 py-2"
            >
              <CheckCircle2 size={14} className="shrink-0 text-success" aria-hidden="true" />
              <p className="text-xs text-success">
                {t('cbs.link_success_announce', { ref: txRef })}
              </p>
            </div>
          )}

          {/* Error banner */}
          {link.isError && !succeeded && (
            <div
              data-testid="cbs-error"
              className="flex items-start gap-2 rounded-input border border-danger/30 bg-danger/10 px-3 py-2"
            >
              <AlertCircle size={14} className="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
              <p className="text-xs text-danger">{mapLinkError(link.error)}</p>
            </div>
          )}

          {/* Transaction ref */}
          <div>
            <label htmlFor={`${dialogId}-ref`} className="label">
              {t('cbs.link_ref_label')}
            </label>
            <input
              ref={firstInputRef}
              id={`${dialogId}-ref`}
              data-testid="cbs-link-transaction-ref"
              type="text"
              name="transaction_ref"
              value={txRef}
              maxLength={128}
              autoComplete="off"
              disabled={succeeded || link.isPending}
              aria-describedby={`${refHintId}${refErr ? ` ${dialogId}-ref-err` : ''}`}
              aria-invalid={refErr !== null}
              onChange={(e) => { setTxRef(e.target.value); setRefErr(null); }}
              onKeyDown={handleKeyDown}
              className={cn(
                'input mt-1',
                refErr && 'border-danger focus:border-danger focus:ring-danger/20',
              )}
              placeholder={t('cbs.link_ref_placeholder')}
            />
            <span id={refHintId} className="mt-0.5 block text-xs text-muted">
              {t('cbs.link_ref_hint')}
            </span>
            {refErr && (
              <span
                id={`${dialogId}-ref-err`}
                role="alert"
                className="mt-0.5 block text-xs text-danger"
              >
                {refErr}
              </span>
            )}
          </div>

          {/* Transaction type */}
          <div>
            <label htmlFor={`${dialogId}-type`} className="label">
              {t('cbs.link_type_label')}
            </label>
            <select
              id={`${dialogId}-type`}
              data-testid="cbs-link-transaction-type"
              name="transaction_type"
              value={txType}
              disabled={succeeded || link.isPending}
              onChange={(e) => setTxType(e.target.value as typeof txType)}
              className="input mt-1 cursor-pointer"
            >
              {TX_TYPES.map((opt) => (
                <option key={opt} value={opt}>
                  {t(`cbs.tx_type_${opt}`)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-divider px-5 py-3">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={link.isPending}>
            {t('cbs.cancel')}
          </Button>
          <Button
            data-testid="cbs-link-submit"
            size="sm"
            onClick={handleSubmit}
            loading={link.isPending}
            disabled={succeeded}
          >
            {t('cbs.link_submit')}
          </Button>
        </div>
      </div>
    </div>
  );
}
