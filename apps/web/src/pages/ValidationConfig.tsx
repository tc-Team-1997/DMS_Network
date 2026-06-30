import { useEffect, useState, useCallback, type FormEvent } from "react";
import { useAuth } from "../auth/AuthContext.js";
import { validationApi, type ValidationRule, type RuleType, type Severity } from "../api/validationApi.js";

/**
 * SC-15 Validation Configuration — define data-validation rules per
 * doc-type/field on the core rule engine (built this session). No mock data.
 */
const RULE_TYPES: RuleType[] = ["required", "regex", "min_length", "max_length", "range", "enum"];
const SEVERITIES: Severity[] = ["error", "warning"];

export function ValidationConfig() {
  const { user } = useAuth();
  const canEdit = !!user?.permissions.includes("admin:access");

  const [rules, setRules] = useState<ValidationRule[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ doc_type: "", field_key: "", rule_type: "required" as RuleType, params: "", severity: "error" as Severity, message: "" });

  const refresh = useCallback(async () => {
    try { setRules(await validationApi.listRules()); }
    catch (e: any) { setError(String(e?.message ?? e)); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    let params: Record<string, unknown> | undefined;
    if (form.params.trim()) {
      try { params = JSON.parse(form.params); }
      catch { setError("Params must be valid JSON (e.g. {\"pattern\":\"^[0-9]+$\"})"); return; }
    }
    try {
      await validationApi.createRule({
        doc_type: form.doc_type.trim() || null,
        field_key: form.field_key.trim(),
        rule_type: form.rule_type,
        params,
        severity: form.severity,
        message: form.message.trim() || undefined,
      });
      setForm({ doc_type: "", field_key: "", rule_type: "required", params: "", severity: "error", message: "" });
      await refresh();
    } catch (e: any) { setError(String(e?.message ?? e)); }
  }

  async function toggle(r: ValidationRule) {
    try { await validationApi.updateRule(r.id, { enabled: !r.enabled }); await refresh(); }
    catch (e: any) { setError(String(e?.message ?? e)); }
  }

  async function remove(r: ValidationRule) {
    try { await validationApi.deleteRule(r.id); await refresh(); }
    catch (e: any) { setError(String(e?.message ?? e)); }
  }

  return (
    <div style={{ padding: 32 }}>
      <h2>Validation Configuration</h2>
      <p style={{ color: "var(--muted)" }}>
        Field-validation rules per doc-type. Rules run during extraction and surface on the document + review queue.
      </p>
      {error && <div role="alert" style={{ color: "var(--danger, #c0392b)", marginTop: 8 }}>{error}</div>}

      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 12 }}>
        <thead>
          <tr>
            {["Doc Type", "Field", "Rule", "Params", "Severity", "Enabled", ...(canEdit ? [""] : [])].map((h) => (
              <th key={h} style={{ textAlign: "left", padding: 8 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rules.map((r) => (
            <tr key={r.id} style={{ borderTop: "1px solid var(--line)" }}>
              <td style={{ padding: 8 }}>{r.docType ?? "(any)"}</td>
              <td style={{ padding: 8, fontFamily: "monospace", fontSize: 12 }}>{r.fieldKey}</td>
              <td style={{ padding: 8 }}>{r.ruleType}</td>
              <td style={{ padding: 8, fontFamily: "monospace", fontSize: 11, color: "var(--sil)" }}>{Object.keys(r.params).length ? JSON.stringify(r.params) : "—"}</td>
              <td style={{ padding: 8 }}>{r.severity}</td>
              <td style={{ padding: 8 }}>{r.enabled ? "Yes" : "No"}</td>
              {canEdit && (
                <td style={{ padding: 8, display: "flex", gap: 6 }}>
                  <button className="btn bs xs" onClick={() => toggle(r)} aria-label={`toggle ${r.fieldKey}`}>{r.enabled ? "Disable" : "Enable"}</button>
                  <button className="btn bs xs" onClick={() => remove(r)} aria-label={`delete ${r.fieldKey}`}>Delete</button>
                </td>
              )}
            </tr>
          ))}
          {rules.length === 0 && <tr><td colSpan={canEdit ? 7 : 6} style={{ padding: 16, textAlign: "center", color: "var(--sil)" }}>No validation rules</td></tr>}
        </tbody>
      </table>

      {canEdit && (
        <form onSubmit={create} style={{ marginTop: 24, display: "flex", gap: 8, flexWrap: "wrap", maxWidth: 900, alignItems: "center" }}>
          <input className="field" style={{ width: 150 }} placeholder="doc_type (blank=any)" value={form.doc_type} onChange={(e) => setForm({ ...form, doc_type: e.target.value })} aria-label="doc_type" />
          <input className="field" style={{ width: 150 }} placeholder="field_key" value={form.field_key} onChange={(e) => setForm({ ...form, field_key: e.target.value })} aria-label="field_key" required />
          <select className="field" style={{ width: 130 }} value={form.rule_type} onChange={(e) => setForm({ ...form, rule_type: e.target.value as RuleType })} aria-label="rule_type">{RULE_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
          <input className="field" style={{ width: 200 }} placeholder='params JSON e.g. {"pattern":"^[0-9]+$"}' value={form.params} onChange={(e) => setForm({ ...form, params: e.target.value })} aria-label="params" />
          <select className="field" style={{ width: 110 }} value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value as Severity })} aria-label="severity">{SEVERITIES.map((s) => <option key={s}>{s}</option>)}</select>
          <input className="field" style={{ width: 160 }} placeholder="message (optional)" value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} aria-label="message" />
          <button className="btn-primary" style={{ width: 130 }}>Add rule</button>
        </form>
      )}
    </div>
  );
}

export default ValidationConfig;
