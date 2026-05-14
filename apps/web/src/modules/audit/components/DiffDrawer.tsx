/**
 * DiffDrawer — Plan 3 (Wave-E1) Task #4 expanded shape.
 *
 * Right-side drawer for an audit_log event. Backed by
 * GET /spa/api/audit/events/:id/with-context which returns the parsed event
 * plus the prev/next neighbours from the hash chain.
 *
 * Sections (top → bottom):
 *   1. Meta — timestamp, actor, result, hash.
 *   2. Policy decision — pretty-printed OPA decision JSON
 *      (testid `audit-policy-decision-json`).
 *   3. Before → After — side-by-side diff when `detail.before`/`detail.after`
 *      are present (testid `audit-before-after`).
 *   4. Hash chain segment — prev / this / next ids + hash prefixes
 *      (testid `audit-chain-segment`).
 *
 * Wrapper testid `audit-diff-drawer` is the Plan-3 contract; the legacy
 * `diff-drawer` testid is retained inside for backwards compat.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Drawer } from '@/components/ui';
import { fetchEventWithContext } from '../api';
import type { AuditEvent } from '../schemas';
import { cn } from '@/lib/cn';

// ---------------------------------------------------------------------------
// Diff helpers
// ---------------------------------------------------------------------------

type JsonVal = string | number | boolean | null | undefined;
type JsonObj = Record<string, JsonVal>;

interface DiffEntry {
  key: string;
  kind: 'added' | 'removed' | 'modified' | 'unchanged';
  before: JsonVal;
  after: JsonVal;
}

function diffObjects(before: JsonObj, after: JsonObj): DiffEntry[] {
  const allKeys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)])).sort();
  return allKeys.map((key) => {
    const hasBefore = key in before;
    const hasAfter  = key in after;
    if (!hasBefore) return { key, kind: 'added',   before: undefined, after: after[key] };
    if (!hasAfter)  return { key, kind: 'removed',  before: before[key], after: undefined };
    if (before[key] !== after[key]) return { key, kind: 'modified', before: before[key], after: after[key] };
    return { key, kind: 'unchanged', before: before[key], after: after[key] };
  });
}

const kindStyles: Record<DiffEntry['kind'], string> = {
  added:     'bg-success-bg/60 text-success',
  removed:   'bg-danger-bg/60  text-danger',
  modified:  'bg-warning-bg/60 text-warning',
  unchanged: 'text-ink',
};

const kindBadge: Record<DiffEntry['kind'], string> = {
  added:     '+',
  removed:   '−',
  modified:  '~',
  unchanged: ' ',
};

function DiffRow({ entry }: { entry: DiffEntry }) {
  const cls = kindStyles[entry.kind];
  return (
    <tr className={cn('font-mono text-xs border-b border-divider last:border-0', cls)}>
      <td className="px-2 py-1 w-5 select-none opacity-60">{kindBadge[entry.kind]}</td>
      <td className="px-2 py-1 font-medium max-w-[120px] truncate">{entry.key}</td>
      {entry.kind === 'modified' ? (
        <>
          <td className="px-2 py-1 max-w-[160px] truncate line-through opacity-60">
            {JSON.stringify(entry.before)}
          </td>
          <td className="px-2 py-1 max-w-[160px] truncate">
            {JSON.stringify(entry.after)}
          </td>
        </>
      ) : (
        <td className="px-2 py-1 max-w-[320px] truncate" colSpan={2}>
          {entry.kind === 'removed'
            ? JSON.stringify(entry.before)
            : JSON.stringify(entry.after)}
        </td>
      )}
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  event:   AuditEvent | null;
  onClose: () => void;
}

function hashPrefix(h: string | null | undefined): string {
  if (!h) return '(genesis)';
  return h.length > 16 ? `${h.slice(0, 16)}…` : h;
}

export function DiffDrawer({ event, onClose }: Props) {
  const open = event !== null;

  const ctxQ = useQuery({
    queryKey: ['audit', 'event-with-context', event?.id],
    queryFn: () => fetchEventWithContext(event!.id),
    enabled: event !== null,
    staleTime: 30_000,
  });

  const parsedDetail = ctxQ.data?.event.detail as
    | { before?: JsonObj; after?: JsonObj } & Record<string, unknown>
    | null
    | undefined;

  const diffs = useMemo<DiffEntry[] | null>(() => {
    if (!parsedDetail) return null;
    if (parsedDetail.before === undefined && parsedDetail.after === undefined) return null;
    return diffObjects(
      (parsedDetail.before ?? {}) as JsonObj,
      (parsedDetail.after ?? {}) as JsonObj,
    );
  }, [parsedDetail]);

  const title = event
    ? `${event.action ?? 'Event'} — ${event.entity_type ?? ''} ${event.entity_id ?? ''}`.trim()
    : 'Event detail';

  const policyDecision = ctxQ.data?.event.policy_decision ?? null;
  const chain = ctxQ.data?.chain ?? null;

  return (
    <Drawer open={open} onClose={onClose} side="right" title={title} width="640px">
      {event && (
        <div
          data-testid="audit-diff-drawer"
          className="space-y-4 text-sm"
        >
          {/* Legacy testid alias for any older specs. */}
          <span data-testid="diff-drawer" hidden />

          {/* Meta */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <span className="text-muted">Timestamp</span>
            <span className="text-ink">{event.created_at ? new Date(event.created_at).toLocaleString() : '—'}</span>
            <span className="text-muted">Actor</span>
            <span className="text-ink">{event.username ?? '—'}</span>
            <span className="text-muted">Result</span>
            <span className={cn(
              'font-medium',
              event.result === 'allow' ? 'text-success' :
              event.result === 'deny'  ? 'text-danger'  : 'text-warning',
            )}>
              {event.result ?? '—'}
            </span>
            <span className="text-muted">Hash</span>
            <span className="text-ink font-mono text-2xs break-all">{event.hash ?? '—'}</span>
          </div>

          <hr className="border-divider" />

          {/* Plan 3 (Wave-E1) — Policy decision JSON */}
          <section aria-labelledby="audit-policy-decision-title">
            <h3
              id="audit-policy-decision-title"
              className="text-2xs uppercase tracking-wider text-muted font-semibold mb-1.5"
            >
              Policy decision
            </h3>
            <pre
              data-testid="audit-policy-decision-json"
              className="text-2xs bg-raised border border-divider rounded-input p-3 overflow-x-auto font-mono"
            >
              {policyDecision !== null && policyDecision !== undefined
                ? JSON.stringify(policyDecision, null, 2)
                : '(no policy_decision recorded for this event)'}
            </pre>
          </section>

          {/* Plan 3 (Wave-E1) — Before → After (only when both keys present) */}
          {diffs && (
            <section
              data-testid="audit-before-after"
              aria-labelledby="audit-before-after-title"
            >
              <h3
                id="audit-before-after-title"
                className="text-2xs uppercase tracking-wider text-muted font-semibold mb-1.5"
              >
                Before → After
              </h3>
              <div className="overflow-x-auto rounded-input border border-divider">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-raised text-2xs text-muted">
                      <th className="px-2 py-1 w-5" />
                      <th className="px-2 py-1 text-left">Field</th>
                      <th className="px-2 py-1 text-left">Before</th>
                      <th className="px-2 py-1 text-left">After</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diffs.map((d) => <DiffRow key={d.key} entry={d} />)}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Plan 3 (Wave-E1) — Hash chain segment */}
          {chain && (
            <section
              data-testid="audit-chain-segment"
              aria-labelledby="audit-chain-segment-title"
            >
              <h3
                id="audit-chain-segment-title"
                className="text-2xs uppercase tracking-wider text-muted font-semibold mb-1.5"
              >
                Hash chain segment
              </h3>
              <ul className="text-2xs font-mono space-y-1 bg-raised border border-divider rounded-input p-3">
                <li>
                  prev: {hashPrefix(chain.prev?.hash ?? null)}
                  {chain.prev !== null && <span className="text-muted"> (#{chain.prev.id})</span>}
                </li>
                <li>
                  this: prev_hash = {hashPrefix(chain.this.prev_hash)} → hash = {hashPrefix(chain.this.hash)}
                  <span className="text-muted"> (#{chain.this.id})</span>
                </li>
                <li>
                  next: {chain.next ? hashPrefix(chain.next.hash) : '(head)'}
                  {chain.next !== null && <span className="text-muted"> (#{chain.next.id})</span>}
                </li>
              </ul>
            </section>
          )}

          {/* Fallback: raw detail when no before/after structure was present. */}
          {!diffs && parsedDetail !== null && parsedDetail !== undefined && (
            <section aria-labelledby="audit-raw-detail-title">
              <h3
                id="audit-raw-detail-title"
                className="text-2xs uppercase tracking-wider text-muted font-semibold mb-1.5"
              >
                Event detail
              </h3>
              <pre className="text-2xs bg-raised border border-divider rounded-input p-3 overflow-x-auto font-mono max-h-96">
                {JSON.stringify(parsedDetail, null, 2)}
              </pre>
            </section>
          )}
        </div>
      )}
    </Drawer>
  );
}
