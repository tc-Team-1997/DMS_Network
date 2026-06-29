import type { Knex } from "knex";
import { newId } from "@zordms/db";

/**
 * Validation rules engine + repository (§4.6).
 *
 * Rules are data-driven (doc_type + field_key + rule_type + params). The engine
 * evaluates a flat `data` map of extracted fields and records pass/fail results.
 */

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

export interface ValidationResult {
  ruleId: string | null;
  fieldKey: string;
  ruleType: string;
  passed: boolean;
  severity: Severity;
  message: string | null;
}

function ruleRowToObj(row: Record<string, unknown>): ValidationRule {
  let params: Record<string, unknown> = {};
  try { params = JSON.parse(String(row.params ?? "{}")); } catch { params = {}; }
  return {
    id: String(row.id),
    docType: (row.doc_type as string) ?? null,
    fieldKey: String(row.field_key),
    ruleType: String(row.rule_type) as RuleType,
    params,
    severity: (String(row.severity) as Severity) ?? "error",
    message: (row.message as string) ?? null,
    enabled: Boolean(row.enabled),
    createdBy: (row.created_by as string) ?? null,
    createdAt: (row.created_at as string) ?? null,
  };
}

// ── Rule evaluation ───────────────────────────────────────────────────────────
function isBlank(v: unknown): boolean {
  return v === undefined || v === null || String(v).trim() === "";
}

/** Evaluate a single rule against a field value. Returns true = passed. */
export function evaluateRule(rule: ValidationRule, value: unknown): boolean {
  const p = rule.params ?? {};
  switch (rule.ruleType) {
    case "required":
      return !isBlank(value);
    // Non-required rules only apply when a value is present (absent ⇒ skip/pass).
    case "regex": {
      if (isBlank(value)) return true;
      const pattern = typeof p.pattern === "string" ? p.pattern : "";
      if (!pattern) return true;
      try { return new RegExp(pattern).test(String(value)); } catch { return true; }
    }
    case "min_length":
      return isBlank(value) ? true : String(value).length >= Number(p.min ?? 0);
    case "max_length":
      return isBlank(value) ? true : String(value).length <= Number(p.max ?? Infinity);
    case "range": {
      if (isBlank(value)) return true;
      const n = Number(value);
      if (Number.isNaN(n)) return false;
      const min = p.min !== undefined ? Number(p.min) : -Infinity;
      const max = p.max !== undefined ? Number(p.max) : Infinity;
      return n >= min && n <= max;
    }
    case "enum": {
      if (isBlank(value)) return true;
      const values = Array.isArray(p.values) ? p.values : [];
      return values.map(String).includes(String(value));
    }
    default:
      return true; // unknown rule type never blocks
  }
}

// ── CRUD ───────────────────────────────────────────────────────────────────────
export async function listRules(knex: Knex, docType?: string): Promise<ValidationRule[]> {
  let q = knex("validation_rules").select("*").orderBy([{ column: "doc_type" }, { column: "field_key" }]);
  if (docType) q = q.where({ doc_type: docType });
  return (await q).map(ruleRowToObj);
}

export async function createRule(
  knex: Knex,
  input: { docType?: string | null; fieldKey: string; ruleType: RuleType; params?: Record<string, unknown>; severity?: Severity; message?: string; enabled?: boolean; createdBy?: string },
): Promise<ValidationRule> {
  const id = newId();
  await knex("validation_rules").insert({
    id,
    doc_type: input.docType ?? null,
    field_key: input.fieldKey,
    rule_type: input.ruleType,
    params: JSON.stringify(input.params ?? {}),
    severity: input.severity ?? "error",
    message: input.message ?? null,
    enabled: input.enabled ?? true,
    created_by: input.createdBy ?? null,
  });
  const row = await knex("validation_rules").where({ id }).first();
  return ruleRowToObj(row!);
}

export async function updateRule(
  knex: Knex,
  id: string,
  patch: { docType?: string | null; fieldKey?: string; ruleType?: RuleType; params?: Record<string, unknown>; severity?: Severity; message?: string; enabled?: boolean },
): Promise<ValidationRule | null> {
  const existing = await knex("validation_rules").where({ id }).first();
  if (!existing) return null;
  const update: Record<string, unknown> = {};
  if (patch.docType !== undefined) update.doc_type = patch.docType;
  if (patch.fieldKey !== undefined) update.field_key = patch.fieldKey;
  if (patch.ruleType !== undefined) update.rule_type = patch.ruleType;
  if (patch.params !== undefined) update.params = JSON.stringify(patch.params);
  if (patch.severity !== undefined) update.severity = patch.severity;
  if (patch.message !== undefined) update.message = patch.message;
  if (patch.enabled !== undefined) update.enabled = patch.enabled;
  if (Object.keys(update).length > 0) await knex("validation_rules").where({ id }).update(update);
  return ruleRowToObj((await knex("validation_rules").where({ id }).first())!);
}

export async function deleteRule(knex: Knex, id: string): Promise<boolean> {
  const n = await knex("validation_rules").where({ id }).del();
  return n > 0;
}

// ── Run ──────────────────────────────────────────────────────────────────────
export interface RunSummary {
  total: number;
  passed: number;
  failed: number;
  errors: number;
  warnings: number;
}

/**
 * Evaluate all enabled rules for `docType` (plus rules with a null doc_type) against
 * `data`. If `documentId` is given, prior results for that document are replaced.
 */
export async function runValidation(
  knex: Knex,
  input: { documentId?: string; docType: string; data: Record<string, unknown> },
): Promise<{ results: ValidationResult[]; summary: RunSummary }> {
  const rows = await knex("validation_rules")
    .where({ enabled: true })
    .andWhere((b) => b.where({ doc_type: input.docType }).orWhereNull("doc_type"));
  const rules = rows.map(ruleRowToObj);

  const results: ValidationResult[] = rules.map((rule) => {
    const passed = evaluateRule(rule, input.data[rule.fieldKey]);
    return {
      ruleId: rule.id,
      fieldKey: rule.fieldKey,
      ruleType: rule.ruleType,
      passed,
      severity: rule.severity,
      message: passed ? null : rule.message ?? `${rule.fieldKey} failed ${rule.ruleType}`,
    };
  });

  if (input.documentId) {
    await knex("validation_results").where({ document_id: input.documentId }).del();
    for (const r of results) {
      await knex("validation_results").insert({
        id: newId(),
        document_id: input.documentId,
        rule_id: r.ruleId,
        doc_type: input.docType,
        field_key: r.fieldKey,
        rule_type: r.ruleType,
        passed: r.passed,
        severity: r.severity,
        message: r.message,
      });
    }
  }

  const failed = results.filter((r) => !r.passed);
  const summary: RunSummary = {
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    errors: failed.filter((r) => r.severity === "error").length,
    warnings: failed.filter((r) => r.severity === "warning").length,
  };
  return { results, summary };
}

/** Fetch persisted results for a document (most recent run). */
export async function listResults(knex: Knex, documentId: string): Promise<ValidationResult[]> {
  const rows = await knex("validation_results").where({ document_id: documentId }).orderBy("field_key", "asc");
  return rows.map((row) => ({
    ruleId: (row.rule_id as string) ?? null,
    fieldKey: String(row.field_key),
    ruleType: String(row.rule_type),
    passed: Boolean(row.passed),
    severity: (String(row.severity) as Severity) ?? "error",
    message: (row.message as string) ?? null,
  }));
}
