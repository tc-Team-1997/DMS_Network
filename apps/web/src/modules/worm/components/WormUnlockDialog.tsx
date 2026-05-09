/**
 * WormUnlockDialog — admin-only modal to remove a WORM lock.
 *
 * Rules (from contract §11):
 *   - Requires a reason text field (min 10 chars).
 *   - Confirm button enabled only when EITHER:
 *       a) worm_unlock_after has passed (unlock date in the past), OR
 *       b) the "legal hold lift" checkbox is checked.
 *   - Reason must be one of: legal_hold_released | retention_expired | error_correction
 *   - Minimum approver notes length: 10 characters.
 *
 * A11y:
 *   - dialog + aria-modal + aria-labelledby
 *   - Focus trap
 *   - ESC closes
 *   - aria-invalid on textarea when below minimum length
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X, LockOpen } from 'lucide-react';
import { Button } from '@/components/ui';
import { HttpError } from '@/lib/http';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import { unlockDocument } from '../api';
import { UnlockReasonSchema, type UnlockReason } from '../schemas';

interface WormUnlockDialogProps {
  documentId: number;
  documentName: string;
  /** ISO 8601 string, or null if no lock. Used to determine grace-period logic. */
  unlockAfter: string | null;
  onClose: () => void;
  onUnlocked: () => void;
}

const REASON_OPTIONS: Array<{ value: UnlockReason; labelKey: string }> = [
  { value: 'legal_hold_released', labelKey: 'worm.reason_legal_hold_released' },
  { value: 'retention_expired',   labelKey: 'worm.reason_retention_expired' },
  { value: 'error_correction',    labelKey: 'worm.reason_error_correction' },
];

const MIN_NOTES_LENGTH = 10;

export function WormUnlockDialog({
  documentId,
  documentName,
  unlockAfter,
  onClose,
  onUnlocked,
}: WormUnlockDialogProps) {
  const dialogId = useId();
  const titleId = `${dialogId}-title`;
  const notesId = `${dialogId}-notes`;
  const reasonId = `${dialogId}-reason`;
  const legalHoldId = `${dialogId}-legal-hold`;

  const [reason, setReason] = useState<UnlockReason | ''>('');
  const [notes, setNotes] = useState('');
  const [legalHoldLift, setLegalHoldLift] = useState(false);
  const [serverErr, setServerErr] = useState<string | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFocusRef = useRef<HTMLSelectElement>(null);

  const qc = useQueryClient();

  // Unlock-after gate: is the unlock date in the past?
  const unlockDatePassed = unlockAfter
    ? new Date(unlockAfter).getTime() <= Date.now()
    : false;

  // Confirm enabled when (date passed OR legal hold lift checked) AND notes valid
  const notesValid = notes.trim().length >= MIN_NOTES_LENGTH;
  const canConfirm = (unlockDatePassed || legalHoldLift) && notesValid && reason !== '';

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
          'button:not([disabled]), select:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
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
      const parsedReason = UnlockReasonSchema.parse(reason);
      return unlockDocument(documentId, parsedReason, notes.trim());
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['worm', 'status', documentId] });
      onUnlocked();
      onClose();
    },
    onError: (e: unknown) => {
      if (e instanceof HttpError && e.status === 409) {
        setServerErr(t('worm.error_dsar_conflict'));
      } else {
        setServerErr(
          e instanceof HttpError ? e.message : t('worm.error_generic'),
        );
      }
    },
  });

  const handleSubmit = useCallback(() => {
    if (!canConfirm || mutation.isPending) return;
    setServerErr(null);
    mutation.mutate();
  }, [canConfirm, mutation]);

  const unlockAfterFormatted = unlockAfter
    ? new Date(unlockAfter).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      })
    : null;

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
        data-testid="worm-unlock-dialog"
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
                <LockOpen size={15} aria-hidden="true" className="text-warning" />
                {t('worm.unlock_dialog_title')}
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
            {/* Unlock-after gate notice */}
            {!unlockDatePassed && unlockAfterFormatted && (
              <div className="rounded-input border border-warning/40 bg-warning-bg px-3 py-2 text-xs text-warning">
                {t('worm.unlock_grace_notice', { date: unlockAfterFormatted })}
              </div>
            )}

            {/* Reason select */}
            <div>
              <label
                htmlFor={reasonId}
                className="block text-xs font-semibold text-ink mb-1.5"
              >
                {t('worm.reason_label')}
              </label>
              <select
                ref={firstFocusRef}
                id={reasonId}
                data-testid="worm-unlock-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value as UnlockReason | '')}
                className={cn(
                  'w-full rounded-input border border-border bg-surface px-3 py-2 text-sm text-ink',
                  'focus:outline-none focus:ring-2 focus:ring-brand-blue',
                )}
              >
                <option value="" disabled>
                  {t('worm.reason_placeholder')}
                </option>
                {REASON_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {t(opt.labelKey)}
                  </option>
                ))}
              </select>
            </div>

            {/* Approver notes */}
            <div>
              <label
                htmlFor={notesId}
                className="block text-xs font-semibold text-ink mb-1.5"
              >
                {t('worm.notes_label')}
                <span className="text-danger ml-1" aria-hidden="true">*</span>
              </label>
              <textarea
                id={notesId}
                data-testid="worm-unlock-reason"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                aria-required="true"
                aria-invalid={notes.length > 0 && !notesValid}
                aria-describedby={`${notesId}-hint`}
                placeholder={t('worm.notes_placeholder')}
                className={cn(
                  'w-full rounded-input border border-border bg-surface px-3 py-2 text-sm text-ink resize-none',
                  'focus:outline-none focus:ring-2 focus:ring-brand-blue',
                  notes.length > 0 && !notesValid && 'border-warning',
                )}
              />
              <p id={`${notesId}-hint`} className="mt-1 text-xs text-muted">
                {notes.trim().length < MIN_NOTES_LENGTH
                  ? t('worm.notes_min_hint', { min: String(MIN_NOTES_LENGTH) })
                  : ''}
              </p>
            </div>

            {/* Legal hold lift override */}
            {!unlockDatePassed && (
              <label
                htmlFor={legalHoldId}
                className="flex items-start gap-2 cursor-pointer select-none"
              >
                <input
                  id={legalHoldId}
                  type="checkbox"
                  data-testid="worm-unlock-legal-hold-lift"
                  checked={legalHoldLift}
                  onChange={(e) => setLegalHoldLift(e.target.checked)}
                  className="mt-0.5 rounded border-border text-brand-blue focus:ring-brand-blue"
                />
                <span className="text-xs text-ink">
                  {t('worm.legal_hold_lift_label')}
                  <span className="block text-muted">{t('worm.legal_hold_lift_hint')}</span>
                </span>
              </label>
            )}

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
              data-testid="worm-unlock-submit"
              onClick={handleSubmit}
              disabled={!canConfirm}
              loading={mutation.isPending}
              aria-disabled={!canConfirm}
            >
              <LockOpen size={13} aria-hidden="true" />
              {t('worm.unlock_submit')}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
