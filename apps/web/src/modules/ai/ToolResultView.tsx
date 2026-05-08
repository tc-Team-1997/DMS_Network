/**
 * Auto-renders a tool_result payload as a table, bar chart, or single-
 * value card depending on the shape. The agent's prose answer stays
 * concise and the visual output takes over presenting the data.
 *
 * Recognised shapes:
 *   { buckets: [{ bucket, count }], total }   → bar chart + total pill
 *   { rows: [...], count, table }             → data table
 *   [ { ... }, ... ]                          → data table
 *   { total, sql? }                           → single-value card
 *   anything else                             → collapsed JSON
 */
import { useState } from 'react';
import { ChevronDown, ChevronRight, Table as TableIcon, BarChart3 } from 'lucide-react';
import { cn } from '@/lib/cn';

type ToolResult = unknown;

interface Bucket { bucket: unknown; count: number }

function isBucketsResult(v: unknown): v is { buckets: Bucket[]; total?: number; note?: string; table?: string } {
  return (
    !!v && typeof v === 'object' && 'buckets' in v
    && Array.isArray((v as { buckets: unknown }).buckets)
  );
}

function isRowsResult(v: unknown): v is { rows: Record<string, unknown>[]; count?: number; table?: string } {
  return (
    !!v && typeof v === 'object' && 'rows' in v
    && Array.isArray((v as { rows: unknown }).rows)
  );
}

function isTotalResult(v: unknown): v is { total: number; table?: string; note?: string } {
  return (
    !!v && typeof v === 'object' && 'total' in v
    && typeof (v as { total: unknown }).total === 'number'
    && !('buckets' in v) && !('rows' in v)
  );
}

function isArrayOfObjects(v: unknown): v is Record<string, unknown>[] {
  return (
    Array.isArray(v) && v.length > 0
    && v.every((x) => x && typeof x === 'object' && !Array.isArray(x))
  );
}

export function ToolResultView({ result }: { result: ToolResult }) {
  if (isBucketsResult(result)) {
    return (
      <BucketsView
        buckets={result.buckets}
        {...(result.total !== undefined ? { total: result.total } : {})}
        {...(result.note !== undefined ? { note: result.note } : {})}
        {...(result.table !== undefined ? { table: result.table } : {})}
      />
    );
  }
  if (isRowsResult(result)) {
    return (
      <RowsView
        rows={result.rows}
        {...(result.table !== undefined ? { table: result.table } : {})}
        {...(result.count !== undefined ? { count: result.count } : {})}
      />
    );
  }
  if (isArrayOfObjects(result)) {
    return <RowsView rows={result} />;
  }
  if (isTotalResult(result)) {
    return (
      <TotalView
        total={result.total}
        {...(result.table !== undefined ? { table: result.table } : {})}
        {...(result.note !== undefined ? { note: result.note } : {})}
      />
    );
  }
  return <RawJson result={result} />;
}

function BucketsView({
  buckets, total, note, table,
}: {
  buckets: Bucket[];
  total?: number;
  note?: string;
  table?: string;
}) {
  const max = Math.max(1, ...buckets.map((b) => b.count));
  return (
    <div className="rounded-card border border-divider bg-white/70 p-3 my-1">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted inline-flex items-center gap-1">
          <BarChart3 size={11} />
          {table ? `Breakdown of ${table}` : 'Breakdown'}
        </p>
        {typeof total === 'number' && (
          <span className="text-xs text-ink">
            Total: <span className="font-semibold">{total.toLocaleString()}</span>
          </span>
        )}
      </div>
      <ul className="space-y-1.5">
        {buckets.map((b, i) => (
          <li key={i} className="flex items-center gap-2 text-xs">
            <span className="text-ink min-w-[96px] truncate" title={String(b.bucket ?? '—')}>
              {String(b.bucket ?? '—')}
            </span>
            <div className="flex-1 h-2 rounded-full bg-divider overflow-hidden">
              <div
                className="h-full bg-brand-blue transition-all"
                style={{ width: `${(b.count / max) * 100}%` }}
              />
            </div>
            <span className="font-mono text-ink tabular-nums">{b.count.toLocaleString()}</span>
          </li>
        ))}
      </ul>
      {note && <p className="mt-2 text-[10px] text-warning">{note}</p>}
    </div>
  );
}

