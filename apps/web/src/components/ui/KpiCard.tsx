import type { ReactNode } from "react";

export type KpiVariant = "gold" | "blue" | "green" | "red" | "purple" | "amber";

const variantClass: Record<KpiVariant, string> = {
  gold:   "kg",
  blue:   "kb",
  green:  "kok",
  red:    "kr",
  purple: "kp",
  amber:  "kw",
};

export interface KpiCardProps {
  label:     string;
  value:     ReactNode;
  sub?:      ReactNode;
  variant?:  KpiVariant;
  className?: string;
}

export function KpiCard({ label, value, sub, variant = "gold", className = "" }: KpiCardProps) {
  return (
    <div className={`kpi ${variantClass[variant]} ${className}`}>
      <div className="kl">{label}</div>
      <div className="kv">{value}</div>
      {sub && <div className="ks">{sub}</div>}
    </div>
  );
}
