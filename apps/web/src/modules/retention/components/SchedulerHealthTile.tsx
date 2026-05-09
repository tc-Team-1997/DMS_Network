/**
 * SchedulerHealthTile — retention sweep health dashboard cards.
 * Shows last sweep timestamp, documents purged today/week/month,
 * and count blocked by legal hold.
 */
import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { MetricCard } from '@/components/ui/MetricCard';
import { Skeleton } from '@/components/ui/Skeleton';
import { fetchSweepStatus } from '../api';

export function SchedulerHealthTile() {
  const q = useQuery({
    queryKey: ['retention', 'sweep-status'],
    queryFn: fetchSweepStatus,
    refetchInterval: 60_000,
  });

  if (q.isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24 rounded-card" />
        ))}
      </div>
    );
  }

  if (q.isError || q.data === undefined) {
    return (
      <div className="rounded-card border border-warning/40 bg-warning-bg px-4 py-3 text-sm text-ink flex items-center gap-2">
        <RefreshCw size={14} className="text-warning" />
        Sweep status unavailable — the retention job may not have run yet.
      </div>
    );
  }

  const { last_sweep_at, purged_today, purged_week, purged_month, blocked_by_legal_hold } = q.data;

  const lastSweepLabel = last_sweep_at
    ? new Date(last_sweep_at).toLocaleString()
    : 'Never';

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted">
          Last sweep: <span className="font-medium text-ink">{lastSweepLabel}</span>
        </p>
        <button
          type="button"
          onClick={() => { void q.refetch(); }}
          className="inline-flex items-center gap-1 text-xs text-brand-blue hover:underline focus:outline-none"
          aria-label="Refresh sweep status"
        >
          <RefreshCw size={11} />
          Refresh
        </button>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard
          label="Purged today"
          value={purged_today}
          tone={purged_today > 0 ? 'warning' : 'neutral'}
        />
        <MetricCard
          label="Purged this week"
          value={purged_week}
          tone={purged_week > 0 ? 'warning' : 'neutral'}
        />
        <MetricCard
          label="Purged this month"
          value={purged_month}
          tone={purged_month > 50 ? 'danger' : purged_month > 0 ? 'warning' : 'neutral'}
        />
        <MetricCard
          label="Blocked by legal hold"
          value={blocked_by_legal_hold}
          tone={blocked_by_legal_hold > 0 ? 'blue' : 'neutral'}
        />
      </div>
    </div>
  );
}
