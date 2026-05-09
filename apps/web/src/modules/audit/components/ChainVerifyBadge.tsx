/**
 * ChainVerifyBadge — walks the N most-recent audit_log rows from the server,
 * recomputes each SHA-256 hash browser-side using Web Crypto, and shows a
 * green "Chain verified" banner or a red "N mismatches" warning.
 *
 * Algorithm (identical to db/hash-chain.js and Python services):
 *   canonical_json = JSON.stringify(sortedKeys(rowDict))   // no whitespace
 *   hash = sha256( (prevHash || '') + canonical_json )
 *
 * The server's POST /spa/api/audit/verify-chain does the same walk server-side
 * so we can cross-check. Here we show the server result immediately and
 * optionally re-verify in-browser (useful when the user wants to be sure no
 * in-transit tampering occurred).
 */

import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, ShieldAlert, RefreshCw, Loader2 } from 'lucide-react';
import { verifyChain } from '../api';
import type { VerifyChainResponse } from '../schemas';
import { cn } from '@/lib/cn';

// ---------------------------------------------------------------------------
// Browser-side SHA-256 chain verifier (Web Crypto)
// ---------------------------------------------------------------------------

/** Canonical JSON: keys sorted lexicographically, no whitespace. */
function canonicalJson(obj: Record<string, unknown>): string {
  const sorted = Object.keys(obj)
    .sort()
    .reduce<Record<string, unknown>>((acc, k) => {
      const v = obj[k];
      acc[k] = v !== null && typeof v === 'object' && !Array.isArray(v)
        ? JSON.parse(canonicalJson(v as Record<string, unknown>))
        : v;
      return acc;
    }, {});
  return JSON.stringify(sorted);
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

interface AuditRow {
  id: number;
  action: string | null;
  created_at: string | null;
  detail: string | null;
  details: string | null;
  entity: string | null;
  entity_id: number | null;
  entity_type: string | null;
  hash: string | null;
  prev_hash: string | null;
  result: string | null;
  tenant_id: string | null;
  user_id: number | null;
}

function buildRowDict(row: AuditRow): Record<string, unknown> {
  return {
    action:      row.action      ?? null,
    created_at:  row.created_at  ?? null,
    detail:      row.detail ?? row.details ?? null,
    entity:      row.entity      ?? null,
    entity_id:   row.entity_id   ?? null,
    entity_type: row.entity_type ?? null,
    id:          row.id,
    result:      row.result      ?? 'allow',
    tenant_id:   row.tenant_id   ?? null,
    user_id:     row.user_id     ?? null,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  /** Window size to verify — comes from tenant config verify_chain_window. */
  window?: number;
  /** Optional: pass server result from a parent query to skip the RPC. */
  serverResult?: VerifyChainResponse;
}

export function ChainVerifyBadge({ window: verifyWindow = 1000, serverResult }: Props) {
  const [browserMismatches, setBrowserMismatches] = useState<number | null>(null);
  const [browserRunning, setBrowserRunning]       = useState(false);

  // Use server-side pre-check first (fast).
  const q = useQuery({
    queryKey: ['audit', 'verify-chain', verifyWindow],
    queryFn: () => verifyChain(verifyWindow),
    enabled: !serverResult,
    staleTime: 60_000,
  });

  const result: VerifyChainResponse | undefined = serverResult ?? q.data;

  // Browser-side re-verify (cross-check against the rows we already have).
  const runBrowserVerify = useCallback(async () => {
    if (!result) return;
    setBrowserRunning(true);
    setBrowserMismatches(null);
    try {
      // Fetch the raw rows that the server checked.
      const resp = await fetch(
        `/spa/api/audit/events?per_page=${verifyWindow}&page=1`,
        { credentials: 'include' },
      );
      if (!resp.ok) throw new Error('fetch failed');
      const data = (await resp.json()) as { events: AuditRow[] };
      const rows = [...data.events].reverse(); // oldest first

      let prevHash: string | null = rows.length > 0 ? (rows[0]?.prev_hash ?? null) : null;
      let mismatches = 0;

      for (const row of rows) {
        const rowDict = buildRowDict(row);
        const payload  = (prevHash ?? '') + canonicalJson(rowDict);
        const expected = await sha256Hex(payload);
        if (expected !== row.hash) mismatches += 1;
        prevHash = row.hash;
      }

      setBrowserMismatches(mismatches);
    } finally {
      setBrowserRunning(false);
    }
  }, [result, verifyWindow]);

  if (q.isLoading && !serverResult) {
    return (
      <div className="flex items-center gap-2 rounded-card border border-divider bg-raised px-4 py-3 text-sm text-muted">
        <Loader2 size={14} className="animate-spin" />
        Verifying chain integrity…
      </div>
    );
  }

  if (!result) return null;

  const serverOk = result.verified;
  const mismatchCount = browserMismatches ?? result.mismatched_rows.length;
  const verified = serverOk && (browserMismatches === null || browserMismatches === 0);

  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-3 rounded-card border px-4 py-3',
        verified
          ? 'border-success/30 bg-success-bg/30'
          : 'border-danger/30 bg-danger-bg/30',
      )}
      data-testid="chain-verify-badge"
    >
      {verified ? (
        <ShieldCheck size={18} className="text-success shrink-0" />
      ) : (
        <ShieldAlert size={18} className="text-danger shrink-0" />
      )}

      <div className="flex-1 min-w-0">
        <p className={cn('text-md font-semibold', verified ? 'text-success' : 'text-danger')}>
          {verified
            ? `Chain verified through ${result.checked} events`
            : `Chain integrity warning — ${mismatchCount} mismatch${mismatchCount !== 1 ? 'es' : ''} detected`}
        </p>
        <p className="text-xs text-muted mt-0.5">
          {result.head_hash
            ? `Head hash: ${result.head_hash.slice(0, 16)}…`
            : 'No hashed rows in window'}
          {browserMismatches !== null && (
            <span className="ml-2 text-ink">
              (browser-verified: {browserMismatches === 0 ? 'clean' : `${browserMismatches} mismatch${browserMismatches !== 1 ? 'es' : ''}`})
            </span>
          )}
        </p>
      </div>

      <button
        type="button"
        onClick={runBrowserVerify}
        disabled={browserRunning || !result}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-input border px-3 py-1.5 text-xs font-medium transition',
          'border-border bg-surface hover:bg-divider text-ink disabled:opacity-50',
        )}
      >
        {browserRunning ? (
          <Loader2 size={12} className="animate-spin" />
        ) : (
          <RefreshCw size={12} />
        )}
        Re-verify in browser
      </button>
    </div>
  );
}
