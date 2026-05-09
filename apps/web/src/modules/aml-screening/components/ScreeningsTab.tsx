/**
 * ScreeningsTab — recent screenings list with status filter and inline
 * hit drilldown. Also provides a "Trigger screening manually" button
 * for compliance role+.
 */

import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ChevronDown, ChevronRight, Search } from 'lucide-react';
import { Button, Panel } from '@/components/ui';
import { HttpError } from '@/lib/http';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import { fetchScreenings, triggerScreening } from '../api';
import type { Screening } from '../schemas';

// ── Status tone helper ────────────────────────────────────────────────────────

function screeningTone(status: Screening['status']): string {
  switch (status) {
    case 'cleared': return 'bg-success-bg text-success';
    case 'flagged': return 'bg-danger-bg text-danger';
    case 'pending': return 'bg-warning-bg text-warning';
    case 'running': return 'bg-brand-skyLight text-brand-blue';
    case 'error':   return 'bg-divider text-muted';
  }
}

const STATUS_OPTIONS: Array<{ value: string; labelKey: string }> = [
  { value: '',        labelKey: 'aml.status_all' },
  { value: 'pending', labelKey: 'aml.status_pending' },
  { value: 'cleared', labelKey: 'aml.status_cleared' },
  { value: 'flagged', labelKey: 'aml.status_flagged' },
  { value: 'error',   labelKey: 'aml.status_error' },
];

// ── Trigger modal ─────────────────────────────────────────────────────────────

function TriggerModal({
  onClose,
  onTriggered,
}: {
  onClose: () => void;
  onTriggered: () => void;
}) {
  const [cid, setCid] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const mutation = useMutation({
    mutationFn: () => triggerScreening(cid.trim()),
    onSuccess: () => {
      onTriggered();
      onClose();
    },
    onError: (e: unknown) => {
      setErr(e instanceof HttpError ? e.message : t('aml.error_generic'));
      inputRef.current?.focus();
    },
  });

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // ESC closes
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  const handleSubmit = () => {
    setErr(null);
    if (!cid.trim()) {
      setErr(t('aml.trigger_cid_required'));
      inputRef.current?.focus();
      return;
    }
    mutation.mutate();
  };

  return (
    <>
      <div className="fixed inset-0 z-40 bg-ink/30" aria-hidden="true" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('aml.trigger_modal_title')}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
      >
        <div className="w-full max-w-sm rounded-card border border-border bg-surface shadow-[0_4px_24px_rgba(16,24,40,0.14)] p-6 space-y-4">
          <p className="text-md font-semibold text-ink">{t('aml.trigger_modal_title')}</p>
          <div>
            <label htmlFor="trigger-cid" className="label">{t('aml.trigger_cid_label')}</label>
            <input
              ref={inputRef}
              id="trigger-cid"
              type="text"
              value={cid}
              onChange={(e) => { setCid(e.target.value); setErr(null); }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); if (e.key === 'Escape') onClose(); }}
              placeholder={t('aml.trigger_cid_placeholder')}
              data-testid="aml-screening-cid-input"
              className="input w-full"
            />
            {err && <p className="field-error mt-1">{err}</p>}
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="ghost" size="sm" onClick={onClose} disabled={mutation.isPending}>
              {t('aml.cancel')}
            </Button>
            <Button type="button" size="sm" onClick={handleSubmit} loading={mutation.isPending}>
              {t('aml.trigger_submit')}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface ScreeningsTabProps {
  canTrigger: boolean;
}

