/**
 * useUrlState — bidirectional sync of filter state with URL query params.
 *
 * Reads from `useLocation().search` on mount / navigation.
 * Writes back via `window.history.replaceState` so the tab bar does not
 * create a new history entry for each filter change.
 *
 * Only primitive values (string | number | boolean | null) are supported per
 * key; callers handle the type coercion at the call-site.
 */

import { useCallback, useMemo } from 'react';
import { useLocation } from 'react-router-dom';

export type UrlParams = Record<string, string | number | boolean | null | undefined>;

function toSearch(params: UrlParams): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === '') continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

function fromSearch(search: string): Record<string, string> {
  const sp = new URLSearchParams(search);
  const out: Record<string, string> = {};
  for (const [k, v] of sp.entries()) {
    out[k] = v;
  }
  return out;
}

export function useUrlState<T extends UrlParams>(
  defaults: T,
): [T, (patch: Partial<T>) => void] {
  const { search, pathname } = useLocation();

  const state: T = useMemo(() => {
    const raw = fromSearch(search);
    const merged = { ...defaults } as T;
    for (const k of Object.keys(defaults) as Array<keyof T>) {
      const rawVal = raw[k as string];
      if (rawVal === undefined) continue;
      const def = defaults[k];
      if (typeof def === 'number') {
        const n = Number(rawVal);
        (merged as Record<keyof T, unknown>)[k] = Number.isFinite(n) ? n : def;
      } else if (typeof def === 'boolean') {
        (merged as Record<keyof T, unknown>)[k] = rawVal === 'true';
      } else {
        (merged as Record<keyof T, unknown>)[k] = rawVal;
      }
    }
    return merged;
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  const setState = useCallback(
    (patch: Partial<T>) => {
      const next = { ...state, ...patch } as T;
      const newSearch = toSearch(next as UrlParams);
      window.history.replaceState(null, '', `${pathname}${newSearch}`);
      // Dispatch a popstate-like event so React Router picks up the change
      // without a navigation. Using a custom event avoids the full re-render
      // cost of pushState. The location hook re-reads on the next render cycle.
      window.dispatchEvent(new PopStateEvent('popstate'));
    },
    [state, pathname],
  );

  return [state, setState];
}
