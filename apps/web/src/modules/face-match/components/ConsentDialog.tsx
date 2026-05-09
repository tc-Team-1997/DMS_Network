/**
 * ConsentDialog — required FIRST step before any biometric capture.
 *
 * A11y requirements (contract §10):
 * - Focus trap: first focusable element (close button) gets focus on mount.
 * - ESC closes the dialog.
 * - Consent checkbox is keyboard-reachable with aria-required.
 * - "Accept" button disabled until checkbox is ticked.
 * - No biometric capture can proceed until this dialog posts to acceptConsent()
 *   and the token is stored in sessionStorage.
 *
 * Privacy:
 * - The consent token (24h JWT) is stored in sessionStorage only.
 *   It is cleared automatically when the tab closes.
 * - Token is NEVER written to localStorage.
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { X, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import { getConsent, acceptConsent } from '../api';
import { HttpError } from '@/lib/http';

export const CONSENT_TOKEN_KEY = 'face_match_consent_token';
export const CONSENT_EXPIRES_KEY = 'face_match_consent_expires';

interface ConsentDialogProps {
  customerCid: string;
  onAccepted: (token: string) => void;
  onClose: () => void;
}

export function ConsentDialog({ customerCid, onAccepted, onClose }: ConsentDialogProps) {
  const dialogId = useId();
  const titleId = `${dialogId}-title`;
  const checkboxId = `${dialogId}-checkbox`;

  const [checked, setChecked] = useState(false);
  const [serverErr, setServerErr] = useState<string | null>(null);

  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Load consent template text
  const { data: consentTemplate, isLoading } = useQuery({
    queryKey: ['face-match', 'consent-template'],
    queryFn: getConsent,
    staleTime: 5 * 60 * 1000,
  });

  // Focus close button on mount (focus trap entry point)
  useEffect(() => {
    closeButtonRef.current?.focus();
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
          'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
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
    mutationFn: () =>
      acceptConsent(customerCid, new Date().toISOString()),
    onSuccess: (result) => {
      // Store token in sessionStorage only — cleared on tab close
      sessionStorage.setItem(CONSENT_TOKEN_KEY, result.consent_token);
      sessionStorage.setItem(CONSENT_EXPIRES_KEY, result.expires_at);
      onAccepted(result.consent_token);
    },
    onError: (e: unknown) => {
      setServerErr(
        e instanceof HttpError ? e.message : t('kyc.error_generic'),
      );
    },
  });

  const handleAccept = useCallback(() => {
    if (!checked || mutation.isPending) return;
    setServerErr(null);
    mutation.mutate();
  }, [checked, mutation]);

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
        data-testid="consent-dialog"
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
      >
        <div className="w-full max-w-lg rounded-card bg-surface border border-border shadow-[0_8px_32px_rgba(16,24,40,0.18)] flex flex-col max-h-[90vh]">

          {/* Header */}
          <div className="flex items-start justify-between px-5 pt-5 pb-4 border-b border-divider shrink-0">
            <div className="flex items-center gap-2">
              <ShieldCheck size={18} className="text-brand-blue shrink-0" aria-hidden="true" />
              <h2 id={titleId} className="text-md font-semibold text-ink">
                {t('kyc.consent_title')}
              </h2>
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              aria-label={t('kyc.consent_close_aria')}
              className="rounded-input p-1 text-muted hover:bg-divider hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue"
            >
              <X size={16} />
            </button>
          </div>

          {/* Scrollable consent text */}
          <div
            className="px-5 py-4 overflow-y-auto grow"
            tabIndex={0}
            aria-label={t('kyc.consent_text_aria')}
          >
            {isLoading && (
              <p className="text-sm text-muted animate-pulse">{t('kyc.consent_loading')}</p>
            )}
            {!isLoading && consentTemplate && (
              <div className="space-y-3">
                <p className="text-xs text-ink-sub leading-relaxed whitespace-pre-wrap">
                  {consentTemplate.consent_text}
                </p>
                <p className="text-2xs text-muted">
                  {t('kyc.consent_version', { version: consentTemplate.version })}
                </p>
              </div>
            )}
            {!isLoading && !consentTemplate && (
              <p className="text-xs text-muted">{t('kyc.consent_unavailable')}</p>
            )}
          </div>

          {/* Checkbox + actions */}
          <div className="px-5 pb-5 pt-4 border-t border-divider space-y-4 shrink-0">
            <label
              htmlFor={checkboxId}
              className={cn(
                'flex items-start gap-3 rounded-input border px-4 py-3 cursor-pointer transition',
                checked ? 'border-brand-blue/50 bg-brand-skyLight' : 'border-border bg-white hover:bg-divider',
              )}
            >
              <input
                id={checkboxId}
                type="checkbox"
                data-testid="consent-accept-checkbox"
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
                aria-required="true"
                className="mt-0.5 h-4 w-4 rounded border-border text-brand-blue accent-brand-blue focus:ring-2 focus:ring-brand-blue focus:ring-offset-1 shrink-0"
              />
              <span className="text-xs text-ink leading-relaxed select-none">
                {t('kyc.consent_checkbox_label')}
              </span>
            </label>

            {serverErr && (
              <div
                role="alert"
                className="rounded-input border border-danger/30 bg-danger-bg px-3 py-2 text-xs text-danger"
              >
                {serverErr}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onClose}
                disabled={mutation.isPending}
              >
                {t('kyc.cancel')}
              </Button>
              <Button
                type="button"
                size="sm"
                data-testid="consent-accept-button"
                disabled={!checked}
                loading={mutation.isPending}
                onClick={handleAccept}
              >
                {t('kyc.consent_accept_button')}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
