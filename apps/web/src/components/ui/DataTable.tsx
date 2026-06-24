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
}

export function DataTable<T extends object>({
  columns, rows, rowKey, onRowClick, emptyMessage = "No records found",
}: DataTableProps<T>) {
  const [sortKey, setSortKey]   = useState<string | null>(null);
  const [sortAsc, setSortAsc]   = useState(true);

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
  }

  return (
    <table>
      <thead>
        <tr>
          {columns.map(col => (
            <th
              key={col.key}
              style={{ width: col.width, cursor: col.sortable ? "pointer" : "default" }}
              onClick={() => handleSort(col)}
            >
              {col.header}
              {col.sortable && sortKey === col.key && (sortAsc ? " ↑" : " ↓")}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {sorted.length === 0 ? (
          <tr><td colSpan={columns.length} style={{ textAlign: "center", padding: 24, color: "var(--sil)" }}>{emptyMessage}</td></tr>
        ) : sorted.map(row => (
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
  );
}
