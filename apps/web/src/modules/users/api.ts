/**
 * Users v2 API — all calls through src/lib/http.ts with zod schemas.
 * Replaces the old plaintext-password createUser with the invite flow.
 */

import { z } from 'zod';
import { get, post, patch, put, del } from '@/lib/http';

// Raw wire shape from the server before the synthetic `id` is added.
const RawSessionRowSchema = z.object({
  user_id:    z.number().int(),
  username:   z.string(),
  sid_last8:  z.string(),
  created_at: z.string().nullable(),
  expires_at: z.string().nullable(),
  ip:         z.string().nullable(),
  user_agent: z.string().nullable(),
});
import {
  UserRowSchema,
  PatchUserInputSchema,
  InviteUserInputSchema,
  InviteUserResponseSchema,
  FactorsResponseSchema,
  DisableFactorResponseSchema,
  SamlIdpRowSchema,
  CreateSamlIdpInputSchema,
  UpdateSamlIdpInputSchema,
  SamlTestResponseSchema,
  OkResponseSchema,
  SetPasswordInputSchema,
  type UserRow,
  type PatchUserInput,
  type InviteUserInput,
  type InviteUserResponse,
  type FactorsResponse,
  type MfaFactor,
  type SamlIdpRow,
  type CreateSamlIdpInput,
  type UpdateSamlIdpInput,
  type SamlTestResponse,
  type ActiveSessionRow,
} from './schemas';

// Re-export for external consumers (e.g. E2E mocking, MfaTab).
export type {
  UserRow,
  PatchUserInput,
  InviteUserInput,
  InviteUserResponse,
  FactorsResponse,
  MfaFactor,
  SamlIdpRow,
  CreateSamlIdpInput,
  UpdateSamlIdpInput,
  SamlTestResponse,
  ActiveSessionRow,
};

// ---------------------------------------------------------------------------
// Users list
// ---------------------------------------------------------------------------

export const fetchUsers = (): Promise<UserRow[]> =>
  get('/spa/api/users', z.array(UserRowSchema));

// ---------------------------------------------------------------------------
// Patch user (role/branch/status/mfa — no password field)
// ---------------------------------------------------------------------------

export const patchUser = (id: number, body: PatchUserInput): Promise<UserRow> =>
  patch('/spa/api/users/' + String(id), PatchUserInputSchema.parse(body), UserRowSchema);

// ---------------------------------------------------------------------------
// Invite user (replaces the old plaintext-password createUser)
// ---------------------------------------------------------------------------

export const inviteUser = (body: InviteUserInput): Promise<InviteUserResponse> =>
  post('/spa/api/admin/users/invite', InviteUserInputSchema.parse(body), InviteUserResponseSchema);

// ---------------------------------------------------------------------------
// MFA factors
// ---------------------------------------------------------------------------

export const fetchFactors = (userId: number): Promise<FactorsResponse> =>
  get(`/spa/api/admin/users/${String(userId)}/factors`, FactorsResponseSchema);

export const disableFactor = (
  userId: number,
  factorId: string,
): Promise<{ ok: true; factor_id: string }> =>
  del(
    `/spa/api/admin/users/${String(userId)}/factors/${encodeURIComponent(factorId)}`,
    DisableFactorResponseSchema,
  );

// ---------------------------------------------------------------------------
// SAML IdPs
// ---------------------------------------------------------------------------

export const fetchSamlIdps = (): Promise<SamlIdpRow[]> =>
  get('/spa/api/admin/users/saml-idps', z.array(SamlIdpRowSchema));

export const createSamlIdp = (body: CreateSamlIdpInput): Promise<SamlIdpRow> =>
  post('/spa/api/admin/users/saml-idps', CreateSamlIdpInputSchema.parse(body), SamlIdpRowSchema);

export const updateSamlIdp = (id: number, body: UpdateSamlIdpInput): Promise<SamlIdpRow> =>
  put(
    `/spa/api/admin/users/saml-idps/${String(id)}`,
    UpdateSamlIdpInputSchema.parse(body),
    SamlIdpRowSchema,
  );

export const testSamlIdp = (id: number): Promise<SamlTestResponse> =>
  post(`/spa/api/admin/users/saml-idps/${String(id)}/test`, {}, SamlTestResponseSchema);

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export const fetchActiveSessions = async (): Promise<ActiveSessionRow[]> => {
  const raw = await get('/spa/api/auth/active-sessions', z.array(RawSessionRowSchema));
  return raw.map((s) => ({ ...s, id: `${String(s.user_id)}:${s.sid_last8}` }));
};

export const killSession = (userId: number, sid: string): Promise<{ ok: true }> =>
  del(`/spa/api/auth/sessions/${String(userId)}/${encodeURIComponent(sid)}`, OkResponseSchema);

export const killAllSessions = (
  userId: number,
): Promise<{ ok: true; sessions_killed: number }> =>
  del(
    `/spa/api/auth/sessions/${String(userId)}`,
    OkResponseSchema.extend({ sessions_killed: z.number().int() }),
  );

// ---------------------------------------------------------------------------
// Set password (anonymous — called from SetPasswordPage)
// ---------------------------------------------------------------------------

export const setPassword = (
  body: z.infer<typeof SetPasswordInputSchema>,
): Promise<{ ok: true }> =>
  post('/spa/api/auth/set-password', SetPasswordInputSchema.parse(body), OkResponseSchema);
