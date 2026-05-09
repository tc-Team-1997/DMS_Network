/**
 * Users v2 — Zod schemas for all new endpoints.
 * Source of truth: routes/spa-api/users.js, auth.js, saml-idps.js
 */

import { z } from 'zod';
import { RoleSchema } from '@/lib/schemas';

// ---------------------------------------------------------------------------
// User row (extended from v1)
// ---------------------------------------------------------------------------

export const UserRowSchema = z.object({
  id:             z.number().int(),
  username:       z.string(),
  full_name:      z.string().nullable(),
  email:          z.string().nullable(),
  role:           RoleSchema,
  branch:         z.string().nullable(),
  status:         z.enum(['Active', 'Locked', 'Disabled']),
  mfa_enabled:    z.number().int(),
  mfa_phone:      z.string().nullable(),
  tenant_id:      z.string(),
  created_at:     z.string(),
  invite_pending: z.boolean().optional(),
});
export type UserRow = z.infer<typeof UserRowSchema>;

// ---------------------------------------------------------------------------
// Patch user
// ---------------------------------------------------------------------------

export const PatchUserInputSchema = z.object({
  full_name:   z.string().max(120).optional(),
  email:       z.string().email().max(200).optional(),
  role:        RoleSchema.optional(),
  branch:      z.string().max(80).nullable().optional(),
  status:      z.enum(['Active', 'Locked', 'Disabled']).optional(),
  mfa_enabled: z.number().int().min(0).max(1).optional(),
  mfa_phone:   z.string().max(32).nullable().optional(),
});
export type PatchUserInput = z.infer<typeof PatchUserInputSchema>;

// ---------------------------------------------------------------------------
// Invite
// ---------------------------------------------------------------------------

export const InviteUserInputSchema = z.object({
  email:  z.string().email().max(200),
  role:   RoleSchema,
  branch: z.string().max(80).optional(),
  reason: z.string().min(10, 'Reason must be at least 10 characters'),
});
export type InviteUserInput = z.infer<typeof InviteUserInputSchema>;

export const InviteUserResponseSchema = z.object({
  ok:         z.literal(true),
  user_id:    z.number().int(),
  username:   z.string(),
  email:      z.string(),
  role:       RoleSchema,
  branch:     z.string().nullable(),
  expires_at: z.string(),
  dev_link:   z.string().optional(),
});
export type InviteUserResponse = z.infer<typeof InviteUserResponseSchema>;

// ---------------------------------------------------------------------------
// MFA factors
// ---------------------------------------------------------------------------

export const MfaFactorSchema = z.object({
  id:           z.string(),
  kind:         z.enum(['totp', 'sms', 'webauthn']),
  enabled:      z.boolean(),
  label:        z.string(),
  last_used_at: z.string().nullable().optional(),
});
export type MfaFactor = z.infer<typeof MfaFactorSchema>;

export const FactorsResponseSchema = z.object({
  user_id: z.number().int(),
  factors: z.array(MfaFactorSchema),
});
export type FactorsResponse = z.infer<typeof FactorsResponseSchema>;

export const DisableFactorResponseSchema = z.object({
  ok:        z.literal(true),
  factor_id: z.string(),
});

// ---------------------------------------------------------------------------
// SAML IdP
// ---------------------------------------------------------------------------

export const SamlClaimMapSchema = z.record(z.string(), z.string());

export const SamlIdpRowSchema = z.object({
  id:           z.number().int(),
  tenant_id:    z.string(),
  name:         z.string(),
  metadata_xml: z.string(),
  claim_map:    SamlClaimMapSchema,
  enforce_only: z.boolean(),
  is_active:    z.boolean(),
  created_at:   z.string(),
  updated_at:   z.string(),
});
export type SamlIdpRow = z.infer<typeof SamlIdpRowSchema>;

export const CreateSamlIdpInputSchema = z.object({
  name:         z.string().min(1).max(80),
  metadata_xml: z.string().min(50),
  claim_map:    SamlClaimMapSchema.optional(),
  enforce_only: z.boolean().optional(),
  is_active:    z.boolean().optional(),
});
export type CreateSamlIdpInput = z.infer<typeof CreateSamlIdpInputSchema>;

export const UpdateSamlIdpInputSchema = z.object({
  name:         z.string().min(1).max(80).optional(),
  metadata_xml: z.string().min(50).optional(),
  claim_map:    SamlClaimMapSchema.optional(),
  enforce_only: z.boolean().optional(),
  is_active:    z.boolean().optional(),
});
export type UpdateSamlIdpInput = z.infer<typeof UpdateSamlIdpInputSchema>;

export const SamlTestResponseSchema = z.object({
  idp_entity_id:    z.string(),
  sso_url:          z.string(),
  sp_issuer:        z.string(),
  acs_url:          z.string(),
  claim_map:        SamlClaimMapSchema,
  saml_request_xml: z.string(),
  note:             z.string(),
});
export type SamlTestResponse = z.infer<typeof SamlTestResponseSchema>;

// ---------------------------------------------------------------------------
// Active sessions
// ---------------------------------------------------------------------------

export const ActiveSessionRowSchema = z.object({
  /** Synthetic id = "{user_id}:{sid_last8}" — satisfies DataTable<T extends {id}> */
  id:         z.string(),
  user_id:    z.number().int(),
  username:   z.string(),
  sid_last8:  z.string(),
  created_at: z.string().nullable(),
  expires_at: z.string().nullable(),
  ip:         z.string().nullable(),
  user_agent: z.string().nullable(),
});
export type ActiveSessionRow = z.infer<typeof ActiveSessionRowSchema>;

// ---------------------------------------------------------------------------
// Set password
// ---------------------------------------------------------------------------

export const SetPasswordInputSchema = z.object({
  token:    z.string().min(32),
  password: z.string().min(8),
});
export type SetPasswordInput = z.infer<typeof SetPasswordInputSchema>;

export const OkResponseSchema = z.object({ ok: z.literal(true) });

// ---------------------------------------------------------------------------
// SoD error (returned by PATCH /users/:id when role change violates SoD)
// ---------------------------------------------------------------------------

export const SodViolationSchema = z.object({
  error:   z.literal('sod_violation'),
  pair:    z.tuple([z.string(), z.string()]),
  message: z.string(),
});
