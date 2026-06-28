/**
 * usePeriod — shared time-period (date-range) state, URL-backed.
 *
 * The Dashboard lets users pick a time period (day / month / quarter / year)
 * which resolves to an explicit `from`/`to` date range.  When the user drills
 * down from a dashboard widget into a section page, that period must travel in
 * the URL (?period=&from=&to=) so the destination shows the same window and the
 * link is shareable / bookmarkable.
 *
 *   - `appendPeriod(path, p)` — sender side: tack the period onto a navigate path.
 *   - `usePeriod()`           — reader side: resolve the period from the URL
 *                               (with sensible defaults) plus an `active` flag
 *                               that is true only when the URL actually carries
 *                               period params, so destination pages know whether
 *                               to apply the filter at all.
 *   - `inPeriod(value, p)`    — filter predicate: is a row's date within [from,to]?
 *
 * The pure helpers (no React) are exported so they can be unit-tested and reused
 * by both the sender (Dashboard) and the receivers (section pages).
 */
import { useMemo, useCallback } from "react";
import { useUrlState } from "./useUrlState.js";

export type TimePeriod = "day" | "month" | "quarter" | "year";

export interface PeriodState {
  period: TimePeriod;
  from: string; // YYYY-MM-DD
  to: string;   // YYYY-MM-DD
}

const PERIODS: readonly TimePeriod[] = ["day", "month", "quarter", "year"];

/** Today as YYYY-MM-DD (local-ish, mirrors the original Dashboard helper). */
export function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Default range start for a given period, relative to today. */
export function defaultFrom(period: TimePeriod): string {
  const d = new Date();
  if (period === "day") d.setDate(d.getDate() - 1);
  else if (period === "month") d.setMonth(d.getMonth() - 1);
  else if (period === "quarter") d.setMonth(d.getMonth() - 3);
  else d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

/** Coerce raw (possibly missing/invalid) URL values into a valid PeriodState. */
export function resolvePeriod(raw: { period?: string; from?: string; to?: string }): PeriodState {
  const period = (PERIODS as readonly string[]).includes(raw.period ?? "")
    ? (raw.period as TimePeriod)
    : "month";
  return {
    period,
    from: raw.from || defaultFrom(period),
    to: raw.to || todayStr(),
  };
}

/**
 * Sender side: append `?period=&from=&to=` to a navigation path, preserving any
 * query string the path already has (e.g. `/viewer?id=…`).
 */
export function appendPeriod(path: string, p: PeriodState): string {
  const qs = new URLSearchParams({ period: p.period, from: p.from, to: p.to }).toString();
  return `${path}${path.includes("?") ? "&" : "?"}${qs}`;
}

/** Normalise a date-ish value to a YYYY-MM-DD calendar day, or null if unusable. */
function toDay(value: string | number): string | null {
  if (typeof value === "number") {
    return Number.isNaN(value) ? null : new Date(value).toISOString().slice(0, 10);
  }
  const s = String(value);
  // Fast path: an ISO string already begins with the calendar day. Using the
  // literal day avoids timezone drift (a "…T23:00:00Z" stamp stays on its date).
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

/**
 * Filter predicate: is `value` within the inclusive [from, to] day window?
 * Accepts a Unix-ms number or an ISO/date string.  Comparison is done at
 * calendar-day granularity (tz-stable).  Undated or unparseable values return
 * `true` so rows without a date are never silently hidden.
 */
export function inPeriod(
  value: string | number | null | undefined,
  p: { from: string; to: string },
): boolean {
  if (value === null || value === undefined || value === "") return true;
  const day = toDay(value);
  if (day === null) return true;
  if (p.from && day < p.from) return false;
  if (p.to && day > p.to) return false;
  return true;
}

export interface PeriodController extends PeriodState {
  /** True only when the URL actually carries any of period/from/to. */
  active: boolean;
  /** Write the period to the URL (replace, not push). */
  set: (p: PeriodState) => void;
  /** Remove period/from/to from the URL. */
  clear: () => void;
}

/**
 * Reader/controller side, URL-backed.  Defaults are empty strings so that
 * `active` can distinguish "no period in URL" from an explicitly-chosen one.
 */
export function usePeriod(): PeriodController {
  const [urlState, setUrlState] = useUrlState({ period: "", from: "", to: "" });
  const { period: rawPeriod, from: rawFrom, to: rawTo } = urlState;

  const resolved = useMemo(
    () => resolvePeriod({ period: rawPeriod, from: rawFrom, to: rawTo }),
    [rawPeriod, rawFrom, rawTo],
  );
  const active = Boolean(rawPeriod || rawFrom || rawTo);

  const set = useCallback(
    (p: PeriodState) => setUrlState({ period: p.period, from: p.from, to: p.to }),
    [setUrlState],
  );
  const clear = useCallback(
    () => setUrlState({ period: "", from: "", to: "" }),
    [setUrlState],
  );

  return { ...resolved, active, set, clear };
}
