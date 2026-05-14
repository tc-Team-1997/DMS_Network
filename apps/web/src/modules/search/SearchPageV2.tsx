/**
 * Search Results v2 — Plan 3 (Wave-E1) Task #7 (mockup screen 17).
 *
 * Routed at `/search/v2`. URL state drives filters:
 *   ?q=<text>&type=passport&branch=cairo&status=approved
 *
 * Layout: top header → operator-token chips → 2-column grid
 *   - Left:  FacetsSidebar (type / branch / status with counts)
 *   - Right: list of SearchResultRow with FTS5-highlighted snippet + actions
 *           + AskDocBrainCta footer
 *
 * Mobile: facets collapse into a toggleable drawer below `<md`.
 */

import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { X, Search, Download, ExternalLink, Sparkles, Filter, ChevronDown } from 'lucide-react';
import { Skeleton } from '@/components/ui';
import { cn } from '@/lib/cn';
import { fetchSearchV2 } from './api';
import type { SearchV2Filters, SearchV2Result, SearchV2Facets } from './schemas';

// ---------------------------------------------------------------------------
// Snippet sanitisation
//
// The backend returns FTS5 snippet() output wrapped in `<mark>` tags. We
// strip every tag except a whitelisted `<mark>` (no attributes allowed)
// before handing the HTML to dangerouslySetInnerHTML — defence in depth
// against any ocr_text / customer_name containing user-provided angle
// brackets.
// ---------------------------------------------------------------------------

function sanitizeSnippet(raw: string | null): string {
  if (!raw) return '';
  // Drop every tag except <mark>/</mark> (no attributes).
  return raw.replace(/<(?!\/?mark(?:>|\s))[^>]*>/gi, '');
}

