/**
 * PurgeLogTable — view of recent retention audit log actions.
 */
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { fetchPurgeLog } from '../api';

const ACTION_TONE: Record<string, 'danger' | 'warning' | 'blue' | 'success' | 'neutral'> = {
  RETENTION_PURGE: 'danger',
  RETENTION_BLOCKED_LEGAL_HOLD: 'warning',
  RETENTION_TRIGGER: 'neutral',
  RETENTION_RULE_UPDATE: 'blue',
  LEGAL_HOLD_APPLIED: 'blue',
  LEGAL_HOLD_RELEASED: 'success',
  WORM_EXTENDED: 'blue',
  WORM_LOCKED: 'warning',
  WORM_UNLOCKED: 'success',
};

function actionTone(action: string | null): 'danger' | 'warning' | 'blue' | 'success' | 'neutral' {
  return ACTION_TONE[action ?? ''] ?? 'neutral';
}

export function PurgeLogTable({ limit = 100 }: { limit?: number }) {
  const q = useQuery({
    queryKey: ['retention', 'purge-log', limit],
    queryFn: () => fetchPurgeLog(limit),
    refetchInterval: 60_000,
  });

  if (q.isLoading) return <Skeleton className="h-48 w-full rounded-card" />;

  if (q.isError) {
    return (
      <EmptyState
        title="Failed to load purge log"
        body="Could not fetch retention audit log. Ensure the backend is running."
      />
    );
  }

  const rows = q.data ?? [];

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No retention events yet"
        body="Retention actions (purges, holds, WORM operations) will appear here."
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-card border border-divider bg-surface">
      <table className="w-full text-sm">
        <thead>
          <tr className="table-header">
            <th className="px-3 py-2 text-left text-[11px] font-semibold text-ink-sub">Time</th>
            <th className="px-3 py-2 text-left text-[11px] font-semibold text-ink-sub">Action</th>
            <th className="px-3 py-2 text-left text-[11px] font-semibold text-ink-sub">Entity</th>
            <th className="px-3 py-2 text-left text-[11px] font-semibold text-ink-sub">Actor</th>
            <th className="px-3 py-2 text-left text-[11px] font-semibold text-ink-sub">Details</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t border-divider hover:bg-raised/40">
              <td className="px-3 py-2 text-xs text-muted whitespace-nowrap">
                {new Date(row.created_at).toLocaleString()}
              </td>
              <td className="px-3 py-2">
                <Badge tone={actionTone(row.action)}>
                  {row.action ?? '—'}
                </Badge>
              </td>
              <td className="px-3 py-2 text-xs text-muted">
                {row.entity ?? '—'}{row.entity_id !== null ? ` #${row.entity_id}` : ''}
              </td>
              <td className="px-3 py-2 text-xs text-ink">{row.username ?? '—'}</td>
              <td className="px-3 py-2 text-xs text-muted max-w-[240px] truncate">
                {row.details ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
