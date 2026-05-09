/**
 * SyncStatusCard — displays last 7-day offline sync statistics.
 *
 * Endpoint: GET /spa/api/sync/status
 *
 * Test IDs:
 *   sync-status-card       — root container
 *   sync-status-replayed   — replayed count value
 *   sync-status-deduped    — deduped count value
 *   sync-status-failed     — failed count value
 */

import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { get } from '@/lib/http';
import { RefreshCw, CheckCircle2, Copy, AlertCircle } from 'lucide-react';
import { Panel } from '@/components/ui';
import { cn } from '@/lib/cn';

// ── Schema ───────────────────────────────────────────────────────────────────

const SyncStatusSchema = z.object({
  replayed: z.number().int().min(0),
  deduped: z.number().int().min(0),
  failed: z.number().int().min(0),
  last_sync_at: z.string().nullable(),
});
export type SyncStatus = z.infer<typeof SyncStatusSchema>;

export const fetchSyncStatus = (): Promise<SyncStatus> =>
  get('/spa/api/sync/status', SyncStatusSchema);

// ── Sub-component: metric tile ───────────────────────────────────────────────

interface TileProps {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone: 'success' | 'warning' | 'danger' | 'neutral';
  testId: string;
}

function StatTile({ label, value, icon, tone, testId }: TileProps) {
  const colours: Record<TileProps['tone'], string> = {
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
    danger:  'bg-danger/10 text-danger',
    neutral: 'bg-raised text-ink-sub',
  };

  return (
    <div className={cn('flex flex-col items-center justify-center gap-1 rounded-input px-4 py-3', colours[tone])}>
      <span className="opacity-70">{icon}</span>
      <span
        data-testid={testId}
        className="text-xl font-bold leading-tight"
        aria-label={`${value} ${label}`}
      >
        {value.toLocaleString()}
      </span>
      <span className="text-2xs font-medium uppercase tracking-wide opacity-70">{label}</span>
    </div>
  );
}

// ── Component ────────────────────────────────────────────────────────────────

export function SyncStatusCard() {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['sync', 'status'],
    queryFn: fetchSyncStatus,
    refetchInterval: 60_000,
  });

  const lastSync = data?.last_sync_at
    ? new Date(data.last_sync_at).toLocaleString()
    : 'No sync yet';

  return (
    <div data-testid="sync-status-card">
    <Panel
      className="space-y-3"
    >
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-ink">Offline Sync — last 7 days</h3>
          <p className="text-xs text-ink-sub mt-0.5">
            Last sync: <span className="font-medium">{isLoading ? '…' : lastSync}</span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => { void refetch(); }}
          aria-label="Refresh sync status"
          className="p-1.5 rounded-full hover:bg-surface-alt transition-colors"
        >
          <RefreshCw size={14} className={cn('text-ink-sub', isLoading && 'animate-spin')} />
        </button>
      </div>

      {isError && (
        <p className="text-xs text-danger">Failed to load sync statistics.</p>
      )}

      {!isError && (
        <div className="grid grid-cols-3 gap-3">
          <StatTile
            label="Replayed"
            value={data?.replayed ?? 0}
            icon={<RefreshCw size={16} />}
            tone="success"
            testId="sync-status-replayed"
          />
          <StatTile
            label="Deduped"
            value={data?.deduped ?? 0}
            icon={<Copy size={16} />}
            tone="neutral"
            testId="sync-status-deduped"
          />
          <StatTile
            label="Failed"
            value={data?.failed ?? 0}
            icon={<AlertCircle size={16} />}
            tone={data && data.failed > 0 ? 'danger' : 'neutral'}
            testId="sync-status-failed"
          />
        </div>
      )}

      {data && data.replayed === 0 && data.deduped === 0 && data.failed === 0 && (
        <div className="flex items-center gap-2 text-xs text-success">
          <CheckCircle2 size={13} />
          <span>No offline syncs in the last 7 days — all uploads were online.</span>
        </div>
      )}
    </Panel>
    </div>
  );
}
