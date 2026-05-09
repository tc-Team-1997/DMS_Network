/**
 * ExtendLockDialog — modal to extend a WORM lock period.
 * Admin can only EXTEND (add days), never shorten.
 */
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';
import { HttpError } from '@/lib/http';
import { extendWormLock } from '../api';
import type { LockedDocument } from '../schemas';

interface Props {
  doc: LockedDocument;
  onClose: () => void;
}

export function ExtendLockDialog({ doc, onClose }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [days, setDays] = useState('365');
  const [reason, setReason] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      extendWormLock({
        document_id: doc.id,
        extend_by_days: parseInt(days, 10),
        reason,
      }),
    onSuccess: (result) => {
      void qc.invalidateQueries({ queryKey: ['retention', 'worm-locked'] });
      toast({
        variant: 'success',
        title: 'Lock extended',
        message: `New unlock date: ${new Date(result.new_unlock_after).toLocaleDateString()}`,
      });
      onClose();
    },
    onError: (err: unknown) => {
      const msg = err instanceof HttpError ? err.message : (err as Error).message;
      toast({ variant: 'error', title: 'Extension failed', message: msg });
    },
  });

  const daysNum = parseInt(days, 10);
  const daysOk = !isNaN(daysNum) && daysNum >= 1;
  const reasonOk = reason.length >= 20;
  const canSubmit = daysOk && reasonOk && !mutation.isPending;

  return (
    <Modal
      open
      onClose={onClose}
      title="Extend WORM lock"
      data-testid="worm-extend-dialog"
    >
      <div className="space-y-4">
        {/* Document info */}
        <div className="rounded-input bg-page px-3 py-2 text-xs text-ink-sub space-y-0.5">
          <p>
            <span className="font-medium text-ink">Document:</span>{' '}
            {doc.original_name ?? `#${doc.id}`}
          </p>
          {doc.worm_unlock_after !== null && (
            <p>
              <span className="font-medium text-ink">Current unlock date:</span>{' '}
              {new Date(doc.worm_unlock_after).toLocaleDateString()}
              {doc.days_remaining !== null && (
                <span className="ml-1 text-muted">({doc.days_remaining} days remaining)</span>
              )}
            </p>
          )}
        </div>

        {/* Extend by days */}
        <div>
          <label htmlFor="extend-days" className="label text-xs font-medium text-ink">
            Extend by (days) <span className="text-danger">*</span>
          </label>
          <input
            id="extend-days"
            type="number"
            min={1}
            value={days}
            onChange={(e) => setDays(e.target.value)}
            className={cn(
              'input mt-1 w-full text-sm',
              !daysOk && days.length > 0 && 'border-danger',
            )}
            aria-label="Days to extend lock"
            data-testid="worm-extend-days"
          />
          <p className="mt-0.5 text-xs text-muted">
            Locks can only be extended forward — the new unlock date will always be
            later than the current one.
          </p>
        </div>

        {/* Reason */}
        <div>
          <label htmlFor="extend-reason" className="label text-xs font-medium text-ink">
            Reason for extension <span className="text-danger">*</span>
          </label>
          <textarea
            id="extend-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Describe why you are extending this lock (minimum 20 characters)…"
            className={cn(
              'input mt-1 w-full resize-none text-sm',
              reason.length > 0 && !reasonOk && 'border-danger',
            )}
            aria-label="Reason for extension"
            data-testid="worm-extend-reason"
          />
          <p className={cn('mt-0.5 text-xs', reasonOk ? 'text-success' : reason.length > 0 ? 'text-danger' : 'text-muted')}>
            {reason.length}/20 characters minimum
          </p>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2 border-t border-divider">
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => mutation.mutate()}
            disabled={!canSubmit}
            loading={mutation.isPending}
            data-testid="worm-extend-submit"
          >
            Extend lock
          </Button>
        </div>
      </div>
    </Modal>
  );
}
