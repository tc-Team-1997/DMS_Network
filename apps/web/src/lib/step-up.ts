/**
 * WebAuthn step-up helpers — shared across any module that needs high-risk
 * action gating (workflows, AML hit-decide, future).
 *
 * Extracted from apps/web/src/modules/workflows/api.ts so neither
 * `workflows` nor `aml-screening` imports from each other (no-cross-module rule).
 *
 * Usage:
 *   const opts = await stepUpStart('aml_decide', hitId);
 *   const credential = await navigator.credentials.get({ publicKey: opts as ... });
 *   const assertionId = await stepUpFinish('aml_decide', credential, hitId);
 */

import { post } from '@/lib/http';
import { z } from 'zod';

// ── Schemas ───────────────────────────────────────────────────────────────────

const StepUpStartSchema = z
  .object({
    challenge:        z.string(),
    rpId:             z.string().optional(),
    timeout:          z.number().optional(),
    userVerification: z.string().optional(),
    allowCredentials: z.array(z.unknown()).optional(),
  })
  .passthrough();

const StepUpFinishSchema = z
  .object({ assertion_id: z.string() })
  .passthrough();

// ── Exported helpers ──────────────────────────────────────────────────────────

export type StepUpStartResult = z.infer<typeof StepUpStartSchema>;

/**
 * Begin a WebAuthn step-up challenge for the given action + optional resource.
 * Returns the PublicKeyCredentialRequestOptions-shaped object from the server.
 */
export async function stepUpStart(
  action: string,
  resourceId?: number,
): Promise<StepUpStartResult> {
  return post(
    '/py/api/v1/stepup/authenticate/start',
    { action, resource_id: resourceId ?? null },
    StepUpStartSchema,
  );
}

/**
 * Finish the step-up dance by submitting the WebAuthn assertion.
 * Returns the assertion_id string to be included in the guarded action call.
 */
export async function stepUpFinish(
  action: string,
  credential: unknown,
  resourceId?: number,
): Promise<string> {
  const result = await post(
    '/py/api/v1/stepup/authenticate/finish',
    { action, resource_id: resourceId ?? null, credential },
    StepUpFinishSchema,
  );
  return result.assertion_id;
}
