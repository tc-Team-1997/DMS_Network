import { useState } from "react";
import type { ReactNode } from "react";

export interface Column<T> {
  key:      string;
  header:   string;
  render?:  (row: T) => ReactNode;
  sortable?: boolean;
  width?:   string | number;
}

export interface DataTableProps<T extends object> {
  columns:  Column<T>[];
  rows:     T[];
  rowKey:   (row: T) => string | number;
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
  /**
   * When set, the table renders internal pagination.
   * The pager shows "Prev / Page X of N · M items / Next" below the table.
   * When omitted the table is unchanged (backward compatible).
   */
  pageSize?: number;
}

export function DataTable<T extends object>({
  columns, rows, rowKey, onRowClick, emptyMessage = "No records found", pageSize,
}: DataTableProps<T>) {
  const [sortKey, setSortKey]   = useState<string | null>(null);
  const [sortAsc, setSortAsc]   = useState(true);
  const [page, setPage]         = useState(1);

  const sorted = sortKey
    ? [...rows].sort((a, b) => {
        const av = (a as Record<string, unknown>)[sortKey]; const bv = (b as Record<string, unknown>)[sortKey];
        const cmp = String(av ?? "").localeCompare(String(bv ?? ""), undefined, { numeric: true });
        return sortAsc ? cmp : -cmp;
      })
    : rows;

  function handleSort(col: Column<T>) {
    if (!col.sortable) return;
    if (sortKey === col.key) setSortAsc(v => !v);
    else { setSortKey(col.key); setSortAsc(true); }
    // Reset to first page when sort changes
    setPage(1);
  }

  // Pagination logic — only applied when pageSize is set.
  const totalPages = pageSize ? Math.max(1, Math.ceil(sorted.length / pageSize)) : 1;
  const safePage   = Math.min(page, totalPages);
  const visibleRows = pageSize
    ? sorted.slice((safePage - 1) * pageSize, safePage * pageSize)
    : sorted;

  return (
    <div>
      <table>
        <thead>
          <tr>
            {columns.map(col => (
              <th
                key={col.key}
                style={{
                  width:      col.width,
                  cursor:     col.sortable ? "pointer" : "default",
                  fontWeight: 700,
                }}
                onClick={() => handleSort(col)}
              >
                {col.header}
                {col.sortable && sortKey === col.key && (sortAsc ? " ↑" : " ↓")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visibleRows.length === 0 ? (
            <tr><td colSpan={columns.length} style={{ textAlign: "center", padding: 24, color: "var(--sil)" }}>{emptyMessage}</td></tr>
          ) : visibleRows.map(row => (
            <tr key={rowKey(row)} onClick={onRowClick ? () => onRowClick(row) : undefined}
                style={onRowClick ? { cursor: "pointer" } : undefined}>
              {columns.map(col => (
                <td key={col.key}>
                  {col.render ? col.render(row) : String((row as Record<string, unknown>)[col.key] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {pageSize && totalPages > 1 && (
        <div style={{
          display:        "flex",
          alignItems:     "center",
          justifyContent: "center",
          gap:            10,
          padding:        "10px 0 4px",
          fontSize:       11,
          color:          "var(--sil)",
        }}>
          <button
            className="btn bs xs"
            disabled={safePage <= 1}
            onClick={() => setPage(p => Math.max(1, p - 1))}
            aria-label="Previous page"
          >
            Prev
          </button>
          <span>
            Page {safePage} of {totalPages} &middot; {sorted.length} items
          </span>
          <button
            className="btn bs xs"
            disabled={safePage >= totalPages}
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            aria-label="Next page"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
