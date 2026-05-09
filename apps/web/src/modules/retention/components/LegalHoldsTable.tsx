/**
 * LegalHoldsTable — list all legal holds, apply new holds, release holds.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, Plus, Unlock } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';
import { HttpError } from '@/lib/http';
import { fetchLegalHolds, applyLegalHold, releaseLegalHold } from '../api';
import type { LegalHold } from '../schemas';

// ── Apply hold form ────────────────────────────────────────────────────────────

function ApplyHoldForm({ onDone }: { onDone: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [docId, setDocId] = useState('');
  const [reason, setReason] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      applyLegalHold({ doc_id: parseInt(docId, 10), reason }),
    onSuccess: (hold) => {
      void qc.invalidateQueries({ queryKey: ['legal-holds'] });
      toast({ variant: 'success', title: `Legal hold applied to document #${hold.doc_id}` });
      setDocId('');
      setReason('');
      onDone();
    },
    onError: (err: unknown) => {
      const msg = err instanceof HttpError ? err.message : (err as Error).message;
      toast({ variant: 'error', title: 'Failed to apply hold', message: msg });
    },
  });

  const docIdNum = parseInt(docId, 10);
  const valid = !isNaN(docIdNum) && docIdNum > 0 && reason.length >= 20;

  return (
    <div className="rounded-card border border-divider bg-surface p-4 space-y-3">
      <h3 className="text-sm font-semibold text-ink flex items-center gap-2">
        <Plus size={13} className="text-brand-blue" />
        Apply legal hold
      </h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="lh-doc-id" className="label text-xs font-medium text-ink">
            Document ID
          </label>
          <input
            id="lh-doc-id"
            type="number"
            min={1}
            value={docId}
            onChange={(e) => setDocId(e.target.value)}
            placeholder="42"
            className="input mt-1 w-full text-sm"
          />
        </div>
        <div>
          <label htmlFor="lh-reason" className="label text-xs font-medium text-ink">
            Reason <span className="text-danger">*</span>
          </label>
          <input
            id="lh-reason"
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Legal hold reason (min 20 chars)…"
            className={cn(
              'input mt-1 w-full text-sm',
              reason.length > 0 && reason.length < 20 && 'border-danger',
            )}
          />
          <p className={cn('mt-0.5 text-xs', reason.length < 20 && reason.length > 0 ? 'text-danger' : 'text-muted')}>
            {reason.length}/20
          </p>
        </div>
      </div>
      <Button
        type="button"
        size="sm"
        onClick={() => mutation.mutate()}
        disabled={!valid}
        loading={mutation.isPending}
        data-testid="legal-hold-apply"
      >
        <ShieldCheck size={13} />
        Apply hold
      </Button>
    </div>
  );
}

// ── Release hold inline ────────────────────────────────────────────────────────

function ReleaseHoldInline({ hold, onDone }: { hold: LegalHold; onDone: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [reason, setReason] = useState('');

  const mutation = useMutation({
    mutationFn: () => releaseLegalHold(hold.id, { reason }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['legal-holds'] });
      toast({ variant: 'success', title: `Hold #${hold.id} released` });
      onDone();
    },
    onError: (err: unknown) => {
      const msg = err instanceof HttpError ? err.message : (err as Error).message;
      toast({ variant: 'error', title: 'Failed to release hold', message: msg });
    },
  });

  const valid = reason.length >= 20;

  return (
    <div className="mt-1 flex flex-col gap-1">
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="Release reason (min 20 chars)…"
        className={cn(
          'w-48 rounded-input border border-border px-2 py-1 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-brand-blue',
          reason.length > 0 && !valid && 'border-danger',
        )}
        aria-label="Release reason"
      />
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => mutation.mutate()}
          disabled={!valid || mutation.isPending}
          className="inline-flex items-center gap-1 rounded-input bg-danger px-2 py-1 text-[10px] font-medium text-white disabled:opacity-40"
        >
          <Unlock size={10} /> Release
        </button>
        <button
          type="button"
          onClick={onDone}
          className="inline-flex items-center gap-1 rounded-input border border-border px-2 py-1 text-[10px] text-ink-sub hover:bg-divider"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function LegalHoldsTable() {
  const [activeOnly, setActiveOnly] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [releasingId, setReleasingId] = useState<number | null>(null);

  const q = useQuery({
    queryKey: ['legal-holds', { active_only: activeOnly }],
    queryFn: () => fetchLegalHolds({ active_only: activeOnly }),
  });

  if (q.isLoading) return <Skeleton className="h-32 w-full rounded-card" />;

  const holds = q.data ?? [];

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-xs text-ink">
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={(e) => setActiveOnly(e.target.checked)}
            className="h-4 w-4 accent-brand-blue"
          />
          Active holds only
        </label>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => setShowForm((v) => !v)}
        >
          <Plus size={13} />
          {showForm ? 'Hide form' : 'Apply new hold'}
        </Button>
      </div>

      {showForm && <ApplyHoldForm onDone={() => setShowForm(false)} />}

      {holds.length === 0 ? (
        <EmptyState
          title="No legal holds"
          body={activeOnly ? 'No active legal holds for this tenant.' : 'No legal holds recorded.'}
        />
      ) : (
        <div className="overflow-x-auto rounded-card border border-divider bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="table-header">
                <th className="px-3 py-2 text-left text-[11px] font-semibold text-ink-sub">ID</th>
                <th className="px-3 py-2 text-left text-[11px] font-semibold text-ink-sub">Document</th>
                <th className="px-3 py-2 text-left text-[11px] font-semibold text-ink-sub">Applied by</th>
                <th className="px-3 py-2 text-left text-[11px] font-semibold text-ink-sub">Applied at</th>
                <th className="px-3 py-2 text-left text-[11px] font-semibold text-ink-sub">Status</th>
                <th className="px-3 py-2 text-left text-[11px] font-semibold text-ink-sub">Reason</th>
                <th className="px-3 py-2 text-left text-[11px] font-semibold text-ink-sub">Actions</th>
              </tr>
            </thead>
            <tbody>
              {holds.map((hold) => (
                <tr key={hold.id} className="border-t border-divider hover:bg-raised/40">
                  <td className="px-3 py-2 font-mono text-xs text-muted">{hold.id}</td>
                  <td className="px-3 py-2 text-xs text-ink">
                    <span className="font-medium">#{hold.doc_id}</span>
                    {hold.document_name !== undefined && hold.document_name !== null && (
                      <span className="ml-1 text-muted truncate max-w-[120px] inline-block align-bottom">
                        {hold.document_name}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-ink">{hold.applied_by}</td>
                  <td className="px-3 py-2 text-xs text-muted">
                    {new Date(hold.applied_at).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2">
                    {hold.released_at !== null ? (
                      <Badge tone="neutral">Released</Badge>
                    ) : (
                      <Badge tone="blue">Active</Badge>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted max-w-[160px] truncate">
                    {hold.reason}
                  </td>
                  <td className="px-3 py-2">
                    {hold.released_at === null && (
                      releasingId === hold.id ? (
                        <ReleaseHoldInline
                          hold={hold}
                          onDone={() => setReleasingId(null)}
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => setReleasingId(hold.id)}
                          className="inline-flex items-center gap-1 rounded-input border border-border px-2 py-1 text-[10px] text-danger hover:bg-danger-bg focus:outline-none focus:ring-2 focus:ring-danger/40"
                          data-testid={`legal-hold-release-${hold.id}`}
                        >
                          <Unlock size={10} /> Release
                        </button>
                      )
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
