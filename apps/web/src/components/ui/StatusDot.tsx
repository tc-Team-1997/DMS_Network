export type DotColor = "green" | "red" | "amber" | "blue";

const cls: Record<DotColor, string> = {
  green: "status-dot dot-green dot-pulse",
  red:   "status-dot dot-red",
  amber: "status-dot dot-amber",
  blue:  "status-dot dot-blue",
};

export function StatusDot({ color = "green", pulse = false }: { color?: DotColor; pulse?: boolean }) {
  const base = cls[color];
  return <span className={pulse ? base : base.replace(" dot-pulse", "")} />;
}
