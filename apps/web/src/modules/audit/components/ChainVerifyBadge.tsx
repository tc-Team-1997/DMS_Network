/**
 * ChainVerifyBadge — Plan 3 (Wave-E1) banner shape + re-verify control.
 *
 * Renders a prominent green "Chain verified through N events (SHA-256 forward
 * chain)" banner — or a red "broken at event #N" banner — at the top of the
 * Audit Log page. Pulls from GET /spa/api/audit/chain/verify (the new full-walk
 * endpoint) and falls back to a checking state while the query is in flight.
 *
 * Testid `audit-chain-banner` is the Plan-3 contract (Task #4).
 *
 * Plan 3 Task #4 follow-up — "Re-verify chain" button: explicit operator-
 * triggered re-verification refetches the query AND emits an
 * `audit.chain_verify` SPA audit row so the audit log can answer
 * "who verified the integrity, and when". The page-load auto-verify does
 * NOT emit (would create one row per page view).
 *
 * Hash algorithm (server-side; client just renders the verdict):
 *   canonical_json = JSON.stringify(sortedKeys(rowDict))   // no whitespace
 *   hash = sha256( (prevHash || '') + canonical_json )
 */

import { useQueryClient, useQuery } from '@tanstack/react-query';
import { ShieldCheck, ShieldAlert, Loader2, RefreshCw } from 'lucide-react';
import { fetchChainVerify } from '../api';
import type { ChainVerifyV2Response } from '../schemas';
import { cn } from '@/lib/cn';
import { emitAuditEvent } from '@/lib/audit-events';

interface Props {
  /** Optional pre-fetched server result so the badge can be parented from a single query. */
  serverResult?: ChainVerifyV2Response;
}

export function ChainVerifyBadge({ serverResult }: Props) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['audit', 'chain-verify-v2'],
    queryFn: fetchChainVerify,
    enabled: !serverResult,
    staleTime: 60_000,
  });

  const result = serverResult ?? q.data;

  async function handleReverify() {
    // Emit BEFORE the refetch so the audit row is written ASAP and the
    // verification verdict (which we'll see next render) is independent of
    // whether the audit row ends up in the new chain count.
    emitAuditEvent({
      action:      'audit.chain_verify',
      entity_type: 'audit_log',
      detail: {
        trigger:        'user_reverify_button',
        latest_anchor:  result?.latest_anchor ?? null,
        prior_verdict:  result ? result.verified : null,
        prior_count:    result?.count ?? null,
      },
    });
    await qc.invalidateQueries({ queryKey: ['audit', 'chain-verify-v2'] });
  }

  // Checking state.
  if (!result) {
    return (
      <div
        data-testid="audit-chain-banner"
        className="flex items-center gap-2 rounded-card border border-divider bg-raised px-4 py-3 text-sm text-muted"
      >
        <Loader2 size={14} className="animate-spin" />
        Verifying chain integrity…
      </div>
    );
  }

  if (result.verified) {
    return (
      <div
        data-testid="audit-chain-banner"
        aria-live="polite"
        className={cn(
          'chain-verified flex flex-wrap items-center gap-3 rounded-card border px-4 py-3',
          'border-success/40 bg-success-bg',
        )}
      >
        <ShieldCheck size={18} className="text-success shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-success">
            Chain verified through {result.count} event{result.count === 1 ? '' : 's'}
          </p>
          <p className="text-2xs text-muted mt-0.5">
            SHA-256 forward chain
            {result.latest_anchor && (
              <span className="ml-2 font-mono text-ink">
                head: {result.latest_anchor.slice(0, 16)}…
              </span>
            )}
          </p>
        </div>
        <button
          type="button"
          data-testid="audit-chain-reverify"
          onClick={handleReverify}
          disabled={q.isFetching}
          aria-label="Re-verify chain integrity (emits audit.chain_verify)"
          className={cn(
            'inline-flex items-center gap-1.5 rounded-input border px-3 py-1.5 text-xs font-medium transition min-h-[32px]',
            'border-success/40 bg-surface text-success hover:bg-success-bg/60 focus:outline-none focus:ring-2 focus:ring-success/40',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        >
          {q.isFetching ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          Re-verify
        </button>
      </div>
    );
  }

  return (
    <div
      data-testid="audit-chain-banner"
      role="alert"
      aria-live="assertive"
      className={cn(
        'chain-broken flex flex-wrap items-center gap-3 rounded-card border px-4 py-3',
        'border-danger/40 bg-danger-bg',
      )}
    >
      <ShieldAlert size={18} className="text-danger shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-danger">
          Chain integrity broken at event #{result.broken_at}
        </p>
        <p className="text-2xs text-muted mt-0.5">
          SHA-256 forward chain · {result.count} event{result.count === 1 ? '' : 's'} scanned
        </p>
      </div>
      <button
        type="button"
        data-testid="audit-chain-reverify"
        onClick={handleReverify}
        disabled={q.isFetching}
        aria-label="Re-verify chain integrity (emits audit.chain_verify)"
        className={cn(
          'inline-flex items-center gap-1.5 rounded-input border px-3 py-1.5 text-xs font-medium transition min-h-[32px]',
          'border-danger/40 bg-surface text-danger hover:bg-danger-bg/60 focus:outline-none focus:ring-2 focus:ring-danger/40',
          'disabled:opacity-50 disabled:cursor-not-allowed',
        )}
      >
        {q.isFetching ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
        Re-verify
      </button>
    </div>
  );
}
