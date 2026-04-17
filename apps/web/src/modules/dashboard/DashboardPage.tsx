import { useQuery } from '@tanstack/react-query';
import { BarChart, Bar, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, PieChart, Pie, Cell, Legend } from 'recharts';
import { MetricCard, Panel, Badge, statusTone, DataTable, type Column } from '@/components/ui';
import { chartPalette, color } from '@/styles/tokens';
import type { Alert, Workflow } from '@/lib/schemas';
import {
  fetchDocTypeBreakdown,
  fetchExpiryBuckets,
  fetchRecentAlerts,
  fetchRecentWorkflows,
  fetchStats,
} from './api';

export function DashboardPage() {
  const stats = useQuery({ queryKey: ['stats'], queryFn: fetchStats });
  const expiry = useQuery({ queryKey: ['stats', 'expiry'], queryFn: fetchExpiryBuckets });
  const docTypes = useQuery({ queryKey: ['stats', 'doc-types'], queryFn: fetchDocTypeBreakdown });
  const alerts = useQuery({ queryKey: ['alerts', 'recent'], queryFn: fetchRecentAlerts });
  const workflows = useQuery({ queryKey: ['workflows', 'recent'], queryFn: fetchRecentWorkflows });

  const s = stats.data;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard label="Total documents" value={s?.total ?? '—'} tone="blue" sub="Repository" />
        <MetricCard label="Valid" value={s?.valid ?? '—'} tone="success" sub="In compliance" />
        <MetricCard label="Expiring soon" value={s?.expiring ?? '—'} tone="warning" sub="Review queue" />
        <MetricCard label="Expired" value={s?.expired ?? '—'} tone="danger" sub="Breach risk" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <Panel title="Expiry distribution" className="xl:col-span-2">
          <div className="h-[240px]">
            {expiry.data && (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={expiry.data.labels.map((l, i) => ({ label: l, count: expiry.data.counts[i] ?? 0 }))}>
                  <CartesianGrid stroke={color.divider} vertical={false} />
                  <XAxis dataKey="label" tick={{ fill: color.muted, fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill: color.muted, fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip cursor={{ fill: color.skyLight }} contentStyle={{ borderRadius: 8, border: `1px solid ${color.divider}` }} />
                  <Bar dataKey="count" fill={color.blue} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Panel>

        <Panel title="By document type">
          <div className="h-[240px]">
            {docTypes.data && docTypes.data.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={docTypes.data}
                    dataKey="count"
                    nameKey="doc_type"
                    innerRadius={48}
                    outerRadius={80}
                    paddingAngle={2}
                  >
                    {docTypes.data.map((_, i) => (
                      <Cell key={i} fill={chartPalette[i % chartPalette.length]} />
                    ))}
                  </Pie>
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 11, color: color.muted }} />
                  <Tooltip contentStyle={{ borderRadius: 8, border: `1px solid ${color.divider}` }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-xs text-muted text-center pt-20">No documents yet</p>
            )}
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Panel title="Recent workflows">
          <DataTable<Workflow>
            columns={workflowColumns}
            data={workflows.data ?? []}
            empty="No workflows"
          />
        </Panel>
        <Panel title="Recent alerts">
          <DataTable<Alert>
            columns={alertColumns}
            data={alerts.data ?? []}
            empty="No alerts"
          />
        </Panel>
      </div>
    </div>
  );
}

const workflowColumns: Column<Workflow>[] = [
  { key: 'ref',   header: 'Ref',      render: (w) => <span className="font-mono text-xs">{w.ref_code ?? '—'}</span> },
  { key: 'title', header: 'Title',    render: (w) => w.title ?? '—' },
  { key: 'stage', header: 'Stage',    render: (w) => <Badge tone={statusTone(w.stage)}>{w.stage}</Badge> },
  { key: 'prio',  header: 'Priority', render: (w) => <Badge tone={w.priority === 'High' ? 'danger' : w.priority === 'Low' ? 'neutral' : 'warning'}>{w.priority}</Badge> },
];

const alertLevelTone = { critical: 'danger', warning: 'warning', info: 'blue', success: 'success' } as const;
const alertColumns: Column<Alert>[] = [
  { key: 'level', header: 'Level', width: 100,
    render: (a) => <Badge tone={alertLevelTone[a.level]}>{a.level}</Badge> },
  { key: 'title', header: 'Title', render: (a) => a.title },
  { key: 'at',    header: 'When',  width: 160,
    render: (a) => <span className="text-xs text-muted">{new Date(a.created_at).toLocaleString()}</span> },
];
