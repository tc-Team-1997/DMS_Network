/**
 * HitsQueueTab — paginated table of open AML hits.
 * Clicking a row (or the "Decide" button) opens HitDecideModal.
 * Score is color-coded with matching text/icon (not color-only — §10).
 */

import { useState, useRef, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Gavel } from 'lucide-react';
import { Button, Panel } from '@/components/ui';
import { HttpError } from '@/lib/http';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import { fetchOpenHits } from '../api';
import type { Hit } from '../schemas';
import { HitDecideV2Modal } from './HitDecideV2Modal';

// Score display — color + icon + text label (never color-only)
function ScoreCell({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const isHigh = score >= 0.95;
  const isMid = score >= 0.85 && score < 0.95;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-badge px-1.5 py-0.5 text-xs font-mono font-semibold',
        isHigh ? 'bg-danger-bg text-danger' : isMid ? 'bg-warning-bg text-warning' : 'bg-divider text-ink-sub',
      )}
      aria-label={`${t('aml.score_label')} ${pct} ${t('aml.percent')}`}
    >
      {isHigh && <AlertTriangle size={9} aria-hidden="true" />}
      {pct}%
    </span>
  );
}

const PAGE_SIZE = 50;

interface HitsQueueTabProps {
  canDecide: boolean;
}

