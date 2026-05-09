/**
 * BulkActionBar — sticky bar that appears when ≥1 row is selected.
 *
 * Opens a Modal with the shared reason_code + comment form, then calls
 * POST /spa/api/workflows/bulk.
 */

import { useState } from 'react';
import { Button, Modal } from '@/components/ui';
import { useToast } from '@/components/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTenantConfig } from '@/store/tenant-config';
import { bulkAction, type WorkflowActionKind, type BulkPayload } from '../api';

interface BulkActionBarProps {
  selectedIds: number[];
  onClear: () => void;
  canApprove: boolean;
  canEscalate: boolean;
}

interface BulkFormState {
  action: WorkflowActionKind;
  reasonCode: string;
  comment: string;
  target: string;
}

export function BulkActionBar({ selectedIds, onClear, canApprove, canEscalate }: BulkActionBarProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: cfg } = useTenantConfig('workflows');

  const [modalAction, setModalAction] = useState<WorkflowActionKind | null>(null);
  const [form, setForm] = useState<Omit<BulkFormState, 'action'>>({ reasonCode: '', comment: '', target: '' });

  const minLen = typeof cfg?.['min_comment_length'] === 'number'
    ? (cfg['min_comment_length'] as number)
    : 20;

  function reasonCodes(action: WorkflowActionKind): string[] {
    const key = `reason_codes.${action}` as const;
    return Array.isArray(cfg?.[key]) ? (cfg[key] as string[]) : [];
  }
  const escalationTargets: string[] = Array.isArray(cfg?.['escalation_targets'])
    ? (cfg['escalation_targets'] as string[])
    : [];

  const mutation = useMutation({
    mutationFn: (payload: BulkPayload) => bulkAction(payload),
    onSuccess: (data) => {
      const ok  = data.results.filter((r) => r.ok).length;
      const err = data.results.filter((r) => !r.ok).length;
      void qc.invalidateQueries({ queryKey: ['workflows'] });
      void qc.invalidateQueries({ queryKey: ['stats'] });
      toast({
        variant: err > 0 ? 'warning' : 'success',
        title: `Bulk action complete`,
        message: err > 0
          ? `${ok} succeeded, ${err} failed.`
          : `${ok} workflow${ok === 1 ? '' : 's'} updated.`,
      });
      onClear();
      setModalAction(null);
    },
    onError: () => {
      toast({ variant: 'error', title: 'Bulk action failed', message: 'Please try again.' });
    },
  });

  if (selectedIds.length === 0) return null;

  function openModal(action: WorkflowActionKind) {
    setForm({ reasonCode: '', comment: '', target: '' });
    setModalAction(action);
  }

  function handleSubmit() {
    if (!modalAction) return;
    const commentOk = form.comment.trim().length >= minLen;
    if (!form.reasonCode || !commentOk) return;
    if (modalAction === 'escalate' && !form.target) return;

    const payload: BulkPayload = {
      ids:         selectedIds,
      action:      modalAction,
      reason_code: form.reasonCode,
      comment:     form.comment.trim(),
      ...(modalAction === 'escalate' && form.target ? { target: form.target } : {}),
    };
    mutation.mutate(payload);
  }

  const activeReasonCodes = modalAction ? reasonCodes(modalAction) : [];
  const commentOk = form.comment.trim().length >= minLen;
  const canConfirm =
    !!form.reasonCode &&
    commentOk &&
    (modalAction !== 'escalate' || !!form.target) &&
    !mutation.isPending;

  return (
    <>
      <div
        className="sticky bottom-0 z-20 flex items-center justify-between gap-3 rounded-card border border-brand-blue/20 bg-brand-skyLight px-4 py-2.5 shadow-card"
        data-testid="bulk-action-bar"
      >
        <span className="text-sm font-medium text-brand-blue">
          {selectedIds.length} selected
        </span>
        <div className="flex gap-2">
          {canApprove && (
            <Button size="sm" onClick={() => openModal('approve')} data-testid="bulk-approve-btn">
              Bulk approve ({selectedIds.length})
            </Button>
          )}
          {canApprove && (
            <Button size="sm" variant="danger" onClick={() => openModal('reject')} data-testid="bulk-reject-btn">
              Bulk reject ({selectedIds.length})
            </Button>
          )}
          {canEscalate && (
            <Button size="sm" variant="ghost" onClick={() => openModal('escalate')} data-testid="bulk-escalate-btn">
              Bulk escalate ({selectedIds.length})
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onClear}>
            Clear
          </Button>
        </div>
      </div>

      {modalAction !== null && (
        <Modal
          open={true}
          onClose={() => setModalAction(null)}
          title={`Bulk ${modalAction} — ${selectedIds.length} workflow${selectedIds.length === 1 ? '' : 's'}`}
          size="sm"
        >
          <div className="space-y-4 p-4" data-testid="bulk-modal">
            {modalAction === 'escalate' && (
              <label className="block">
                <span className="label">Escalate to *</span>
                <select
                  className="input mt-1"
                  value={form.target}
                  onChange={(e) => setForm((f) => ({ ...f, target: e.target.value }))}
                >
                  <option value="">Select recipient…</option>
                  {escalationTargets.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </label>
            )}

            <label className="block">
              <span className="label">Reason code *</span>
              <select
                className="input mt-1"
                value={form.reasonCode}
                onChange={(e) => setForm((f) => ({ ...f, reasonCode: e.target.value }))}
              >
                <option value="">Select a reason…</option>
                {activeReasonCodes.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="label">
                Comment *
                <span className="ml-1 font-normal text-muted">
                  ({form.comment.trim().length}/{minLen} min)
                </span>
              </span>
              <textarea
                className="input mt-1 resize-none"
                rows={3}
                value={form.comment}
                onChange={(e) => setForm((f) => ({ ...f, comment: e.target.value }))}
                placeholder={`At least ${minLen} characters required…`}
                data-testid="bulk-comment"
              />
            </label>

            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={() => setModalAction(null)} disabled={mutation.isPending}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant={modalAction === 'reject' ? 'danger' : 'primary'}
                disabled={!canConfirm}
                onClick={handleSubmit}
                data-testid="bulk-confirm-btn"
              >
                {mutation.isPending ? 'Processing…' : `Confirm ${modalAction}`}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
