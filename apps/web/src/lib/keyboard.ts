/**
 * Global keyboard shortcut registration.
 *
 * useGlobalShortcut(handler, [keys])
 *   Registers a keydown handler on document for the app's lifetime.
 *   Automatically deregisters on component unmount.
 *
 * isCmdK(event) — true when the event is Cmd+K (macOS) or Ctrl+K (Windows/Linux).
 */

import { useEffect } from 'react';

export function isCmdK(e: KeyboardEvent): boolean {
  return (e.metaKey || e.ctrlKey) && e.key === 'k';
}

export function useGlobalShortcut(
  handler: (e: KeyboardEvent) => void,
  deps: React.DependencyList = [],
): void {
  useEffect(() => {
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
