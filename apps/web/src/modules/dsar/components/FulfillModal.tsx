import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ShieldX, Lock, FileText } from 'lucide-react';
import { useToast } from '@/components/ui';
import { cn } from '@/lib/cn';
import { createRequest, fulfillRequest } from '../api';
import type { DsarAction, SubjectMatch } from '../schemas';
import { HttpError } from '@/lib/http';

// ---------------------------------------------------------------------------
// Action metadata
// ---------------------------------------------------------------------------

interface ActionDef {
  action: DsarAction;
  testIdSuffix: string;
  label: string;
  description: string;
  confirmText: string;
  icon: React.ReactNode;
  danger: boolean;
}

const ACTION_DEFS: ActionDef[] = [
  {
    action: 'article15_export',
    testIdSuffix: 'article15',
    label: 'Article 15 — Data Export',
    description:
      'Generate an encrypted ZIP containing all personal data held for this subject in machine-readable format. A signed receipt is issued.',
    confirmText: 'Generate Export',
    icon: <FileText size={16} />,
    danger: false,
  },
  {
    action: 'article17_cryptoshred',
    testIdSuffix: 'article17',
    label: 'Article 17 — Cryptoshred',
    description:
      'Permanently destroy the customer encryption key. All encrypted documents become unreadable ciphertext. THIS IS IRREVERSIBLE. The audit trail confirming this action is preserved.',
    confirmText: 'Confirm Cryptoshred',
    icon: <ShieldX size={16} />,
    danger: true,
  },
  {
    action: 'litigation_hold',
    testIdSuffix: 'litigation-hold',
    label: 'Litigation Hold',
    description:
      'Place a hold on all documents belonging to this subject. The retention sweep and cryptoshred are blocked until the hold is released.',
    confirmText: 'Place Hold',
    icon: <Lock size={16} />,
    danger: false,
  },
  {
    action: 'fulfillment_letter',
    testIdSuffix: 'fulfillment-letter',
    label: 'Fulfillment Letter',
    description:
      'Generate a plain-language letter for the data subject summarising what data was found and what action was taken.',
    confirmText: 'Generate Letter',
    icon: <AlertTriangle size={16} />,
    danger: false,
  },
];

const DEFAULT_REASON =
  'Plan 3 — fulfillment requested via DSAR Console (operator selected action from UI).';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  subject: SubjectMatch;
  regulator?: string;
  onFulfilled?: () => void;
}

// ---------------------------------------------------------------------------
// FulfillModal — inline fulfillment panel (Plan 3 — Wave-E1 refactor).
//
// Renders the 4 fulfillment action cards inline after subject selection.
// Article 17 routes through a two-step cryptoshred confirmation that requires
// the operator to type the literal string "DESTROY" before the mutation fires.
// All other actions show a single confirm button (`dsar-fulfill-confirm`).
// ---------------------------------------------------------------------------

type CryptoshredStep = 'select' | 'confirm-1' | 'confirm-2';