export function ScreeningsTab({ canTrigger }: ScreeningsTabProps) {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('');
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [showTrigger, setShowTrigger] = useState(false);

  const slowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isSlow, setIsSlow] = useState(false);

  const q = useQuery({
    queryKey: ['aml', 'screenings', { status: statusFilter }],
    queryFn: () => fetchScreenings(statusFilter ? { status: statusFilter } : {}),
  });

  useEffect(() => {
    if (q.isFetching) {
      slowTimerRef.current = setTimeout(() => setIsSlow(true), 5_000);
      return () => clearTimeout(slowTimerRef.current ?? undefined);
    } else {
      clearTimeout(slowTimerRef.current ?? undefined);
      setIsSlow(false);
    }
    return undefined;
  }, [q.isFetching]);

  const isForbidden = q.error instanceof HttpError && q.error.status === 403;
  const isServerErr = q.error instanceof HttpError && q.error.status >= 500;
  const isNetworkErr = q.isError && !isForbidden && !isServerErr;

  const screenings = q.data?.items ?? [];

  const handleTriggered = () => {
    void qc.invalidateQueries({ queryKey: ['aml', 'screenings'] });
    void qc.invalidateQueries({ queryKey: ['aml', 'summary'] });
  };

  return (
    <>
      <Panel
        title={t('aml.screenings_title')}
        action={
          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor="aml-status-filter">{t('aml.status_filter_label')}</label>
            <select
              id="aml-status-filter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="h-8 rounded-input border border-border bg-white px-2 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-brand-blue"
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{t(opt.labelKey)}</option>
              ))}
            </select>
            {canTrigger && (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setShowTrigger(true)}
                data-testid="aml-screening-trigger-button"
              >
                <Search size={12} aria-hidden="true" />
                {t('aml.screening_trigger_button')}
              </Button>
            )}
          </div>
        }
      >
        {/* Loading */}
        {q.isLoading && (
          <div className="space-y-2 py-2" aria-busy="true">
            {[1, 2, 3].map((n) => (
              <div key={n} className="h-9 rounded-input bg-divider animate-pulse" />
            ))}
          </div>
        )}

        {/* Slow hint */}
        {isSlow && (
          <div className="rounded-input border border-warning/40 bg-warning-bg px-3 py-2 text-xs text-warning mb-3 flex items-center justify-between gap-2">
            <span>{t('aml.slow_loading')}</span>
            <button
              type="button"
              onClick={() => { setIsSlow(false); void q.refetch(); }}
              className="text-2xs underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-warning rounded"
            >
              {t('aml.cancel')}
            </button>
          </div>
        )}

        {/* Empty */}
        {!q.isLoading && !q.isError && screenings.length === 0 && (
          <div
            className="py-10 flex flex-col items-center text-center text-muted"
            data-testid="aml-empty-state"
          >
            <Search size={28} className="mb-2 text-muted" aria-hidden="true" />
            <p className="text-md font-medium text-ink">{t('aml.screenings_empty_title')}</p>
            <p className="text-xs mt-1">{t('aml.screenings_empty_body')}</p>
          </div>
        )}

        {/* Errors */}
        {isForbidden && (
          <div className="rounded-input border border-warning/40 bg-warning-bg px-3 py-2 text-xs text-warning" data-testid="aml-error">
            {t('aml.error_forbidden')}
          </div>
        )}
        {isNetworkErr && (
          <div className="rounded-input border border-danger/30 bg-danger-bg px-3 py-2 text-xs text-danger flex items-center justify-between gap-2" data-testid="aml-error">
            <span className="flex items-center gap-1.5"><AlertTriangle size={13} aria-hidden="true" />{t('aml.error_network')}</span>
            <button type="button" onClick={() => void q.refetch()} className="text-2xs underline">
              {t('aml.error_retry')}
            </button>
          </div>
        )}
        {isServerErr && (
          <div className="rounded-input border border-danger/30 bg-danger-bg px-3 py-2 text-xs text-danger" data-testid="aml-error">
            {t('aml.error_server')}
          </div>
        )}

        {/* Table */}
        {!q.isLoading && screenings.length > 0 && (
          <div className="overflow-hidden rounded-card border border-divider bg-surface">
            <table className="w-full text-sm" aria-label={t('aml.screenings_title')}>
              <thead>
                <tr className="table-header">
                  <th scope="col" className="w-8 px-3 py-2" />
                  <th scope="col" className="px-3 py-2 text-[11px] font-semibold text-ink-sub text-left">
                    {t('aml.col_cid')}
                  </th>
                  <th scope="col" className="px-3 py-2 text-[11px] font-semibold text-ink-sub text-left" aria-sort="none">
                    {t('aml.col_status')}
                  </th>
                  <th scope="col" className="px-3 py-2 text-[11px] font-semibold text-ink-sub text-right">
                    {t('aml.col_hits')}
                  </th>
                  <th scope="col" className="px-3 py-2 text-[11px] font-semibold text-ink-sub text-left">
                    {t('aml.col_screened_at')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {screenings.map((s, i) => {
                  const isExpanded = expandedId === s.id;
                  return [
                    <tr
                      key={s.id}
                      data-testid={`aml-screening-row-${s.id}`}
                      className={cn(
                        'border-t border-divider cursor-pointer hover:bg-brand-skyLight/60',
                        i % 2 === 1 && !isExpanded && 'bg-page',
                        isExpanded && 'bg-brand-skyLight/40',
                      )}
                      onClick={() => setExpandedId(isExpanded ? null : s.id)}
                      aria-expanded={isExpanded}
                    >
                      <td className="px-3 py-2 text-muted" aria-hidden="true">
                        {isExpanded
                          ? <ChevronDown size={13} />
                          : <ChevronRight size={13} />}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-ink" scope="row">
                        {s.customer_cid}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={cn(
                            'inline-flex items-center rounded-badge px-2 py-0.5 text-2xs font-medium',
                            screeningTone(s.status),
                          )}
                        >
                          {t(`aml.status_${s.status}`)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right text-xs tabular-nums text-ink">
                        {s.hit_count}
                      </td>
                      <td className="px-3 py-2 text-xs text-muted">
                        {new Date(s.screened_at).toLocaleString()}
                      </td>
                    </tr>,
                    isExpanded && (
                      <tr key={`${s.id}-detail`} className="border-t border-divider">
                        <td />
                        <td colSpan={4} className="px-3 py-3 bg-brand-skyLight/20">
                          <div className="text-xs text-ink space-y-1">
                            {s.trigger_reason && (
                              <p>
                                <span className="font-medium">{t('aml.trigger_reason_label')}:</span>{' '}
                                {s.trigger_reason}
                              </p>
                            )}
                            {s.completed_at && (
                              <p>
                                <span className="font-medium">{t('aml.completed_at_label')}:</span>{' '}
                                {new Date(s.completed_at).toLocaleString()}
                              </p>
                            )}
                            {s.hit_count === 0 && (
                              <p className="text-muted italic">{t('aml.no_hits_detail')}</p>
                            )}
                          </div>
                        </td>
                      </tr>
                    ),
                  ];
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {showTrigger && (
        <TriggerModal
          onClose={() => setShowTrigger(false)}
          onTriggered={handleTriggered}
        />
      )}
    </>
  );
}
