/**
 * Chart wrapper components using recharts.
 * All inherit the ZorDMS v4.2 light palette.
 */
import {
  ResponsiveContainer,
  LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid,
  BarChart, Bar,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import type { ReactNode } from "react";
import { Card } from "./Card.js";

const TOOLTIP_STYLE = {
  background:   "var(--ink2)",
  border:       "1px solid var(--bd)",
  borderRadius: 8,
  color:        "var(--wh)",
  fontSize:     11,
};

/* ───────── shared axis / grid props ───────── */
const axisProps = { tick: { fill: "var(--sil)", fontSize: 10 }, axisLine: false, tickLine: false } as const;
const gridProps = { stroke: "rgba(15,23,42,.07)", strokeDasharray: "3 3" } as const;

/* ──────────────────────────────────────────── */
/* LINE CHART CARD                              */
/* ──────────────────────────────────────────── */
export interface LineChartCardProps {
  title:    ReactNode;
  action?:  ReactNode;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data:     any[];
  /** key in data for X axis */
  xKey:     string;
  /** series definitions */
  lines:    { key: string; color?: string; name?: string }[];
  height?:  number;
  className?: string;
}

export function LineChartCard({
  title, action, data, xKey, lines, height = 200, className = "",
}: LineChartCardProps) {
  return (
    <Card title={title} action={action} className={className}>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -10 }}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey={xKey} {...axisProps} />
          <YAxis {...axisProps} />
          <Tooltip contentStyle={TOOLTIP_STYLE} />
          {lines.map(l => (
            <Line
              key={l.key}
              type="monotone"
              dataKey={l.key}
              name={l.name ?? l.key}
              stroke={l.color ?? "var(--gold2)"}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </Card>
  );
}

/* ──────────────────────────────────────────── */
/* BAR CHART CARD                               */
/* ──────────────────────────────────────────── */
export interface BarChartCardProps {
  title:    ReactNode;
  action?:  ReactNode;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data:     any[];
  xKey:     string;
  bars:     { key: string; color?: string; name?: string }[];
  height?:  number;
  className?: string;
}

export function BarChartCard({
  title, action, data, xKey, bars, height = 200, className = "",
}: BarChartCardProps) {
  return (
    <Card title={title} action={action} className={className}>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -10 }}>
          <CartesianGrid {...gridProps} />
          <XAxis dataKey={xKey} {...axisProps} />
          <YAxis {...axisProps} />
          <Tooltip contentStyle={TOOLTIP_STYLE} />
          {bars.map(b => (
            <Bar key={b.key} dataKey={b.key} name={b.name ?? b.key}
                 fill={b.color ?? "var(--gold2)"} radius={[3, 3, 0, 0]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </Card>
  );
}

/* ──────────────────────────────────────────── */
/* DONUT CHART CARD                             */
/* ──────────────────────────────────────────── */
export interface DonutChartCardProps {
  title:    ReactNode;
  action?:  ReactNode;
  data:     { name: string; value: number; color?: string }[];
  height?:  number;
  className?: string;
}

const DEFAULT_COLORS = [
  "var(--gold2)", "var(--B)", "var(--G)", "var(--P)", "var(--W)", "var(--R)",
];

export function DonutChartCard({
  title, action, data, height = 200, className = "",
}: DonutChartCardProps) {
  return (
    <Card title={title} action={action} className={className}>
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius="55%"
            outerRadius="80%"
            paddingAngle={2}
            dataKey="value"
          >
            {data.map((entry, i) => (
              <Cell key={entry.name} fill={entry.color ?? DEFAULT_COLORS[i % DEFAULT_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip contentStyle={TOOLTIP_STYLE} />
          <Legend
            iconType="circle"
            iconSize={8}
            formatter={(v) => <span style={{ fontSize: 10, color: "var(--sil)" }}>{v}</span>}
          />
        </PieChart>
      </ResponsiveContainer>
    </Card>
  );
}

/* ──────────────────────────────────────────── */
/* CSS-GRID HEATMAP                             */
/* ──────────────────────────────────────────── */
export interface HeatmapProps {
  /** flat array of 0-1 intensity values, row-major */
  cells:   number[];
  cols?:   number;
  title?:  ReactNode;
  action?: ReactNode;
  className?: string;
}

function intensityStyle(v: number): React.CSSProperties {
  if (v < 0.33) return { background: `rgba(184,145,42,${0.1 + v * 0.4})` };
  if (v < 0.66) return { background: `rgba(184,145,42,${0.3 + v * 0.4})` };
  return { background: `rgba(240,200,74,${0.6 + v * 0.4})` };
}

export function Heatmap({ cells, cols = 14, title, action, className = "" }: HeatmapProps) {
  return (
    <Card title={title} action={action} className={className}>
      <div
        className="heatmap-grid"
        style={{ gridTemplateColumns: `repeat(${cols},1fr)` }}
      >
        {cells.map((v, i) => (
          <div key={i} className="heatmap-cell" style={intensityStyle(Math.min(1, Math.max(0, v)))} title={`${Math.round(v * 100)}%`} />
        ))}
      </div>
    </Card>
  );
}
