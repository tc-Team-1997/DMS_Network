import { useQuery } from '@tanstack/react-query';
import { DataTable, MetricCard, Panel, type Column } from '@/components/ui';
import { fetchComplianceSummary, type ComplianceSummary } from './api';

type RetentionRow = ComplianceSummary['retention'][number] & { id: string };

export function CompliancePage() {
  const q = useQuery({ queryKey: ['compliance', 'summary'], queryFn: fetchComplianceSummary });
  const s = q.data;

  // Retention rows have no primary key of their own; synthesize one from
  // the doc_type so DataTable's key constraint is satisfied.
  const retentionRows: RetentionRow[] = (s?.retention ?? []).map((r) => ({
    ...r,
    id: r.doc_type ?? 'unspecified',
  }));

  const retentionColumns: Column<RetentionRow>[] = [
    { key: 'type',    header: 'Document type', render: (r) => r.doc_type ?? 'Unspecified' },
    { key: 'years',   header: 'Retention',     width: 120, render: (r) => `${r.retention_years} years` },
    { key: 'purge',   header: 'Auto-purge',    width: 120, render: (r) => r.auto_purge ? 'Enabled' : 'Off' },
    { key: 'count',   header: 'Documents',     width: 120, align: 'right', render: (r) => r.doc_count },
  ];
  const auditColumns: Column<ComplianceSummary['audit'][number]>[] = [
    { key: 'when',   header: 'When', width: 180, render: (r) => new Date(r.created_at).toLocaleString() },
    { key: 'who',    header: 'User', width: 140, render: (r) => r.username ?? 'system' },
    { key: 'action', header: 'Action',           render: (r) => r.action ?? '—' },
    { key: 'entity', header: 'Entity', width: 180, render: (r) => `${r.entity ?? ''}${r.entity_id ? ` #${r.entity_id}` : ''}` },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard label="Overdue expiry" value={s?.expiry.overdue ?? '—'} tone="danger" sub="Immediate action" />
        <MetricCard label="Next 30 days"   value={s?.expiry.d30 ?? '—'}     tone="danger" sub="Schedule review" />
        <MetricCard label="31–60 days"     value={s?.expiry.d60 ?? '—'}     tone="warning" sub="Plan" />
        <MetricCard label="61–90 days"     value={s?.expiry.d90 ?? '—'}     tone="blue"    sub="Queue" />
      </div>

      <Panel title="Workflow SLA">
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          <MetricCard label="Late (>3d)" value={s?.workflow_sla.late ?? '—'}     tone="danger"  sub="Breach risk" />
          <MetricCard label="On track"   value={s?.workflow_sla.on_track ?? '—'} tone="warning" sub="Within SLA" />
          <MetricCard label="Approved"   value={s?.workflow_sla.approved ?? '—'} tone="success" sub="Closed OK" />
          <MetricCard label="Rejected"   value={s?.workflow_sla.rejected ?? '—'} tone="neutral" sub="Sent back" />
        </div>
      </Panel>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Panel title="Retention policies">
          <DataTable<RetentionRow>
            columns={retentionColumns}
            data={retentionRows}
            empty="No retention policies configured"
          />
        </Panel>

        <Panel title="Recent audit activity">
          <DataTable
            columns={auditColumns}
            data={s?.audit ?? []}
            empty="No audit events"
          />
        </Panel>
      </div>
    </div>
  );
}
