/**
 * Sparkline — hand-rolled 60×16 inline SVG sparkline.
 * No recharts dependency. Renders a polyline with a gradient fill.
 * Intentionally tiny; it is a static import in KpiTile.
 */

interface SparklineProps {
  data: number[];
  /** Tailwind-token hex color for the line stroke. */
  color: string;
}

const W = 60;
const H = 16;
const PAD = 1; // 1px inner padding so the line doesn't clip at edges

export function Sparkline({ data, color }: SparklineProps) {
  if (data.length < 2) {
    return <svg width={W} height={H} aria-hidden="true" />;
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  // Map data points to SVG coordinates
  const pts = data.map((v, i) => {
    const x = PAD + (i / (data.length - 1)) * (W - PAD * 2);
    const y = H - PAD - ((v - min) / range) * (H - PAD * 2);
    return [x, y] as const;
  });

  const polyline = pts.map(([x, y]) => `${x},${y}`).join(' ');

  // Close path for gradient fill area — pts has at least 2 elements (guarded above)
  const firstPt = pts[0] as readonly [number, number];
  const lastPt  = pts[pts.length - 1] as readonly [number, number];
  const fillPath =
    `M ${firstPt[0]},${firstPt[1]} ` +
    pts.slice(1).map(([x, y]) => `L ${x},${y}`).join(' ') +
    ` L ${lastPt[0]},${H} L ${firstPt[0]},${H} Z`;

  // Unique gradient id per color (stable across renders)
  const gradId = `sg-${color.replace('#', '')}`;

  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      aria-hidden="true"
      style={{ display: 'block', overflow: 'visible' }}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={color} stopOpacity={0.25} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      {/* Gradient fill */}
      <path d={fillPath} fill={`url(#${gradId})`} />
      {/* Line */}
      <polyline
        points={polyline}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
