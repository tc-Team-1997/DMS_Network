/**
 * FacetsSidebar — collapsible facet panels in the left rail.
 *
 * Each facet section shows value buckets with counts.
 * Clicking a value AND-narrows the result list via onFiltersChange.
 * Active values are rendered checked; clicking again removes the filter.
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { Facets, SearchFilters } from '../schemas';

// Facet definitions in display order.
interface FacetDef {
  key: keyof Facets;
  label: string;
  filterField: keyof Pick<SearchFilters, 'doc_type' | 'branch' | 'risk_band' | 'status'>;
}

const FACET_DEFS: FacetDef[] = [
  { key: 'doc_type',  label: 'Document type', filterField: 'doc_type' },
  { key: 'branch',    label: 'Branch',         filterField: 'branch' },
  { key: 'risk_band', label: 'Risk band',       filterField: 'risk_band' },
  { key: 'status',    label: 'Status',          filterField: 'status' },
];

function FacetSection({
  def,
  buckets,
  activeValues,
  onToggle,
}: {
  def: FacetDef;
  buckets: Record<string, number>;
  activeValues: string[];
  onToggle: (field: FacetDef['filterField'], value: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const entries = Object.entries(buckets).slice(0, 20);
  if (entries.length === 0) return null;

  return (
    <div className="border-b border-divider">
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-2.5 text-sm font-semibold text-ink hover:bg-surface-alt transition-colors"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {def.label}
        {open
          ? <ChevronDown size={13} className="text-muted" />
          : <ChevronRight size={13} className="text-muted" />
        }
      </button>

      {open && (
        <ul className="px-3 pb-3 space-y-0.5">
          {entries.map(([value, count]) => {
            const active = activeValues.includes(value);
            return (
              <li key={value}>
                <button
                  type="button"
                  onClick={() => onToggle(def.filterField, value)}
                  className={cn(
                    'flex w-full items-center justify-between rounded px-1.5 py-1 text-xs transition-colors',
                    active
                      ? 'bg-brand-skyLight text-brand-blue font-semibold'
                      : 'text-ink-sub hover:bg-surface-alt hover:text-ink',
                  )}
                >
                  <span className="flex items-center gap-1.5 truncate">
                    <span
                      className={cn(
                        'flex-shrink-0 w-3.5 h-3.5 rounded border flex items-center justify-center',
                        active ? 'bg-brand-blue border-brand-blue' : 'border-border',
                      )}
                      aria-hidden="true"
                    >
                      {active && (
                        <svg viewBox="0 0 10 10" className="w-2 h-2 text-white" fill="currentColor">
                          <path d="M1.5 5l2.5 2.5 4.5-4" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>
                    <span className="truncate">{value}</span>
                  </span>
                  <span className={cn(
                    'ml-1 flex-shrink-0 tabular-nums',
                    active ? 'text-brand-blue/70' : 'text-muted',
                  )}>
                    {count.toLocaleString()}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export interface FacetsSidebarProps {
  facets: Facets;
  filters: SearchFilters;
  onFiltersChange: (next: Partial<SearchFilters>) => void;
}

export function FacetsSidebar({ facets, filters, onFiltersChange }: FacetsSidebarProps) {
  function onToggle(field: FacetDef['filterField'], value: string) {
    const existing = filters[field];
    const next = existing.includes(value)
      ? existing.filter((v) => v !== value)
      : [...existing, value];
    onFiltersChange({ [field]: next });
  }

  const hasAny = FACET_DEFS.some((def) => {
    const b = facets[def.key];
    return b !== undefined && Object.keys(b).length > 0;
  });

  if (!hasAny) return null;

  return (
    <aside
      aria-label="Search facets"
      className="w-60 flex-shrink-0 border-r border-divider bg-surface-alt overflow-y-auto rounded-l-card"
    >
      <div className="px-3 py-2.5 border-b border-divider">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">
          Filter by
        </p>
      </div>
      {FACET_DEFS.map((def) => {
        const buckets = facets[def.key] ?? {};
        return (
          <FacetSection
            key={def.key}
            def={def}
            buckets={buckets}
            activeValues={filters[def.filterField]}
            onToggle={onToggle}
          />
        );
      })}
    </aside>
  );
}
