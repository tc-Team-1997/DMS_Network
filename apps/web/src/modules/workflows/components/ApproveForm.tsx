/**
 * ApproveForm — inline form inside the ActionDrawer.
 *
 * When the server returns 403 step_up_required, this component runs the
 * Python step-up dance via the /py proxy, then retries the approve call
 * with the returned assertion_id.
 */

import { useState } from 'react';
import { Button } from '@/components/ui';
import { HttpError } from '@/lib/http';
import { useTenantConfig } from '@/store/tenant-config';
import { stepUpStart, stepUpFinish } from '@/lib/step-up';
import { approveWorkflow, type ApprovePayload } from '../api';
import type { WorkflowRow } from '../api';

interface ApproveFormProps {
  workflow: WorkflowRow;
  onSuccess: (stage: string) => void;
  onCancel: () => void;
}

interface StepUpRequiredError {
  error: 'step_up_required';
  risk_band: string | null;
  amount:    number | null;
}

function isStepUpError(data: unknown): data is StepUpRequiredError {
  return (
    data !== null &&
    typeof data === 'object' &&
    'error' in data &&
    (data as Record<string, unknown>).error === 'step_up_required'
  );
}

export function ApproveForm({ workflow, onSuccess, onCancel }: ApproveFormProps) {
  const { data: cfg } = useTenantConfig('workflows');

  const reasonCodes: string[] = Array.isArray(cfg?.['reason_codes.approve'])
    ? (cfg['reason_codes.approve'] as string[])
    : ['Compliant', 'Verified', 'Meets policy'];

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
      // opts is a PublicKeyCredentialRequestOptions-shaped object.
      const credential = await navigator.credentials.get({
        publicKey: opts as unknown as PublicKeyCredentialRequestOptions,
      });
      if (!credential) {
        setStepUpMsg(null);
        setError('WebAuthn step-up cancelled. Please try again.');
        return null;
      }
      setStepUpMsg('Completing step-up…');
      const assertionId = await stepUpFinish('approve_document', credential, workflow.id);
      setStepUpMsg(null);
      return assertionId;
    } catch (e) {
      setStepUpMsg(null);
      setError('WebAuthn step-up failed. Please try again or contact your administrator.');
      console.error('[workflows-v2] step-up error:', e);
      return null;
    }
  }

  async function submit(assertionId?: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const payload: ApprovePayload = {
        reason_code: reasonCode,
        comment:     comment.trim(),
        ...(assertionId != null ? { webauthn_assertion_id: assertionId } : {}),
      };
      const result = await approveWorkflow(workflow.id, payload);
      onSuccess(result.stage);
    } catch (e) {
      if (e instanceof HttpError && e.status === 403 && isStepUpError(e.data)) {
        setBusy(false);
        // Run the step-up dance, then retry.
        const aid = await runStepUp();
        if (aid) {
          await submit(aid);
        }
        return;
      }
      const msg =
        e instanceof HttpError
          ? (typeof e.data === 'object' && e.data !== null && 'error' in e.data
              ? String((e.data as Record<string, unknown>).error)
              : e.message)
          : 'Unexpected error. Please try again.';
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 pt-2" data-testid="approve-form">
      {/* Reason code */}
      <label className="block">
        <span className="label">Reason code *</span>
        <select
          className="input mt-1"
          value={reasonCode}
          onChange={(e) => setReasonCode(e.target.value)}
          disabled={busy}
          aria-label="Reason code"
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
          aria-label="Approval comment"
          data-testid="approve-comment"
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
          disabled={!canSubmit}
          onClick={() => void submit()}
          data-testid="approve-submit"
        >
          {busy ? 'Approving…' : 'Approve'}
        </Button>
      </div>
    </div>
  );
}
