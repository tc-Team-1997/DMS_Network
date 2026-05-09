import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ShieldX, Lock, FileText } from 'lucide-react';
import { Modal, useToast } from '@/components/ui';
import { cn } from '@/lib/cn';
import { createRequest, fulfillRequest } from '../api';
import type { DsarAction, SubjectMatch } from '../schemas';
import { HttpError } from '@/lib/http';

// ---------------------------------------------------------------------------
// Action metadata
// ---------------------------------------------------------------------------

interface ActionDef {
  action: DsarAction;
  label: string;
  description: string;
  confirmText: string;
  icon: React.ReactNode;
  danger: boolean;
}

const ACTION_DEFS: ActionDef[] = [
  {
    action: 'article15_export',
    label: 'Article 15 — Data Export',
    description:
      'Generate an encrypted ZIP containing all personal data held for this subject in machine-readable format. A signed receipt is issued.',
    confirmText: 'Generate Export',
    icon: <FileText size={16} />,
    danger: false,
  },
  {
    action: 'article17_cryptoshred',
    label: 'Article 17 — Cryptoshred',
    description:
      'Permanently destroy the customer encryption key. All encrypted documents become unreadable ciphertext. THIS IS IRREVERSIBLE. The audit trail confirming this action is preserved.',
    confirmText: 'Confirm Cryptoshred',
    icon: <ShieldX size={16} />,
    danger: true,
  },
  {
    action: 'litigation_hold',
    label: 'Litigation Hold',
    description:
      'Place a hold on all documents belonging to this subject. The retention sweep and cryptoshred are blocked until the hold is released.',
    confirmText: 'Place Hold',
    icon: <Lock size={16} />,
    danger: false,
  },
  {
    action: 'fulfillment_letter',
    label: 'Fulfillment Letter',
    description:
      'Generate a plain-language letter for the data subject summarising what data was found and what action was taken.',
    confirmText: 'Generate Letter',
    icon: <AlertTriangle size={16} />,
    danger: false,
  },
];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  open: boolean;
  onClose: () => void;
  subject: SubjectMatch;
  regulator?: string;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FulfillModal({ open, onClose, subject, regulator }: Props) {
  const [selectedAction, setSelectedAction] = useState<DsarAction | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const actionDef = ACTION_DEFS.find((a) => a.action === selectedAction);
  const dangerConfirmRequired = actionDef?.danger === true;
  const confirmReady = !dangerConfirmRequired || confirmText.trim().toLowerCase() === 'cryptoshred';

  const mutation = useMutation({
    mutationFn: async () => {
      if (!selectedAction) throw new Error('No action selected');
      // Step 1: create the request.
      const req = await createRequest({
        customer_cid: subject.cid,
        action: selectedAction,
        regulator: regulator ?? 'GDPR',
      });
      // Step 2: immediately fulfill it.
      return fulfillRequest(req.id);
    },
    onSuccess: (receipt) => {
      toast({
        variant: 'success',
        title: 'Action completed',
        message: `Request ${receipt.request_id} fulfilled. Receipt signed at ${receipt.completed_at}.`,
      });
      void queryClient.invalidateQueries({ queryKey: ['dsar', 'requests'] });
      onClose();
    },
    onError: (err) => {
      const msg = err instanceof HttpError ? err.message : String(err);
      toast({ variant: 'error', title: 'Action failed', message: msg });
    },
  });

  function handleClose() {
    if (!mutation.isPending) {
      setSelectedAction(null);
      setConfirmText('');
      onClose();
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title="Fulfillment Action" size="lg">
      <div className="space-y-4">
        {/* Subject info */}
        <div className="rounded-input border border-divider bg-raised px-4 py-3 text-sm">
          <span className="text-muted">Subject:</span>{' '}
          <span className="font-medium text-ink">{subject.cid}</span>
          {subject.name !== null && (
            <span className="ml-2 text-ink-sub">— {subject.name}</span>
          )}
        </div>

        {/* Action selector */}
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted">
            Select action
          </p>
          {ACTION_DEFS.map((def) => (
            <button
              key={def.action}
              type="button"
              onClick={() => {
                setSelectedAction(def.action);
                setConfirmText('');
              }}
              className={cn(
                'w-full rounded-input border p-3 text-left transition-colors',
                selectedAction === def.action
                  ? def.danger
                    ? 'border-danger bg-danger-bg'
                    : 'border-action bg-action-subtle'
                  : 'border-divider bg-surface hover:border-borderMed hover:bg-raised',
              )}
            >
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    selectedAction === def.action && def.danger
                      ? 'text-danger'
                      : selectedAction === def.action
                        ? 'text-action'
                        : 'text-muted',
                  )}
                >
                  {def.icon}
                </span>
                <span className="text-sm font-medium text-ink">{def.label}</span>
              </div>
              {selectedAction === def.action && (
                <p className="mt-1.5 text-xs text-ink-sub leading-relaxed">
                  {def.description}
                </p>
              )}
            </button>
          ))}
        </div>

        {/* Danger confirm */}
        {dangerConfirmRequired && (
          <div className="rounded-input border border-danger bg-danger-bg p-3">
            <p className="mb-2 text-xs font-semibold text-danger">
              This action is irreversible. Type{' '}
              <span className="font-mono">cryptoshred</span> to confirm.
            </p>
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="cryptoshred"
              className="input w-full border-danger focus:ring-danger/20"
              autoComplete="off"
            />
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={handleClose}
            disabled={mutation.isPending}
            className="rounded-input border border-divider bg-surface px-4 py-2 text-sm text-ink-sub hover:bg-raised disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => mutation.mutate()}
            disabled={
              !selectedAction || !confirmReady || mutation.isPending
            }
            className={cn(
              'rounded-input px-4 py-2 text-sm font-medium text-white transition-colors',
              'focus:outline-none focus:ring-2 focus:ring-offset-1',
              'disabled:opacity-40 disabled:cursor-not-allowed',
              actionDef?.danger
                ? 'bg-danger hover:bg-danger/90 focus:ring-danger'
                : 'bg-brand-blue hover:bg-brand-blueHover focus:ring-brand-blue',
            )}
          >
            {mutation.isPending
              ? 'Processing…'
              : (actionDef?.confirmText ?? 'Proceed')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
