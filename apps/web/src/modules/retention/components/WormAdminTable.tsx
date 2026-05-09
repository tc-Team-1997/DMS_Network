/**
 * WormAdminTable — list all WORM-locked documents with lock period remaining.
 * Doc Admin can extend the lock period (never shorten).
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Lock, CalendarPlus } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { fetchLockedDocuments } from '../api';
import { ExtendLockDialog } from './ExtendLockDialog';
import type { LockedDocument } from '../schemas';

export function WormAdminTable() {
  const [extending, setExtending] = useState<LockedDocument | null>(null);

  const q = useQuery({
    queryKey: ['retention', 'worm-locked'],
    queryFn: () => fetchLockedDocuments(),
    refetchInterval: 120_000,
  });

  if (q.isLoading) return <Skeleton className="h-32 w-full rounded-card" />;

  if (q.isError) {
    return (
      <EmptyState
        title="Failed to load locked documents"
        body="Could not fetch WORM-locked documents. Ensure the WORM feature flag is enabled."
      />
    );
  }

  const docs = q.data ?? [];

  if (docs.length === 0) {
    return (
      <EmptyState
        icon={<Lock size={18} />}
        title="No WORM-locked documents"
        body="Documents become WORM-locked when a retention policy is applied or an admin locks them manually."
      />
    );
  }

  return (
    <>
      <div className="overflow-x-auto rounded-card border border-divider bg-surface">
        <table className="w-full text-sm">
          <thead>
            <tr className="table-header">
              <th className="px-3 py-2 text-left text-[11px] font-semibold text-ink-sub">ID</th>
              <th className="px-3 py-2 text-left text-[11px] font-semibold text-ink-sub">Name</th>
              <th className="px-3 py-2 text-left text-[11px] font-semibold text-ink-sub">Type</th>
              <th className="px-3 py-2 text-left text-[11px] font-semibold text-ink-sub">Locked at</th>
              <th className="px-3 py-2 text-left text-[11px] font-semibold text-ink-sub">Unlock after</th>
              <th className="px-3 py-2 text-left text-[11px] font-semibold text-ink-sub">Days left</th>
              <th className="px-3 py-2 text-left text-[11px] font-semibold text-ink-sub">Hash prefix</th>
              <th className="px-3 py-2 text-left text-[11px] font-semibold text-ink-sub">Extend</th>
            </tr>
          </thead>
          <tbody>
            {docs.map((doc) => {
              const daysLeft = doc.days_remaining;
              const urgentTone =
                daysLeft === null
                  ? 'neutral'
                  : daysLeft <= 30
                  ? 'warning'
                  : daysLeft <= 90
                  ? 'blue'
                  : 'neutral';

              return (
                <tr
                  key={doc.id}
                  className="border-t border-divider hover:bg-raised/40"
                  data-testid={`worm-admin-row-${doc.id}`}
                >
                  <td className="px-3 py-2 font-mono text-xs text-muted">{doc.id}</td>
                  <td className="px-3 py-2 text-xs text-ink max-w-[180px] truncate">
                    {doc.original_name ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted">{doc.doc_type ?? '—'}</td>
                  <td className="px-3 py-2 text-xs text-muted">
                    {doc.worm_locked_at !== null
                      ? new Date(doc.worm_locked_at).toLocaleDateString()
                      : '—'}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted">
                    {doc.worm_unlock_after !== null
                      ? new Date(doc.worm_unlock_after).toLocaleDateString()
                      : 'Indefinite'}
                  </td>
                  <td className="px-3 py-2">
                    {daysLeft !== null ? (
                      <Badge tone={urgentTone}>{daysLeft}d</Badge>
                    ) : (
                      <span className="text-xs text-muted">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-muted">
                    {doc.sha256_prefix ?? '—'}
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => setExtending(doc)}
                      className="inline-flex items-center gap-1 rounded-input border border-border px-2 py-1 text-[10px] text-ink-sub hover:bg-divider focus:outline-none focus:ring-2 focus:ring-brand-blue"
                      aria-label={`Extend WORM lock for document ${doc.id}`}
                      data-testid={`worm-extend-btn-${doc.id}`}
                    >
                      <CalendarPlus size={10} />
                      Extend
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {extending !== null && (
        <ExtendLockDialog
          doc={extending}
          onClose={() => setExtending(null)}
        />
      )}
    </>
  );
}
