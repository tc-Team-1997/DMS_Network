/**
 * EntityPivot — groups audit events by a chosen dimension and shows
 * count + first/last timestamps + a drill-down link per bucket.
 *
 * Pivot dimensions: entity_type | document_id | customer_cid | user_id
 */

import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { BarChart3, Loader2 } from 'lucide-react';
import { fetchAuditPivot } from '../api';
import type { PivotBy } from '../schemas';
import { DataTable, type Column } from '@/components/ui';
import type { PivotRow } from '../schemas';
import { cn } from '@/lib/cn';

const PIVOT_OPTIONS: { value: PivotBy; label: string }[] = [
  { value: 'entity_type',  label: 'By entity type' },
  { value: 'document_id',  label: 'By document' },
  { value: 'customer_cid', label: 'By customer CID' },
  { value: 'user_id',      label: 'By user' },
];

const columns: Column<PivotRow & { id: string }>[] = [
  { key: 'pivot_key',   header: 'Group',       render: (r) => String(r.pivot_key ?? '—') },
  { key: 'event_count', header: 'Events',      width: 80,  align: 'right', render: (r) => r.event_count.toLocaleString() },
  { key: 'first_event', header: 'First event', width: 160, render: (r) => r.first_event ? new Date(r.first_event).toLocaleString() : '—' },
  { key: 'last_event',  header: 'Last event',  width: 160, render: (r) => r.last_event  ? new Date(r.last_event).toLocaleString()  : '—' },
  { key: 'actions',     header: 'Actions seen',             render: (r) => r.actions ?? '—' },
];

export function EntityPivot() {
  const [params, setParams] = useSearchParams();
  const by: PivotBy = (params.get('pivot_by') as PivotBy) ?? 'entity_type';

  const q = useQuery({
    queryKey: ['audit', 'pivot', by],
    queryFn: () => fetchAuditPivot(by),
    staleTime: 30_000,
  });

  const setPivotBy = (val: PivotBy) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('pivot_by', val);
      return next;
    });
  };

  const rows = (q.data?.rows ?? []).map((r, i) => ({
    ...r,
    id: `${r.pivot_key ?? 'null'}-${i}`,
  }));

  return (
    <div className="space-y-4" data-testid="entity-pivot">
      {/* Pivot selector */}
      <div className="flex items-center gap-2">
        <BarChart3 size={16} className="text-muted" />
        <span className="text-sm font-medium text-ink">Pivot by:</span>
        {PIVOT_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setPivotBy(opt.value)}
            className={cn(
              'rounded-badge px-3 py-1 text-xs font-medium transition',
              by === opt.value
                ? 'bg-brand-blue text-white'
                : 'bg-divider text-ink hover:bg-border',
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {q.isLoading && (
        <div className="flex items-center gap-2 text-sm text-muted py-4">
          <Loader2 size={14} className="animate-spin" />
          Loading pivot…
        </div>
      )}

      {q.isError && (
        <p className="text-sm text-danger py-4">Failed to load pivot data.</p>
      )}

      {!q.isLoading && !q.isError && (
        <DataTable<PivotRow & { id: string }>
          columns={columns}
          data={rows}
          empty="No audit events found for this pivot."
        />
      )}
    </div>
  );
}
