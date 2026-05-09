/**
 * SuppressionDialog — Cleared + Suppress action.
 *
 * Collects:
 *   - reason         (≥ 20 chars, required)
 *   - suppress_days  (0 = permanent, or 30/60/90/180/365 from a select)
 *
 * Calls suppressHit() then notifies onSuppressed.
 * Rendered as a second-layer modal (z-60) on top of HitDecideV2Modal.
 */

import { useState, useId, useEffect, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { X, Clock } from 'lucide-react';
import { Button } from '@/components/ui';
import { HttpError } from '@/lib/http';
import { t } from '@/lib/i18n';
import { suppressHit } from '../api';

interface SuppressionDialogProps {
  hitId: number;
  onClose: () => void;
  onSuppressed: () => void;
}

const MIN_REASON = 20;

const DURATION_OPTIONS: Array<{ label: string; days: number }> = [
  { label: 'Permanent',  days: 0   },
  { label: '30 days',    days: 30  },
  { label: '60 days',    days: 60  },
  { label: '90 days',    days: 90  },
  { label: '180 days',   days: 180 },
  { label: '365 days',   days: 365 },
];

export function SuppressionDialog({
  hitId,
  onClose,
  onSuppressed,
}: SuppressionDialogProps) {
  const dialogId  = useId();
  const titleId   = `${dialogId}-title`;
  const dialogRef = useRef<HTMLDivElement>(null);

  const [reason,      setReason]      = useState('');
  const [suppressDays, setSuppressDays] = useState(90);
  const [serverErr,   setServerErr]   = useState<string | null>(null);

  const reasonOk = reason.trim().length >= MIN_REASON;

  // Focus the textarea on open
  useEffect(() => {
    const el = dialogRef.current?.querySelector<HTMLTextAreaElement>('textarea');
    el?.focus();
  }, []);

  // ESC closes
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  const mutation = useMutation({
    mutationFn: () =>
      suppressHit(hitId, reason.trim(), suppressDays === 0 ? undefined : suppressDays),
    onSuccess: () => {
      onSuppressed();
    },
    onError: (e: unknown) => {
      setServerErr(
        e instanceof HttpError ? e.message : t('aml.error_generic'),
      );
    },
  });

  return (
    <>
      {/* Backdrop (above the parent modal backdrop z-40, below z-60 dialog) */}
      <div
        className="fixed inset-0 z-50 bg-ink/30"
        aria-hidden="true"
        onClick={onClose}
      />

      {/* Dialog */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="aml-suppression-dialog"
        className="fixed inset-0 z-60 flex items-center justify-center p-4"
      >
        <div className="w-full max-w-sm rounded-card bg-surface shadow-[0_8px_32px_rgba(16,24,40,0.22)] border border-border">

          {/* Header */}
          <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-divider">
            <h2 id={titleId} className="text-sm font-semibold text-ink flex items-center gap-2">
              <Clock size={14} className="text-brand-blue" aria-hidden="true" />
              {t('aml.v2.suppress_dialog_title')}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('aml.modal_close')}
              className="rounded-input p-1 text-muted hover:bg-divider hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue"
            >
              <X size={14} />
            </button>
          </div>

          {/* Body */}
          <div className="px-4 py-4 space-y-4">
            {/* Duration picker */}
            <div>
              <label className="label block mb-1" htmlFor={`${dialogId}-duration`}>
                {t('aml.v2.suppress_duration_label')}
              </label>
              <select
                id={`${dialogId}-duration`}
                value={suppressDays}
                onChange={(e) => setSuppressDays(Number(e.target.value))}
                className="input w-full"
              >
                {DURATION_OPTIONS.map((opt) => (
                  <option key={opt.days} value={opt.days}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Reason */}
            <div>
              <label className="label block mb-1" htmlFor={`${dialogId}-reason`}>
                {t('aml.v2.suppress_reason_label')}
                <span className="text-danger ml-1" aria-hidden="true">*</span>
                <span className="ml-1 font-normal text-muted">
                  ({reason.trim().length}/{MIN_REASON} min)
                </span>
              </label>
              <textarea
                id={`${dialogId}-reason`}
                data-testid="aml-suppress-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder={t('aml.v2.suppress_reason_placeholder')}
                className="input resize-none w-full"
                aria-required="true"
              />
            </div>

            {serverErr && (
              <div className="rounded-input border border-danger/30 bg-danger-bg px-3 py-2 text-xs text-danger" role="alert">
                {serverErr}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-4 pb-4 flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClose}
              disabled={mutation.isPending}
            >
              {t('aml.cancel')}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!reasonOk || mutation.isPending}
              onClick={() => { setServerErr(null); mutation.mutate(); }}
              data-testid="aml-suppress-submit"
            >
              {mutation.isPending ? t('aml.loading') : t('aml.v2.suppress_submit_button')}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