function SnippetWithHighlight({ html }: { html: string }) {
  const clean = useMemo(() => sanitizeSnippet(html), [html]);
  return (
    <p
      data-testid="search-snippet"
      className="text-xs leading-relaxed text-ink-sub"
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}

// ---------------------------------------------------------------------------
// OperatorTokenChip
// ---------------------------------------------------------------------------

interface ChipProps {
  tokenKey: string;
  tokenValue: string;
  onRemove: () => void;
}

function OperatorTokenChip({ tokenKey, tokenValue, onRemove }: ChipProps) {
  return (
    <span
      data-testid={`search-token-chip-${tokenKey}`}
      className="inline-flex items-center gap-1 rounded-badge bg-action-subtle border border-action px-2 py-1 text-xs font-mono text-action"
    >
      {tokenKey}:{tokenValue}
      <button
        type="button"
        aria-label={`Remove ${tokenKey} filter`}
        onClick={onRemove}
        className="ml-0.5 inline-flex items-center justify-center rounded p-0.5 hover:bg-action/10 focus:outline-none focus:ring-2 focus:ring-action"
      >
        <X size={12} />
      </button>
    </span>
  );
}

// ---------------------------------------------------------------------------
// FacetsSidebar
// ---------------------------------------------------------------------------

interface FacetsProps {
  facets: SearchV2Facets;
  active: { type?: string | null; branch?: string | null; status?: string | null };
  onToggle: (axis: 'type' | 'branch' | 'status', value: string) => void;
}

function FacetGroup({
  axis,
  title,
  counts,
  activeValue,
  onToggle,
}: {
  axis: 'type' | 'branch' | 'status';
  title: string;
  counts: Record<string, number>;
  activeValue: string | null | undefined;
  onToggle: (axis: 'type' | 'branch' | 'status', value: string) => void;
}) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return (
    <section
      data-testid={`search-facet-group-${axis}`}
      aria-labelledby={`search-facet-${axis}-title`}
      className="border-b border-divider last:border-0 pb-3 mb-3"
    >
      <h3
        id={`search-facet-${axis}-title`}
        className="text-2xs font-semibold uppercase tracking-wider text-muted mb-1.5"
      >
        {title}
      </h3>
      {entries.length === 0 ? (
        <p className="text-2xs text-muted italic">No matches</p>
      ) : (
        <ul className="space-y-0.5">
          {entries.map(([value, count]) => {
            const isActive = activeValue === value;
            return (
              <li key={value}>
                <button
                  type="button"
                  onClick={() => onToggle(axis, value)}
                  aria-pressed={isActive}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded px-2 py-1 text-xs min-h-[28px]',
                    isActive
                      ? 'bg-action-subtle text-action font-medium'
                      : 'text-ink-sub hover:bg-raised',
                  )}
                >
                  <span className="truncate">{value}</span>
                  <span className="text-2xs text-muted tabular-nums">{count}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function FacetsSidebar({ facets, active, onToggle }: FacetsProps) {
  return (
    <aside
      data-testid="search-facets-sidebar"
      aria-label="Search facets"
      className="rounded-card border border-divider bg-surface p-3"
    >
      <FacetGroup axis="type"   title="Document type" counts={facets.type}   activeValue={active.type}   onToggle={onToggle} />
      <FacetGroup axis="branch" title="Branch"        counts={facets.branch} activeValue={active.branch} onToggle={onToggle} />
      <FacetGroup axis="status" title="Status"        counts={facets.status} activeValue={active.status} onToggle={onToggle} />
    </aside>
  );
}

// ---------------------------------------------------------------------------
// SearchResultRow
// ---------------------------------------------------------------------------

function SearchResultRow({ result }: { result: SearchV2Result }) {
  return (
    <article
      data-testid="search-result-row"
      className="rounded-card border border-divider bg-surface p-4 hover:border-brand-blue/40 hover:shadow-sm transition-all"
    >
      <header className="flex flex-wrap items-baseline gap-2 mb-1.5">
        <Link
          to={`/viewer/${result.id}`}
          data-testid="result-action-open"
          className="text-sm font-semibold text-ink hover:text-brand-blue"
        >
          {result.original_name ?? `Document #${result.id}`}
        </Link>
        {result.doctype && (
          <span className="rounded-badge bg-raised border border-divider px-2 py-0.5 text-2xs font-mono text-ink-sub">
            {result.doctype}
          </span>
        )}
        {result.branch_id && (
          <span className="text-2xs text-muted">· {result.branch_id}</span>
        )}
        {result.status && (
          <span className="text-2xs text-muted">· {result.status}</span>
        )}
        {result.customer_cid && (
          <span className="text-2xs text-muted font-mono">· {result.customer_cid}</span>
        )}
      </header>
      {result.snippet && <SnippetWithHighlight html={result.snippet} />}
      <footer className="mt-2.5 flex flex-wrap items-center gap-3 text-xs">
        <Link
          to={`/viewer/${result.id}`}
          data-testid="result-action-open"
          className="inline-flex items-center gap-1 text-brand-blue hover:underline"
        >
          <ExternalLink size={11} />
          Open
        </Link>
        <a
          href={`/spa/api/documents/${result.id}/download`}
          data-testid="result-action-download"
          className="inline-flex items-center gap-1 text-ink-sub hover:text-ink"
        >
          <Download size={11} />
          Download
        </a>
        <Link
          to={`/docbrain?doc=${result.id}`}
          data-testid="result-action-ask-docbrain"
          className="inline-flex items-center gap-1 text-ink-sub hover:text-ink"
        >
          <Sparkles size={11} />
          Ask DocBrain
        </Link>
      </footer>
    </article>
  );
}

// ---------------------------------------------------------------------------
// AskDocBrainCta
// ---------------------------------------------------------------------------

function AskDocBrainCta({ count, resultIds }: { count: number; resultIds: number[] }) {
  const seed = resultIds.slice(0, 20).join(',');
  return (
    <Link
      to={`/docbrain?seed_corpus=${encodeURIComponent(seed)}`}
      data-testid="search-ask-docbrain-cta"
      className="block rounded-card border border-action/40 bg-action-subtle px-4 py-3 text-center text-sm font-medium text-action hover:bg-action/10 focus:outline-none focus:ring-2 focus:ring-action"
    >
      <Sparkles size={14} className="inline mr-1.5" />
      Ask DocBrain about these {count} result{count === 1 ? '' : 's'}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// SearchPageV2
// ---------------------------------------------------------------------------

export function SearchPageV2() {
  const [params, setParams] = useSearchParams();
  const [mobileFacetsOpen, setMobileFacetsOpen] = useState(false);

  const q = params.get('q') ?? '';
  const filters: SearchV2Filters = {
    q,
    type:   params.get('type'),
    branch: params.get('branch'),
    status: params.get('status'),
  };

  const searchQ = useQuery({
    queryKey: ['search-v2', q, filters.type, filters.branch, filters.status],
    queryFn: () => fetchSearchV2(filters),
    enabled: q.length > 0,
  });

  function removeChip(key: 'type' | 'branch' | 'status') {
    const next = new URLSearchParams(params);
    next.delete(key);
    setParams(next);
  }

  function toggleFacet(axis: 'type' | 'branch' | 'status', value: string) {
    const next = new URLSearchParams(params);
    if (next.get(axis) === value) {
      next.delete(axis);
    } else {
      next.set(axis, value);
    }
    setParams(next);
  }

  const data = searchQ.data;
  const chipEntries: Array<['type' | 'branch' | 'status', string]> = (
    [
      ['type', filters.type],
      ['branch', filters.branch],
      ['status', filters.status],
    ] as const
  ).flatMap(([k, v]) => (v ? [[k, v] as ['type' | 'branch' | 'status', string]] : []));

  return (
    <div data-testid="search-v2-page" className="flex flex-col gap-4 p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Search size={18} className="text-brand-blue" />
        <h1 className="text-lg font-semibold text-ink">
          Search results
          {q && <span className="ml-2 text-sm text-muted font-normal">for &ldquo;{q}&rdquo;</span>}
        </h1>
        {data && (
          <span className="ml-auto text-xs text-muted">
            {data.total} result{data.total === 1 ? '' : 's'} in {data.took_ms} ms
          </span>
        )}
      </div>

      {/* Operator chips */}
      {chipEntries.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {chipEntries.map(([k, v]) => (
            <OperatorTokenChip key={k} tokenKey={k} tokenValue={v} onRemove={() => removeChip(k)} />
          ))}
        </div>
      )}

      {/* Mobile facets toggle */}
      <button
        type="button"
        data-testid="search-facets-toggle"
        onClick={() => setMobileFacetsOpen((v) => !v)}
        aria-expanded={mobileFacetsOpen}
        aria-controls="search-facets-mobile"
        className="md:hidden inline-flex items-center justify-between gap-2 rounded-input border border-divider bg-surface px-3 py-2 text-sm text-ink min-h-[44px]"
      >
        <span className="inline-flex items-center gap-2">
          <Filter size={14} /> Facets
        </span>
        <ChevronDown size={14} className={mobileFacetsOpen ? 'rotate-180 transition-transform' : 'transition-transform'} />
      </button>

      <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-4">
        {/* Mobile drawer (collapsible) — hidden on md+ */}
        <div
          id="search-facets-mobile"
          className={cn('md:hidden', mobileFacetsOpen ? 'block' : 'hidden')}
        >
          {data && (
            <FacetsSidebar
              facets={data.facets}
              active={{ type: filters.type, branch: filters.branch, status: filters.status }}
              onToggle={toggleFacet}
            />
          )}
        </div>
        {/* Desktop facets — always visible on md+ */}
        <div className="hidden md:block">
          {data && (
            <FacetsSidebar
              facets={data.facets}
              active={{ type: filters.type, branch: filters.branch, status: filters.status }}
              onToggle={toggleFacet}
            />
          )}
        </div>

        {/* Results */}
        <div className="space-y-3">
          {searchQ.isLoading && (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => <Skeleton key={i} height={84} />)}
            </div>
          )}
          {q.length === 0 && (
            <p className="rounded-card border border-divider bg-surface p-6 text-center text-sm text-muted">
              Enter a query to search the corpus.
            </p>
          )}
          {data && data.results.length === 0 && q.length > 0 && !searchQ.isLoading && (
            <p className="rounded-card border border-divider bg-surface p-6 text-center text-sm text-muted">
              No results for &ldquo;{q}&rdquo;. Try a different query or clear filters.
            </p>
          )}
          {data && data.results.map((r) => <SearchResultRow key={r.id} result={r} />)}
          {data && data.results.length > 0 && (
            <AskDocBrainCta count={data.total} resultIds={data.results.map((r) => r.id)} />
          )}
        </div>
      </div>
    </div>
  );
}
