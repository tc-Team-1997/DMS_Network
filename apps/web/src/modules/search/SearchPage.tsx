/**
 * SearchPage — Search v2 redesign.
 *
 * Layout:
 *   ┌── Search input bar (full width) ─────────────────────────────────────┐
 *   │  [scope toggle]                                                       │
 *   └───────────────────────────────────────────────────────────────────────┘
 *   ┌── Facets sidebar (240px) ─┬─ Results list ──────┬─ Saved searches ──┐
 *   │  doc_type / branch /      │  N results for "q"  │  My / Team /       │
 *   │  risk_band / status       │  [ResultCard×N]      │  Tenant sections   │
 *   │  (collapsible sections)   │  [pagination]        │  [+Save CTA]       │
 *   │                           │  [Ask DocBrain CTA]  │                    │
 *   └───────────────────────────┴─────────────────────┴────────────────────┘
 *
 * URL state: all filter state lives in the URL (?q=…&branch=…&page=…).
 */

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileSearch, ChevronLeft, ChevronRight } from 'lucide-react';
import { Button, Skeleton } from '@/components/ui';
import { cn } from '@/lib/cn';
import { fetchSearch } from './api';
import { useUrlState } from './hooks/useUrlState';
import { useRecents } from './hooks/useRecents';
import { SearchInput } from './components/SearchInput';
import { FacetsSidebar } from './components/FacetsSidebar';
import { ResultCard } from './components/ResultCard';
import { SavedSearchesPanel } from './components/SavedSearchesPanel';
import { AskDocBrainCta } from './components/AskDocBrainCta';
import type { SearchFilters } from './schemas';

// ---------------------------------------------------------------------------
// Scope toggle (UI-only in v1; all scopes query documents)
// ---------------------------------------------------------------------------

const SCOPE_TABS = ['Documents', 'Workflows', 'Folders', 'Recents'] as const;
type ScopeTab = (typeof SCOPE_TABS)[number];

