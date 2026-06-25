/**
 * AutoDetectModal — upload a SAMPLE document, call POST /idp/infer-fields,
 * show AI-proposed fields, let the admin tick which to keep + adjust mandatory,
 * then hand the chosen field-objects back to the parent.
 *
 * Clearly labelled "AI suggestion — review before saving" and handles the
 * degraded response (backend unavailable / unreadable file) gracefully.
 */
import { useState } from "react";
import { Modal } from "../ui/index.js";
import { docTypesApi } from "../../api/docTypesApi.js";
import type { FieldObject, InferredField, InferFieldsResult } from "../../api/docTypesApi.js";

export interface AutoDetectModalProps {
  open: boolean;
  onClose: () => void;
  /** Optional hint sent to the inferer (e.g. the type code being edited). */
  docTypeHint?: string;
  /** Called with the field-objects the admin chose to keep. */
  onApply: (fields: FieldObject[]) => void;
}

interface PickRow extends InferredField {
  _keep: boolean;
}

export function AutoDetectModal({ open, onClose, docTypeHint, onApply }: AutoDetectModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<InferFieldsResult | null>(null);
  const [rows, setRows] = useState<PickRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setFile(null);
    setLoading(false);
    setResult(null);
    setRows([]);
    setError(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function runInfer() {
    if (!file) return;
    setLoading(true);
    setError(null);
    setResult(null);
    setRows([]);
    try {
      const res = await docTypesApi.inferFields(file, docTypeHint);
      setResult(res);
      setRows(res.fields.map((f) => ({ ...f, _keep: true })));
    } catch (e: unknown) {
      const err = e as { body?: { detail?: string }; message?: string };
      setError(err?.body?.detail ?? err?.message ?? "Failed to infer fields.");
    } finally {
      setLoading(false);
    }
  }

  function toggleKeep(name: string, keep: boolean) {
    setRows((rs) => rs.map((r) => (r.name === name ? { ...r, _keep: keep } : r)));
  }
  function toggleMandatory(name: string, mandatory: boolean) {
    setRows((rs) => rs.map((r) => (r.name === name ? { ...r, mandatory } : r)));
  }

  function apply() {
    const chosen: FieldObject[] = rows
      .filter((r) => r._keep)
      .map((r) => ({ name: r.name, type: r.type, mandatory: r.mandatory }));
    onApply(chosen);
    handleClose();
  }

  const keptCount = rows.filter((r) => r._keep).length;

  return (
    <Modal open={open} onClose={handleClose} title="Auto-detect fields from sample" width={640}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {/* AI disclaimer */}
        <div
          role="note"
          style={{
            padding: "8px 12px",
            borderRadius: 8,
            fontSize: 11,
            background: "var(--gold0, rgba(151,120,30,.08))",
            border: "1px solid rgba(151,120,30,.3)",
            color: "var(--gold3)",
          }}
        >
          AI suggestion — review before saving. The model reads one sample document and
          guesses field names, types and which are mandatory. Always verify before applying.
        </div>

        {/* File picker */}
        <div>
          <label style={{ display: "block", fontSize: 10.5, color: "var(--sil)", marginBottom: 4 }}>
            Sample document (image or PDF)
          </label>
          <input
            type="file"
            accept="image/*,application/pdf"
            aria-label="Sample document"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            className="btn bg sm"
            type="button"
            onClick={runInfer}
            disabled={!file || loading}
            aria-label="Run auto-detect"
          >
            {loading ? "Detecting…" : "Detect fields"}
          </button>
        </div>

        {error && (
          <div role="alert" style={{ padding: "8px 12px", borderRadius: 6, fontSize: 11, background: "var(--RT)", border: "1px solid rgba(224,82,82,.3)", color: "var(--R)" }}>
            {error}
          </div>
        )}

        {/* Degraded notice */}
        {result?.degraded && (
          <div role="status" style={{ padding: "8px 12px", borderRadius: 6, fontSize: 11, background: "var(--WT, rgba(240,160,48,.1))", border: "1px solid rgba(240,160,48,.35)", color: "var(--W)" }}>
            {result.note ?? "AI field detection is degraded — no fields could be inferred. You can still add fields manually."}
          </div>
        )}

        {/* Proposed fields */}
        {result && !result.degraded && rows.length > 0 && (
          <div>
            <div style={{ fontSize: 11, color: "var(--sil)", marginBottom: 6 }}>
              {keptCount} of {rows.length} proposed field{rows.length === 1 ? "" : "s"} selected
              {result.doc_type_hint ? ` · detected: ${result.doc_type_hint}` : ""}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 320, overflowY: "auto" }} data-testid="proposed-fields">
              {rows.map((r) => (
                <div
                  key={r.name}
                  data-testid="proposed-field"
                  style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--ink3)", border: "1px solid var(--bd)", borderRadius: 8, padding: "7px 10px" }}
                >
                  <input
                    type="checkbox"
                    checked={r._keep}
                    aria-label={`Keep ${r.name}`}
                    onChange={(e) => toggleKeep(r.name, e.target.checked)}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>
                      {r.label ?? r.name}{" "}
                      <span className="mono" style={{ fontSize: 10, color: "var(--gold2)" }}>{r.name}</span>
                    </div>
                    <div style={{ fontSize: 10, color: "var(--sil)" }}>
                      {r.type ?? "string"}
                      {r.sample_value ? ` · e.g. "${r.sample_value}"` : ""}
                    </div>
                  </div>
                  <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10.5, cursor: "pointer", whiteSpace: "nowrap" }}>
                    <input
                      type="checkbox"
                      checked={r.mandatory}
                      aria-label={`Mandatory ${r.name}`}
                      onChange={(e) => toggleMandatory(r.name, e.target.checked)}
                    />
                    <span style={{ color: r.mandatory ? "var(--G)" : "var(--sil)" }}>Mandatory</span>
                  </label>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, borderTop: "1px solid var(--bd)", paddingTop: 12 }}>
          <button className="btn bs sm" type="button" onClick={handleClose}>Cancel</button>
          <button
            className="btn bg sm"
            type="button"
            onClick={apply}
            disabled={keptCount === 0}
            aria-label="Apply selected fields"
          >
            Apply {keptCount > 0 ? `${keptCount} field${keptCount === 1 ? "" : "s"}` : "fields"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
