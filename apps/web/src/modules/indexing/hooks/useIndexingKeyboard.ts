/**
 * useIndexingKeyboard — global keyboard bindings for the Indexing Station.
 *
 * Bindings (all only active when station has a document open):
 *   J          → next field
 *   K          → prev field
 *   Tab        → next field  (native Tab still works; we intercept it
 *                              only when the station is focused to avoid
 *                              breaking normal tab-order elsewhere)
 *   Shift+Enter → save + advance to next queue item
 *   Esc         → release lock + close station
 *   ?           → toggle shortcut help overlay
 *
 * J/K keys are configurable via tenant_config (passed as props).
 */

import { useEffect } from 'react';
import type { RefObject } from 'react';

export interface IndexingKeyboardOptions {
  /** Whether a document is currently open (bindings are no-ops otherwise). */
  active: boolean;
  /** Field input refs in order — used to compute next/prev. */
  fieldRefs: RefObject<HTMLInputElement | null>[];
  /** Index of the currently focused field (-1 if none). */
  focusedFieldIndex: number;
  setFocusedFieldIndex: (i: number) => void;
  onSaveAndNext: () => void;
  onRelease: () => void;
  onToggleHelp: () => void;
  /** Configurable key for "next field" (default 'j'). */
  keyNext?: string;
  /** Configurable key for "prev field" (default 'k'). */
  keyPrev?: string;
}

export function useIndexingKeyboard({
  active,
  fieldRefs,
  focusedFieldIndex,
  setFocusedFieldIndex,
  onSaveAndNext,
  onRelease,
  onToggleHelp,
  keyNext = 'j',
  keyPrev = 'k',
}: IndexingKeyboardOptions): void {
  useEffect(() => {
    if (!active) return;

    function handler(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      // When focus is inside a text input or textarea, only intercept
      // Shift+Enter and Esc (not J/K which would break typing).
      const inInput =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT';

      if (e.key === 'Escape') {
        e.preventDefault();
        onRelease();
        return;
      }

      if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault();
        onSaveAndNext();
        return;
      }

      if (e.key === '?' && !inInput) {
        e.preventDefault();
        onToggleHelp();
        return;
      }

      if (inInput) return; // J/K/Tab only outside text inputs

      const total = fieldRefs.length;
      if (total === 0) return;

      let nextIndex: number | null = null;

      if (e.key.toLowerCase() === keyNext.toLowerCase()) {
        e.preventDefault();
        nextIndex = focusedFieldIndex < total - 1 ? focusedFieldIndex + 1 : 0;
      } else if (e.key.toLowerCase() === keyPrev.toLowerCase()) {
        e.preventDefault();
        nextIndex = focusedFieldIndex > 0 ? focusedFieldIndex - 1 : total - 1;
      }

      if (nextIndex !== null) {
        setFocusedFieldIndex(nextIndex);
        const ref = fieldRefs[nextIndex];
        ref?.current?.focus();
      }
    }

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    active,
    fieldRefs,
    focusedFieldIndex,
    setFocusedFieldIndex,
    onSaveAndNext,
    onRelease,
    onToggleHelp,
    keyNext,
    keyPrev,
  ]);
}
