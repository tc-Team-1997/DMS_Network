/**
 * ConfidenceBadge — color-coded indicator of translation confidence.
 *
 * Green  >= 0.8
 * Yellow  0.6 – 0.79
 * Red    < 0.6
 *
 * Meets WCAG 2.1 AA 3:1 minimum contrast requirement for non-text indicators.
 */

interface ConfidenceBadgeProps {
  /** 0..1 confidence score returned by the translation service */
  confidence: number;
}

export function ConfidenceBadge({ confidence }: ConfidenceBadgeProps) {
  const pct = Math.round(confidence * 100);

  const colorClass =
    confidence >= 0.8
      ? 'bg-success-bg text-success'
      : confidence >= 0.6
        ? 'bg-warning-bg text-warning'
        : 'bg-danger-bg text-danger';

  const label = `Confidence ${pct} percent`;

  return (
    <span
      data-testid="translate-confidence-badge"
      aria-label={label}
      title={`Confidence: ${pct}%`}
      className={`inline-block rounded-badge px-[9px] py-[3px] text-[11px] font-medium ${colorClass}`}
    >
      {pct}% confidence
    </span>
  );
}
