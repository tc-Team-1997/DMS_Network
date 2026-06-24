/**
 * ConfidenceBadge — renders the IDP §6.4 confidence-band as a coloured pill.
 * Also exports `bandFor` so tests and parent screens can call it directly.
 */
import { bandFor, type BandTone } from "../../api/aiEngine.js";

export { bandFor } from "../../api/aiEngine.js";
export type { BandTone } from "../../api/aiEngine.js";

const BADGE_STYLES: Record<BandTone, string> = {
  green:  "conf-badge conf-green",
  teal:   "conf-badge conf-teal",
  amber:  "conf-badge conf-amber",
  orange: "conf-badge conf-orange",
  red:    "conf-badge conf-red",
};

interface Props {
  confidence: number;
  showPct?: boolean;
  size?: "sm" | "md";
}

export function ConfidenceBadge({ confidence, showPct = true, size = "md" }: Props) {
  const band = bandFor(confidence);
  const pct = `${(confidence * 100).toFixed(0)}%`;

  const toneStyle: Record<BandTone, React.CSSProperties> = {
    green:  { background: "rgba(46,204,138,.18)", color: "#2ecc8a", border: "1px solid rgba(46,204,138,.35)" },
    teal:   { background: "rgba(58,159,208,.18)", color: "#3a9fd0", border: "1px solid rgba(58,159,208,.35)" },
    amber:  { background: "rgba(240,160,48,.18)", color: "#f0a030", border: "1px solid rgba(240,160,48,.35)" },
    orange: { background: "rgba(224,120,48,.18)", color: "#e07830", border: "1px solid rgba(224,120,48,.35)" },
    red:    { background: "rgba(224,82,82,.18)",  color: "#e05252", border: "1px solid rgba(224,82,82,.35)" },
  };

  const fontSize = size === "sm" ? 10 : 11;

  return (
    <span
      className={BADGE_STYLES[band.tone]}
      style={{
        ...toneStyle[band.tone],
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        borderRadius: 12,
        padding: size === "sm" ? "1px 7px" : "2px 9px",
        fontSize,
        fontWeight: 700,
        whiteSpace: "nowrap",
      }}
    >
      {band.shortLabel}
      {showPct && <span style={{ fontWeight: 400, opacity: 0.8 }}>· {pct}</span>}
    </span>
  );
}

export default ConfidenceBadge;
