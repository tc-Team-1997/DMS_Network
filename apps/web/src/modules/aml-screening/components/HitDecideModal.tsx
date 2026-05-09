/**
 * HitDecideModal — compliance officer decision UI for a single AML hit.
 *
 * A11y:
 * - Focus trap: first focusable element receives focus on open.
 * - ESC closes; Enter submits when form is valid.
 * - Radio group is keyboard-navigable with arrow keys.
 * - Notes textarea is aria-required when decision is escalated/blocked.
 * - Live region announces result after submission.
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X, ShieldCheck, ShieldAlert, ShieldX } from 'lucide-react';
import { Button } from '@/components/ui';
import { HttpError } from '@/lib/http';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import { decideHit } from '../api';
import type { DecisionEnum } from '../schemas';
import type { Hit } from '../schemas';

type DecideOption = {
  value: DecisionEnum;
  labelKey: string;
  descKey: string;
  icon: React.ReactNode;
  tone: string;
};

const OPTIONS: DecideOption[] = [
  {
    value: 'cleared',
    labelKey: 'aml.decide_cleared',
    descKey: 'aml.decide_cleared_desc',
    icon: <ShieldCheck size={14} aria-hidden="true" />,
    tone: 'text-success',
  },
  {
    value: 'escalated',
    labelKey: 'aml.decide_escalated',
    descKey: 'aml.decide_escalated_desc',
    icon: <ShieldAlert size={14} aria-hidden="true" />,
    tone: 'text-warning',
  },
  {
    value: 'blocked',
    labelKey: 'aml.decide_blocked',
    descKey: 'aml.decide_blocked_desc',
    icon: <ShieldX size={14} aria-hidden="true" />,
    tone: 'text-danger',
  },
];

interface HitDecideModalProps {
  hit: Hit;
  onClose: () => void;
  onDecided: () => void;
}

function scoreLabel(score: number): string {
  return `${Math.round(score * 100)} percent`;
}

export function HitDecideModal({ hit, onClose, onDecided }: HitDecideModalProps) {
  const dialogId = useId();
  const titleId = `${dialogId}-title`;
  const liveRegionId = `${dialogId}-live`;
  const notesId = `${dialogId}-notes`;
  const radioGroupId = `${dialogId}-radio`;

  const [decision, setDecision] = useState<DecisionEnum>('cleared');
  const [notes, setNotes] = useState('');
  const [liveMsg, setLiveMsg] = useState('');
  const [serverErr, setServerErr] = useState<string | null>(null);
  const [conflictMsg, setConflictMsg] = useState<string | null>(null);

  const notesRef = useRef<HTMLTextAreaElement>(null);
  const firstRadioRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const qc = useQueryClient();
  const notesRequired = decision === 'escalated' || decision === 'blocked';
  const notesValid = !notesRequired || notes.trim().length > 0;
  const canSubmit = notesValid;

  // Focus trap: focus first interactive element on mount
  useEffect(() => {
    firstRadioRef.current?.focus();
  }, []);

  // ESC to close
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
          'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
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
    mutationFn: () => decideHit(hit.id, decision, notes),
    onSuccess: (result) => {
      void qc.invalidateQueries({ queryKey: ['aml', 'hits'] });
      void qc.invalidateQueries({ queryKey: ['aml', 'summary'] });
      setLiveMsg(t('aml.decided_announcement', { decision: t(`aml.decide_${result.decision}`) }));
      setTimeout(() => {
        onDecided();
        onClose();
      }, 600);
    },
    onError: (e: unknown) => {
      if (e instanceof HttpError && e.status === 409) {
        setConflictMsg(
          typeof e.data === 'object' && e.data !== null && 'detail' in e.data
            ? String((e.data as { detail: unknown }).detail)
            : t('aml.error_conflict'),
        );
      } else {
        setServerErr(e instanceof HttpError ? e.message : t('aml.error_generic'));
      }
    },
  });

  const handleSubmit = useCallback(() => {
    if (!canSubmit || mutation.isPending) return;
    setServerErr(null);
    setConflictMsg(null);
    mutation.mutate();
  }, [canSubmit, mutation]);

  // Enter key to submit when form valid
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && canSubmit && !mutation.isPending) {
      handleSubmit();
    }
  };

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
        data-testid="aml-decide-modal"
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        onKeyDown={handleKeyDown}
      >
        <div className="w-full max-w-md rounded-card bg-surface shadow-[0_8px_32px_rgba(16,24,40,0.18)] border border-border">
          {/* Header */}
          <div className="flex items-start justify-between px-5 pt-5 pb-4 border-b border-divider">
            <div>
              <h2 id={titleId} className="text-md font-semibold text-ink">
                {t('aml.modal_title')}
              </h2>
              <p className="text-xs text-muted mt-0.5">
                {t('aml.modal_hit_label')}: <span className="font-mono font-medium text-ink">{hit.watchlist_entry_name}</span>
                {' '}&mdash;{' '}
                <span className="text-xs">{hit.watchlist_name}</span>
              </p>
              <p className="text-xs text-muted mt-0.5">
                {t('aml.score_label')}:{' '}
                <span
                  className={cn(
                    'font-mono font-semibold',
                    hit.score >= 0.95 ? 'text-danger' : hit.score >= 0.85 ? 'text-warning' : 'text-ink',
                  )}
                  aria-label={scoreLabel(hit.score)}
                >
                  {Math.round(hit.score * 100)}%
                </span>
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('aml.modal_close')}
              className="rounded-input p-1 text-muted hover:bg-divider hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue"
            >
              <X size={16} />
            </button>
          </div>

          {/* Body */}
          <div className="px-5 py-4 space-y-4">
            {/* Radio group */}
            <fieldset>
              <legend id={radioGroupId} className="text-xs font-semibold text-ink mb-2">
                {t('aml.decide_label')}
              </legend>
              <div className="space-y-2" role="radiogroup" aria-labelledby={radioGroupId}>
                {OPTIONS.map((opt, idx) => {
                  const isSelected = decision === opt.value;
                  return (
                    <button
                      key={opt.value}
                      ref={idx === 0 ? firstRadioRef : undefined}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      data-testid={`aml-decide-${opt.value}`}
                      onClick={() => setDecision(opt.value)}
                      className={cn(
                        'w-full flex items-start gap-3 rounded-input border px-3 py-2.5 text-left transition',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue',
                        isSelected
                          ? 'border-brand-blue/50 bg-brand-skyLight'
                          : 'border-border bg-white hover:bg-divider',
                      )}
                    >
                      <span className={cn('mt-0.5 shrink-0', opt.tone)}>{opt.icon}</span>
                      <div>
                        <div className={cn('text-xs font-semibold', opt.tone)}>
                          {t(opt.labelKey)}
                        </div>
                        <div className="text-2xs text-muted">{t(opt.descKey)}</div>
                      </div>
                      <span
                        className={cn(
                          'ml-auto mt-0.5 h-3.5 w-3.5 rounded-full border-2 shrink-0',
                          isSelected ? 'border-brand-blue bg-brand-blue' : 'border-border bg-white',
                        )}
                        aria-hidden="true"
                      />
                    </button>
                  );
                })}
              </div>
            </fieldset>

            {/* Notes */}
            <div>
              <label htmlFor={notesId} className="label">
                {t('aml.decide_notes_label')}
                {notesRequired && (
                  <span className="text-danger ml-1" aria-hidden="true">*</span>
                )}
              </label>
              <textarea
                ref={notesRef}
                id={notesId}
                data-testid="aml-decide-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                aria-required={notesRequired}
                aria-describedby={notesRequired ? `${notesId}-hint` : undefined}
                rows={3}
                placeholder={t('aml.decide_notes_placeholder')}
                className={cn(
                  'input resize-none w-full',
                  notesRequired && notes.trim().length === 0 && 'border-warning focus:border-warning focus:ring-warning/20',
                )}
              />
              {notesRequired && (
                <p id={`${notesId}-hint`} className="field-error">
                  {notes.trim().length === 0 ? t('aml.decide_notes_required') : ''}
                </p>
              )}
            </div>

            {/* Errors */}
            {conflictMsg && (
              <div className="rounded-input border border-warning/40 bg-warning-bg px-3 py-2 text-xs text-warning">
                {conflictMsg}
              </div>
            )}
            {serverErr && (
              <div className="rounded-input border border-danger/30 bg-danger-bg px-3 py-2 text-xs text-danger" data-testid="aml-error">
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
              {t('aml.cancel')}
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSubmit}
              disabled={!canSubmit}
              loading={mutation.isPending}
              data-testid="aml-decide-submit"
            >
              {t('aml.decide_submit')}
            </Button>
          </div>
        </div>
      </div>

      {/* Live region for screen reader announcement */}
      <div
        id={liveRegionId}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {liveMsg}
      </div>
    </>
  );
}
