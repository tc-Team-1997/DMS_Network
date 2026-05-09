/**
 * AmlSummaryCard — compact summary widget used by the Compliance page.
 * Shows last-24h screening counts and links to /admin/aml.
 */

import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ShieldAlert, Clock } from 'lucide-react';
import { t } from '@/lib/i18n';
import { fetchAmlSummary } from '../api';

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function AmlSummaryCard() {
  const q = useQuery({
    queryKey: ['aml', 'summary'],
    queryFn: fetchAmlSummary,
    staleTime: 60_000,
  });

  const summary = q.data;

  const openHits = summary?.last_24h.open_hit_count ?? 0;
  const hasWarning = openHits > 0;

  return (
    <Link
      to="/admin/aml"
      className="block rounded-card border p-4 space-y-3 transition hover:shadow-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue"
      data-testid="aml-summary-card"
      aria-label={t('aml.summary_card_aria')}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ShieldAlert
            size={15}
            className={hasWarning ? 'text-warning' : 'text-success'}
            aria-hidden="true"
          />
          <span className="text-xs font-semibold text-ink">{t('aml.title')}</span>
        </div>
        {q.isLoading && (
          <span className="text-xs text-muted">{t('aml.loading')}</span>
        )}
        {q.isError && (
          <span className="text-xs text-danger">{t('aml.error_load_failed')}</span>
        )}
      </div>

      {summary && (
        <div className="grid grid-cols-3 gap-2">
          <div className="text-center">
            <div
              className="text-lg font-bold tabular-nums text-ink"
              data-testid="aml-summary-screenings"
            >
              {summary.last_24h.screenings_count}
            </div>
            <div className="text-2xs text-muted">{t('aml.summary_screenings')}</div>
          </div>
          <div className="text-center">
            <div
              className="text-lg font-bold tabular-nums text-ink"
              data-testid="aml-summary-hits"
            >
              {summary.last_24h.hit_count}
            </div>
            <div className="text-2xs text-muted">{t('aml.summary_hits')}</div>
          </div>
          <div className="text-center">
            <div
              className={`text-lg font-bold tabular-nums ${hasWarning ? 'text-warning' : 'text-success'}`}
              data-testid="aml-summary-open-hits"
            >
              {openHits}
            </div>
            <div className="text-2xs text-muted">{t('aml.summary_open_hits')}</div>
          </div>
        </div>
      )}

      {summary?.last_run_at && (
        <div className="flex items-center gap-1 text-2xs text-muted">
          <Clock size={10} aria-hidden="true" />
          {t('aml.last_run')}: {relativeTime(summary.last_run_at)}
        </div>
      )}

      {hasWarning && (
        <div className="rounded-badge bg-warning-bg px-2 py-1 text-2xs font-medium text-warning inline-flex items-center gap-1">
          <ShieldAlert size={10} aria-hidden="true" />
          {t('aml.open_hits_warning', { count: openHits })}
        </div>
      )}
    </Link>
  );
}
