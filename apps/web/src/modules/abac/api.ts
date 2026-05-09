/**
 * API layer for the ABAC Editor module.
 * All requests go through src/lib/http.ts with zod schemas.
 * Endpoints:
 *   GET    /spa/api/admin/abac/rules
 *   POST   /spa/api/admin/abac/rules
 *   PUT    /spa/api/admin/abac/rules/:id
 *   DELETE /spa/api/admin/abac/rules/:id
 *   POST   /spa/api/admin/abac/compile
 *   POST   /spa/api/admin/abac/test
 *   GET    /spa/api/admin/audit-log  (reused from admin module)
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { get, post, put } from '@/lib/http';
import {
  RulesResponseSchema,
  MutateRulesResponseSchema,
  CompileResultSchema,
  PolicyTestInputSchema,
  PolicyTestResultSchema,
  AbacRuleSchema,
  DecisionTraceRowSchema,
  type AbacRule,
  type PolicyTestInput,
} from './schemas';
import { AuditRowSchema } from '@/modules/admin/api';

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const abacKeys = {
  rules:         () => ['abac', 'rules']         as const,
  decisionTrace: () => ['abac', 'decision-trace'] as const,
};

// ---------------------------------------------------------------------------
// Fetchers
// ---------------------------------------------------------------------------

export function fetchRules() {
  return get('/spa/api/admin/abac/rules', RulesResponseSchema).then(r => r.rules);
}

export function addRule(rule: AbacRule, reason: string) {
  AbacRuleSchema.parse(rule);
  return post('/spa/api/admin/abac/rules', { rule, reason }, MutateRulesResponseSchema);
}

export function updateRule(id: string, rule: AbacRule, reason: string) {
  AbacRuleSchema.parse(rule);
  return put(`/spa/api/admin/abac/rules/${encodeURIComponent(id)}`, { rule, reason }, MutateRulesResponseSchema);
}

export function compileAndPush() {
  return post('/spa/api/admin/abac/compile', {}, CompileResultSchema);
}

export function testPolicy(input: PolicyTestInput) {
  PolicyTestInputSchema.parse(input);
  return post('/spa/api/admin/abac/test', input, PolicyTestResultSchema);
}

// Audit log rows where details JSON contains ABAC-related keys
const AuditRowListSchema = z.array(AuditRowSchema);

export function fetchDecisionTrace(limit = 50) {
  return get('/spa/api/admin/audit-log', AuditRowListSchema, { limit }).then(rows =>
    rows
      .filter(r => {
        if (!r.details) return false;
        try {
          const d = JSON.parse(r.details) as Record<string, unknown>;
          return 'allow' in d || 'via' in d || 'abac_deny' in d;
        } catch {
          return false;
        }
      })
      .map(r => {
        let allow: boolean | undefined;
        let via: string | undefined;
        let reason: string | undefined;
        if (r.details) {
          try {
            const d = JSON.parse(r.details) as Record<string, unknown>;
            if (typeof d['allow'] === 'boolean') allow = d['allow'];
            if (typeof d['via'] === 'string')    via   = d['via'];
            if (typeof d['reason'] === 'string') reason = d['reason'];
          } catch { /* ignore */ }
        }
        return DecisionTraceRowSchema.parse({ ...r, allow, via, reason });
      })
  );
}

// ---------------------------------------------------------------------------
// React Query hooks
// ---------------------------------------------------------------------------

export function useAbacRules() {
  return useQuery({
    queryKey: abacKeys.rules(),
    queryFn:  fetchRules,
    staleTime: 30_000,
  });
}

export function useAddRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ rule, reason }: { rule: AbacRule; reason: string }) =>
      addRule(rule, reason),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: abacKeys.rules() });
    },
  });
}

export function useUpdateRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, rule, reason }: { id: string; rule: AbacRule; reason: string }) =>
      updateRule(id, rule, reason),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: abacKeys.rules() });
    },
  });
}

export function useDeleteRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      _deleteRule(id, reason),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: abacKeys.rules() });
    },
  });
}

// Internal: DELETE with body via axios delete method
async function _deleteRule(id: string, reason: string) {
  const { http } = await import('@/lib/http');
  const { data } = await http.delete<unknown>(`/spa/api/admin/abac/rules/${encodeURIComponent(id)}`, {
    data: { reason },
  });
  return MutateRulesResponseSchema.parse(data);
}

export function useCompileAndPush() {
  return useMutation({
    mutationFn: compileAndPush,
  });
}

export function useTestPolicy() {
  return useMutation({
    mutationFn: testPolicy,
  });
}

export function useDecisionTrace(limit = 50) {
  return useQuery({
    queryKey: abacKeys.decisionTrace(),
    queryFn:  () => fetchDecisionTrace(limit),
    staleTime: 60_000,
  });
}
