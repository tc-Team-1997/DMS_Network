import { useState } from 'react';
import { Button } from '@/components/ui';
import { HttpError } from '@/lib/http';
import { useTenantConfig } from '@/store/tenant-config';
import { stepUpStart, stepUpFinish } from '@/lib/step-up';
import { escalateWorkflow, type EscalatePayload } from '../api';
import type { WorkflowRow } from '../api';

interface EscalateFormProps {
  workflow: WorkflowRow;
  onSuccess: (stage: string) => void;
  onCancel: () => void;
}

interface StepUpRequiredError {
  error: 'step_up_required';
}

function isStepUpError(data: unknown): data is StepUpRequiredError {
  return (
    data !== null &&
    typeof data === 'object' &&
    'error' in data &&
    (data as Record<string, unknown>).error === 'step_up_required'
  );
}

export function EscalateForm({ workflow, onSuccess, onCancel }: EscalateFormProps) {
  const { data: cfg } = useTenantConfig('workflows');

  const reasonCodes: string[] = Array.isArray(cfg?.['reason_codes.escalate'])
    ? (cfg['reason_codes.escalate'] as string[])
    : ['Requires branch manager review', 'Compliance escalation', 'AML flag'];

  const targets: string[] = Array.isArray(cfg?.['escalation_targets'])
    ? (cfg['escalation_targets'] as string[])
    : ['Branch Manager', 'Compliance Officer', 'Head of KYC'];

  const minLen = typeof cfg?.['min_comment_length'] === 'number'
    ? (cfg['min_comment_length'] as number)
    : 20;

  const [reasonCode, setReasonCode] = useState('');
  const [comment,    setComment]    = useState('');
  const [target,     setTarget]     = useState('');
  const [busy,       setBusy]       = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [stepUpMsg,  setStepUpMsg]  = useState<string | null>(null);

  const commentOk = comment.trim().length >= minLen;
  const canSubmit = reasonCode !== '' && commentOk && target !== '' && !busy;

  async function runStepUp(): Promise<string | null> {
    try {
      setStepUpMsg('Starting WebAuthn step-up…');
      const opts = await stepUpStart('approve_document', workflow.id);
      const credential = await navigator.credentials.get({
        publicKey: opts as unknown as PublicKeyCredentialRequestOptions,
      });
      if (!credential) {
        setStepUpMsg(null);
        setError('WebAuthn step-up cancelled.');
        return null;
      }
      setStepUpMsg('Completing step-up…');
      const assertionId = await stepUpFinish('approve_document', credential, workflow.id);
      setStepUpMsg(null);
      return assertionId;
    } catch (e) {
      setStepUpMsg(null);
      setError('WebAuthn step-up failed. Please try again.');
      console.error('[workflows-v2] step-up error:', e);
      return null;
    }
  }

  async function submit(assertionId?: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const payload: EscalatePayload = {
        reason_code: reasonCode,
        comment:     comment.trim(),
        target,
        ...(assertionId != null ? { webauthn_assertion_id: assertionId } : {}),
      };
      const result = await escalateWorkflow(workflow.id, payload);
      onSuccess(result.stage);
    } catch (e) {
      if (e instanceof HttpError && e.status === 403 && isStepUpError(e.data)) {
        setBusy(false);
        const aid = await runStepUp();
        if (aid) { await submit(aid); }
        return;
      }
      const msg =
        e instanceof HttpError
          ? (typeof e.data === 'object' && e.data !== null && 'error' in e.data
              ? String((e.data as Record<string, unknown>).error)
              : e.message)
          : 'Unexpected error.';
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 pt-2" data-testid="escalate-form">
      {/* Escalation target */}
      <label className="block">
        <span className="label">Escalate to *</span>
        <select
          className="input mt-1"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          disabled={busy}
          aria-label="Escalation target"
        >
          <option value="">Select recipient…</option>
          {targets.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </label>

      {/* Reason code */}
      <label className="block">
        <span className="label">Reason code *</span>
        <select
          className="input mt-1"
          value={reasonCode}
          onChange={(e) => setReasonCode(e.target.value)}
          disabled={busy}
          aria-label="Escalation reason code"
        >
          <option value="">Select a reason…</option>
          {reasonCodes.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </label>

      {/* Comment */}
      <label className="block">
        <span className="label">
          Comment *
          <span className="ml-1 font-normal text-muted">
            ({comment.trim().length}/{minLen} min)
          </span>
        </span>
        <textarea
          className="input mt-1 resize-none"
          rows={3}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          disabled={busy}
          placeholder={`At least ${minLen} characters required…`}
          aria-label="Escalation comment"
          data-testid="escalate-comment"
        />
      </label>

      {stepUpMsg && (
        <p className="text-xs text-brand-blue">{stepUpMsg}</p>
      )}

      {error && (
        <p className="rounded-input bg-danger-bg border border-danger/30 px-3 py-2 text-xs text-danger" role="alert">
          {error}
        </p>
      )}

      <div className="flex gap-2 justify-end">
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={!canSubmit}
          onClick={() => void submit()}
          data-testid="escalate-submit"
        >
          {busy ? 'Escalating…' : 'Escalate'}
        </Button>
      </div>
    </div>
  );
}
