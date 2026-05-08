import { useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Download } from 'lucide-react';
import { Button, MetricCard, Panel } from '@/components/ui';
import { chartPalette, color } from '@/styles/tokens';
import { EXPORT_CSV_URL, fetchReportSummary } from './api';

export function ReportsPage() {
  const summary = useQuery({ queryKey: ['reports', 'summary'], queryFn: fetchReportSummary });
  const s = summary.data;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard label="Total documents" value={s?.totals.all ?? '—'} tone="blue" sub="Repository" />
        <MetricCard label="Valid" value={s?.totals.valid ?? '—'} tone="success" sub="In compliance" />
        <MetricCard label="Expiring" value={s?.totals.expiring ?? '—'} tone="warning" sub="Review queue" />
        <MetricCard label="Expired" value={s?.totals.expired ?? '—'} tone="danger" sub="Breach risk" />
      </div>

      <Panel
        title="Uploads (last 6 months)"
        action={
          <a href={EXPORT_CSV_URL} download data-testid="reports-export">
            <Button size="sm" variant="secondary">
              <Download size={14} /> Export CSV
            </Button>
          </a>
        }
      >
        <div className="h-[260px]">
          {s && s.monthly.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={s.monthly}>
                <CartesianGrid stroke={color.divider} vertical={false} />
                <XAxis dataKey="month" tick={{ fill: color.muted, fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: color.muted, fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{ borderRadius: 8, border: `1px solid ${color.divider}` }} />
                <Line type="monotone" dataKey="count" stroke={color.blue} strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-xs text-muted text-center pt-20">No uploads recorded in the last 6 months.</p>
          )}
        </div>
      </Panel>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Panel title="Documents by branch">
          <div className="h-[260px]">
            {s && s.by_branch.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={s.by_branch}>
                  <CartesianGrid stroke={color.divider} vertical={false} />
                  <XAxis dataKey="branch" tick={{ fill: color.muted, fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fill: color.muted, fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={{ borderRadius: 8, border: `1px solid ${color.divider}` }} />
                  <Bar dataKey="count" fill={color.blue} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-xs text-muted text-center pt-20">No branch data.</p>
            )}
          </div>
        </Panel>

        <Panel title="Documents by type">
          <div className="h-[260px]">
            {s && s.by_type.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={s.by_type} dataKey="count" nameKey="doc_type" innerRadius={48} outerRadius={84} paddingAngle={2}>
                    {s.by_type.map((_, i) => (
                      <Cell key={i} fill={chartPalette[i % chartPalette.length]} />
                    ))}
                  </Pie>
                  <Legend iconType="circle" wrapperStyle={{ fontSize: 11, color: color.muted }} />
                  <Tooltip contentStyle={{ borderRadius: 8, border: `1px solid ${color.divider}` }} />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-xs text-muted text-center pt-20">No documents yet.</p>
            )}
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <Panel title="Expiry pipeline">
          <div className="grid grid-cols-3 gap-4">
            <MetricCard label="Next 30 days"  value={s?.expiry.d30 ?? '—'} tone="danger"  sub="Immediate" />
            <MetricCard label="31–60 days"    value={s?.expiry.d60 ?? '—'} tone="warning" sub="Schedule" />
            <MetricCard label="61–90 days"    value={s?.expiry.d90 ?? '—'} tone="blue"    sub="Queue" />
          </div>
        </Panel>

        <Panel title="Workflow throughput">
          <div className="grid grid-cols-3 gap-4">
            <MetricCard label="Pending"   value={s?.workflows.pending  ?? '—'} tone="warning" sub="In queues" />
            <MetricCard label="Approved"  value={s?.workflows.approved ?? '—'} tone="success" sub="Closed OK" />
            <MetricCard label="Rejected"  value={s?.workflows.rejected ?? '—'} tone="danger"  sub="Sent back" />
          </div>
        </Panel>
      </div>
    </div>
  );
}
