/**
 * AiConfidenceHealth — recharts bar histogram showing AI extraction confidence
 * distribution over the last 7 days, banded <40 / 40-70 / 70-90 / ≥90.
 *
 * Source: documents.ocr_confidence (model self-reported, 0-1 scale).
 * Lazy-loaded from DashboardPage via React.lazy + Suspense.
 */

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { color } from '@/styles/tokens';
import type { ConfidenceHistogram } from '../schemas';

interface AiConfidenceHealthProps {
  data: ConfidenceHistogram;
}

const BANDS = [
  { key: 'lt40',    label: '<40%',    fill: color.danger  },
  { key: 'c40to70', label: '40–70%',  fill: color.warning },
  { key: 'c70to90', label: '70–90%',  fill: color.success },
  { key: 'gte90',   label: '≥90%',   fill: color.blue    },
] as const;

export function AiConfidenceHealth({ data }: AiConfidenceHealthProps) {
  const total = data.lt40 + data.c40to70 + data.c70to90 + data.gte90;

  if (total === 0) {
    return (
      <div className="flex h-[180px] items-center justify-center text-sm text-muted">
        No AI confidence data in the last 7 days.
      </div>
    );
  }

  const chartData = BANDS.map((b) => ({
    label: b.label,
    count: data[b.key],
    fill:  b.fill,
    pct:   Math.round((data[b.key] / total) * 100),
  }));

  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={color.divider} vertical={false} />
        <XAxis
          dataKey="label"
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
          formatter={(v: number) => [v.toLocaleString(), 'Documents']}
        />
        <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={40}>
          {chartData.map((d, i) => (
            <Cell key={i} fill={d.fill} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
