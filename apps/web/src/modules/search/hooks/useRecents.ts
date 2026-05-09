/**
 * useRecents — persist the last N search queries in localStorage.
 *
 * Key: `dms_search_recents`  (plain string, not tenant-scoped —
 * recents are per-browser, not per-tenant, which matches UX expectations
 * for a single-user device. Cleared on logout via clearRecents()).
 *
 * The count limit is read from a prop (passed from tenant_config.search.cmdk_recents_count)
 * with a default of 10.
 */

import { useCallback } from 'react';

const STORAGE_KEY = 'dms_search_recents';

export function getRecents(limit = 10): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as unknown[])
      .filter((v): v is string => typeof v === 'string')
      .slice(0, limit);
  } catch {
    return [];
  }
}

export function pushRecent(query: string, limit = 10): void {
  if (!query.trim()) return;
  try {
    const existing = getRecents(limit);
    const deduped = [query, ...existing.filter((q) => q !== query)].slice(0, limit);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(deduped));
  } catch {
    // localStorage may be unavailable (private mode, storage quota).
  }
}

export function clearRecents(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
}

export function useRecents(limit = 10): {
  recents: string[];
  push: (q: string) => void;
  clear: () => void;
} {
  const push = useCallback((q: string) => pushRecent(q, limit), [limit]);
  const clear = useCallback(() => clearRecents(), []);
  return { recents: getRecents(limit), push, clear };
}
