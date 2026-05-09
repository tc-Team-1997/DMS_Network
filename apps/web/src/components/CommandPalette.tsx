/**
 * CommandPalette — global Cmd-K / Ctrl-K overlay.
 *
 * Mounted from App.tsx (inside BrowserRouter, after <Routes>).
 * Portal renders into document.body so it floats above all other UI.
 *
 * Indexes searched:
 *   - Documents (FTS5 top-5 via POST /spa/api/search/cmdk)
 *   - Saved searches (name match top-5)
 *   - Nav routes (static, filtered by label)
 *   - Recents (last N queries from localStorage)
 *
 * Keyboard:
 *   Cmd/Ctrl+K  → open
 *   Esc          → close
 *   Up/Down      → navigate items
 *   Enter        → activate focused item
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Search, Clock, Bookmark, Navigation, FileText, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { isCmdK, useGlobalShortcut } from '@/lib/keyboard';
import { getRecents } from '@/modules/search/hooks/useRecents';
import { fetchCmdk } from '@/modules/search/api';
import type { PaletteGroup, PaletteItem } from '@/modules/search/schemas';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function groupIcon(group: string) {
  if (group === 'Documents')      return <FileText size={12} className="text-muted" />;
  if (group === 'Saved searches') return <Bookmark size={12} className="text-muted" />;
  if (group === 'Navigation')     return <Navigation size={12} className="text-muted" />;
  if (group === 'Recents')        return <Clock size={12} className="text-muted" />;
  return null;
}

function itemTypeIcon(type: PaletteItem['type']) {
  if (type === 'document')     return <FileText size={13} className="text-brand-blue/70" />;
  if (type === 'saved_search') return <Bookmark size={13} className="text-muted" />;
  if (type === 'nav')          return <Navigation size={13} className="text-muted" />;
  if (type === 'recent')       return <Clock size={13} className="text-muted" />;
  return null;
}

// Flatten groups into an indexed list for keyboard nav.
function flattenGroups(groups: PaletteGroup[]): { item: PaletteItem; groupIndex: number; itemIndex: number }[] {
  return groups.flatMap((g, gi) =>
    g.items.map((item, ii) => ({ item, groupIndex: gi, itemIndex: ii })),
  );
}

// ---------------------------------------------------------------------------
// PaletteOverlay
// ---------------------------------------------------------------------------

interface PaletteOverlayProps {
  onClose: () => void;
}

function PaletteOverlay({ onClose }: PaletteOverlayProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef  = useRef<HTMLDivElement>(null);

  // Debounced cmdk mutation.
  const { mutate: runCmdk, data: cmdkData, isPending } = useMutation({
    mutationFn: (q: string) => fetchCmdk(q),
  });

  // Debounce the API call.
  useEffect(() => {
    if (!query.trim()) return;
    const timer = setTimeout(() => runCmdk(query), 180);
    return () => clearTimeout(timer);
  }, [query, runCmdk]);

  // Build visible groups: recents (when query is empty) or API results.
  const groups: PaletteGroup[] = (() => {
    if (!query.trim()) {
      const recents = getRecents(5);
      if (recents.length === 0) return [];
      return [{
        group: 'Recents',
        items: recents.map((r) => ({
          type: 'recent' as const,
          label: r,
          href: `/search?q=${encodeURIComponent(r)}`,
        })),
      }];
    }
    return cmdkData?.groups ?? [];
  })();

  const flatItems = flattenGroups(groups);
  const hasFocus  = cursor >= 0 && cursor < flatItems.length;

  // Keyboard navigation inside the palette.
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, flatItems.length - 1));
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, -1));
    }
    if (e.key === 'Enter' && hasFocus) {
      e.preventDefault();
      const entry = flatItems[cursor];
      if (entry) activate(entry.item);
    }
  }

  function activate(item: PaletteItem) {
    onClose();
    navigate(item.href);
  }

  // Focus input on open.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Reset cursor when groups change.
  useEffect(() => { setCursor(-1); }, [groups.length]);

  // Scroll focused item into view.
  useEffect(() => {
    if (cursor < 0) return;
    const el = listRef.current?.querySelector(`[data-idx="${cursor}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  let globalIdx = -1;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh] px-4"
      onKeyDown={handleKeyDown}
      onClick={onClose}
    >
      {/* Scrim */}
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-sm" aria-hidden="true" />

      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="relative z-10 w-full max-w-xl rounded-card bg-surface shadow-card border border-divider overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-divider">
          <Search size={16} className="text-muted flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={groups.length > 0}
            aria-autocomplete="list"
            aria-controls="cmdk-listbox"
            aria-activedescendant={hasFocus ? `cmdk-item-${cursor}` : undefined}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setCursor(-1); }}
            placeholder="Search documents, navigate, run saved searches…"
            className="flex-1 bg-transparent text-base text-ink placeholder:text-muted outline-none border-none ring-0"
          />
          {isPending && (
            <span className="text-[10px] text-muted animate-pulse">Searching…</span>
          )}
          <button
            type="button"
            aria-label="Close palette"
            onClick={onClose}
            className="rounded p-1 text-muted hover:text-ink focus:outline-none focus:ring-1 focus:ring-border"
          >
            <X size={14} />
          </button>
        </div>

        {/* Results list */}
        <div
          ref={listRef}
          id="cmdk-listbox"
          role="listbox"
          aria-label="Results"
          className="max-h-[360px] overflow-y-auto py-1"
        >
          {groups.length === 0 && query.trim() && !isPending && (
            <p className="px-4 py-3 text-xs text-muted">No results for "{query}"</p>
          )}

          {groups.length === 0 && !query.trim() && (
            <p className="px-4 py-3 text-xs text-muted">
              Start typing to search documents, navigate, or run saved searches.
            </p>
          )}

          {groups.map((group) => (
            <div key={group.group}>
              {/* Group header */}
              <div className="flex items-center gap-1.5 px-4 py-1.5">
                {groupIcon(group.group)}
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">
                  {group.group}
                </span>
              </div>

              {/* Group items */}
              {group.items.map((item) => {
                globalIdx += 1;
                const idx = globalIdx;
                const focused = cursor === idx;
                return (
                  <button
                    key={`${group.group}-${idx}`}
                    type="button"
                    id={`cmdk-item-${idx}`}
                    role="option"
                    aria-selected={focused}
                    data-idx={idx}
                    onClick={() => activate(item)}
                    onMouseEnter={() => setCursor(idx)}
                    className={cn(
                      'flex w-full items-center gap-3 px-4 py-2 text-left transition-colors',
                      focused ? 'bg-brand-skyLight' : 'hover:bg-surface-alt',
                    )}
                  >
                    {itemTypeIcon(item.type)}
                    <div className="flex-1 min-w-0">
                      <p className={cn(
                        'text-sm truncate',
                        focused ? 'text-brand-blue font-medium' : 'text-ink',
                      )}>
                        {item.label}
                      </p>
                      {item.meta && (
                        <p className="text-[10px] text-muted truncate">{item.meta}</p>
                      )}
                    </div>
                    {focused && (
                      <kbd className="text-[10px] text-muted border border-border rounded px-1">
                        Enter
                      </kbd>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* Footer hint */}
        <div className="flex items-center gap-4 px-4 py-2 border-t border-divider bg-surface-alt">
          <span className="text-[10px] text-muted"><kbd className="border border-border rounded px-1">↑↓</kbd> navigate</span>
          <span className="text-[10px] text-muted"><kbd className="border border-border rounded px-1">Enter</kbd> open</span>
          <span className="text-[10px] text-muted"><kbd className="border border-border rounded px-1">Esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CommandPalette — stateful wrapper, mounted at app level
// ---------------------------------------------------------------------------

export function CommandPalette() {
  const [open, setOpen] = useState(false);

  const toggle = useCallback((e: KeyboardEvent) => {
    if (isCmdK(e)) {
      e.preventDefault();
      setOpen((v) => !v);
    }
  }, []);

  useGlobalShortcut(toggle, [toggle]);

  // Prevent body scroll while open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <PaletteOverlay onClose={() => setOpen(false)} />,
    document.body,
  );
}
