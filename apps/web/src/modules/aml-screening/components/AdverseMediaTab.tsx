/**
 * AdverseMediaTab — lazy-loaded adverse-media stub.
 *
 * When real adverse-media sources are configured via tenant_config.aml.adverse_media_sources
 * the tab lists them.  In all cases a static stub result is shown so QA and
 * compliance reviewers can see the intended layout.  Real scraping is out of
 * scope for Wave B and will be wired when the python-service adverse_media
 * router is implemented.
 *
 * Props:
 *   subjectName  — the subject name to search (display only, no actual query)
 *   sources      — array of source-label strings from tenant_config (may be empty)
 */

import { ShieldCheck, Globe, Info } from 'lucide-react';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/cn';

interface AdverseMediaTabProps {
  subjectName: string;
  sources: string[];
}

interface StubResult {
  source: string;
  headline: string;
  date: string;
  risk: 'low' | 'medium' | 'high';
  stub: true;
}

const STUB_RESULTS: StubResult[] = [
  {
    source: 'World-Check (stub)',
    headline: 'Sample: No adverse media found for this subject.',
    date: '2025-01-01',
    risk: 'low',
    stub: true,
  },
];

const RISK_CLASS: Record<'low' | 'medium' | 'high', string> = {
  low:    'bg-success-bg text-success',
  medium: 'bg-warning-bg text-warning',
  high:   'bg-danger-bg text-danger',
};

export function AdverseMediaTab({ subjectName, sources }: AdverseMediaTabProps) {
  const resolvedSources = sources.length > 0 ? sources : ['World-Check (stub)', 'Dow Jones Risk (stub)'];

  return (
    <div className="space-y-4">
      {/* Stub notice */}
      <div className="rounded-input border border-brand-blue/30 bg-brand-skyLight/40 px-3 py-2 text-xs text-brand-blue flex items-start gap-2">
        <Info size={13} className="shrink-0 mt-0.5" aria-hidden="true" />
        <span>{t('aml.v2.adverse_media_stub_notice')}</span>
      </div>

      {/* Query subject */}
      <div className="rounded-card border border-divider bg-surface p-3 space-y-1">
        <p className="text-2xs font-semibold text-muted uppercase tracking-wide">{t('aml.v2.adverse_media_subject')}</p>
        <p className="text-sm font-medium text-ink">{subjectName || '—'}</p>
      </div>

      {/* Sources */}
      <div>
        <p className="text-2xs font-semibold text-muted uppercase tracking-wide mb-2">
          {t('aml.v2.adverse_media_sources_label')}
        </p>
        <div className="flex flex-wrap gap-2">
          {resolvedSources.map((src) => (
            <span
              key={src}
              className="inline-flex items-center gap-1 rounded-badge border border-divider bg-page px-2 py-0.5 text-2xs text-ink-sub"
            >
              <Globe size={9} aria-hidden="true" />
              {src}
            </span>
          ))}
        </div>
      </div>

      {/* Results */}
      <div>
        <p className="text-2xs font-semibold text-muted uppercase tracking-wide mb-2">
          {t('aml.v2.adverse_media_results_label')} ({STUB_RESULTS.length})
        </p>
        <ul className="space-y-2">
          {STUB_RESULTS.map((result, i) => (
            <li
              key={i}
              className="rounded-card border border-divider bg-surface px-3 py-2 space-y-1"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs text-ink font-medium truncate">{result.headline}</p>
                  <p className="text-2xs text-muted mt-0.5">
                    {result.source}
                    {' · '}
                    {result.date}
                  </p>
                </div>
                <span
                  className={cn(
                    'shrink-0 rounded-badge px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wide',
                    RISK_CLASS[result.risk],
                  )}
                >
                  {result.risk}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* All-clear indicator when no high-risk */}
      {!STUB_RESULTS.some((r) => r.risk === 'high') && (
        <div className="rounded-input border border-success/30 bg-success-bg px-3 py-2 text-xs text-success flex items-center gap-2">
          <ShieldCheck size={13} aria-hidden="true" />
          {t('aml.v2.adverse_media_no_high_risk')}
        </div>
      )}
    </div>
  );
}