export function HitsQueueTab({ canDecide }: HitsQueueTabProps) {
  const qc = useQueryClient();
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [selectedHit, setSelectedHit] = useState<Hit | null>(null);

  // Slow-request tracking
  const slowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isSlow, setIsSlow] = useState(false);
  const [pendingAfter30s, setPendingAfter30s] = useState(false);

  const q = useQuery({
    queryKey: ['aml', 'hits', { cursor, limit: PAGE_SIZE }],
    queryFn: () => fetchOpenHits(cursor !== undefined ? { cursor, limit: PAGE_SIZE } : { limit: PAGE_SIZE }),
  });

  // Slow detection on initial load
  useEffect(() => {
    if (q.isFetching) {
      slowTimerRef.current = setTimeout(() => setIsSlow(true), 5_000);
      const timer30 = setTimeout(() => {
        if (q.isFetching) setPendingAfter30s(true);
      }, 30_000);
      return () => {
        clearTimeout(slowTimerRef.current ?? undefined);
        clearTimeout(timer30);
      };
    } else {
      clearTimeout(slowTimerRef.current ?? undefined);
      setIsSlow(false);
    }
    return undefined;
  }, [q.isFetching]);

  const isForbidden = q.error instanceof HttpError && q.error.status === 403;
  const isServerErr = q.error instanceof HttpError && q.error.status >= 500;
  const isNetworkErr = q.isError && !isForbidden && !isServerErr;

  const hits = q.data?.items ?? [];
  const total = q.data?.total ?? 0;
  const nextCursor = q.data?.next_cursor ?? null;

  const handleDecided = () => {
    void qc.invalidateQueries({ queryKey: ['aml', 'hits'] });
    void qc.invalidateQueries({ queryKey: ['aml', 'summary'] });
  };

  return (
    <>
      <Panel
        title={`${t('aml.hits_queue_title')}${total > 0 ? ` (${total})` : ''}`}
      >
        {/* Loading skeleton */}
        {q.isLoading && (
          <div className="space-y-2 py-2" aria-busy="true" aria-label={t('aml.loading')}>
            {[1, 2, 3, 4].map((n) => (
              <div key={n} className="h-9 rounded-input bg-divider animate-pulse" />
            ))}
          </div>
        )}

        {/* Slow hint */}
        {isSlow && !pendingAfter30s && (
          <div className="rounded-input border border-warning/40 bg-warning-bg px-3 py-2 text-xs text-warning flex items-center justify-between gap-2 mb-3">
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

        {/* Still pending after 30s */}
        {pendingAfter30s && (
          <div className="rounded-input border border-warning/40 bg-warning-bg px-3 py-2 text-xs text-warning mb-3">
            {t('aml.pending_30s_hint')}
          </div>
        )}

        {/* Empty state */}
        {!q.isLoading && !q.isError && hits.length === 0 && (
          <div
            className="py-10 flex flex-col items-center text-center text-muted"
            data-testid="aml-empty-state"
          >
            <Gavel size={28} className="mb-2 text-muted" aria-hidden="true" />
            <p className="text-md font-medium text-ink">{t('aml.hits_empty_title')}</p>
            <p className="text-xs mt-1">{t('aml.hits_empty_body')}</p>
          </div>
        )}

        {/* Forbidden */}
        {isForbidden && (
          <div className="rounded-input border border-warning/40 bg-warning-bg px-3 py-2 text-xs text-warning flex items-center gap-2" data-testid="aml-error">
            <AlertTriangle size={13} aria-hidden="true" />
            {t('aml.error_forbidden_decide')}
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

        {/* 5xx */}
        {isServerErr && (
          <div className="rounded-input border border-danger/30 bg-danger-bg px-3 py-2 text-xs text-danger" data-testid="aml-error">
            {t('aml.error_server')}
          </div>
        )}

        {/* Table */}
        {!q.isLoading && hits.length > 0 && (
          <>
            <div className="overflow-hidden rounded-card border border-divider bg-surface">
              <table className="w-full text-sm" aria-label={t('aml.hits_queue_title')}>
                <thead>
                  <tr className="table-header">
                    <th scope="col" className="px-3 py-2 text-[11px] font-semibold text-ink-sub text-left">
                      {t('aml.col_cid')}
                    </th>
                    <th scope="col" className="px-3 py-2 text-[11px] font-semibold text-ink-sub text-left">
                      {t('aml.col_watchlist_match')}
                    </th>
                    <th scope="col" className="px-3 py-2 text-[11px] font-semibold text-ink-sub text-left" aria-sort="descending">
                      {t('aml.col_score')}
                    </th>
                    <th scope="col" className="px-3 py-2 text-[11px] font-semibold text-ink-sub text-left">
                      {t('aml.col_created')}
                    </th>
                    <th scope="col" className="px-3 py-2 text-[11px] font-semibold text-ink-sub text-right">
                      {t('aml.col_action')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {hits.map((hit, i) => (
                    <tr
                      key={hit.id}
                      data-testid={`aml-hit-row-${hit.id}`}
                      className={cn(
                        'border-t border-divider cursor-pointer hover:bg-brand-skyLight/60',
                        i % 2 === 1 && 'bg-page',
                      )}
                      onClick={() => setSelectedHit(hit)}
                    >
                      <td className="px-3 py-2 font-mono text-xs text-ink" scope="row">
                        {hit.screening_id}
                      </td>
                      <td className="px-3 py-2 text-xs text-ink">
                        <div className="font-medium">{hit.watchlist_entry_name}</div>
                        <div className="text-2xs text-muted">{hit.watchlist_name}</div>
                      </td>
                      <td className="px-3 py-2">
                        <ScoreCell score={hit.score} />
                      </td>
                      <td className="px-3 py-2 text-xs text-muted">
                        {new Date(hit.created_at).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {canDecide ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            data-testid={`aml-hit-decide-button-${hit.id}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedHit(hit);
                            }}
                          >
                            <Gavel size={12} aria-hidden="true" />
                            {t('aml.decide_button')}
                          </Button>
                        ) : (
                          <span className="text-xs text-muted">{t('aml.error_forbidden_decide_short')}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {(cursor !== undefined || nextCursor !== null) && (
              <div className="flex justify-between items-center mt-3">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setCursor(undefined)}
                  disabled={cursor === undefined}
                >
                  {t('aml.prev_page')}
                </Button>
                <span className="text-xs text-muted">
                  {t('aml.showing_n', { n: hits.length, total })}
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    if (nextCursor) setCursor(nextCursor);
                  }}
                  disabled={!nextCursor}
                >
                  {t('aml.next_page')}
                </Button>
              </div>
            )}
          </>
        )}
      </Panel>

      {selectedHit && (
        <HitDecideV2Modal
          hit={selectedHit}
          onClose={() => setSelectedHit(null)}
          onDecided={handleDecided}
        />
      )}
    </>
  );
}
