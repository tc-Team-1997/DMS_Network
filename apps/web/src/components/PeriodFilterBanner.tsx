/**
 * PeriodFilterBanner — shown on section pages when a time period was carried in
 * from a Dashboard drill-down (?period=&from=&to=).  Makes the active date
 * window visible and offers a one-click "Clear" to drop it from the URL.
 */
interface PeriodFilterBannerProps {
  from: string;
  to: string;
  onClear: () => void;
}

export function PeriodFilterBanner({ from, to, onClear }: PeriodFilterBannerProps) {
  return (
    <div
      role="status"
      aria-label="Active time period filter"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 12px",
        marginBottom: 12,
        background: "var(--ink3)",
        border: "1px solid var(--gold2)",
        borderRadius: 8,
        fontSize: 12,
      }}
    >
      <span aria-hidden style={{ fontSize: 13 }}>🗓️</span>
      <span style={{ color: "var(--mist)" }}>
        Filtered by period:{" "}
        <strong style={{ color: "var(--gold2)" }}>{from}</strong>
        {" → "}
        <strong style={{ color: "var(--gold2)" }}>{to}</strong>
      </span>
      <button
        onClick={onClear}
        style={{
          marginLeft: "auto",
          padding: "4px 10px",
          background: "transparent",
          color: "var(--sil)",
          border: "1px solid var(--bd)",
          borderRadius: 6,
          fontSize: 11,
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        Clear
      </button>
    </div>
  );
}
