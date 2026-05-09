/**
 * DecisionHistoryTab — shows prior decisions and suppressions for a hit.
 *
 * Calls fetchHitHistory(hitId) and renders:
 *   - decisions[] in reverse-chronological order with an "Apply prior verdict"
 *     button (disabled when a suppression is still active)
 *   - suppressions[] showing active/expired state
 *
 * "Apply prior verdict" re-decides the hit using the same decision value from
 * the history item. It does NOT re-open the action tab; the parent is notified
 * via onApplied so it can navigate to the action tab or close the modal.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle, Clock, ShieldAlert } from 'lucide-react';
import { Button } from '@/components/ui';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import { fetchHitHistory, decideHit } from '../api';
import type { DecisionEnum } from '../schemas';

interface DecisionHistoryTabProps {
  hitId: number;
  onApplied?: () => void;
}

function decisionBadgeClass(decision: string): string {
  switch (decision) {
    case 'cleared':   return 'bg-success-bg text-success';
    case 'escalated': return 'bg-warning-bg text-warning';
    case 'blocked':   return 'bg-danger-bg text-danger';
    case 'edd':       return 'bg-brand-skyLight text-brand-blue';
    default:          return 'bg-divider text-ink-sub';
  }
}

function isActiveSupression(suppressedUntil: string | null): boolean {
  if (!suppressedUntil) return true; // no expiry = permanent
  return new Date(suppressedUntil) > new Date();
}

const DECIDABLE: DecisionEnum[] = ['cleared', 'escalated', 'blocked', 'edd'];

function isDecidable(d: string): d is DecisionEnum {
  return (DECIDABLE as string[]).includes(d);
}

export function DecisionHistoryTab({ hitId, onApplied }: DecisionHistoryTabProps) {
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ['aml', 'hit-history', hitId],
    queryFn: () => fetchHitHistory(hitId),
  });

  const applyMutation = useMutation({
    mutationFn: ({ decision, notes }: { decision: DecisionEnum; notes: string }) =>
      decideHit(hitId, decision, notes),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['aml', 'hits'] });
      void qc.invalidateQueries({ queryKey: ['aml', 'hit-history', hitId] });
      onApplied?.();
    },
  });

  if (q.isLoading) {
    return (
      <div className="space-y-2 py-4" aria-busy="true" aria-label={t('aml.loading')}>
        {[1, 2, 3].map((n) => (
          <div key={n} className="h-16 rounded-card bg-divider animate-pulse" />
        ))}
      </div>
    );
  }

  if (q.isError) {
    return (
      <div className="rounded-input border border-danger/30 bg-danger-bg px-3 py-2 text-xs text-danger flex items-center gap-2">
        <AlertTriangle size={13} aria-hidden="true" />
        {t('aml.error_load_failed')}
      </div>
    );
  }

  const history = q.data;
  if (!history) return null;

  // A suppression is "active" when suppressed_until is null or in the future
  const hasActiveSupression = history.suppressions.some(
    (s) => s.is_active && isActiveSupression(s.suppressed_until),
  );

  const decisions = [...history.decisions].sort((a, b) => {
    const ta = a.reviewed_at ? new Date(a.reviewed_at).getTime() : 0;
    const tb = b.reviewed_at ? new Date(b.reviewed_at).getTime() : 0;
    return tb - ta; // newest first
  });

  const suppressions = [...history.suppressions].sort((a, b) => {
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  return (
    <div className="space-y-5">
      {/* Apply-prior-verdict error */}
      {applyMutation.isError && (
        <div className="rounded-input border border-danger/30 bg-danger-bg px-3 py-2 text-xs text-danger" role="alert">
          {t('aml.error_generic')}
        </div>
      )}

      {/* Decisions */}
      <section aria-label={t('aml.v2.history_decisions_label')}>
        <h3 className="text-2xs font-semibold text-muted uppercase tracking-wide mb-2">
          {t('aml.v2.history_decisions_label')}
        </h3>

        {decisions.length === 0 ? (
          <p className="text-xs text-muted italic">{t('aml.v2.history_no_decisions')}</p>
        ) : (
          <ol className="space-y-2" reversed>
            {decisions.map((d) => (
              <li
                key={`${d.hit_id}-${d.reviewed_at ?? d.decision}`}
                className="flex items-start justify-between gap-3 rounded-card border border-divider bg-surface px-3 py-2"
              >
                <div className="min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={cn(
                        'inline-block rounded-badge px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-wide',
                        decisionBadgeClass(d.decision),
                      )}
                    >
                      {d.decision}
                    </span>
                    {d.reviewed_at && (
                      <span className="text-2xs text-muted font-mono">
                        {new Date(d.reviewed_at).toLocaleString()}
                      </span>
                    )}
                    {d.reviewed_by && (
                      <span className="text-2xs text-muted">
                        {t('aml.v2.history_by')} {String(d.reviewed_by)}
                      </span>
                    )}
                  </div>
                  {d.notes && (
                    <p className="text-2xs text-ink-sub truncate max-w-xs" title={d.notes}>
                      {d.notes}
                    </p>
                  )}
                </div>

                {isDecidable(d.decision) && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={hasActiveSupression || applyMutation.isPending}
                    title={hasActiveSupression ? t('aml.v2.apply_verdict_disabled_tip') : t('aml.v2.apply_verdict_tip')}
                    onClick={() =>
                      applyMutation.mutate({
                        decision: d.decision as DecisionEnum,
                        notes: `${t('aml.v2.apply_verdict_auto_note')} ${d.reviewed_at ?? ''}`.trim(),
                      })
                    }
                    className="shrink-0 text-2xs"
                  >
                    <CheckCircle size={11} aria-hidden="true" className="mr-0.5" />
                    {t('aml.v2.apply_verdict_button')}
                  </Button>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* Suppressions */}
      <section aria-label={t('aml.v2.history_suppressions_label')}>
        <h3 className="text-2xs font-semibold text-muted uppercase tracking-wide mb-2">
          {t('aml.v2.history_suppressions_label')}
        </h3>

        {suppressions.length === 0 ? (
          <p className="text-xs text-muted italic">{t('aml.v2.history_no_suppressions')}</p>
        ) : (
          <ol className="space-y-2">
            {suppressions.map((s) => {
              const active = s.is_active && isActiveSupression(s.suppressed_until);
              return (
                <li
                  key={s.suppression_id}
                  className={cn(
                    'rounded-card border px-3 py-2 space-y-0.5',
                    active ? 'border-brand-blue/30 bg-brand-skyLight/30' : 'border-divider bg-surface',
                  )}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    {active ? (
                      <span className="inline-flex items-center gap-1 text-2xs text-brand-blue font-semibold">
                        <Clock size={10} aria-hidden="true" />
                        {t('aml.v2.suppression_active')}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-2xs text-muted">
                        <ShieldAlert size={10} aria-hidden="true" />
                        {t('aml.v2.suppression_expired')}
                      </span>
                    )}
                    <span className="text-2xs text-muted font-mono">
                      {new Date(s.created_at).toLocaleString()}
                    </span>
                    <span className="text-2xs text-muted">
                      {t('aml.v2.history_by')} {s.suppressed_by}
                    </span>
                  </div>
                  <p className="text-2xs text-ink-sub">{s.suppression_reason}</p>
                  {s.suppressed_until && (
                    <p className="text-2xs text-muted">
                      {t('aml.v2.suppression_until')}: {new Date(s.suppressed_until).toLocaleDateString()}
                    </p>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}
