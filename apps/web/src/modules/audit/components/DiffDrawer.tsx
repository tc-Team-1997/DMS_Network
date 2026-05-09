/**
 * DiffDrawer — right-side drawer showing the before→after diff for an audit event.
 *
 * For CRUD events (detail JSON has "before" + "after" keys): side-by-side diff.
 *   - Additions:    green background
 *   - Removals:     red background
 *   - Modifications: yellow background (key in both, value changed)
 *
 * For non-CRUD events (login, denial, system): pretty-prints the full JSON.
 *
 * Uses the CC4 Drawer primitive.
 */

import { useMemo } from 'react';
import { Drawer } from '@/components/ui';
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

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

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

export function DiffDrawer({ event, onClose }: Props) {
  const open = event !== null;

  const parsed = useMemo<{ before: JsonObj | null; after: JsonObj | null; raw: unknown } | null>(() => {
    if (!event) return null;
    const src = event.detail ?? event.details;
    if (!src) return { before: null, after: null, raw: null };
    try {
      const obj = JSON.parse(src) as Record<string, unknown>;
      const before = obj['before'] !== undefined ? (obj['before'] as JsonObj) : null;
      const after  = obj['after']  !== undefined ? (obj['after']  as JsonObj) : null;
      return { before, after, raw: obj };
    } catch {
      return { before: null, after: null, raw: src };
    }
  }, [event]);

  const diffs = useMemo<DiffEntry[] | null>(() => {
    if (!parsed?.before && !parsed?.after) return null;
    return diffObjects(parsed.before ?? {}, parsed.after ?? {});
  }, [parsed]);

  const title = event
    ? `${event.action ?? 'Event'} — ${event.entity_type ?? ''} ${event.entity_id ?? ''}`.trim()
    : 'Event detail';

  return (
    <Drawer open={open} onClose={onClose} side="right" title={title} width="560px">
      {event && (
        <div className="space-y-4 text-sm" data-testid="diff-drawer">
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

          {/* Diff or pretty-print */}
          {diffs ? (
            <>
              <p className="text-xs font-semibold text-ink">Before → After</p>
              <div className="overflow-x-auto rounded-input border border-divider">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-raised text-xs text-muted">
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
            </>
          ) : (
            <>
              <p className="text-xs font-semibold text-ink">Event payload</p>
              <pre className="overflow-auto rounded-input border border-divider bg-raised p-3 text-2xs text-ink font-mono max-h-96">
                {parsed !== null && parsed.raw != null
                  ? JSON.stringify(parsed.raw, null, 2)
                  : '(no detail)'}
              </pre>
            </>
          )}
        </div>
      )}
    </Drawer>
  );
}