function RowsView({
  rows, table, count,
}: {
  rows: Record<string, unknown>[];
  table?: string;
  count?: number;
}) {
  const [expanded, setExpanded] = useState(true);
  if (rows.length === 0) {
    return <p className="text-xs text-muted italic">No rows returned.</p>;
  }
  // Build a column list from the union of keys but keep the first row's
  // order as the base — trims noise from rows with extra fields.
  const columns: string[] = [];
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      if (!columns.includes(k)) columns.push(k);
    }
  }
  // Drop noisy sql/_meta keys and any column that's null across the whole set.
  const noisy = new Set(['sql', 'embedding', 'ocr_text']);
  const useful = columns.filter((c) => !noisy.has(c) && rows.some((r) => r[c] != null && r[c] !== ''));
  const display = useful.slice(0, 8);
  const previewRows = expanded ? rows : rows.slice(0, 5);
  return (
    <div className="rounded-card border border-divider bg-white/70 my-1">
      <div className="flex items-center justify-between px-3 py-2 border-b border-divider">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted inline-flex items-center gap-1">
          <TableIcon size={11} />
          {table ? table : 'Rows'}
          <span className="text-muted font-normal normal-case">
            ({count ?? rows.length} row{(count ?? rows.length) === 1 ? '' : 's'})
          </span>
        </p>
        {rows.length > 5 && (
          <button
            type="button"
            onClick={() => setExpanded((x) => !x)}
            className="text-[11px] text-brand-blue inline-flex items-center gap-1"
          >
            {expanded ? <><ChevronDown size={11} /> Collapse</> : <><ChevronRight size={11} /> Show all</>}
          </button>
        )}
      </div>
      <div className="overflow-auto max-h-[320px]">
        <table className="w-full text-[11px]">
          <thead className="bg-divider/40 text-muted">
            <tr>
              {display.map((c) => (
                <th key={c} className="text-left px-2 py-1 font-medium whitespace-nowrap">{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {previewRows.map((r, i) => (
              <tr key={i} className="border-t border-divider/50">
                {display.map((c) => (
                  <td key={c} className="px-2 py-1 text-ink align-top">
                    <CellValue value={r[c]} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CellValue({ value }: { value: unknown }) {
  if (value == null || value === '') return <span className="text-muted">—</span>;
  if (typeof value === 'boolean') return <span>{value ? 'yes' : 'no'}</span>;
  if (typeof value === 'number') return <span className="font-mono tabular-nums">{value.toLocaleString()}</span>;
  if (typeof value === 'string') {
    if (value.length > 80) return <span title={value}>{value.slice(0, 77)}…</span>;
    return <span>{value}</span>;
  }
  return <code className="font-mono text-[10px]">{JSON.stringify(value)}</code>;
}

function TotalView({ total, table, note }: { total: number; table?: string; note?: string }) {
  return (
    <div className="rounded-card border border-divider bg-white/70 p-3 my-1 inline-flex items-center gap-3">
      <span className="text-[10px] uppercase tracking-wider text-muted">
        {table ? `Count · ${table}` : 'Total'}
      </span>
      <span className="text-xl font-semibold text-ink tabular-nums">{total.toLocaleString()}</span>
      {note && <span className="text-[10px] text-warning">{note}</span>}
    </div>
  );
}

function RawJson({ result }: { result: unknown }) {
  const [expanded, setExpanded] = useState(false);
  const text = JSON.stringify(result, null, 2);
  if (text.length < 160) {
    return <pre className="text-[10px] font-mono bg-divider/40 rounded px-2 py-1 my-1 overflow-x-auto">{text}</pre>;
  }
  return (
    <div className="my-1">
      <button
        type="button"
        onClick={() => setExpanded((x) => !x)}
        className="text-[11px] text-brand-blue inline-flex items-center gap-1"
      >
        {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />} Tool output ({text.length} chars)
      </button>
      {expanded && (
        <pre className={cn(
          'mt-1 text-[10px] font-mono bg-divider/40 rounded px-2 py-2 overflow-auto',
          'max-h-[240px]',
        )}>{text}</pre>
      )}
    </div>
  );
}
