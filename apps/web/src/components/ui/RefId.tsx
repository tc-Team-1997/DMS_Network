/**
 * RefId — human-friendly identifier display.
 *
 * UUIDv7 row ids are unreadable in the UI. RefId shows a short, friendly token
 * (an explicit label, or the first 8 chars of the UUID) to the user, and keeps
 * the FULL uuid "behind" it — revealed on hover (native title) and copied to the
 * clipboard on click. Values that are NOT uuids (business refs like
 * `NLCS-LC-2026-0401`, `WF-12`, `DOC-001`) are already readable and render
 * verbatim. URL params keep the real uuid — this only affects display.
 */
import { useState, type CSSProperties, type KeyboardEvent, type MouseEvent } from "react";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when the value is a canonical 36-char UUID. */
export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

/** Short form for display — first 8 chars of a uuid, else the value unchanged. */
export function shortId(v: string | number | null | undefined): string {
  const s = v == null ? "" : String(v);
  return isUuid(s) ? s.slice(0, 8) : s;
}

export interface RefIdProps {
  /** The identifier (uuid or business ref). */
  value?: string | number | null;
  /** Optional human label shown instead of the short id (uuid kept behind). */
  label?: string;
  /** Prefix before the short uuid (default "#"). */
  prefix?: string;
  className?: string;
  style?: CSSProperties;
}

/**
 * Render an identifier as a friendly label/short token with the full uuid
 * available on hover + click-to-copy.
 */
export function RefId({ value, label, prefix = "#", className, style }: RefIdProps) {
  const [copied, setCopied] = useState(false);
  const full = value == null ? "" : String(value);

  if (!full) return <span className={className} style={style}>—</span>;

  const id = isUuid(full);

  // A non-uuid value with no override label is already human-readable.
  if (!id && !label) {
    return <span className={className} style={style}>{full}</span>;
  }

  const text = label ?? `${prefix}${full.slice(0, 8)}`;

  const copy = () => {
    try {
      navigator.clipboard?.writeText(full);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable — title still reveals the uuid */
    }
  };

  return (
    <span
      className={className}
      title={copied ? "Copied!" : full}
      role="button"
      tabIndex={0}
      aria-label={`${label ?? "ID"}: ${full} — click to copy`}
      onClick={(e: MouseEvent) => { e.stopPropagation(); copy(); }}
      onKeyDown={(e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); copy(); } }}
      style={{ cursor: "copy", fontFamily: label ? undefined : "monospace", ...style }}
    >
      {text}
    </span>
  );
}
