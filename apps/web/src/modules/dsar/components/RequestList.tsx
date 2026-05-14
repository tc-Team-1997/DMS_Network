import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Unlock } from 'lucide-react';
import { useToast } from '@/components/ui';
import { cn } from '@/lib/cn';
import { releaseHold } from '../api';
import { SlaCountdown } from './SlaCountdown';
import type { DsarRequest, DsarAction, DsarStatus } from '../schemas';
import { HttpError } from '@/lib/http';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ACTION_LABELS: Record<DsarAction, string> = {
  article15_export: 'Art-15 Export',
  article17_cryptoshred: 'Art-17 Cryptoshred',
  litigation_hold: 'Litigation Hold',
  fulfillment_letter: 'Fulfillment Letter',
};

const STATUS_BADGE: Record<DsarStatus, string> = {
  NEW: 'bg-action-subtle text-action',
  IN_PROGRESS: 'bg-warning-bg text-warning',
  COMPLETED: 'bg-success-bg text-success',
  OVERDUE: 'bg-danger-bg text-danger',
};

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  items: DsarRequest[];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RequestList({ items }: Props) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const releaseMutation = useMutation({
    mutationFn: (requestId: string) => releaseHold(requestId),
    onSuccess: (res) => {
      toast({
        variant: 'success',
        title: 'Hold released',
        message: `${res.documents_released} document(s) released for ${res.customer_cid}.`,
      });
      void queryClient.invalidateQueries({ queryKey: ['dsar', 'requests'] });
    },
    onError: (err) => {
      const msg = err instanceof HttpError ? err.message : String(err);
      toast({ variant: 'error', title: 'Release failed', message: msg });
    },
  });

  if (items.length === 0) {
    return (
      <div className="rounded-card border border-divider bg-surface px-6 py-10 text-center text-sm text-muted">
        No DSAR requests yet for this tenant.
      </div>
    );
  }

  return (
    <div className="rounded-card border border-divider bg-surface overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-divider bg-raised text-xs text-muted">
            <th className="px-4 py-2 text-left font-medium">Subject CID</th>
            <th className="px-4 py-2 text-left font-medium">Action</th>
            <th className="px-4 py-2 text-left font-medium">Regulator</th>
            <th className="px-4 py-2 text-left font-medium">Status</th>
            <th className="px-4 py-2 text-left font-medium">SLA</th>
            <th className="px-4 py-2 text-left font-medium">Requested by</th>
            <th className="px-4 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-divider">
          {items.map((req) => (
            <tr key={req.id} className="hover:bg-raised transition-colors">
              <td className="px-4 py-2.5 font-mono text-xs text-ink">
                {req.customer_cid}
              </td>
              <td className="px-4 py-2.5 text-ink-sub">
                {ACTION_LABELS[req.action]}
              </td>
              <td className="px-4 py-2.5 text-ink-sub">
                {req.regulator ?? '—'}
              </td>
              <td className="px-4 py-2.5">
                <span
                  className={cn(
                    'inline-flex items-center rounded-badge px-2 py-0.5 text-xs font-medium',
                    STATUS_BADGE[req.status],
                  )}
                >
                  {req.status}
                </span>
              </td>
              <td className="px-4 py-2.5">
                <span data-testid="dsar-sla-countdown" aria-live="polite">
                  <SlaCountdown
                    daysRemaining={req.days_remaining}
                    status={req.status}
                  />
                </span>
              </td>
              <td className="px-4 py-2.5 text-ink-sub text-xs">
                {req.requested_by}
              </td>
              <td className="px-4 py-2.5">
                {req.action === 'litigation_hold' && req.status !== 'COMPLETED' && (
                  <button
                    type="button"
                    onClick={() => releaseMutation.mutate(req.id)}
                    disabled={releaseMutation.isPending}
                    className="inline-flex items-center gap-1 rounded-input border border-divider px-2 py-1 text-xs text-ink-sub hover:bg-raised disabled:opacity-40"
                  >
                    <Unlock size={11} />
                    Release
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
