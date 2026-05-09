/**
 * WormLockDialog — admin-only modal to place a document under WORM lock.
 *
 * Flow:
 *   1. Admin picks a retention period from a preset dropdown.
 *   2. Confirms via "Lock document" button.
 *   3. POST /spa/api/worm/{id}/lock → invalidates worm status query.
 *
 * A11y:
 *   - dialog + aria-modal + aria-labelledby
 *   - Focus trap (Tab / Shift+Tab cycle within modal)
 *   - ESC closes
 *   - Confirmation button aria-disabled until selection is non-empty
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Lock } from 'lucide-react';
import { Button } from '@/components/ui';
import { HttpError } from '@/lib/http';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import { lockDocument } from '../api';
import { RetentionPeriodSchema, type RetentionPeriod } from '../schemas';

interface WormLockDialogProps {
  documentId: number;
  documentName: string;
  onClose: () => void;
  onLocked: () => void;
}

const PERIOD_OPTIONS: Array<{ value: RetentionPeriod; labelKey: string }> = [
  { value: '30_days',    labelKey: 'worm.period_30_days' },
  { value: '90_days',    labelKey: 'worm.period_90_days' },
  { value: '1_year',     labelKey: 'worm.period_1_year' },
  { value: '7_years',    labelKey: 'worm.period_7_years' },
  { value: 'indefinite', labelKey: 'worm.period_indefinite' },
];

export function WormLockDialog({
  documentId,
  documentName,
  onClose,
  onLocked,
}: WormLockDialogProps) {
  const dialogId = useId();
  const titleId = `${dialogId}-title`;
  const selectId = `${dialogId}-period`;

  const [period, setPeriod] = useState<RetentionPeriod | ''>('');
  const [serverErr, setServerErr] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFocusRef = useRef<HTMLSelectElement>(null);

  const qc = useQueryClient();

  const canSubmit = period !== '';

  // Auto-focus the select on mount
  useEffect(() => {
    firstFocusRef.current?.focus();
  }, []);

  // ESC closes
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // Focus trap
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    dialog.addEventListener('keydown', handler);
    return () => dialog.removeEventListener('keydown', handler);
  }, []);

  const mutation = useMutation({
    mutationFn: () => {
      const parsed = RetentionPeriodSchema.parse(period);
      return lockDocument(documentId, parsed);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['worm', 'status', documentId] });
      onLocked();
      onClose();
    },
    onError: (e: unknown) => {
      setServerErr(
        e instanceof HttpError ? e.message : t('worm.error_generic'),
      );
    },
  });

  const handleSubmit = useCallback(() => {
    if (!canSubmit || mutation.isPending) return;
    setServerErr(null);
    mutation.mutate();
  }, [canSubmit, mutation]);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-ink/40"
        aria-hidden="true"
        onClick={onClose}
      />

      {/* Dialog */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="worm-lock-dialog"
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
      >
        <div className="w-full max-w-md rounded-card bg-surface shadow-[0_8px_32px_rgba(16,24,40,0.18)] border border-border">
          {/* Header */}
          <div className="flex items-start justify-between px-5 pt-5 pb-4 border-b border-divider">
            <div>
              <h2
                id={titleId}
                className="text-md font-semibold text-ink inline-flex items-center gap-1.5"
              >
                <Lock size={15} aria-hidden="true" className="text-danger" />
                {t('worm.lock_dialog_title')}
              </h2>
              <p className="text-xs text-muted mt-0.5 truncate max-w-[320px]">
                {documentName}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('worm.close')}
              className="rounded-input p-1 text-muted hover:bg-divider hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue"
            >
              <X size={16} />
            </button>
          </div>

          {/* Body */}
          <div className="px-5 py-4 space-y-4">
            <p className="text-xs text-muted">
              {t('worm.lock_dialog_warning')}
            </p>

            <div>
              <label
                htmlFor={selectId}
                className="block text-xs font-semibold text-ink mb-1.5"
              >
                {t('worm.period_label')}
              </label>
              <select
                ref={firstFocusRef}
                id={selectId}
                data-testid="worm-lock-period"
                value={period}
                onChange={(e) => setPeriod(e.target.value as RetentionPeriod | '')}
                className={cn(
                  'w-full rounded-input border border-border bg-surface px-3 py-2 text-sm text-ink',
                  'focus:outline-none focus:ring-2 focus:ring-brand-blue',
                )}
              >
                <option value="" disabled>
                  {t('worm.period_placeholder')}
                </option>
                {PERIOD_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {t(opt.labelKey)}
                  </option>
                ))}
              </select>
            </div>

            {serverErr && (
              <div
                role="alert"
                className="rounded-input border border-danger/30 bg-danger-bg px-3 py-2 text-xs text-danger"
              >
                {serverErr}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-2 px-5 pb-5 pt-2 border-t border-divider">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClose}
              disabled={mutation.isPending}
            >
              {t('worm.cancel')}
            </Button>
            <Button
              type="button"
              variant="danger"
              size="sm"
              data-testid="worm-lock-submit"
              onClick={handleSubmit}
              disabled={!canSubmit}
              loading={mutation.isPending}
              aria-disabled={!canSubmit}
            >
              <Lock size={13} aria-hidden="true" />
              {t('worm.lock_submit')}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