export function FulfillModal({ subject, regulator, onFulfilled }: Props) {
  const [selectedAction, setSelectedAction] = useState<DsarAction | null>(null);
  const [cryptoshredStep, setCryptoshredStep] = useState<CryptoshredStep>('select');
  const [destroyToken, setDestroyToken] = useState('');
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const actionDef = ACTION_DEFS.find((a) => a.action === selectedAction) ?? null;
  const isArticle17 = selectedAction === 'article17_cryptoshred';

  const mutation = useMutation({
    mutationFn: async () => {
      if (!selectedAction) throw new Error('No action selected');
      const req = await createRequest({
        customer_cid: subject.cid,
        action: selectedAction,
        regulator: regulator ?? 'GDPR',
        reason: DEFAULT_REASON,
      });
      return fulfillRequest(req.id, {
        kind: selectedAction,
        reason: DEFAULT_REASON,
        destroy_token: isArticle17 ? destroyToken.trim() : undefined,
      });
    },
    onSuccess: (receipt) => {
      toast({
        variant: 'success',
        title: isArticle17 ? 'Cryptoshred completed' : 'Action completed',
        message: isArticle17
          ? `Customer encryption key destroyed. Request ${receipt.request_id} fulfilled at ${receipt.completed_at}.`
          : `Request ${receipt.request_id} fulfilled — bundle exported. Receipt signed at ${receipt.completed_at}.`,
      });
      void queryClient.invalidateQueries({ queryKey: ['dsar', 'requests'] });
      setSelectedAction(null);
      setCryptoshredStep('select');
      setDestroyToken('');
      onFulfilled?.();
    },
    onError: (err) => {
      const msg = err instanceof HttpError ? err.message : String(err);
      toast({ variant: 'error', title: 'Action failed', message: msg });
    },
  });

  function handleSelect(action: DsarAction) {
    setSelectedAction(action);
    setDestroyToken('');
    if (action === 'article17_cryptoshred') {
      setCryptoshredStep('confirm-1');
    } else {
      setCryptoshredStep('select');
    }
  }

  return (
    <section
      data-testid="dsar-fulfill-section"
      aria-labelledby="dsar-fulfill-title"
      className="rounded-card border border-divider bg-surface p-4 shadow-card"
    >
      <h2
        id="dsar-fulfill-title"
        className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted"
      >
        Fulfillment action
      </h2>

      {/* 4 action cards — each carries its testid contract. */}
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
        {ACTION_DEFS.map((def) => (
          <button
            key={def.action}
            type="button"
            data-testid={`dsar-fulfill-${def.testIdSuffix}`}
            onClick={() => handleSelect(def.action)}
            aria-pressed={selectedAction === def.action}
            className={cn(
              'min-h-[44px] w-full rounded-input border p-3 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-brand-blue focus:ring-offset-1',
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
            <p className="mt-1.5 text-xs text-ink-sub leading-relaxed">
              {def.description}
            </p>
          </button>
        ))}
      </div>

      {/* Non-Article-17 actions: single confirm button. */}
      {actionDef && !isArticle17 && (
        <div className="mt-4 flex items-center justify-end gap-2 border-t border-divider pt-3">
          <button
            type="button"
            data-testid="dsar-fulfill-confirm"
            onClick={() => mutation.mutate()}
            disabled={mutation.isPending}
            className="min-h-[44px] rounded-input bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-blueHover focus:outline-none focus:ring-2 focus:ring-brand-blue focus:ring-offset-1 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {mutation.isPending ? 'Processing…' : actionDef.confirmText}
          </button>
        </div>
      )}

      {/* Article 17 step 1: irreversibility warning + proceed. */}
      {isArticle17 && cryptoshredStep === 'confirm-1' && (
        <div
          data-testid="dsar-cryptoshred-confirm-1"
          role="alertdialog"
          aria-modal="false"
          aria-labelledby="dsar-cryptoshred-warn-title"
          className="mt-4 rounded-input border border-danger bg-danger-bg p-4"
        >
          <p
            id="dsar-cryptoshred-warn-title"
            className="mb-2 text-sm font-semibold text-danger"
          >
            Article 17 — Irreversible cryptoshred
          </p>
          <p className="mb-3 text-xs text-ink-sub leading-relaxed">
            This destroys the customer&apos;s encryption key permanently. All
            encrypted documents become unreadable ciphertext. There is no undo.
            The audit trail is preserved.
          </p>
          <div className="flex justify-end">
            <button
              type="button"
              data-testid="dsar-cryptoshred-confirm-1-button"
              onClick={() => setCryptoshredStep('confirm-2')}
              className="min-h-[44px] rounded-input bg-danger px-4 py-2 text-sm font-medium text-white hover:bg-danger/90 focus:outline-none focus:ring-2 focus:ring-danger focus:ring-offset-1"
            >
              I understand — proceed
            </button>
          </div>
        </div>
      )}

      {/* Article 17 step 2: DESTROY token input. */}
      {isArticle17 && cryptoshredStep === 'confirm-2' && (
        <div
          data-testid="dsar-cryptoshred-confirm-2"
          role="alertdialog"
          aria-modal="false"
          aria-labelledby="dsar-cryptoshred-destroy-title"
          className="mt-4 rounded-input border border-danger bg-danger-bg p-4"
        >
          <p
            id="dsar-cryptoshred-destroy-title"
            className="mb-2 text-sm font-semibold text-danger"
          >
            Type DESTROY to confirm cryptoshred
          </p>
          <label className="block">
            <span className="sr-only">type &quot;DESTROY&quot; to confirm</span>
            <input
              type="text"
              value={destroyToken}
              onChange={(e) => setDestroyToken(e.target.value)}
              placeholder="DESTROY"
              autoComplete="off"
              aria-label="type &quot;DESTROY&quot; to confirm"
              aria-required="true"
              aria-invalid={destroyToken.length > 0 && destroyToken !== 'DESTROY'}
              className="input mb-3 w-full border-danger font-mono focus:ring-danger/20"
            />
          </label>
          <div className="flex justify-end">
            <button
              type="button"
              data-testid="dsar-cryptoshred-confirm-2-button"
              onClick={() => mutation.mutate()}
              disabled={destroyToken !== 'DESTROY' || mutation.isPending}
              className="min-h-[44px] rounded-input bg-danger px-4 py-2 text-sm font-medium text-white hover:bg-danger/90 focus:outline-none focus:ring-2 focus:ring-danger focus:ring-offset-1 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {mutation.isPending ? 'Processing…' : 'Cryptoshred now'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
