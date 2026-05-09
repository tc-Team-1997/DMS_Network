/**
 * QueuePane — left pane of the Indexing Station.
 *
 * Renders the claim queue as a DataTable v1. Rows:
 *   - Locked by another user → greyed out with "Locked by X · N min" badge
 *   - Locked by current user → highlighted with "You" chip
 *   - Unlocked → fully clickable
 *
 * Clicking a row fires onSelectRow (parent handles claim API call).
 */

import { useMemo } from 'react';
import { Lock } from 'lucide-react';
import { DataTable, Badge, type Column } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { IndexingRow } from '../schemas';

// ── helpers ───────────────────────────────────────────────────────────────────

function minutesRemaining(expiresAt: string): number {
  const ms = new Date(expiresAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 60_000));
}

function ocrBadgeTone(v: number | null): 'success' | 'warning' | 'danger' {
  if (v == null) return 'warning';
  if (v >= 90) return 'success';
  if (v >= 70) return 'warning';
  return 'danger';
}

// ── props ──────────────────────────────────────────────────────────────────────

export interface QueuePaneProps {
  rows: IndexingRow[];
  isLoading: boolean;
  activeDocId: number | null;
  currentUserId: number;
  onSelectRow: (row: IndexingRow) => void;
  onlyLowConf: boolean;
  onToggleLowConf: (v: boolean) => void;
}

// ── component ─────────────────────────────────────────────────────────────────

export function QueuePane({
  rows,
  isLoading,
  activeDocId,
  currentUserId,
  onSelectRow,
  onlyLowConf,
  onToggleLowConf,
}: QueuePaneProps) {
  const columns = useMemo((): Column<IndexingRow>[] => [
    {
      key: 'document',
      header: 'Document',
      render: (row) => {
        const name = row.original_name ?? row.filename;
        const lockedByOther = row.lock !== null && row.lock.user_id !== currentUserId;
        const lockedByMe = row.lock !== null && row.lock.user_id === currentUserId;
        return (
          <div className={cn('flex flex-col gap-0.5 min-w-0', lockedByOther && 'opacity-50')}>
            <span className="text-xs font-medium text-ink truncate" title={name}>{name}</span>
            <span className="text-2xs text-muted">{row.doc_type ?? 'Unknown type'}</span>
            {lockedByOther && row.lock && (
              <span className="flex items-center gap-1 text-2xs text-warning mt-0.5">
                <Lock size={10} aria-hidden="true" />
                Locked by {row.lock.user_name} · {minutesRemaining(row.lock.expires_at)} min remaining
              </span>
            )}
            {lockedByMe && (
              <span className="flex items-center gap-1 text-2xs text-brand-blue mt-0.5">
                <Lock size={10} aria-hidden="true" />
                Claimed by you
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: 'ocr',
      header: 'OCR',
      width: 80,
      render: (row) => (
        <Badge tone={ocrBadgeTone(row.ocr_confidence)}>
          {row.ocr_confidence == null ? '—' : `${row.ocr_confidence.toFixed(0)}%`}
        </Badge>
      ),
    },
    {
      key: 'branch',
      header: 'Branch',
      width: 80,
      render: (row) => (
        <span className="text-2xs text-muted">{row.branch ?? '—'}</span>
      ),
    },
  ], [currentUserId]);

  return (
    <div className="flex flex-col h-full border-r border-divider">
      {/* Filter bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-divider bg-raised">
        <span className="text-xs font-semibold text-ink flex-1">
          Queue ({rows.length})
        </span>
        <label className="flex items-center gap-1.5 text-2xs text-muted cursor-pointer select-none">
          <input
            type="checkbox"
            data-testid="only-low-conf"
            checked={onlyLowConf}
            onChange={(e) => onToggleLowConf(e.target.checked)}
            className="rounded accent-brand-blue"
          />
          Low conf only
        </label>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <DataTable
          columns={columns}
          data={rows}
          density="compact"
          stickyHeader
          empty={isLoading ? 'Loading queue…' : 'No documents need indexing.'}
          onRowClick={(row) => {
            // Prevent clicking a row locked by another user.
            if (row.lock !== null && row.lock.user_id !== currentUserId) return;
            onSelectRow(row);
          }}
        />
      </div>

      {/* Highlight active row with a sidebar accent — DataTable doesn't own
          row bg, so we use a CSS data-attr trick via a wrapper class. */}
      <style>{`
        [data-testid="datatable-row"][data-row-id="${activeDocId ?? ''}"] {
          background-color: var(--tw-color-action-subtle, #E3EFFF);
        }
      `}</style>
    </div>
  );
}
