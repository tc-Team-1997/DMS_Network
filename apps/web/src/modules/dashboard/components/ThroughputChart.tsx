/**
 * ThroughputChart — recharts line chart showing documents completed per day
 * vs SLA breach count over a 14-day window.
 *
 * Lazy-loaded from DashboardPage via React.lazy + Suspense.
 */

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { color } from '@/styles/tokens';
import type { ThroughputRow } from '../schemas';

interface ThroughputChartProps {
  data: ThroughputRow[];
}

export function ThroughputChart({ data }: ThroughputChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-[240px] items-center justify-center text-sm text-muted">
        No throughput data in the selected window.
      </div>
    );
  }

  // Format day label as "Mon 5" etc.
  function fmtDay(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' });
  }

  const chartData = data.map((r) => ({
    ...r,
    dayLabel: fmtDay(r.day),
  }));

  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={color.divider} vertical={false} />
        <XAxis
          dataKey="dayLabel"
          tick={{ fill: color.muted, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tick={{ fill: color.muted, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
        />
        <Tooltip
          contentStyle={{
            borderRadius: 8,
            border: `1px solid ${color.divider}`,
            fontSize: 12,
          }}
        />
        <Legend wrapperStyle={{ fontSize: 11, color: color.muted }} />
        <ReferenceLine y={0} stroke={color.divider} />
        <Line
          type="monotone"
          dataKey="completed"
          name="Completed"
          stroke={color.blue}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
        <Line
          type="monotone"
          dataKey="sla_breach"
          name="SLA breach"
          stroke={color.danger}
          strokeWidth={2}
          strokeDasharray="4 2"
          dot={false}
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
