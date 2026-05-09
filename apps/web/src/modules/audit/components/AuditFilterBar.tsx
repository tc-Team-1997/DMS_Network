/**
 * AuditFilterBar — filter controls for the Audit Log v2 page.
 *
 * State is serialised to / from URL search params so filters survive refresh
 * and are bookmarkable/shareable. Uses useSearchParams from react-router-dom.
 * Never imports useMatches (not a data router).
 */

import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import { cn } from '@/lib/cn';
import type { AuditFilters, EntityTypeFilter, ResultFilter } from '../schemas';

const ENTITY_TYPES: { value: EntityTypeFilter; label: string }[] = [
  { value: '',         label: 'All types' },
  { value: 'document', label: 'Document' },
  { value: 'customer', label: 'Customer' },
  { value: 'workflow', label: 'Workflow' },
  { value: 'user',     label: 'User' },
  { value: 'config',   label: 'Config' },
  { value: 'system',   label: 'System' },
];

const RESULTS: { value: ResultFilter; label: string }[] = [
  { value: '',      label: 'All results' },
  { value: 'allow', label: 'Allow' },
  { value: 'deny',  label: 'Deny' },
  { value: 'error', label: 'Error' },
];

interface Props {
  /** Called whenever any filter changes. */
  onChange?: (filters: AuditFilters) => void;
}

/** Read current filter state from URL search params. */
export function useAuditFilters(): AuditFilters {
  const [params] = useSearchParams();
  return {
    entity_type: (params.get('entity_type') ?? '') as EntityTypeFilter,
    action:      params.get('action')   ?? '',
    actor:       params.get('actor')    ?? '',
    from:        params.get('from')     ?? '',
    to:          params.get('to')       ?? '',
    result:      (params.get('result')  ?? '') as ResultFilter,
    page:        parseInt(params.get('page') ?? '1', 10) || 1,
    per_page:    parseInt(params.get('per_page') ?? '50', 10) || 50,
  };
}

export function AuditFilterBar({ onChange }: Props) {
  const [params, setParams] = useSearchParams();

  const set = useCallback(
    (key: string, value: string) => {
      setParams((prev) => {
        const next = new URLSearchParams(prev);
        if (value) {
          next.set(key, value);
        } else {
          next.delete(key);
        }
        next.set('page', '1'); // reset pagination on filter change
        return next;
      });
      if (onChange) {
        // Pass updated filters immediately (values not flushed to URL yet).
        onChange({
          entity_type: (key === 'entity_type' ? value : params.get('entity_type') ?? '') as EntityTypeFilter,
          action:      key === 'action'      ? value : params.get('action')  ?? '',
          actor:       key === 'actor'       ? value : params.get('actor')   ?? '',
          from:        key === 'from'        ? value : params.get('from')    ?? '',
          to:          key === 'to'          ? value : params.get('to')      ?? '',
          result:      (key === 'result'     ? value : params.get('result')  ?? '') as ResultFilter,
          page: 1,
        });
      }
    },
    [params, setParams, onChange],
  );

  const clearAll = useCallback(() => {
    setParams({});
    if (onChange) onChange({ page: 1 });
  }, [setParams, onChange]);

  const hasFilters = ['entity_type', 'action', 'actor', 'from', 'to', 'result'].some(
    (k) => params.get(k),
  );

  const inputCls =
    'h-8 rounded-input border border-border bg-surface px-2.5 text-sm text-ink placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-brand-blue/40 transition';

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="audit-filter-bar">
      {/* Entity type */}
      <select
        value={params.get('entity_type') ?? ''}
        onChange={(e) => set('entity_type', e.target.value)}
        className={cn(inputCls, 'pr-7')}
        aria-label="Entity type filter"
      >
        {ENTITY_TYPES.map((t) => (
          <option key={t.value} value={t.value}>{t.label}</option>
        ))}
      </select>

      {/* Action text filter */}
      <div className="relative">
        <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
        <input
          type="text"
          placeholder="Action…"
          value={params.get('action') ?? ''}
          onChange={(e) => set('action', e.target.value)}
          className={cn(inputCls, 'pl-7 w-32')}
          aria-label="Action filter"
        />
      </div>

      {/* Actor */}
      <div className="relative">
        <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
        <input
          type="text"
          placeholder="Actor…"
          value={params.get('actor') ?? ''}
          onChange={(e) => set('actor', e.target.value)}
          className={cn(inputCls, 'pl-7 w-32')}
          aria-label="Actor filter"
        />
      </div>

      {/* Date range */}
      <input
        type="date"
        value={params.get('from') ?? ''}
        onChange={(e) => set('from', e.target.value)}
        className={inputCls}
        aria-label="From date"
        title="From date"
      />
      <span className="text-xs text-muted">–</span>
      <input
        type="date"
        value={params.get('to') ?? ''}
        onChange={(e) => set('to', e.target.value)}
        className={inputCls}
        aria-label="To date"
        title="To date"
      />

      {/* Result */}
      <select
        value={params.get('result') ?? ''}
        onChange={(e) => set('result', e.target.value)}
        className={cn(inputCls, 'pr-7')}
        aria-label="Result filter"
      >
        {RESULTS.map((r) => (
          <option key={r.value} value={r.value}>{r.label}</option>
        ))}
      </select>

      {/* Clear */}
      {hasFilters && (
        <button
          type="button"
          onClick={clearAll}
          className="inline-flex items-center gap-1 rounded-input border border-border bg-surface px-2.5 py-1 text-xs text-muted hover:text-danger hover:border-danger/40 transition"
          aria-label="Clear all filters"
        >
          <X size={11} /> Clear
        </button>
      )}
    </div>
  );
}
