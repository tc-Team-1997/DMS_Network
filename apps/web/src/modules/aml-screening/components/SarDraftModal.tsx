/**
 * SarDraftModal — review + download a SAR (Suspicious Activity Report) draft.
 *
 * Shown when the reviewer selects "True Match → Generate SAR" in ActionPanel.
 *
 * Flow:
 *   1. Pre-fills narrative, reviewer name, and institution from hit + auth store.
 *   2. Reviewer edits the narrative (≥ 50 chars required).
 *   3. "Download PDF" — generates PDF client-side via generateSarPdf() and
 *      triggers a browser download.  No network call.
 *   4. "Submit to Compliance" — stub call to submitSar() (POST .../sar-submit).
 *      On success: onSubmitted() is called so the parent can close/invalidate.
 *
 * The PDF is entirely browser-generated (pdf-lib).  No PII is sent to the
 * server for PDF generation.
 */

import { useState, useId, useEffect, useRef } from 'react';
import { useMutation } from '@tanstack/react-query';
import { X, FileWarning, Download, Send } from 'lucide-react';
import { Button } from '@/components/ui';
import { HttpError } from '@/lib/http';
import { t } from '@/lib/i18n';
import { useAuth } from '@/store/auth';
import { useTenant } from '@/store/tenant';
import { submitSar } from '../api';
import { generateSarPdf, downloadSarPdf } from '../lib/sarPdf';
import type { Hit } from '../schemas';

interface SarDraftModalProps {
  hit: Hit;
  subjectName: string;
  onClose: () => void;
  onSubmitted: () => void;
}

const MIN_NARRATIVE = 50;

