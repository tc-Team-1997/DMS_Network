/**
 * MatchResultCard — displays face match decision, confidence, quality flags,
 * and a link to the underlying biometric_match record for auditors.
 *
 * Privacy:
 * - The customer's ID photo is NEVER displayed here (contract §4, §8 OWASP).
 *   Only the filename/slot label and the decision are shown.
 * - Result is shown only from in-memory state; never persisted.
 *
 * A11y:
 * - Result text is announced via aria-live="polite" region.
 * - Confidence bar carries aria-label="Confidence {{pct}} percent".
 * - Color coding uses both color and icon/text to convey state (WCAG 1.4.1).
 */

import { CheckCircle, XCircle, AlertTriangle, ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui';
import type { BadgeTone } from '@/components/ui';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import type { FaceMatchResult } from '../schemas';

interface MatchResultCardProps {
  result: FaceMatchResult;
  onReset: () => void;
}

function pct(val: number | null | undefined): number {
  if (val === null || val === undefined) return 0;
  return Math.round(val * 100);
}

export function MatchResultCard({ result, onReset }: MatchResultCardProps) {
  const isMatch = result.match && result.face_geometry_ok;
  const isNoMatch = !result.match && result.face_geometry_ok;
  const isQualityFail = !result.face_geometry_ok;

  const decisionBadgeTone: BadgeTone = isMatch ? 'success' : isQualityFail ? 'warning' : 'danger';
  const decisionLabel = isMatch
    ? t('kyc.result_match')
    : isQualityFail
    ? t('kyc.result_quality_fail')
    : t('kyc.result_no_match');

  const confidencePct = pct(result.confidence);

  return (
    <div
      data-testid="face-match-result-card"
      className="rounded-card border border-border bg-surface p-5 space-y-4"
    >
      {/* Decision header */}
      <div className="flex items-center gap-3">
        {isMatch && (
          <CheckCircle
            size={28}
            className="text-success shrink-0"
            aria-hidden="true"
          />
        )}
        {isNoMatch && (
          <XCircle
            size={28}
            className="text-danger shrink-0"
            aria-hidden="true"
          />
        )}
        {isQualityFail && (
          <AlertTriangle
            size={28}
            className="text-warning shrink-0"
            aria-hidden="true"
          />
        )}

        <div>
          <Badge
            tone={decisionBadgeTone}
            data-testid="face-match-result-decision"
          >
            {decisionLabel}
          </Badge>
          <p className="text-xs text-ink-sub mt-1">
            {isMatch && t('kyc.result_match_detail')}
            {isNoMatch && t('kyc.result_no_match_detail')}
            {isQualityFail && (result.detail ?? t('kyc.result_quality_fail_detail'))}
          </p>
        </div>
      </div>

      {/* Quality fail callout */}
      {isQualityFail && (
        <div
          data-testid="face-match-quality-fail"
          role="alert"
          className="flex items-start gap-2 rounded-input border border-warning/40 bg-warning-bg px-3 py-2.5"
        >
          <AlertTriangle size={14} className="text-warning shrink-0 mt-0.5" aria-hidden="true" />
          <p className="text-xs text-warning leading-relaxed">
            {result.detail ?? t('kyc.quality_fail_generic')}
          </p>
        </div>
      )}

      {/* Confidence bar (only shown when geometry OK) */}
      {result.face_geometry_ok && result.confidence !== null && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-ink-sub">{t('kyc.confidence_label')}</span>
            <span
              className="text-xs font-mono font-medium text-ink"
              data-testid="face-match-result-confidence"
            >
              {confidencePct}%
            </span>
          </div>
          <div
            role="progressbar"
            aria-valuenow={confidencePct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t('kyc.confidence_bar_aria', { pct: confidencePct })}
            className="h-2 w-full rounded-full bg-divider overflow-hidden"
          >
            <div
              className={cn(
                'h-full rounded-full transition-all',
                isMatch ? 'bg-success' : 'bg-danger',
              )}
              style={{ width: `${confidencePct}%` }}
            />
          </div>
        </div>
      )}

      {/* Metadata grid */}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
        {result.distance !== null && (
          <>
            <dt className="text-ink-sub">{t('kyc.distance_label')}</dt>
            <dd className="font-mono text-ink">{result.distance.toFixed(4)}</dd>
          </>
        )}
        <dt className="text-ink-sub">{t('kyc.decided_at_label')}</dt>
        <dd className="text-ink">
          {new Date(result.decision_at).toLocaleString()}
        </dd>
        <dt className="text-ink-sub">{t('kyc.geometry_label')}</dt>
        <dd>
          <Badge tone={result.face_geometry_ok ? 'success' : 'warning'}>
            {result.face_geometry_ok ? t('kyc.geometry_ok') : t('kyc.geometry_fail')}
          </Badge>
        </dd>
      </dl>

      {/* Audit trail link */}
      {result.match_id !== undefined && (
        <a
          href={`/admin/kyc/face-match/audit/${result.match_id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-2xs text-brand-blue hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue rounded"
        >
          <ExternalLink size={11} aria-hidden="true" />
          {t('kyc.audit_trail_link')}
        </a>
      )}

      {/* Reset button */}
      <div className="pt-2 border-t border-divider">
        <button
          type="button"
          onClick={onReset}
          className="text-xs text-brand-blue hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue rounded"
        >
          {t('kyc.try_again')}
        </button>
      </div>
    </div>
  );
}
