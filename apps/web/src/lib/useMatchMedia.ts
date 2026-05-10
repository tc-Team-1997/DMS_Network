/**
 * useMatchMedia — reactive wrapper around window.matchMedia.
 *
 * Returns true when the media query matches. Reacts to viewport changes.
 * SSR-safe: returns false on the server (window is undefined).
 */

import { useEffect, useState } from 'react';

export function useMatchMedia(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia(query);
    setMatches(mq.matches);
    const handler = (e: MediaQueryListEvent) => { setMatches(e.matches); };
    mq.addEventListener('change', handler);
    return () => { mq.removeEventListener('change', handler); };
  }, [query]);

  return matches;
}

/** Convenience: true when viewport is below the md breakpoint (< 768 px). */
export function useIsMobile(): boolean {
  return useMatchMedia('(max-width: 767px)');
}

/** Convenience: true when viewport is below the lg breakpoint (< 1024 px). */
export function useIsBelowLg(): boolean {
  return useMatchMedia('(max-width: 1023px)');
}
