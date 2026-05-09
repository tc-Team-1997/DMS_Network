/**
 * DataTable v1
 *
 * Backwards-compatible drop-in replacement for the v0.1 DataTable.
 * All new capabilities are opt-in via optional props — existing callers
 * pass only `columns`, `data`, `empty`, and optionally `onRowClick` and
 * continue to work unchanged.
 *
 * Virtualization note
 * ───────────────────
 * When `virtualize` is enabled (explicitly or via 'auto' with >1 000 rows)
 * we use an IntersectionObserver-based sentinel that progressively renders
 * rows in windows of VIRTUAL_WINDOW_SIZE. This is adequate for up to ~10k
 * rows. Replace with @tanstack/react-virtual when it lands as a project dep
 * for full bi-directional virtualization.
 */

import {
  useEffect,
  useRef,
  useState,
  useCallback,
  useId,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/cn';
import {
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
  ChevronLeft,
  ChevronRight,
  Columns3,
} from 'lucide-react';
import { EmptyState } from './EmptyState';
import { Skeleton } from './Skeleton';

// ─── Column definition ────────────────────────────────────────────────────────

export interface Column<T> {
  key: string;
  header: string;
  width?: number;
  render: (row: T) => ReactNode;
  align?: 'left' | 'right' | 'center';
  /** Allow sorting on this column. Sortable columns show a sort icon in the header. */
  sortable?: boolean;
}

// ─── Sort ─────────────────────────────────────────────────────────────────────

export interface SortState {
  columnKey: string;
  direction: 'asc' | 'desc';
}

// ─── Selection ────────────────────────────────────────────────────────────────

export interface SelectionState {
  selectedKeys: Set<string | number>;
  onChange: (keys: Set<string | number>) => void;
}

// ─── Pagination ───────────────────────────────────────────────────────────────

export interface PaginationState {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
}

// ─── Column visibility ────────────────────────────────────────────────────────

export interface ColumnVisibilityState {
  hiddenKeys: Set<string>;
  onChange: (hidden: Set<string>) => void;
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface DataTableProps<T extends { id: number | string }> {
  columns: Column<T>[];
  data: readonly T[];
  onRowClick?: (row: T) => void;

  /** Empty-state message. String kept for backwards compatibility; ReactNode also accepted. */
  empty?: string | ReactNode;

  // ── Sorting ────────────────────────────────────────────────────────────────
  /** Controlled sort state. */
  sort?: SortState | null;
  /** Uncontrolled default sort. */
  defaultSort?: SortState;
  onSortChange?: (sort: SortState | null) => void;

  // ── Sticky header ──────────────────────────────────────────────────────────
  /** Makes <thead> sticky; stays visible while scrolling tall tables. */
  stickyHeader?: boolean;

  // ── Row selection ──────────────────────────────────────────────────────────
  selection?: SelectionState;
  selectionMode?: 'single' | 'multi';

  // ── Pagination ─────────────────────────────────────────────────────────────
  pagination?: PaginationState;

  // ── Column visibility ──────────────────────────────────────────────────────
  columnVisibility?: ColumnVisibilityState;

  // ── Density ────────────────────────────────────────────────────────────────
  density?: 'compact' | 'normal' | 'comfortable';

  // ── Virtualization ─────────────────────────────────────────────────────────
  /**
   * `'auto'` (default) enables IntersectionObserver windowing when
   * `data.length > 1 000`. `true` forces it on. `false` disables it.
   *
   * IntersectionObserver windowing — adequate for up to ~10k rows;
   * replace with @tanstack/react-virtual when it lands as a dep.
   */
  virtualize?: boolean | 'auto';

  // ── Mobile card mode ───────────────────────────────────────────────────────
  /**
   * When the viewport is ≤ 768 px wide, rows render as stacked cards using
   * this render prop instead of table rows. Falls back to the table if omitted.
   */
  mobileCard?: (row: T) => ReactNode;

  // ── Keyboard navigation ────────────────────────────────────────────────────
  /** Arrow keys move focus through cells; Space toggles selection. */
  keyboardNav?: boolean;

  // ── Async states ───────────────────────────────────────────────────────────
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const VIRTUAL_WINDOW_SIZE = 50;
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

// ─── Density cell/header padding ──────────────────────────────────────────────

const densityCell: Record<'compact' | 'normal' | 'comfortable', string> = {
  compact:     'px-3 py-1',
  normal:      'px-3 py-2',
  comfortable: 'px-3 py-3',
};
const densityHeader: Record<'compact' | 'normal' | 'comfortable', string> = {
  compact:     'px-3 py-1.5',
  normal:      'px-3 py-2',
  comfortable: 'px-3 py-3',
};

// ─── Sort icon ────────────────────────────────────────────────────────────────

function SortIcon({ columnKey, sort }: { columnKey: string; sort: SortState | null }) {
  if (sort === null || sort.columnKey !== columnKey) {
    return <ChevronsUpDown size={12} className="text-muted" />;
  }
  return sort.direction === 'asc'
    ? <ChevronUp size={12} className="text-brand-blue" />
    : <ChevronDown size={12} className="text-brand-blue" />;
}

// ─── Column visibility toggle ─────────────────────────────────────────────────

interface ColVisToggleProps<T> {
  columns: Column<T>[];
  visibility: ColumnVisibilityState;
}

function ColVisToggle<T>({ columns, visibility }: ColVisToggleProps<T>) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  function toggle(key: string) {
    const next = new Set(visibility.hiddenKeys);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    visibility.onChange(next);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-input border border-border bg-white px-2.5 py-1.5 text-xs text-ink-sub hover:bg-divider focus:outline-none focus:ring-2 focus:ring-brand-blue"
        aria-label="Toggle column visibility"
        aria-expanded={open}
      >
        <Columns3 size={13} />
        Columns
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-44 rounded-card border border-divider bg-surface py-1 shadow-card">
          {columns.map((col) => (
            <label
              key={col.key}
              className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs hover:bg-divider"
            >
              <input
                type="checkbox"
                checked={!visibility.hiddenKeys.has(col.key)}
                onChange={() => toggle(col.key)}
                className="h-3.5 w-3.5 rounded accent-brand-blue"
              />
              {col.header}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Pagination bar ───────────────────────────────────────────────────────────

function PaginationBar({ pagination }: { pagination: PaginationState }) {
  const { page, pageSize, total, onPageChange, onPageSizeChange } = pagination;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = Math.min(total, (page - 1) * pageSize + 1);
  const end = Math.min(total, page * pageSize);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-divider px-3 py-2 text-xs text-ink-sub">
      <span>
        Showing {start}–{end} of {total}
      </span>
      <div className="flex items-center gap-2">
        {onPageSizeChange !== undefined && (
          <label className="flex items-center gap-1.5">
            Rows
            <select
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="rounded-input border border-border px-1.5 py-0.5 text-xs focus:outline-none focus:ring-2 focus:ring-brand-blue"
            >
              {PAGE_SIZE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          className="rounded-input p-1 hover:bg-divider disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-brand-blue"
          aria-label="Previous page"
        >
          <ChevronLeft size={14} />
        </button>
        <span>
          {page} / {totalPages}
        </span>
        <button
          type="button"
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="rounded-input p-1 hover:bg-divider disabled:cursor-not-allowed disabled:opacity-40 focus:outline-none focus:ring-2 focus:ring-brand-blue"
          aria-label="Next page"
        >
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}

// ─── DataTable ────────────────────────────────────────────────────────────────

export function DataTable<T extends { id: number | string }>({
  columns,
  data,
  onRowClick,
  empty = 'No rows',
  sort: controlledSort,
  defaultSort,
  onSortChange,
  stickyHeader = false,
  selection,
  selectionMode = 'multi',
  pagination,
  columnVisibility,
  density = 'normal',
  virtualize = 'auto',
  mobileCard,
  keyboardNav = false,
  loading = false,
  error,
  onRetry,
}: DataTableProps<T>) {
  // ── Sort state ─────────────────────────────────────────────────────────────
  const isSortControlled = controlledSort !== undefined;
  const [internalSort, setInternalSort] = useState<SortState | null>(defaultSort ?? null);
  const activeSort: SortState | null = isSortControlled ? (controlledSort ?? null) : internalSort;

  function handleSortClick(key: string) {
    let next: SortState | null;
    if (activeSort === null || activeSort.columnKey !== key) {
      next = { columnKey: key, direction: 'asc' };
    } else if (activeSort.direction === 'asc') {
      next = { columnKey: key, direction: 'desc' };
    } else {
      next = null; // third click clears sort
    }
    if (!isSortControlled) setInternalSort(next);
    onSortChange?.(next);
  }

  // ── Mobile detection ───────────────────────────────────────────────────────
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)');
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // ── Column visibility filter ───────────────────────────────────────────────
  const visibleColumns = columnVisibility
    ? columns.filter((c) => !columnVisibility.hiddenKeys.has(c.key))
    : columns;

  // ── Virtualization ─────────────────────────────────────────────────────────
  const shouldVirtualize =
    virtualize === true || (virtualize === 'auto' && data.length > 1_000);

  const [renderedCount, setRenderedCount] = useState(
    shouldVirtualize ? Math.min(VIRTUAL_WINDOW_SIZE, data.length) : data.length,
  );
  const sentinelRef = useRef<HTMLTableRowElement>(null);

  useEffect(() => {
    setRenderedCount(
      shouldVirtualize ? Math.min(VIRTUAL_WINDOW_SIZE, data.length) : data.length,
    );
  }, [data.length, shouldVirtualize]);

  useEffect(() => {
    if (!shouldVirtualize || sentinelRef.current === null) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting) {
          setRenderedCount((n) => Math.min(n + VIRTUAL_WINDOW_SIZE, data.length));
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [shouldVirtualize, data.length, renderedCount]);

  const displayData = shouldVirtualize ? data.slice(0, renderedCount) : data;

  // ── Keyboard nav ───────────────────────────────────────────────────────────
  const tableId = useId();

  const handleCellKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTableCellElement>, row: T) => {
      if (!keyboardNav) return;
      const cell = e.currentTarget;
      const rowEl = cell.parentElement;
      const tbody = rowEl?.parentElement;
      if (!tbody) return;

      const rows = Array.from(tbody.querySelectorAll<HTMLTableRowElement>('tr'));
      const rowIdx = rows.indexOf(rowEl as HTMLTableRowElement);
      const cells = Array.from(rowEl?.querySelectorAll<HTMLTableCellElement>('td, th') ?? []);
      const cellIdx = cells.indexOf(cell);

      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault();
          const nextRow = rows[rowIdx + 1];
          const nextCell = nextRow?.querySelectorAll<HTMLTableCellElement>('td, th')[cellIdx];
          nextCell?.focus();
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          const prevRow = rows[rowIdx - 1];
          const prevCell = prevRow?.querySelectorAll<HTMLTableCellElement>('td, th')[cellIdx];
          prevCell?.focus();
          break;
        }
        case 'ArrowRight':
          e.preventDefault();
          cells[cellIdx + 1]?.focus();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          cells[cellIdx - 1]?.focus();
          break;
        case ' ':
          e.preventDefault();
          if (selection !== undefined) toggleSelection(row);
          break;
      }
    },
    // toggleSelection is stable within render; keyboardNav/selection are primitives/references
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [keyboardNav, selection],
  );

  // ── Selection helpers ──────────────────────────────────────────────────────
  function toggleSelection(row: T) {
    if (selection === undefined) return;
    const next = new Set(selection.selectedKeys);
    if (selectionMode === 'single') {
      next.clear();
      if (!selection.selectedKeys.has(row.id)) next.add(row.id);
    } else {
      if (next.has(row.id)) next.delete(row.id);
      else next.add(row.id);
    }
    selection.onChange(next);
  }

  function toggleAll() {
    if (selection === undefined || selectionMode === 'single') return;
    const allKeys = data.map((r) => r.id);
    const allSelected = allKeys.every((k) => selection.selectedKeys.has(k));
    selection.onChange(allSelected ? new Set() : new Set(allKeys));
  }

  // ── Mobile card render ─────────────────────────────────────────────────────
  if (isMobile && mobileCard !== undefined) {
    return (
      <div className="overflow-hidden rounded-card border border-divider bg-surface">
        {loading ? (
          <div className="p-4">
            <Skeleton variant="line" count={5} />
          </div>
        ) : error !== undefined ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="text-sm text-danger">{error}</p>
            {onRetry !== undefined && (
              <button
                type="button"
                onClick={onRetry}
                className="rounded-input border border-border px-3 py-1.5 text-xs hover:bg-divider"
              >
                Retry
              </button>
            )}
          </div>
        ) : data.length === 0 ? (
          <EmptyState title={typeof empty === 'string' ? empty : 'No results'} />
        ) : (
          <div className="flex flex-col divide-y divide-divider">
            {data.map((row) => (
              <div
                key={row.id}
                onClick={onRowClick !== undefined ? () => onRowClick(row) : undefined}
                className={cn(onRowClick !== undefined && 'cursor-pointer hover:bg-brand-skyLight/40')}
              >
                {mobileCard(row)}
              </div>
            ))}
          </div>
        )}
        {pagination !== undefined && <PaginationBar pagination={pagination} />}
      </div>
    );
  }

  // ── RTL-aware default alignment ────────────────────────────────────────────
  const dir = document.documentElement.dir;
  const defaultAlign: 'left' | 'right' = dir === 'rtl' ? 'right' : 'left';

  // ── Column count (for colSpan) ─────────────────────────────────────────────
  const colSpan = visibleColumns.length + (selection !== undefined ? 1 : 0);

  return (
    <div className="overflow-hidden rounded-card border border-divider bg-surface">
      {/* Toolbar: column visibility toggle */}
      {columnVisibility !== undefined && (
        <div className="flex items-center justify-end gap-2 border-b border-divider px-3 py-2">
          <ColVisToggle columns={columns} visibility={columnVisibility} />
        </div>
      )}

      {/* Horizontal scroll container */}
      <div className="overflow-x-auto">
        <table id={tableId} className="w-full text-sm" role="grid">
          <thead className={cn(stickyHeader && 'sticky top-0 z-10')}>
            <tr className="table-header">
              {/* Select-all checkbox */}
              {selection !== undefined && selectionMode === 'multi' && (
                <th className={cn(densityHeader[density], 'w-10')}>
                  <input
                    type="checkbox"
                    aria-label="Select all rows"
                    checked={
                      data.length > 0 &&
                      data.every((r) => selection.selectedKeys.has(r.id))
                    }
                    onChange={toggleAll}
                    className="h-4 w-4 rounded accent-brand-blue"
                  />
                </th>
              )}
              {selection !== undefined && selectionMode === 'single' && (
                <th
                  className={cn(densityHeader[density], 'w-10')}
                  aria-hidden="true"
                />
              )}

              {visibleColumns.map((col) => {
                const isSorted = activeSort?.columnKey === col.key;
                const align = col.align ?? defaultAlign;
                return (
                  <th
                    key={col.key}
                    style={col.width !== undefined ? { width: col.width } : undefined}
                    aria-sort={
                      col.sortable === true && isSorted
                        ? activeSort?.direction === 'asc'
                          ? 'ascending'
                          : 'descending'
                        : undefined
                    }
                    className={cn(
                      densityHeader[density],
                      'text-[11px] font-semibold text-ink-sub',
                      align === 'right' && 'text-right',
                      align === 'center' && 'text-center',
                      align === 'left' && 'text-left',
                      col.sortable === true && 'cursor-pointer select-none hover:text-ink',
                    )}
                    onClick={col.sortable === true ? () => handleSortClick(col.key) : undefined}
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.header}
                      {col.sortable === true && (
                        <SortIcon columnKey={col.key} sort={activeSort} />
                      )}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {/* Loading skeleton rows */}
            {loading &&
              Array.from({ length: 5 }, (_, i) => (
                <tr key={`skel-${i}`} className="border-t border-divider">
                  {selection !== undefined && (
                    <td className={densityCell[density]}>
                      <Skeleton variant="block" width={16} height={16} />
                    </td>
                  )}
                  {visibleColumns.map((col) => (
                    <td key={col.key} className={densityCell[density]}>
                      <Skeleton variant="line" />
                    </td>
                  ))}
                </tr>
              ))}

            {/* Error state */}
            {!loading && error !== undefined && (
              <tr>
                <td colSpan={colSpan} className="py-10 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <p className="text-sm text-danger">{error}</p>
                    {onRetry !== undefined && (
                      <button
                        type="button"
                        onClick={onRetry}
                        className="rounded-input border border-border px-3 py-1.5 text-xs hover:bg-divider focus:outline-none focus:ring-2 focus:ring-brand-blue"
                      >
                        Retry
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            )}

            {/* Empty state */}
            {!loading && error === undefined && displayData.length === 0 && (
              <tr>
                <td colSpan={colSpan}>
                  {typeof empty === 'string' ? (
                    <EmptyState title={empty} />
                  ) : (
                    <>{empty}</>
                  )}
                </td>
              </tr>
            )}

            {/* Data rows */}
            {!loading &&
              error === undefined &&
              displayData.map((row, i) => {
                const isSelected = selection?.selectedKeys.has(row.id) ?? false;
                return (
                  <tr
                    key={row.id}
                    aria-selected={selection !== undefined ? isSelected : undefined}
                    onClick={() => {
                      if (selection !== undefined) toggleSelection(row);
                      if (onRowClick !== undefined) onRowClick(row);
                    }}
                    className={cn(
                      'border-t border-divider',
                      i % 2 === 1 && 'bg-page',
                      (onRowClick !== undefined || selection !== undefined) &&
                        'cursor-pointer hover:bg-brand-skyLight/60',
                      isSelected && 'bg-brand-skyLight',
                    )}
                  >
                    {/* Selection checkbox/radio cell */}
                    {selection !== undefined && (
                      <td
                        className={cn(densityCell[density], 'w-10')}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={keyboardNav ? (e) => handleCellKeyDown(e, row) : undefined}
                        tabIndex={keyboardNav ? 0 : undefined}
                      >
                        <input
                          type={selectionMode === 'single' ? 'radio' : 'checkbox'}
                          aria-label={`Select row ${String(row.id)}`}
                          checked={isSelected}
                          onChange={() => toggleSelection(row)}
                          className="h-4 w-4 rounded accent-brand-blue"
                        />
                      </td>
                    )}

                    {visibleColumns.map((col) => {
                      const align = col.align ?? defaultAlign;
                      return (
                        <td
                          key={col.key}
                          tabIndex={keyboardNav ? 0 : undefined}
                          onKeyDown={keyboardNav ? (e) => handleCellKeyDown(e, row) : undefined}
                          className={cn(
                            densityCell[density],
                            'text-ink',
                            align === 'right' && 'text-right',
                            align === 'center' && 'text-center',
                          )}
                        >
                          {col.render(row)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}

            {/* Virtualization sentinel — triggers next window load */}
            {shouldVirtualize && renderedCount < data.length && (
              <tr ref={sentinelRef} aria-hidden="true">
                <td colSpan={colSpan} className="py-2 text-center">
                  <Skeleton variant="line" />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination bar */}
      {pagination !== undefined && <PaginationBar pagination={pagination} />}
    </div>
  );
}
