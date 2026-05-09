/**
 * FunnelChart — horizontal bar showing Capture → Approve funnel with
 * percentage-drop labels between each stage.
 *
 * Lazy-loaded from DashboardPage via React.lazy + Suspense.
 */

import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { color } from '@/styles/tokens';
import type { FunnelStage } from '../schemas';

interface FunnelChartProps {
  data: FunnelStage[];
}

const STAGE_COLORS = [color.blue, color.sky, color.success, color.purple];

export function FunnelChart({ data }: FunnelChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex h-[180px] items-center justify-center text-sm text-muted">
        No funnel data in the selected window.
      </div>
    );
  }

  // Augment with % of first stage (captured)
  const top = data[0]?.count ?? 1;
  const augmented = data.map((s, i) => ({
    ...s,
    pct:  top > 0 ? Math.round((s.count / top) * 100) : 0,
    drop: i > 0 && (data[i - 1]?.count ?? 0) > 0
      ? Math.round(((data[i - 1]?.count ?? 0 - s.count) / (data[i - 1]?.count ?? 1)) * 100)
      : 0,
  }));

  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart
        layout="vertical"
        data={augmented}
        margin={{ top: 4, right: 48, left: 0, bottom: 0 }}
      >
        <XAxis type="number" hide />
        <YAxis
          type="category"
          dataKey="stage"
          width={76}
          tick={{ fill: color.muted, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          contentStyle={{
            borderRadius: 8,
            border: `1px solid ${color.divider}`,
            fontSize: 12,
          }}
          formatter={(v: number, name: string) =>
            [v.toLocaleString(), name === 'count' ? 'Documents' : name]
          }
        />
        <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={20}>
          {augmented.map((_, i) => (
            <Cell
              key={i}
              fill={STAGE_COLORS[i % STAGE_COLORS.length] ?? color.blue}
            />
          ))}
          <LabelList
            dataKey="pct"
            position="right"
            formatter={(v: number) => `${v}%`}
            style={{ fill: color.muted, fontSize: 11 }}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
