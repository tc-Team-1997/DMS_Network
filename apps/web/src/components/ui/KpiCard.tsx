import type { ReactNode } from "react";

export type KpiVariant = "gold" | "blue" | "green" | "red" | "purple" | "amber";

/** Accent dot / label colour per variant */
const accentColor: Record<KpiVariant, string> = {
  gold:   "var(--gold)",
  blue:   "var(--B)",
  green:  "var(--G)",
  red:    "var(--R)",
  purple: "var(--P)",
  amber:  "var(--W)",
};

export interface KpiCardProps {
  label:     string;
  value:     ReactNode;
  sub?:      ReactNode;
  variant?:  KpiVariant;
  className?: string;
}

export function KpiCard({ label, value, sub, variant = "gold", className = "" }: KpiCardProps) {
  const dot = accentColor[variant];
  return (
    <div className={`kpi-card ${className}`} style={{
      background:   "var(--ink2)",
      border:       "1px solid var(--bd)",
      borderRadius: 10,
      padding:      "16px 18px",
      boxShadow:    "0 2px 8px rgba(15,23,42,.08)",
    }}>
      {/* Accent dot + label row */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <span style={{
          display:      "inline-block",
          width:         8,
          height:        8,
          borderRadius: "50%",
          background:    dot,
          flexShrink:    0,
          boxShadow:    `0 0 4px ${dot}`,
        }} aria-hidden="true" />
        <div className="kl" style={{ margin: 0 }}>{label}</div>
      </div>
      <div className="kv">{value}</div>
      {sub && <div className="ks">{sub}</div>}
    </div>
  );
}