function ScopeToggle({
  active,
  onSelect,
}: {
  active: ScopeTab;
  onSelect: (s: ScopeTab) => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded-input border border-divider bg-surface-alt p-0.5">
      {SCOPE_TABS.map((tab) => (
        <button
          key={tab}
          type="button"
          aria-pressed={active === tab}
          onClick={() => onSelect(tab)}
          className={cn(
            'rounded px-3 py-1 text-xs font-medium transition-colors',
            active === tab
              ? 'bg-white text-ink shadow-card'
              : 'text-muted hover:text-ink',
          )}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pagination bar
// ---------------------------------------------------------------------------

function PaginationBar({
  page,
  pages,
  total,
  pageSize,
  onPage,
}: {
  page: number;
  pages: number;
  total: number;
  pageSize: number;
  onPage: (p: number) => void;
}) {
  if (pages <= 1) return null;

  const from = (page - 1) * pageSize + 1;
  const to   = Math.min(page * pageSize, total);

  return (
    <div className="flex items-center justify-between mt-4">
      <p className="text-xs text-muted">
        Showing {from.toLocaleString()}–{to.toLocaleString()} of {total.toLocaleString()}
      </p>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft size={14} />
        </Button>
        <span className="px-2 text-xs text-ink">
          {page} / {pages}
        </span>
        <Button
          variant="ghost"
          size="sm"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
          aria-label="Next page"
        >
          <ChevronRight size={14} />
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SearchPage
// ---------------------------------------------------------------------------

export function SearchPage() {
  const [filters, setFilters] = useUrlState();
  const { push: pushRecent } = useRecents();
  const [scopeTab, setScopeTab] = useState<ScopeTab>('Documents');

  const hasQuery = filters.q.trim().length > 0
    || filters.doc_type.length > 0
    || filters.branch.length > 0
    || filters.risk_band.length > 0
    || filters.status.length > 0;

  const { data, isLoading, isFetching, isError } = useQuery({
    queryKey: ['search', filters],
    queryFn:  () => fetchSearch(filters),
    enabled:  hasQuery,
    staleTime: 15_000,
    placeholderData: (prev) => prev,
  });

  // Push to recents when a q-based search completes.
  useEffect(() => {
    if (data && filters.q.trim()) {
      pushRecent(filters.q.trim());
    }
  }, [data, filters.q, pushRecent]);

  function handleSubmit(q: string) {
    setFilters({ q });
  }

  function handleFiltersChange(next: Partial<SearchFilters>) {
    setFilters(next);
  }

  function handleApplySaved(saved: Partial<SearchFilters>) {
    setFilters(saved);
  }

  const results  = data?.results   ?? [];
  const facets   = data?.facets    ?? {};
  const total    = data?.total     ?? 0;
  const pages    = data?.pages     ?? 0;
  const pageSize = data?.page_size ?? filters.page_size;

  const hasFacets = Object.values(facets).some((b) => Object.keys(b ?? {}).length > 0);

  return (
    <div className="flex flex-col h-full gap-4">
      {/* Search input bar */}
      <div className="flex flex-col gap-2">
        <SearchInput
          filters={filters}
          onFiltersChange={handleFiltersChange}
          onSubmit={handleSubmit}
        />
        <div className="flex items-center justify-between flex-wrap gap-2">
          <p className="text-xs text-muted">
            Full-text search spans name, customer, CID, OCR text, and notes.
            Try{' '}
            <code className="font-mono text-[10px] bg-divider rounded px-1">type:passport</code>
            {' '}or{' '}
            <code className="font-mono text-[10px] bg-divider rounded px-1">branch:thimphu</code>
            {' '}tokens.
          </p>
          <ScopeToggle active={scopeTab} onSelect={setScopeTab} />
        </div>
      </div>

      {/* Main content area — always rendered so SavedSearchesPanel is always accessible */}
      <div className="flex flex-1 gap-0 rounded-card border border-divider overflow-hidden bg-surface min-h-0">
        {/* Left: facets sidebar — only when query is active and facets have data */}
        {hasQuery && hasFacets && (
          <FacetsSidebar
            facets={facets}
            filters={filters}
            onFiltersChange={handleFiltersChange}
          />
        )}

        {/* Centre: idle state or results list */}
        <div className="flex-1 overflow-y-auto p-4 min-w-0">
          {/* Idle state — no query yet */}
          {!hasQuery && (
            <div className="flex flex-col items-center text-center py-16 text-muted">
              <FileSearch size={40} className="mb-3 text-brand-blue/40" />
              <p className="text-md font-medium text-ink">Start searching</p>
              <p className="text-xs mt-1 max-w-xs">
                Type in the box above, use operator tokens, or run a saved search from the panel.
              </p>
            </div>
          )}

          {/* Active query: header + results */}
          {hasQuery && (
            <>
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <h2 className="section-title">
                  {(isLoading && !data)
                    ? 'Searching…'
                    : data
                      ? `${total.toLocaleString()} result${total === 1 ? '' : 's'}${
                          filters.q ? ` for "${filters.q}"` : ''
                        }`
                    : 'Searching…'}
                  {isFetching && data && (
                    <span className="ml-2 text-xs font-normal text-muted animate-pulse">Updating…</span>
                  )}
                </h2>

                {data && total > 0 && (
                  <select
                    aria-label="Results per page"
                    value={filters.page_size}
                    onChange={(e) => setFilters({ page_size: Number(e.target.value) })}
                    className="input h-7 py-0 px-2 text-xs w-auto"
                  >
                    {[20, 50, 100].map((n) => (
                      <option key={n} value={n}>{n} per page</option>
                    ))}
                  </select>
                )}
              </div>

              {isLoading && !data && (
                <div className="space-y-3">
                  {[0, 1, 2].map((i) => (
                    <Skeleton key={i} className="h-24 w-full" />
                  ))}
                </div>
              )}

              {isError && !data && (
                <div className="flex flex-col items-center text-center py-12 text-muted">
                  <FileSearch size={32} className="mb-3 text-danger/30" />
                  <p className="text-md font-medium text-ink">Search error</p>
                  <p className="text-xs mt-1">
                    Could not complete the search. Please try again.
                  </p>
                </div>
              )}

              {!isLoading && !isError && data && results.length === 0 && (
                <div className="flex flex-col items-center text-center py-12 text-muted">
                  <FileSearch size={32} className="mb-3 text-brand-blue/30" />
                  <p className="text-md font-medium text-ink">
                    No results{filters.q ? ` for "${filters.q}"` : ''}
                  </p>
                  <p className="text-xs mt-1">
                    Try different keywords, or clear some facet filters.
                  </p>
                </div>
              )}

              {results.length > 0 && (
                <div className="space-y-3" aria-label="Search results" aria-live="polite">
                  {results.map((r) => (
                    <ResultCard key={r.id} result={r} query={filters.q} />
                  ))}
                </div>
              )}

              {data && total > 0 && (
                <PaginationBar
                  page={filters.page}
                  pages={pages}
                  total={total}
                  pageSize={pageSize}
                  onPage={(p) => setFilters({ page: p })}
                />
              )}

              {data && results.length > 0 && (
                <AskDocBrainCta results={results} total={total} query={filters.q} />
              )}
            </>
          )}
        </div>

        {/* Right: saved searches panel — always visible */}
        <SavedSearchesPanel
          currentFilters={filters}
          onApply={handleApplySaved}
        />
      </div>
    </div>
  );
}
