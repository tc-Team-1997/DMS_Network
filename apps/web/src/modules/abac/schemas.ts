/**
 * Zod schemas for the ABAC Editor module.
 *
 * Mirrors the closed-enum field list and operator set enforced server-side
 * by scripts/abac-compile.js — if these diverge, the compiler will catch it.
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Closed enums — must match ALLOWED_FIELDS and ALLOWED_OPS in abac-compile.js
// ---------------------------------------------------------------------------

export const ALLOWED_FIELD_PATHS = [
  'subject.role',
  'subject.branch',
  'subject.tenant',
  'resource.tenant_id',
  'resource.risk_band',
  'resource.branch',
  'resource.type',
  'context.stepup_valid',
  'context.time_unix',
  'action.name',
] as const;
export type AllowedFieldPath = (typeof ALLOWED_FIELD_PATHS)[number];

export const ALLOWED_OPS = ['eq', 'neq', 'in', 'not_in', 'gte', 'lte'] as const;
export type AllowedOp = (typeof ALLOWED_OPS)[number];

export const KNOWN_RESOURCES = [
  'document',
  'folder',
  'workflow',
  'admin',
  '*',
] as const;

export const KNOWN_ACTIONS = [
  'view',
  'capture',
  'index',
  'approve',
  'sign',
  'admin',
  'audit_read',
  '*',
] as const;

// ---------------------------------------------------------------------------
// Predicate
// ---------------------------------------------------------------------------

export const PredicateSchema = z.object({
  field: z.enum(ALLOWED_FIELD_PATHS),
  op:    z.enum(ALLOWED_OPS),
  value: z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.string()),
  ]),
});
export type Predicate = z.infer<typeof PredicateSchema>;

// ---------------------------------------------------------------------------
// Condition
// ---------------------------------------------------------------------------

export const ConditionSchema = z.object({
  resource: z.string().min(1),
  action:   z.string().min(1),
  when_all: z.array(PredicateSchema).optional(),
  when_any: z.array(PredicateSchema).optional(),
});
export type Condition = z.infer<typeof ConditionSchema>;

// ---------------------------------------------------------------------------
// AbacRule
// ---------------------------------------------------------------------------

export const AbacRuleSchema = z.object({
  id:          z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, 'id must be a safe identifier'),
  name:        z.string().min(1),
  description: z.string().optional(),
  effect:      z.enum(['allow', 'deny']),
  priority:    z.number().int().min(0).max(1000),
  condition:   ConditionSchema,
});
export type AbacRule = z.infer<typeof AbacRuleSchema>;

// ---------------------------------------------------------------------------
// API response schemas
// ---------------------------------------------------------------------------

export const RulesResponseSchema = z.object({
  rules: z.array(AbacRuleSchema),
});
export type RulesResponse = z.infer<typeof RulesResponseSchema>;

export const MutateRulesResponseSchema = z.object({
  rules:      z.array(AbacRuleSchema),
  hash:       z.string(),
  changed_at: z.string(),
});
export type MutateRulesResponse = z.infer<typeof MutateRulesResponseSchema>;

export const CompileResultSchema = z.object({
  ok:              z.boolean(),
  rules_compiled:  z.number().int().optional(),
  error:           z.string().optional(),
  opa_push: z.object({
    ok:     z.boolean(),
    status: z.number().int().nullable(),
    error:  z.string().nullable(),
  }).nullable().optional(),
});
export type CompileResult = z.infer<typeof CompileResultSchema>;

// ---------------------------------------------------------------------------
// Policy test
// ---------------------------------------------------------------------------

export const PolicyTestInputSchema = z.object({
  action:   z.string().min(1),
  resource: z.record(z.string(), z.unknown()).optional(),
  context:  z.record(z.string(), z.unknown()).optional(),
});
export type PolicyTestInput = z.infer<typeof PolicyTestInputSchema>;

export const PolicyTestResultSchema = z.object({
  allow:  z.boolean(),
  via:    z.string().optional(),
  reason: z.string().optional(),
});
export type PolicyTestResult = z.infer<typeof PolicyTestResultSchema>;

// ---------------------------------------------------------------------------
// Decision trace (reuses audit_log rows from admin module)
// ---------------------------------------------------------------------------

export const DecisionTraceRowSchema = z.object({
  id:         z.number().int(),
  action:     z.string().nullable(),
  entity:     z.string().nullable(),
  entity_id:  z.number().int().nullable(),
  details:    z.string().nullable(),
  created_at: z.string(),
  username:   z.string().nullable(),
  role:       z.string().nullable(),
  // Parsed from details JSON (enriched client-side)
  allow:      z.boolean().optional(),
  via:        z.string().optional(),
  reason:     z.string().optional(),
});
export type DecisionTraceRow = z.infer<typeof DecisionTraceRowSchema>;
