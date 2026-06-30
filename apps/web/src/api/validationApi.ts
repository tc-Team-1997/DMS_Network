/**
 * validationApi.ts — Validation Configuration (§4.6 / SC-15) client.
 *
 * Wires the core service's data-driven validation rule engine:
 *   GET    /validation/rules[?doc_type]
 *   POST   /validation/rules
 *   PUT    /validation/rules/:id
 *   DELETE /validation/rules/:id
 *   POST   /validation/run
 */
import { http, SVC } from "./http.js";

const BASE = SVC.core;

export type RuleType = "required" | "regex" | "min_length" | "max_length" | "range" | "enum";
export type Severity = "error" | "warning";

export interface ValidationRule {
  id: string;
  docType: string | null;
  fieldKey: string;
  ruleType: RuleType;
  params: Record<string, unknown>;
  severity: Severity;
  message: string | null;
  enabled: boolean;
  createdBy: string | null;
  createdAt: string | null;
}

export interface CreateRuleInput {
  doc_type?: string | null;
  field_key: string;
  rule_type: RuleType;
  params?: Record<string, unknown>;
  severity?: Severity;
  message?: string;
  enabled?: boolean;
}

export async function listRules(docType?: string): Promise<ValidationRule[]> {
  const qs = docType ? `?doc_type=${encodeURIComponent(docType)}` : "";
  const res = await http.get<{ rules: ValidationRule[] }>(`${BASE}/validation/rules${qs}`);
  return res.rules ?? [];
}

export async function createRule(input: CreateRuleInput): Promise<ValidationRule> {
  return (await http.post<{ rule: ValidationRule }>(`${BASE}/validation/rules`, input)).rule;
}

export async function updateRule(id: string, patch: Partial<CreateRuleInput>): Promise<ValidationRule> {
  return (await http.put<{ rule: ValidationRule }>(`${BASE}/validation/rules/${encodeURIComponent(id)}`, patch)).rule;
}

export async function deleteRule(id: string): Promise<void> {
  await http.delete(`${BASE}/validation/rules/${encodeURIComponent(id)}`);
}

export const validationApi = { listRules, createRule, updateRule, deleteRule };
