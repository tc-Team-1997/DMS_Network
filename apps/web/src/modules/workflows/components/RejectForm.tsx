import { useState } from 'react';
import { Button } from '@/components/ui';
import { HttpError } from '@/lib/http';
import { useTenantConfig } from '@/store/tenant-config';
import { stepUpStart, stepUpFinish } from '@/lib/step-up';
import { rejectWorkflow, type RejectPayload } from '../api';
import type { WorkflowRow } from '../api';

interface RejectFormProps {
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

export function RejectForm({ workflow, onSuccess, onCancel }: RejectFormProps) {
  const { data: cfg } = useTenantConfig('workflows');

  const reasonCodes: string[] = Array.isArray(cfg?.['reason_codes.reject'])
    ? (cfg['reason_codes.reject'] as string[])
    : ['Incomplete documentation', 'Data mismatch', 'Expired document'];

  const minLen = typeof cfg?.['min_comment_length'] === 'number'
    ? (cfg['min_comment_length'] as number)
    : 20;

  const [reasonCode, setReasonCode] = useState('');
  const [comment,    setComment]    = useState('');
  const [busy,       setBusy]       = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [stepUpMsg,  setStepUpMsg]  = useState<string | null>(null);

  const commentOk = comment.trim().length >= minLen;
  const canSubmit = reasonCode !== '' && commentOk && !busy;

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
      const payload: RejectPayload = {
        reason_code: reasonCode,
        comment:     comment.trim(),
        ...(assertionId != null ? { webauthn_assertion_id: assertionId } : {}),
      };
      const result = await rejectWorkflow(workflow.id, payload);
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
    <div className="space-y-4 pt-2" data-testid="reject-form">
      <label className="block">
        <span className="label">Reason code *</span>
        <select
          className="input mt-1"
          value={reasonCode}
          onChange={(e) => setReasonCode(e.target.value)}
          disabled={busy}
          aria-label="Rejection reason code"
        >
          <option value="">Select a reason…</option>
          {reasonCodes.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </label>

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
          aria-label="Rejection comment"
          data-testid="reject-comment"
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
          variant="danger"
          disabled={!canSubmit}
          onClick={() => void submit()}
          data-testid="reject-submit"
        >
          {busy ? 'Rejecting…' : 'Reject'}
        </Button>
      </div>
    </div>
  );
}
