/**
 * PiiRevealField — shows a masked PII value with a "Reveal" button.
 *
 * When the user clicks Reveal, a modal asks for a reason (≥ 20 chars).
 * On success, the unmasked value is shown for 60 seconds (TTL from server).
 *
 * The component is self-contained. It does NOT share reveal state with siblings
 * — each field has its own TTL timer and masked/revealed UI.
 *
 * Props:
 *   field       — one of: 'phone' | 'email' | 'national_id' | 'dob'
 *   maskedValue — value to show while masked (may be partially visible: "+X ••••")
 *   cid         — customer CID for the reveal API call
 *   onRevealed  — called with the unmasked value string once revealed
 */

import { useState, useEffect, useId } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Eye, EyeOff, X } from 'lucide-react';
import { Button } from '@/components/ui';
import { HttpError } from '@/lib/http';
import { t } from '@/lib/i18n';
import { revealPii } from '../api';

interface PiiRevealFieldProps {
  field:       'phone' | 'email' | 'national_id' | 'dob';
  maskedValue: string | null | undefined;
  cid:         string;
  label:       string;
}

const MIN_REASON = 20;
const REVEAL_TTL_MS = 60_000; // 60 s

export function PiiRevealField({ field, maskedValue, cid, label }: PiiRevealFieldProps) {
  const dialogId = useId();

  const [revealedValue, setRevealedValue] = useState<string | null>(null);
  const [showReasonDialog, setShowReasonDialog] = useState(false);
  const [reason, setReason] = useState('');
  const [serverErr, setServerErr] = useState<string | null>(null);

  // TTL countdown — auto-mask after 60 s
  useEffect(() => {
    if (!revealedValue) return;
    const timer = setTimeout(() => setRevealedValue(null), REVEAL_TTL_MS);
    return () => clearTimeout(timer);
  }, [revealedValue]);

  const revealMutation = useMutation({
    mutationFn: () => revealPii(cid, [field], reason.trim()),
    onSuccess: (data) => {
      const value = data.revealed[field];
      setRevealedValue(typeof value === 'string' ? value : null);
      setShowReasonDialog(false);
      setReason('');
    },
    onError: (e: unknown) => {
      setServerErr(e instanceof HttpError ? e.message : t('customer360.error_generic'));
    },
  });

  const reasonOk = reason.trim().length >= MIN_REASON;

  return (
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0">
        <dt className="text-2xs text-muted font-medium">{label}</dt>
        <dd className="text-xs text-ink font-mono truncate" aria-label={revealedValue ? `${label}: ${revealedValue}` : `${label}: masked`}>
          {revealedValue ?? maskedValue ?? '—'}
        </dd>
      </div>

      <div className="shrink-0">
        {revealedValue ? (
          <button
            type="button"
            onClick={() => setRevealedValue(null)}
            aria-label={t('customer360.mask_button_aria', { field: label })}
            className="p-1 rounded-input text-muted hover:text-ink hover:bg-divider focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue"
            title={t('customer360.mask_now')}
          >
            <EyeOff size={12} aria-hidden="true" />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => { setServerErr(null); setShowReasonDialog(true); }}
            aria-label={t('customer360.reveal_button_aria', { field: label })}
            className="p-1 rounded-input text-muted hover:text-brand-blue hover:bg-brand-skyLight/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue"
            title={t('customer360.reveal_button')}
          >
            <Eye size={12} aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Reason dialog */}
      {showReasonDialog && (
        <>
          <div
            className="fixed inset-0 z-70 bg-ink/30"
            aria-hidden="true"
            onClick={() => setShowReasonDialog(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${dialogId}-title`}
            className="fixed inset-0 z-80 flex items-center justify-center p-4"
          >
            <div className="w-full max-w-sm rounded-card bg-surface shadow-[0_8px_32px_rgba(16,24,40,0.22)] border border-border">

              <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-divider">
                <h2 id={`${dialogId}-title`} className="text-sm font-semibold text-ink flex items-center gap-2">
                  <Eye size={13} className="text-brand-blue" aria-hidden="true" />
                  {t('customer360.reveal_dialog_title', { field: label })}
                </h2>
                <button
                  type="button"
                  onClick={() => setShowReasonDialog(false)}
                  aria-label={t('customer360.close')}
                  className="rounded-input p-1 text-muted hover:bg-divider hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue"
                >
                  <X size={14} />
                </button>
              </div>

              <div className="px-4 py-4 space-y-3">
                <p className="text-xs text-muted">
                  {t('customer360.reveal_dialog_body')}
                </p>

                <div>
                  <label className="label block mb-1" htmlFor={`${dialogId}-reason`}>
                    {t('customer360.reveal_reason_label')}
                    <span className="text-danger ml-1" aria-hidden="true">*</span>
                    <span className="ml-1 font-normal text-muted">
                      ({reason.trim().length}/{MIN_REASON} min)
                    </span>
                  </label>
                  <textarea
                    id={`${dialogId}-reason`}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={3}
                    placeholder={t('customer360.reveal_reason_placeholder')}
                    className="input resize-none w-full text-xs"
                    aria-required="true"
                  />
                </div>

                {serverErr && (
                  <div className="rounded-input border border-danger/30 bg-danger-bg px-3 py-2 text-xs text-danger" role="alert">
                    {serverErr}
                  </div>
                )}
              </div>

              <div className="px-4 pb-4 flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowReasonDialog(false)}
                  disabled={revealMutation.isPending}
                >
                  {t('customer360.cancel')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={!reasonOk || revealMutation.isPending}
                  onClick={() => { setServerErr(null); revealMutation.mutate(); }}
                  data-testid={`pii-reveal-submit-${field}`}
                >
                  {revealMutation.isPending ? t('customer360.loading') : t('customer360.reveal_button')}
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
