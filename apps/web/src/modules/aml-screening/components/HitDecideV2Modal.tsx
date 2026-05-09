/**
 * HitDecideV2Modal — full v2 AML hit-decide experience.
 *
 * Four internal tabs:
 *   Compare       — subject vs watchlist pane, token diff, score bars
 *   History       — prior decisions + suppressions for this subject×entry pair
 *   Adverse Media — lazy-loaded RSS stub list (configurable via tenant_config)
 *   Action        — decision panel: Cleared / Cleared+Suppress / EDD / SAR
 *
 * WebAuthn step-up is triggered when risk band is 'high' (and action is not Cleared).
 * Step-up is skipped when the browser doesn't support credentials API or when
 * the server doesn't return step_up_required (graceful degradation).
 *
 * A11y:
 *   - Focus trap within modal; ESC closes.
 *   - All tab panels have role="tabpanel" with aria-labelledby.
 *   - Score bars announce via aria-label (percentage).
 *   - Live region announces successful decision.
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  X,
  FileWarning,
  Clock,
} from 'lucide-react';
import { Button, Tabs, TabList, Tab, TabPanel } from '@/components/ui';
import { HttpError } from '@/lib/http';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import { stepUpStart, stepUpFinish } from '@/lib/step-up';
import { useTenantConfig } from '@/store/tenant-config';
import { decideHit } from '../api';
import { tokenDiff } from '../lib/tokenDiff';
import type { Hit } from '../schemas';
import { AdverseMediaTab } from './AdverseMediaTab';
import { DecisionHistoryTab } from './DecisionHistoryTab';
import { SarDraftModal } from './SarDraftModal';
import { SuppressionDialog } from './SuppressionDialog';

// ── Types ─────────────────────────────────────────────────────────────────────

interface HitDecideV2ModalProps {
  hit: Hit;
  subjectName?: string;
  riskBand?: string;
  onClose: () => void;
  onDecided: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function scoreBar(value: number, label: string): React.ReactElement {
  const pct = Math.round(value * 100);
  const color =
    value >= 0.8 ? 'bg-success' : value >= 0.5 ? 'bg-warning' : 'bg-danger';
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-2xs font-mono">
        <span className="text-muted">{label}</span>
        <span className="text-ink font-semibold">{pct}%</span>
      </div>
      <div
        className="h-2 rounded-full bg-divider overflow-hidden"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label} ${pct} percent`}
      >
        <div className={cn('h-full rounded-full transition-all', color)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

const TOKEN_CLASSES: Record<'match' | 'partial' | 'miss', string> = {
  match:   'bg-success-bg text-success border border-success/30',
  partial: 'bg-warning-bg text-warning border border-warning/30',
  miss:    'bg-danger-bg text-danger border border-danger/30',
};

function TokenSpan({ text, kind }: { text: string; kind: 'match' | 'partial' | 'miss' }) {
  return (
    <span
      className={cn(
        'inline-flex px-1.5 py-0.5 rounded-badge text-2xs font-mono font-medium mr-1 mb-1',
        TOKEN_CLASSES[kind],
      )}
      title={kind}
    >
      {text}
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function HitDecideV2Modal({
  hit,
  subjectName,
  riskBand,
  onClose,
  onDecided,
}: HitDecideV2ModalProps) {
  const modalId     = useId();
  const titleId     = `${modalId}-title`;
  const liveId      = `${modalId}-live`;
  const dialogRef   = useRef<HTMLDivElement>(null);

  const qc = useQueryClient();

  const [liveMsg,         setLiveMsg]         = useState('');
  const [serverErr,       setServerErr]        = useState<string | null>(null);
  const [showSarModal,    setShowSarModal]     = useState(false);
  const [showSuppDialog,  setShowSuppDialog]   = useState(false);
  const [stepUpMsg,       setStepUpMsg]        = useState<string | null>(null);

  const { data: cfg } = useTenantConfig('aml');
  const isHighRisk = riskBand === 'high';

  // Token diff — computed once from the hit data
  const subjectRaw  = subjectName ?? hit.subject_name ?? '';
  const watchlistRaw = hit.watchlist_entry_name ?? hit.matched_name ?? '';
  const diff = tokenDiff(subjectRaw, watchlistRaw);

  // Score breakdown — defensive default if backend doesn't send it
  const breakdown = hit.score_breakdown ?? {
    name:    hit.score,
    dob:     0,
    country: 0,
  };

  // Focus trap
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    (focusable[0] ?? dialog).focus();
  }, []);

  // ESC closes
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  // Tab focus trap
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last  = focusable[focusable.length - 1];
      if (!first || !last) return;
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last)  { e.preventDefault(); first.focus(); }
      }
    };
    dialog.addEventListener('keydown', h);
    return () => dialog.removeEventListener('keydown', h);
  }, []);

  const invalidate = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['aml', 'hits'] });
    void qc.invalidateQueries({ queryKey: ['aml', 'summary'] });
  }, [qc]);

  // ── Step-up dance ────────────────────────────────────────────────────────────

  async function runStepUp(): Promise<string | null> {
    if (!('credentials' in navigator)) {
      setServerErr('WebAuthn is not supported in this browser. Contact your administrator.');
      return null;
    }
    try {
      setStepUpMsg('Starting WebAuthn step-up…');
      const opts = await stepUpStart('aml_decide', hit.id);
      const credential = await navigator.credentials.get({
        publicKey: opts as unknown as PublicKeyCredentialRequestOptions,
      });
      if (!credential) {
        setStepUpMsg(null);
        setServerErr('WebAuthn step-up was cancelled. Please try again.');
        return null;
      }
      setStepUpMsg('Completing step-up…');
      const assertionId = await stepUpFinish('aml_decide', credential, hit.id);
      setStepUpMsg(null);
      return assertionId;
    } catch {
      setStepUpMsg(null);
      setServerErr('WebAuthn step-up failed. Please try again or contact your administrator.');
      return null;
    }
  }

  // ── Cleared mutation ─────────────────────────────────────────────────────────

  const clearMutation = useMutation({
    mutationFn: async ({ notes }: { notes: string }) => {
      return decideHit(hit.id, 'cleared', notes);
    },
    onSuccess: () => {
      invalidate();
      setLiveMsg(t('aml.v2.decided_cleared'));
      setTimeout(() => { onDecided(); onClose(); }, 600);
    },
    onError: handleMutationError,
  });

  // ── EDD escalation mutation ───────────────────────────────────────────────────

  const eddMutation = useMutation({
    mutationFn: async ({ notes }: { notes: string }) =>
      decideHit(hit.id, 'escalated', notes),
    onSuccess: () => {
      invalidate();
      setLiveMsg(t('aml.v2.decided_edd'));
      setTimeout(() => { onDecided(); onClose(); }, 600);
    },
    onError: handleMutationError,
  });

  function handleMutationError(e: unknown) {
    if (e instanceof HttpError && e.status === 409) {
      setServerErr(t('aml.error_conflict'));
    } else {
      setServerErr(e instanceof HttpError ? e.message : t('aml.error_generic'));
    }
  }

  const isBusy = clearMutation.isPending || eddMutation.isPending;

  async function handleCleared(notes: string) {
    setServerErr(null);
    if (isHighRisk) {
      const aid = await runStepUp();
      if (!aid) return;
      void aid; // assertion id included in middleware headers
    }
    clearMutation.mutate({ notes });
  }

  async function handleEdd(notes: string) {
    setServerErr(null);
    if (isHighRisk) {
      const stepUpResult = await runStepUp();
      if (!stepUpResult) return;
    }
    eddMutation.mutate({ notes });
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-ink/40" aria-hidden="true" onClick={onClose} />

      {/* Dialog */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="aml-hit-decide-v2-modal"
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
      >
        <div className="w-full max-w-2xl rounded-card bg-surface shadow-[0_8px_32px_rgba(16,24,40,0.18)] border border-border flex flex-col max-h-[90vh]">

          {/* Header */}
          <div className="flex items-start justify-between px-5 pt-5 pb-4 border-b border-divider shrink-0">
            <div className="space-y-0.5">
              <h2 id={titleId} className="text-md font-semibold text-ink flex items-center gap-2">
                <ShieldAlert size={16} className="text-warning" aria-hidden="true" />
                {t('aml.v2.modal_title')}
              </h2>
              <p className="text-xs text-muted">
                {t('aml.v2.hit_id_label')}: <span className="font-mono font-medium text-ink">#{hit.id}</span>
                {' '}&mdash;{' '}
                <span
                  className={cn(
                    'font-mono font-semibold',
                    hit.score >= 0.95 ? 'text-danger' : hit.score >= 0.8 ? 'text-warning' : 'text-ink',
                  )}
                  aria-label={`${t('aml.score_label')} ${Math.round(hit.score * 100)} percent`}
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

          {/* Tabs */}
          <div className="flex-1 overflow-hidden flex flex-col">
            <Tabs defaultValue="compare">
              <TabList className="px-5 shrink-0">
                <Tab value="compare">{t('aml.v2.tab_compare')}</Tab>
                <Tab value="history">{t('aml.v2.tab_history')}</Tab>
                <Tab value="adverse">{t('aml.v2.tab_adverse')}</Tab>
                <Tab value="action">{t('aml.v2.tab_action')}</Tab>
              </TabList>

              <div className="flex-1 overflow-y-auto px-5 py-4">

                {/* ── Compare tab ── */}
                <TabPanel value="compare">
                  <div className="grid grid-cols-2 gap-4">
                    {/* Subject pane */}
                    <div className="rounded-card border border-divider p-3 space-y-2 bg-brand-skyLight/30">
                      <p className="text-2xs font-semibold text-muted uppercase tracking-wide">{t('aml.v2.subject_pane')}</p>
                      <p className="text-xs font-medium text-ink">{t('aml.v2.name_label')}</p>
                      <div className="flex flex-wrap">
                        {diff.a.length > 0
                          ? diff.a.map((tok, i) => <TokenSpan key={i} text={tok.text} kind={tok.kind} />)
                          : <span className="text-muted text-2xs italic">{t('aml.v2.unknown')}</span>
                        }
                      </div>
                      {(hit.subject_dob ?? null) !== null && (
                        <p className="text-2xs text-muted">
                          {t('aml.v2.dob_label')}: <span className="text-ink font-mono">{hit.subject_dob}</span>
                        </p>
                      )}
                      {(hit.subject_country ?? null) !== null && (
                        <p className="text-2xs text-muted">
                          {t('aml.v2.country_label')}: <span className="text-ink font-mono">{hit.subject_country}</span>
                        </p>
                      )}
                    </div>

                    {/* Watchlist entry pane */}
                    <div className="rounded-card border border-divider p-3 space-y-2 bg-page">
                      <p className="text-2xs font-semibold text-muted uppercase tracking-wide">{t('aml.v2.watchlist_pane')}</p>
                      <p className="text-xs font-medium text-ink">{hit.watchlist_name ?? '—'}</p>
                      <div className="flex flex-wrap">
                        {diff.b.length > 0
                          ? diff.b.map((tok, i) => <TokenSpan key={i} text={tok.text} kind={tok.kind} />)
                          : <span className="text-muted text-2xs italic">{t('aml.v2.unknown')}</span>
                        }
                      </div>
                      {(hit.watchlist_dob ?? null) !== null && (
                        <p className="text-2xs text-muted">
                          {t('aml.v2.dob_label')}: <span className="text-ink font-mono">{hit.watchlist_dob}</span>
                        </p>
                      )}
                      {(hit.watchlist_country ?? null) !== null && (
                        <p className="text-2xs text-muted">
                          {t('aml.v2.country_label')}: <span className="text-ink font-mono">{hit.watchlist_country}</span>
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Score breakdown bars */}
                  <div className="mt-4 space-y-2 rounded-card border border-divider p-3 bg-surface">
                    <p className="text-2xs font-semibold text-muted uppercase tracking-wide mb-2">{t('aml.v2.score_breakdown_label')}</p>
                    {scoreBar(breakdown.name,    t('aml.v2.score_name'))}
                    {scoreBar(breakdown.dob,     t('aml.v2.score_dob'))}
                    {scoreBar(breakdown.country, t('aml.v2.score_country'))}
                    <div className="pt-1 border-t border-divider">
                      {scoreBar(hit.score, t('aml.v2.score_composite'))}
                    </div>
                  </div>

                  {/* Legend */}
                  <div className="mt-3 flex flex-wrap gap-3 text-2xs">
                    {(['match', 'partial', 'miss'] as const).map((kind) => (
                      <span key={kind} className="flex items-center gap-1">
                        <span className={cn('inline-block w-3 h-3 rounded-badge border', TOKEN_CLASSES[kind])} aria-hidden="true" />
                        {t(`aml.v2.token_${kind}`)}
                      </span>
                    ))}
                  </div>
                </TabPanel>

                {/* ── History tab ── */}
                <TabPanel value="history">
                  <DecisionHistoryTab hitId={hit.id} />
                </TabPanel>

                {/* ── Adverse media tab ── */}
                <TabPanel value="adverse">
                  <AdverseMediaTab
                    subjectName={subjectRaw}
                    sources={
                      Array.isArray(cfg?.['adverse_media_sources'])
                        ? (cfg['adverse_media_sources'] as string[])
                        : []
                    }
                  />
                </TabPanel>

                {/* ── Action tab ── */}
                <TabPanel value="action">
                  <ActionPanel
                    hit={hit}
                    isHighRisk={isHighRisk}
                    isBusy={isBusy}
                    serverErr={serverErr}
                    stepUpMsg={stepUpMsg}
                    onCleared={handleCleared}
                    onClearedSuppress={() => setShowSuppDialog(true)}
                    onEdd={handleEdd}
                    onSar={() => setShowSarModal(true)}
                  />
                </TabPanel>

              </div>
            </Tabs>
          </div>
        </div>
      </div>

      {/* Live region */}
      <div id={liveId} role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {liveMsg}
      </div>

      {/* Suppression dialog */}
      {showSuppDialog && (
        <SuppressionDialog
          hitId={hit.id}
          onClose={() => setShowSuppDialog(false)}
          onSuppressed={() => {
            invalidate();
            setLiveMsg(t('aml.v2.decided_suppressed'));
            setTimeout(() => { onDecided(); onClose(); }, 600);
          }}
        />
      )}

      {/* SAR draft modal */}
      {showSarModal && (
        <SarDraftModal
          hit={hit}
          subjectName={subjectRaw}
          onClose={() => setShowSarModal(false)}
          onSubmitted={() => {
            invalidate();
            setLiveMsg(t('aml.v2.sar_submitted'));
            setTimeout(() => { onDecided(); onClose(); }, 800);
          }}
        />
      )}
    </>
  );
}

