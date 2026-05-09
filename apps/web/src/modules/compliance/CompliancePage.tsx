import { useQuery } from '@tanstack/react-query';
import { Download, ShieldCheck, ShieldAlert, ShieldX, CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { DataTable, MetricCard, Panel, type Column } from '@/components/ui';
import { fetchComplianceSummary, fetchComplianceControls, type ComplianceSummary, type Control } from './api';
import { cn } from '@/lib/cn';

/** Compute overall score: pass=100pts, warn=60pts, fail=0pts per control */
function overallScore(controls: Control[]): number {
  if (controls.length === 0) return 100;
  const total = controls.reduce((acc, c) => {
    if (c.status === 'pass') return acc + 100;
    if (c.status === 'warn') return acc + 60;
    return acc;
  }, 0);
  return Math.round(total / controls.length);
}

function scoreTone(score: number): 'success' | 'warning' | 'danger' {
  if (score >= 90) return 'success';
  if (score >= 70) return 'warning';
  return 'danger';
}

function ControlStatusBadge({ status }: { status: Control['status'] }) {
  if (status === 'pass') {
    return (
      <span className="inline-flex items-center gap-1 rounded-badge px-2 py-0.5 text-xs font-medium bg-success-bg text-success">
        <CheckCircle2 size={11} /> Pass
      </span>
    );
  }
  if (status === 'warn') {
    return (
      <span className="inline-flex items-center gap-1 rounded-badge px-2 py-0.5 text-xs font-medium bg-warning-bg text-warning">
        <AlertTriangle size={11} /> Warning
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-badge px-2 py-0.5 text-xs font-medium bg-danger-bg text-danger">
      <XCircle size={11} /> Fail
    </span>
  );
}

type RetentionRow = ComplianceSummary['retention'][number] & { id: string };

export function CompliancePage() {
  const q = useQuery({ queryKey: ['compliance', 'summary'], queryFn: fetchComplianceSummary });
  const s = q.data;

  const cq = useQuery({ queryKey: ['compliance', 'controls'], queryFn: fetchComplianceControls });
  const controls: Control[] = cq.data ?? [];

  const score = overallScore(controls);
  const tone = scoreTone(score);

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

  const lastAuditDate = controls.reduce<string | null>((latest, c) => {
    if (!latest) return c.lastAudit;
    return c.lastAudit > latest ? c.lastAudit : latest;
  }, null);

  return (
    <div className="space-y-6">
      {/* Overall score hero */}
      <div className="grid grid-cols-1 xl:grid-cols-[auto_1fr] gap-6 items-start">
        <Panel className="flex items-center gap-6 px-8 py-6">
          <div className="flex flex-col items-center">
            <span
              className={cn(
                'text-[56px] font-bold leading-none tabular-nums',
                tone === 'success' && 'text-success',
                tone === 'warning' && 'text-warning',
                tone === 'danger'  && 'text-danger',
              )}
            >
              {score}%
            </span>
            <span className="text-xs text-muted mt-1 font-medium">Overall compliance</span>
          </div>
          <div className="space-y-1.5">
            {tone === 'success' && (
              <div className="inline-flex items-center gap-2 text-success font-semibold text-md">
                <ShieldCheck size={18} /> All controls passing
              </div>
            )}
            {tone === 'warning' && (
              <div className="inline-flex items-center gap-2 text-warning font-semibold text-md">
                <ShieldAlert size={18} /> Action required on some controls
              </div>
            )}
            {tone === 'danger' && (
              <div className="inline-flex items-center gap-2 text-danger font-semibold text-md">
                <ShieldX size={18} /> Critical compliance gaps
              </div>
            )}
            {lastAuditDate && (
              <p className="text-xs text-muted">
                Last audited: {new Date(lastAuditDate).toLocaleString()}
              </p>
            )}
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 mt-2 rounded-input border border-border bg-white px-3 py-1.5 text-xs text-ink hover:bg-divider transition"
            >
              <Download size={12} /> Download Report
            </button>
          </div>
        </Panel>

        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          <MetricCard label="Overdue expiry" value={s?.expiry.overdue ?? '—'} tone="danger" sub="Immediate action" />
          <MetricCard label="Next 30 days"   value={s?.expiry.d30 ?? '—'}     tone="danger" sub="Schedule review" />
          <MetricCard label="31–60 days"     value={s?.expiry.d60 ?? '—'}     tone="warning" sub="Plan" />
          <MetricCard label="61–90 days"     value={s?.expiry.d90 ?? '—'}     tone="blue"    sub="Queue" />
        </div>
      </div>

      {/* Per-control cards */}
      <Panel title="Regulatory controls">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {cq.isLoading && (
            <p className="col-span-2 text-xs text-muted py-4">Loading controls…</p>
          )}
          {cq.isError && (
            <p className="col-span-2 text-xs text-danger py-4">Failed to load compliance controls.</p>
          )}
          {controls.map((ctrl) => (
            <div
              key={ctrl.id}
              className={cn(
                'rounded-card border p-4 space-y-2',
                ctrl.status === 'pass' && 'border-success/30 bg-success-bg/20',
                ctrl.status === 'warn' && 'border-warning/30 bg-warning-bg/20',
                ctrl.status === 'fail' && 'border-danger/30 bg-danger-bg/20',
              )}
              data-testid={`control-${ctrl.id}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-md font-semibold text-ink">{ctrl.name}</p>
                  <p className="text-xs text-muted">{ctrl.framework}</p>
                </div>
                <ControlStatusBadge status={ctrl.status} />
              </div>
              <p className="text-xs text-ink leading-relaxed">{ctrl.evidence}</p>
              <p className="text-[11px] text-muted">
                Audited: {new Date(ctrl.lastAudit).toLocaleString()}
              </p>
            </div>
          ))}
        </div>
      </Panel>

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
          {retentionRows.length === 0 ? (
            <div className="py-8 flex flex-col items-center text-center text-muted">
              <ShieldCheck size={28} className="mb-2 text-success" />
              <p className="text-md font-medium text-ink">No retention issues</p>
              <p className="text-xs mt-1">All retention policies are configured and enforced.</p>
            </div>
          ) : (
            <DataTable<RetentionRow>
              columns={retentionColumns}
              data={retentionRows}
              empty="No retention policies configured"
            />
          )}
        </Panel>

        <Panel title="Recent audit activity">
          {(s?.audit ?? []).length === 0 ? (
            <div className="py-8 flex flex-col items-center text-center text-muted">
              <ShieldCheck size={28} className="mb-2 text-success" />
              <p className="text-md font-medium text-ink">No recent audit events</p>
              <p className="text-xs mt-1">The audit trail is clean — all activity is within policy.</p>
            </div>
          ) : (
            <DataTable
              columns={auditColumns}
              data={s?.audit ?? []}
              empty="No audit events"
            />
          )}
        </Panel>
      </div>
    </div>
  );
}
