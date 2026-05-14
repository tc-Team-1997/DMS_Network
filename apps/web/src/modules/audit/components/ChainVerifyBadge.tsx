/**
 * ChainVerifyBadge — Plan 3 (Wave-E1) banner shape.
 *
 * Renders a prominent green "Chain verified through N events (SHA-256 forward
 * chain)" banner — or a red "broken at event #N" banner — at the top of the
 * Audit Log page. Pulls from GET /spa/api/audit/chain/verify (the new full-walk
 * endpoint) and falls back to a checking state while the query is in flight.
 *
 * Testid `audit-chain-banner` is the Plan-3 contract (Task #4). The legacy
 * `chain-verify-badge` testid is kept as an alias for backwards compat.
 *
 * Hash algorithm (server-side; client just renders the verdict):
 *   canonical_json = JSON.stringify(sortedKeys(rowDict))   // no whitespace
 *   hash = sha256( (prevHash || '') + canonical_json )
 */

import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, ShieldAlert, Loader2 } from 'lucide-react';
import { fetchChainVerify } from '../api';
import type { ChainVerifyV2Response } from '../schemas';
import { cn } from '@/lib/cn';

interface Props {
  /** Optional pre-fetched server result so the badge can be parented from a single query. */
  serverResult?: ChainVerifyV2Response;
}

export function ChainVerifyBadge({ serverResult }: Props) {
  const q = useQuery({
    queryKey: ['audit', 'chain-verify-v2'],
    queryFn: fetchChainVerify,
    enabled: !serverResult,
    staleTime: 60_000,
  });

  const result = serverResult ?? q.data;

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
    </div>
  );
}
