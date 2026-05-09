/**
 * WatchlistsTab — list of loaded AML watchlists with inline threshold editing,
 * active toggle, and a "Refresh from disk" admin action.
 *
 * Error states implemented: empty, loading, network failure + retry,
 * 4xx forbidden, 5xx apology, concurrent-edit 409, refresh-in-progress.
 */

import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, AlertTriangle, ShieldOff } from 'lucide-react';
import { Button, Panel } from '@/components/ui';
import { HttpError } from '@/lib/http';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import { fetchWatchlists, patchWatchlistThreshold, refreshWatchlists } from '../api';
import type { Watchlist } from '../schemas';

// ── Slow-request detection (§11) ───────────────────────────────────────────────

const SLOW_MS = 5_000;

// ── Confirmation modal ─────────────────────────────────────────────────────────

function RefreshConfirmModal({
  onConfirm,
  onCancel,
  isPending,
}: {
  onConfirm: () => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const firstRef = useRef<HTMLButtonElement>(null);

  // Focus first button on mount
  useState(() => {
    requestAnimationFrame(() => firstRef.current?.focus());
  });

  return (
    <>
      <div className="fixed inset-0 z-40 bg-ink/30" aria-hidden="true" onClick={onCancel} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('aml.watchlist_refresh_confirm_title')}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
      >
        <div className="w-full max-w-sm rounded-card border border-border bg-surface shadow-[0_4px_24px_rgba(16,24,40,0.14)] p-6 space-y-4">
          <p className="text-md font-semibold text-ink">{t('aml.watchlist_refresh_confirm_title')}</p>
          <p className="text-xs text-muted">{t('aml.watchlist_refresh_confirm_body')}</p>
          <div className="flex justify-end gap-2 pt-2">
            <Button ref={firstRef} type="button" variant="ghost" size="sm" onClick={onCancel} disabled={isPending}>
              {t('aml.cancel')}
            </Button>
            <Button type="button" size="sm" onClick={onConfirm} loading={isPending}>
              {t('aml.watchlist_refresh_confirm_ok')}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

// ── Threshold cell ─────────────────────────────────────────────────────────────

function ThresholdCell({
  watchlist,
  isAdmin,
}: {
  watchlist: Watchlist;
  isAdmin: boolean;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string>(String(watchlist.match_threshold));
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const patchMutation = useMutation({
    mutationFn: (val: number) => patchWatchlistThreshold(watchlist.id, val),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['aml', 'watchlists'] });
      setEditing(false);
      setSaveErr(null);
    },
    onError: (e: unknown) => {
      if (e instanceof HttpError && e.status === 409) {
        setSaveErr(t('aml.error_conflict'));
        void qc.invalidateQueries({ queryKey: ['aml', 'watchlists'] });
      } else {
        setSaveErr(e instanceof HttpError ? e.message : t('aml.error_generic'));
      }
    },
  });

  const commit = () => {
    const parsed = parseFloat(draft);
    if (isNaN(parsed) || parsed < 0 || parsed > 1) {
      setSaveErr(t('aml.error_invalid_threshold'));
      inputRef.current?.focus();
      return;
    }
    patchMutation.mutate(parsed);
  };

  const cancel = () => {
    setDraft(String(watchlist.match_threshold));
    setEditing(false);
    setSaveErr(null);
  };

  if (!isAdmin) {
    return (
      <span className="font-mono text-xs text-ink">
        {watchlist.match_threshold.toFixed(2)}
      </span>
    );
  }

  if (!editing) {
    return (
      <button
        type="button"
        data-testid={`aml-watchlist-threshold-${watchlist.id}`}
        aria-label={t('aml.watchlist_threshold_edit_aria', { val: watchlist.match_threshold.toFixed(2) })}
        className="font-mono text-xs text-brand-blue underline decoration-dotted hover:decoration-solid focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue rounded"
        onClick={() => {
          setEditing(true);
          setDraft(String(watchlist.match_threshold));
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
      >
        {watchlist.match_threshold.toFixed(2)}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <input
        ref={inputRef}
        type="number"
        min={0}
        max={1}
        step={0.01}
        value={draft}
        onChange={(e) => { setDraft(e.target.value); setSaveErr(null); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') cancel();
        }}
        aria-label={t('aml.watchlist_threshold_label')}
        className="w-16 h-6 rounded-input border border-border px-1.5 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-brand-blue"
      />
      <button
        type="button"
        onClick={commit}
        disabled={patchMutation.isPending}
        className="text-2xs text-success hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue rounded disabled:opacity-50"
        aria-label={t('aml.save')}
      >
        {t('aml.save')}
      </button>
      <button
        type="button"
        onClick={cancel}
        className="text-2xs text-muted hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue rounded"
        aria-label={t('aml.cancel')}
      >
        {t('aml.cancel')}
      </button>
      {saveErr && (
        <span className="text-2xs text-danger">{saveErr}</span>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

interface WatchlistsTabProps {
  isAdmin: boolean;
}

export function WatchlistsTab({ isAdmin }: WatchlistsTabProps) {
  const qc = useQueryClient();
  const [showConfirm, setShowConfirm] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);
  const [refreshInProgress, setRefreshInProgress] = useState(false);

  // Slow-request tracking
  const slowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isSlow, setIsSlow] = useState(false);

  const q = useQuery({
    queryKey: ['aml', 'watchlists'],
    queryFn: fetchWatchlists,
  });

  const refreshMutation = useMutation({
    mutationFn: refreshWatchlists,
    onMutate: () => {
      setRefreshInProgress(true);
      slowTimerRef.current = setTimeout(() => setIsSlow(true), SLOW_MS);
    },
    onSuccess: (data) => {
      clearTimeout(slowTimerRef.current ?? undefined);
      setIsSlow(false);
      setRefreshInProgress(false);
      setRefreshMsg(data.message);
      void qc.invalidateQueries({ queryKey: ['aml', 'watchlists'] });
      setShowConfirm(false);
      setTimeout(() => setRefreshMsg(null), 6_000);
    },
    onError: () => {
      clearTimeout(slowTimerRef.current ?? undefined);
      setIsSlow(false);
      setRefreshInProgress(false);
      setShowConfirm(false);
    },
  });

  const isForbidden = q.error instanceof HttpError && q.error.status === 403;
  const isServerErr = q.error instanceof HttpError && q.error.status >= 500;
  const isNetworkErr = q.isError && !isForbidden && !isServerErr;

  const ticketId = useMemo(() => (isServerErr ? `ERR-${Date.now().toString(36).toUpperCase()}` : null), [isServerErr]);

  const watchlists = q.data ?? [];

  return (
    <>
      <Panel
        title={t('aml.watchlists_title')}
        action={
          isAdmin ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setShowConfirm(true)}
              disabled={refreshInProgress}
              loading={refreshInProgress}
              data-testid="aml-watchlist-refresh-button"
            >
              <RefreshCw size={13} aria-hidden="true" />
              {refreshInProgress
                ? t('aml.watchlist_refreshing')
                : t('aml.watchlist_refresh_button')}
              {refreshInProgress && (
                <span
                  className="ml-1 inline-block h-2 w-2 rounded-full bg-warning animate-pulse"
                  aria-hidden="true"
                  title={t('aml.watchlist_refreshing')}
                />
              )}
            </Button>
          ) : undefined
        }
      >
        {/* Loading skeleton */}
        {q.isLoading && (
          <div className="space-y-2 py-2" aria-busy="true" aria-label={t('aml.loading')}>
            {[1, 2, 3].map((n) => (
              <div key={n} className="h-8 rounded-input bg-divider animate-pulse" />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!q.isLoading && !q.isError && watchlists.length === 0 && (
          <div
            className="py-10 flex flex-col items-center text-center text-muted"
            data-testid="aml-empty-state"
          >
            <ShieldOff size={28} className="mb-2 text-muted" aria-hidden="true" />
            <p className="text-md font-medium text-ink">{t('aml.watchlists_empty_title')}</p>
            <p className="text-xs mt-1">{t('aml.watchlists_empty_body')}</p>
            <a
              href="/admin/docs/watchlists"
              className="mt-3 text-xs text-brand-blue hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue rounded"
            >
              {t('aml.watchlists_empty_cta')}
            </a>
          </div>
        )}

        {/* Forbidden */}
        {isForbidden && (
          <div className="rounded-input border border-warning/40 bg-warning-bg px-3 py-2 text-xs text-warning flex items-center gap-2" data-testid="aml-error">
            <AlertTriangle size={13} aria-hidden="true" />
            {t('aml.error_forbidden')}
          </div>
        )}

        {/* Network failure */}
        {isNetworkErr && (
          <div className="rounded-input border border-danger/30 bg-danger-bg px-3 py-2 text-xs text-danger flex items-center justify-between gap-2" data-testid="aml-error">
            <span className="flex items-center gap-1.5">
              <AlertTriangle size={13} aria-hidden="true" />
              {t('aml.error_network')}
            </span>
            <button
              type="button"
              onClick={() => void q.refetch()}
              className="text-2xs underline text-danger hover:text-danger/80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-danger rounded"
            >
              {t('aml.error_retry')}
            </button>
          </div>
        )}

        {/* 5xx apology */}
        {isServerErr && (
          <div className="rounded-input border border-danger/30 bg-danger-bg px-3 py-2 text-xs text-danger space-y-1" data-testid="aml-error">
            <p>{t('aml.error_server')}</p>
            {ticketId && <p className="font-mono text-2xs">{t('aml.error_ticket_id')}: {ticketId}</p>}
          </div>
        )}

        {/* Slow hint */}
        {isSlow && (
          <div className="rounded-input border border-warning/40 bg-warning-bg px-3 py-2 text-xs text-warning flex items-center justify-between gap-2">
            <span>{t('aml.watchlist_slow')}</span>
            <button
              type="button"
              onClick={() => {
                setIsSlow(false);
                refreshMutation.reset();
                setRefreshInProgress(false);
              }}
              className="text-2xs underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-warning rounded"
            >
              {t('aml.cancel')}
            </button>
          </div>
        )}

        {/* Success toast */}
        {refreshMsg && (
          <div className="rounded-input border border-success/30 bg-success-bg px-3 py-2 text-xs text-success">
            {refreshMsg}
          </div>
        )}

        {/* Watchlists table */}
        {!q.isLoading && watchlists.length > 0 && (
          <div className="overflow-hidden rounded-card border border-divider bg-surface">
            <table className="w-full text-sm" aria-label={t('aml.watchlists_title')}>
              <thead>
                <tr className="table-header">
                  <th scope="col" className="px-3 py-2 text-[11px] font-semibold text-ink-sub text-left">
                    {t('aml.col_name')}
                  </th>
                  <th scope="col" className="px-3 py-2 text-[11px] font-semibold text-ink-sub text-left" aria-sort="none">
                    {t('aml.col_threshold')}
                  </th>
                  <th scope="col" className="px-3 py-2 text-[11px] font-semibold text-ink-sub text-right">
                    {t('aml.col_entries')}
                  </th>
                  <th scope="col" className="px-3 py-2 text-[11px] font-semibold text-ink-sub text-left">
                    {t('aml.col_last_updated')}
                  </th>
                  <th scope="col" className="px-3 py-2 text-[11px] font-semibold text-ink-sub text-center">
                    {t('aml.col_active')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {watchlists.map((wl, i) => (
                  <tr
                    key={wl.id}
                    data-testid={`aml-watchlist-row-${wl.id}`}
                    className={cn('border-t border-divider', i % 2 === 1 && 'bg-page')}
                  >
                    <td className="px-3 py-2 text-ink font-medium" scope="row">{wl.list_name}</td>
                    <td className="px-3 py-2">
                      <ThresholdCell watchlist={wl} isAdmin={isAdmin} />
                    </td>
                    <td className="px-3 py-2 text-right text-xs text-ink tabular-nums">
                      {wl.entry_count.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted">
                      {wl.last_updated ? new Date(wl.last_updated).toLocaleString() : '—'}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span
                        data-testid={`aml-watchlist-toggle-${wl.id}`}
                        className={cn(
                          'inline-flex items-center gap-1 rounded-badge px-2 py-0.5 text-2xs font-medium',
                          wl.active ? 'bg-success-bg text-success' : 'bg-divider text-muted',
                        )}
                        aria-label={wl.active ? t('aml.active') : t('aml.inactive')}
                      >
                        {wl.active ? t('aml.active') : t('aml.inactive')}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {showConfirm && (
        <RefreshConfirmModal
          onConfirm={() => refreshMutation.mutate()}
          onCancel={() => setShowConfirm(false)}
          isPending={refreshInProgress}
        />
      )}
    </>
  );
}
