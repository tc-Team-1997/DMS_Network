/**
 * AnchorBadge — shows the last OTS anchor timestamp and block hash,
 * and provides a "Anchor now" button for Doc Admins.
 *
 * Calls POST /spa/api/audit/anchor with the current chain head hash.
 * The chain head comes from the verify-chain response.
 */

import { useState } from 'react';
import { Anchor, Loader2, ExternalLink } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { anchorChain } from '../api';
import type { AnchorResponse } from '../schemas';
import { cn } from '@/lib/cn';

interface Props {
  /** The chain head hash from the verify-chain response. */
  headHash: string | null;
  /** If false, the "Anchor now" button is hidden (read-only roles). */
  canAnchor?: boolean;
}

export function AnchorBadge({ headHash, canAnchor = false }: Props) {
  const qc = useQueryClient();
  const [lastAnchor, setLastAnchor] = useState<AnchorResponse | null>(null);

  const mutation = useMutation({
    mutationFn: () => anchorChain(headHash),
    onSuccess: (data) => {
      setLastAnchor(data);
      // Invalidate verify-chain so the badge refreshes.
      void qc.invalidateQueries({ queryKey: ['audit', 'verify-chain'] });
    },
  });

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-3 rounded-card border border-divider bg-raised px-4 py-3',
      )}
      data-testid="anchor-badge"
    >
      <Anchor size={16} className="text-muted shrink-0" />

      <div className="flex-1 min-w-0">
        {lastAnchor ? (
          <>
            <p className="text-sm font-medium text-ink">
              Anchored at {lastAnchor.ts ? new Date(lastAnchor.ts).toLocaleString() : '—'}
            </p>
            <p className="text-xs text-muted mt-0.5 font-mono break-all">
              Block: {lastAnchor.block_hash?.slice(0, 32) ?? '—'}…
            </p>
          </>
        ) : (
          <p className="text-sm text-muted">
            No anchor in this session.
            {headHash && (
              <span className="ml-1 font-mono text-2xs text-muted">
                Head: {headHash.slice(0, 16)}…
              </span>
            )}
          </p>
        )}
      </div>

      {lastAnchor?.block_hash && (
        <a
          href={`#anchor-${lastAnchor.block_hash.slice(0, 8)}`}
          className="inline-flex items-center gap-1 text-xs text-brand-blue hover:underline"
          title="Anchor verification link (local chain)"
        >
          <ExternalLink size={11} />
          Verify
        </a>
      )}

      {canAnchor && (
        <button
          type="button"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || !headHash}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-input border border-border bg-surface',
            'px-3 py-1.5 text-xs font-medium text-ink hover:bg-divider transition',
            'disabled:opacity-50 disabled:cursor-not-allowed',
          )}
        >
          {mutation.isPending ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <Anchor size={12} />
          )}
          Anchor now
        </button>
      )}

      {mutation.isError && (
        <p className="w-full text-xs text-danger mt-1">
          Anchor failed — Python anchor service may be offline.
        </p>
      )}
    </div>
  );
}