export function SarDraftModal({
  hit,
  subjectName,
  onClose,
  onSubmitted,
}: SarDraftModalProps) {
  const dialogId  = useId();
  const titleId   = `${dialogId}-title`;
  const dialogRef = useRef<HTMLDivElement>(null);

  const { user }   = useAuth();
  const tenant     = useTenant();

  const reviewedBy = user?.full_name ?? user?.username ?? 'Unknown reviewer';
  const tenantName = tenant.display_name || 'Bank';

  const defaultNarrative =
    `Watchlist match detected for customer ${subjectName}. ` +
    `Hit ID: ${hit.id}. ` +
    `Composite match score: ${Math.round(hit.score * 100)}%. ` +
    `Watchlist: ${hit.watchlist_name ?? 'Unknown'}. ` +
    `Matched entry: ${hit.watchlist_entry_name}. ` +
    `Please provide additional context for SAR submission.`;

  const [narrative,  setNarrative]  = useState(defaultNarrative);
  const [pdfBusy,    setPdfBusy]    = useState(false);
  const [serverErr,  setServerErr]  = useState<string | null>(null);
  const [submitted,  setSubmitted]  = useState(false);

  const narrativeOk = narrative.trim().length >= MIN_NARRATIVE;

  // Focus textarea on open
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

  // Focus trap
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last  = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    dialog.addEventListener('keydown', h);
    return () => dialog.removeEventListener('keydown', h);
  }, []);

  async function handleDownload() {
    setPdfBusy(true);
    try {
      const bytes = await generateSarPdf({
        subjectCid:          String(hit.screening_id),
        subjectName,
        subjectDob:          hit.subject_dob,
        subjectCountry:      hit.subject_country,
        hitId:               hit.id,
        watchlistName:       hit.watchlist_name,
        watchlistEntryName:  hit.watchlist_entry_name,
        matchScore:          hit.score,
        scoreBreakdown:      hit.score_breakdown,
        narrative:           narrative.trim(),
        reviewedBy,
        reviewedAt:          new Date().toISOString(),
        tenantName,
        branch:              user?.branch,
      });
      downloadSarPdf(bytes, `SAR-draft-hit-${hit.id}.pdf`);
    } finally {
      setPdfBusy(false);
    }
  }

  const submitMutation = useMutation({
    mutationFn: () => submitSar(hit.id),
    onSuccess: () => {
      setSubmitted(true);
      setTimeout(() => {
        onSubmitted();
      }, 800);
    },
    onError: (e: unknown) => {
      setServerErr(
        e instanceof HttpError ? e.message : t('aml.error_generic'),
      );
    },
  });

  const isBusy = pdfBusy || submitMutation.isPending;

  return (
    <>
      {/* Backdrop — z-50 sits above parent modal (z-40) */}
      <div
        className="fixed inset-0 z-50 bg-ink/30"
        aria-hidden="true"
        onClick={onClose}
      />

      {/* Dialog — z-60 */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="aml-sar-draft-modal"
        className="fixed inset-0 z-60 flex items-center justify-center p-4"
      >
        <div className="w-full max-w-lg rounded-card bg-surface shadow-[0_8px_32px_rgba(16,24,40,0.22)] border border-border flex flex-col max-h-[90vh]">

          {/* Header */}
          <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-divider shrink-0">
            <h2 id={titleId} className="text-sm font-semibold text-ink flex items-center gap-2">
              <FileWarning size={14} className="text-danger" aria-hidden="true" />
              {t('aml.v2.sar_modal_title')}
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
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">

            {/* DRAFT watermark notice */}
            <div className="rounded-input border border-danger/30 bg-danger-bg px-3 py-2 text-xs text-danger flex items-start gap-2">
              <FileWarning size={13} className="shrink-0 mt-0.5" aria-hidden="true" />
              {t('aml.v2.sar_draft_notice')}
            </div>

            {/* Summary rows */}
            <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1 text-xs">
              <dt className="text-muted font-medium">{t('aml.v2.sar_institution')}</dt>
              <dd className="text-ink">{tenantName}</dd>

              <dt className="text-muted font-medium">{t('aml.v2.sar_subject')}</dt>
              <dd className="text-ink font-mono">{subjectName || '—'}</dd>

              <dt className="text-muted font-medium">{t('aml.v2.sar_hit_id')}</dt>
              <dd className="text-ink font-mono">#{hit.id}</dd>

              <dt className="text-muted font-medium">{t('aml.v2.sar_watchlist')}</dt>
              <dd className="text-ink">{hit.watchlist_name ?? '—'}</dd>

              <dt className="text-muted font-medium">{t('aml.v2.sar_score')}</dt>
              <dd className="text-ink font-mono font-semibold">
                {Math.round(hit.score * 100)}%
              </dd>

              <dt className="text-muted font-medium">{t('aml.v2.sar_reviewer')}</dt>
              <dd className="text-ink">{reviewedBy}</dd>
            </dl>

            {/* Narrative */}
            <div>
              <label className="label block mb-1" htmlFor={`${dialogId}-narrative`}>
                {t('aml.v2.sar_narrative_label')}
                <span className="text-danger ml-1" aria-hidden="true">*</span>
                <span className="ml-1 font-normal text-muted">
                  ({narrative.trim().length}/{MIN_NARRATIVE} min)
                </span>
              </label>
              <textarea
                id={`${dialogId}-narrative`}
                data-testid="aml-sar-narrative"
                value={narrative}
                onChange={(e) => setNarrative(e.target.value)}
                rows={6}
                className="input resize-none w-full font-mono text-xs"
                aria-required="true"
                disabled={submitted}
              />
            </div>

            {/* Success */}
            {submitted && (
              <div className="rounded-input border border-success/30 bg-success-bg px-3 py-2 text-xs text-success" role="status" aria-live="polite">
                {t('aml.v2.sar_submitted_ok')}
              </div>
            )}

            {/* Error */}
            {serverErr && (
              <div className="rounded-input border border-danger/30 bg-danger-bg px-3 py-2 text-xs text-danger" role="alert">
                {serverErr}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-4 pb-4 flex justify-end gap-2 border-t border-divider pt-3 shrink-0">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClose}
              disabled={isBusy}
            >
              {t('aml.cancel')}
            </Button>

            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={!narrativeOk || isBusy || submitted}
              onClick={() => { void handleDownload(); }}
              data-testid="aml-sar-download"
            >
              <Download size={12} aria-hidden="true" />
              {pdfBusy ? t('aml.loading') : t('aml.v2.sar_download_button')}
            </Button>

            <Button
              type="button"
              size="sm"
              disabled={!narrativeOk || isBusy || submitted}
              onClick={() => { setServerErr(null); submitMutation.mutate(); }}
              data-testid="aml-sar-submit"
              className="bg-danger text-white hover:bg-danger/90"
            >
              <Send size={12} aria-hidden="true" />
              {submitMutation.isPending ? t('aml.loading') : t('aml.v2.sar_submit_button')}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