// ── Action panel ──────────────────────────────────────────────────────────────

const MIN_NOTES = 20;

interface ActionPanelProps {
  hit: Hit;
  isHighRisk: boolean;
  isBusy: boolean;
  serverErr: string | null;
  stepUpMsg: string | null;
  onCleared:         (notes: string) => void;
  onClearedSuppress: () => void;
  onEdd:             (notes: string) => void;
  onSar:             () => void;
}

function ActionPanel({
  hit, isHighRisk, isBusy, serverErr, stepUpMsg,
  onCleared, onClearedSuppress, onEdd, onSar,
}: ActionPanelProps) {
  const [notes, setNotes] = useState('');
  const notesOk = notes.trim().length >= MIN_NOTES;

  return (
    <div className="space-y-4">
      {isHighRisk && (
        <div className="rounded-input border border-warning/40 bg-warning-bg px-3 py-2 text-xs text-warning flex items-center gap-2">
          <AlertTriangle size={13} aria-hidden="true" />
          {t('aml.v2.high_risk_stepup_notice')}
        </div>
      )}

      {/* Notes */}
      <div>
        <label className="label block mb-1" htmlFor="aml-action-notes">
          {t('aml.decide_notes_label')}
          <span className="text-danger ml-1" aria-hidden="true">*</span>
          <span className="ml-1 font-normal text-muted">({notes.trim().length}/{MIN_NOTES} min)</span>
        </label>
        <textarea
          id="aml-action-notes"
          data-testid="aml-v2-action-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          placeholder={t('aml.v2.notes_placeholder')}
          className="input resize-none w-full"
          aria-required="true"
        />
      </div>

      {stepUpMsg && (
        <p className="text-xs text-brand-blue">{stepUpMsg}</p>
      )}

      {serverErr && (
        <div className="rounded-input border border-danger/30 bg-danger-bg px-3 py-2 text-xs text-danger" role="alert">
          {serverErr}
        </div>
      )}

      {/* Action buttons */}
      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={!notesOk || isBusy}
          onClick={() => onCleared(notes)}
          data-testid="aml-v2-action-cleared"
          className="flex items-center gap-1.5"
        >
          <ShieldCheck size={13} className="text-success" aria-hidden="true" />
          {t('aml.v2.action_cleared')}
        </Button>

        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={!notesOk || isBusy}
          onClick={onClearedSuppress}
          data-testid="aml-v2-action-suppress"
          className="flex items-center gap-1.5"
        >
          <Clock size={13} className="text-brand-blue" aria-hidden="true" />
          {t('aml.v2.action_cleared_suppress')}
        </Button>

        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={!notesOk || isBusy}
          onClick={() => onEdd(notes)}
          data-testid="aml-v2-action-edd"
          className="flex items-center gap-1.5"
        >
          <ShieldAlert size={13} className="text-warning" aria-hidden="true" />
          {t('aml.v2.action_edd')}
        </Button>

        {hit.decision === 'open' && (
          <Button
            type="button"
            size="sm"
            disabled={!notesOk || isBusy}
            onClick={onSar}
            data-testid="aml-v2-action-sar"
            className="flex items-center gap-1.5 bg-danger text-white hover:bg-danger/90"
          >
            <FileWarning size={13} aria-hidden="true" />
            {t('aml.v2.action_sar')}
          </Button>
        )}
      </div>

      <p className="text-2xs text-muted">{t('aml.v2.action_hint')}</p>
    </div>
  );
}
