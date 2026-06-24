import type { ReactNode, CSSProperties } from "react";

export type TagVariant = "green" | "red" | "amber" | "blue" | "purple" | "gold";

const cls: Record<TagVariant, string> = {
  green:  "tag tg",
  red:    "tag tr",
  amber:  "tag tw",
  blue:   "tag tb",
  purple: "tag tp",
  gold:   "tag tgold",
};

export interface TagProps {
  variant?: TagVariant;
  children: ReactNode;
  style?:   CSSProperties;
}

export function Tag({ variant = "gold", children, style }: TagProps) {
  return <span className={cls[variant]} style={style}>{children}</span>;
}

export interface BadgeProps {
  count:    number | string;
  variant?: "red" | "gold" | "blue";
}

const badgeCls: Record<string, string> = { red: "nb nb-r", gold: "nb nb-g", blue: "nb nb-b" };

export function Badge({ count, variant = "red" }: BadgeProps) {
  return <span className={badgeCls[variant]}>{count}</span>;
}
