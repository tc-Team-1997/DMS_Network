import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, HardDrive, Play, RefreshCw, Sparkles } from 'lucide-react';
import { Badge, Button, DataTable, MetricCard, Panel, type Column } from '@/components/ui';
import {
  fetchAdminHealth,
  fetchAuditLog,
  reindexAllDocBrain,
  triggerRetention,
  type AuditRow,
} from './api';
import { CbsHealthBadge } from '@/modules/cbs/components/CbsHealthBadge';
import { SyncStatusCard } from './components/SyncStatusCard';

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86_400);
  const h = Math.floor((seconds % 86_400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${seconds}s`;
}

export function AdminPage() {
  const qc = useQueryClient();
  const health = useQuery({ queryKey: ['admin', 'health'], queryFn: fetchAdminHealth, refetchInterval: 10_000 });
  const audit = useQuery({ queryKey: ['admin', 'audit'], queryFn: () => fetchAuditLog(100) });

  const retention = useMutation({
    mutationFn: triggerRetention,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['admin', 'audit'] }); },
  });
  const reindex = useMutation({
    mutationFn: reindexAllDocBrain,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'audit'] });
      void qc.invalidateQueries({ queryKey: ['docbrain'] });
    },
  });

  const h = health.data;
  const auditColumns: Column<AuditRow>[] = [
    { key: 'when',    header: 'When',   width: 170, render: (r) => new Date(r.created_at).toLocaleString() },
    { key: 'who',     header: 'User',   width: 160,
      render: (r) => (
        <div className="flex flex-col">
          <span className="text-md text-ink">{r.username ?? 'system'}</span>
          {r.role && <span className="text-xs text-muted">{r.role}</span>}
        </div>
      ) },
    { key: 'action',  header: 'Action',               render: (r) => r.action ?? '—' },
    { key: 'entity',  header: 'Entity', width: 180,
      render: (r) => (
        <span className="text-xs text-muted font-mono">
          {r.entity ?? ''}{r.entity_id ? ` #${r.entity_id}` : ''}
        </span>
      ) },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard
          label="Node"
          value={h?.node.ok ? 'Up' : '—'}
          tone={h?.node.ok ? 'success' : 'neutral'}
          sub={h ? `${formatUptime(h.node.uptime_seconds)} · ${h.node.node_version}` : '…'}
        />
        <MetricCard
          label="Python service"
          value={h?.python.ok ? 'Up' : 'Down'}
          tone={h?.python.ok ? 'success' : 'danger'}
          sub={h?.python.ok ? 'OK' : h?.python.error ?? 'Unavailable'}
        />
        <MetricCard
          label="Node memory"
          value={h ? `${h.node.memory_mb} MB` : '—'}
          tone="blue"
          sub="Resident set"
        />
        <MetricCard
          label="DB size"
          value={h ? formatBytes(h.storage.db_bytes) : '—'}
          tone="purple"
          sub={h ? `uploads ${formatBytes(h.storage.uploads_bytes)}` : ''}
        />
      </div>

      <Panel
        title="Entity counts"
        action={
          <Button size="sm" variant="ghost" onClick={() => health.refetch()} data-testid="admin-refresh">
            <RefreshCw size={13} /> Refresh
          </Button>
        }
      >
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          <MetricCard label="Users"       value={h?.counts.users ?? '—'}     tone="blue"    sub="Accounts" />
          <MetricCard label="Documents"   value={h?.counts.documents ?? '—'} tone="success" sub="Repository" />
          <MetricCard label="Workflows"   value={h?.counts.workflows ?? '—'} tone="warning" sub="All-time" />
          <MetricCard label="Alerts"      value={h?.counts.alerts ?? '—'}    tone="danger"  sub="Emitted" />
        </div>
      </Panel>

      <SyncStatusCard />

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_2fr] gap-6">
        <Panel
          title="Operations"
          action={<HardDrive size={14} className="text-muted" />}
        >
          {/* CBS health indicator */}
          <div className="mb-4 flex items-center justify-between">
            <p className="text-xs text-muted">CBS (T24) status</p>
            <CbsHealthBadge />
          </div>

          <p className="text-md text-ink mb-3">Retention job</p>
          <p className="text-xs text-muted mb-3">
            Runs on cron. Trigger manually to force a pass and record it in the audit log.
          </p>
          <Button
            size="sm"
            onClick={() => retention.mutate()}
            loading={retention.isPending}
            data-testid="admin-retention"
          >
            <Play size={13} /> Run retention now
          </Button>
          {retention.isSuccess && (
            <Badge tone="success" className="ml-3">
              {retention.data.policies} policies processed
            </Badge>
          )}
          {retention.isError && (
            <Badge tone="danger" className="ml-3">Failed</Badge>
          )}

          <div className="mt-5 pt-4 border-t border-divider">
            <p className="text-md text-ink mb-1 inline-flex items-center gap-1.5">
              <Sparkles size={13} className="text-brand-blue" /> DocBrain re-index
            </p>
            <p className="text-xs text-muted mb-3">
              Re-runs OCR + classification + extraction + embedding on every document in this
              tenant. Safe to run; replaces existing chunks. Can be slow for large corpora.
            </p>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                if (confirm('Re-index every document in this tenant? This may take minutes.')) {
                  reindex.mutate();
                }
              }}
              loading={reindex.isPending}
              data-testid="admin-reindex"
            >
              <Sparkles size={13} /> Re-index all documents
            </Button>
            {reindex.isSuccess && (
              <Badge
                tone={reindex.data.failed === 0 ? 'success' : reindex.data.ok > 0 ? 'warning' : 'danger'}
                className="ml-3"
              >
                {reindex.data.ok} / {reindex.data.total} re-indexed
                {reindex.data.failed > 0 && ` · ${reindex.data.failed} failed`}
                {reindex.data.skipped > 0 && ` · ${reindex.data.skipped} skipped`}
              </Badge>
            )}
            {reindex.isError && (
              <Badge tone="danger" className="ml-3">Failed</Badge>
            )}
          </div>
        </Panel>

        <Panel
          title="Audit log"
          action={<Activity size={14} className="text-muted" />}
        >
          <DataTable<AuditRow>
            columns={auditColumns}
            data={audit.data ?? []}
            empty={audit.isLoading ? 'Loading…' : 'No audit events'}
          />
        </Panel>
      </div>
    </div>
  );
}
