/**
 * DocTypesPanel — admin Document Types management.
 *
 * Mounted as a tab inside System Administration (RBAC admin-gated by the parent).
 *
 * Features:
 *   - LIST all doc types (category + mandatory/optional field counts).
 *   - CREATE a custom type (code, description, category, jurisdiction, issuer + fields).
 *   - EDIT an existing type's description / fields (system + custom).
 *   - DELETE custom (non-system) types — delete is hidden for system types.
 *   - Per-type FIELD EDITOR with add/remove + mandatory toggle + dup validation.
 *   - AUTO-DETECT fields from a sample doc via POST /idp/infer-fields.
 *   - Accept a suggested-new-type via POST /doc-types/from-suggestion.
 */
import { useCallback, useEffect, useState } from "react";
import { Card, DataTable, Tag, Modal, FormField } from "../ui/index.js";
import type { Column } from "../ui/index.js";
import { docTypesApi } from "../../api/docTypesApi.js";
import type { DocType, FieldObject, DocTypeWritePayload } from "../../api/docTypesApi.js";
import {
  FieldEditor, rowsFromDocType, splitRows, validateRows, makeFieldRow,
} from "./FieldEditor.js";
import type { FieldRow } from "./FieldEditor.js";
import { AutoDetectModal } from "./AutoDetectModal.js";

type Row = DocType & { _key: string };

interface EditorState {
  mode: "create" | "edit";
  code: string;
  description: string;
  category: string;
  jurisdiction: string;
  issuer: string;
  system: boolean;
  rows: FieldRow[];
}

function blankEditor(): EditorState {
  return {
    mode: "create",
    code: "",
    description: "",
    category: "",
    jurisdiction: "",
    issuer: "",
    system: false,
    rows: [],
  };
}

function editorFrom(dt: DocType): EditorState {
  return {
    mode: "edit",
    code: dt.code,
    description: dt.description ?? "",
    category: dt.category ?? "",
    jurisdiction: dt.jurisdiction ?? "",
    issuer: dt.issuer ?? "",
    system: dt.system,
    rows: rowsFromDocType(dt.mandatoryFields ?? [], dt.optionalFields ?? []),
  };
}

export interface DocTypesPanelProps {
  /** Whether the current user may write (create/edit/delete). */
  canWrite: boolean;
}

export function DocTypesPanel({ canWrite }: DocTypesPanelProps) {
  const [types, setTypes] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  const [editor, setEditor] = useState<EditorState | null>(null);
  const [saving, setSaving] = useState(false);
  const [autoOpen, setAutoOpen] = useState(false);

  // suggested-new-type form
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestName, setSuggestName] = useState("");
  const [suggestReason, setSuggestReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await docTypesApi.list();
      setTypes(res.docTypes.map((d) => ({ ...d, _key: d.code })));
    } catch (e: unknown) {
      const err = e as { message?: string };
      setError(err?.message ?? "Failed to load document types.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function openCreate() {
    setMsg(null);
    setEditor(blankEditor());
  }
  function openEdit(dt: DocType) {
    setMsg(null);
    setEditor(editorFrom(dt));
  }

  async function handleSave() {
    if (!editor) return;
    const validation = validateRows(editor.rows);
    if (validation.length > 0) {
      setMsg({ kind: "error", text: validation[0] });
      return;
    }
    if (editor.mode === "create" && !editor.code.trim()) {
      setMsg({ kind: "error", text: "Code is required." });
      return;
    }
    setSaving(true);
    setMsg(null);
    const { mandatory_fields, optional_fields } = splitRows(editor.rows);
    try {
      if (editor.mode === "create") {
        const payload: DocTypeWritePayload = {
          code: editor.code.trim(),
          description: editor.description.trim() || undefined,
          category: editor.category.trim() || undefined,
          jurisdiction: editor.jurisdiction.trim() || undefined,
          issuer: editor.issuer.trim() || undefined,
          mandatory_fields,
          optional_fields,
        };
        await docTypesApi.create(payload);
        setMsg({ kind: "success", text: `Created "${editor.code}".` });
      } else {
        const payload: DocTypeWritePayload = {
          description: editor.description.trim(),
          category: editor.category.trim(),
          jurisdiction: editor.jurisdiction.trim(),
          issuer: editor.issuer.trim(),
          mandatory_fields,
          optional_fields,
        };
        await docTypesApi.update(editor.code, payload);
        setMsg({ kind: "success", text: `Updated "${editor.code}".` });
      }
      setEditor(null);
      await load();
    } catch (e: unknown) {
      const err = e as { status?: number; body?: { detail?: string; error?: string } };
      const detail =
        err?.body?.detail ??
        (err?.status === 409 ? "A type with that code already exists." : null) ??
        err?.body?.error ??
        "Save failed.";
      setMsg({ kind: "error", text: detail });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(dt: DocType) {
    if (dt.system) return;
    if (!window.confirm(`Delete custom type "${dt.code}"? This cannot be undone.`)) return;
    setMsg(null);
    try {
      await docTypesApi.remove(dt.code);
      setMsg({ kind: "success", text: `Deleted "${dt.code}".` });
      await load();
    } catch (e: unknown) {
      const err = e as { body?: { detail?: string } };
      setMsg({ kind: "error", text: err?.body?.detail ?? "Delete failed." });
    }
  }

  /** Merge auto-detected fields into the open editor (de-dupe by name). */
  function applyDetectedFields(fields: FieldObject[]) {
    setEditor((prev) => {
      if (!prev) return prev;
      const existing = new Set(prev.rows.map((r) => r.name.trim().toLowerCase()));
      const additions = fields
        .filter((f) => f.name && !existing.has(f.name.trim().toLowerCase()))
        .map((f) => makeFieldRow(f));
      return { ...prev, rows: [...prev.rows, ...additions] };
    });
  }

  async function handleAcceptSuggestion() {
    if (!suggestName.trim()) {
      setMsg({ kind: "error", text: "Proposed name is required." });
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      await docTypesApi.fromSuggestion({
        proposedName: suggestName.trim(),
        reason: suggestReason.trim() || undefined,
      });
      setMsg({ kind: "success", text: `Accepted suggestion "${suggestName}".` });
      setSuggestOpen(false);
      setSuggestName("");
      setSuggestReason("");
      await load();
    } catch (e: unknown) {
      const err = e as { status?: number; body?: { detail?: string } };
      setMsg({
        kind: "error",
        text: err?.body?.detail ?? (err?.status === 409 ? "That code already exists." : "Failed to accept suggestion."),
      });
    } finally {
      setSaving(false);
    }
  }

  const cols: Column<Row>[] = [
    {
      key: "code", header: "Code", sortable: true,
      render: (r) => (
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="mono" style={{ fontWeight: 700, fontSize: 12 }}>{r.code}</span>
          {r.system
            ? <Tag variant="blue">system</Tag>
            : <Tag variant="gold">custom</Tag>}
        </span>
      ),
    },
    { key: "description", header: "Description", sortable: true },
    {
      key: "category", header: "Category", width: 150, sortable: true,
      render: (r) => r.category ? <Tag variant="purple">{r.category}</Tag> : <span style={{ color: "var(--sil)" }}>—</span>,
    },
    {
      key: "_fields", header: "Fields", width: 150,
      render: (r) => (
        <span style={{ fontSize: 11 }}>
          <span style={{ color: "var(--G)" }}>{(r.mandatoryFields ?? []).length} mandatory</span>
          {" · "}
          <span style={{ color: "var(--sil)" }}>{(r.optionalFields ?? []).length} optional</span>
        </span>
      ),
    },
    {
      key: "_actions", header: "Actions", width: 150,
      render: (r) => (
        <span style={{ display: "flex", gap: 6 }}>
          <button className="btn bs xs" type="button" onClick={() => openEdit(r)} aria-label={`Edit ${r.code}`}>
            Edit
          </button>
          {!r.system && canWrite && (
            <button className="btn bx xs" type="button" onClick={() => handleDelete(r)} aria-label={`Delete ${r.code}`}>
              Delete
            </button>
          )}
        </span>
      ),
    },
  ];

  return (
    <div style={{ marginTop: 14 }}>
      {/* header actions */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: "var(--sil)" }}>
          {types.length} document type{types.length === 1 ? "" : "s"} registered
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {canWrite && (
            <button className="btn bs sm" type="button" onClick={() => { setMsg(null); setSuggestOpen(true); }} aria-label="Accept suggested type">
              Accept suggested type
            </button>
          )}
          {canWrite && (
            <button className="btn bg sm" type="button" onClick={openCreate} aria-label="New doc type">
              + New type
            </button>
          )}
        </div>
      </div>

      {error && (
        <div style={{ padding: "10px 14px", background: "var(--RT)", border: "1px solid rgba(224,82,82,.3)", borderRadius: 8, marginBottom: 12, fontSize: 12, color: "var(--R)" }}>
          {error}
        </div>
      )}

      {msg && (
        <div
          role="status"
          style={{
            padding: "8px 12px", borderRadius: 6, fontSize: 12, marginBottom: 12,
            background: msg.kind === "success" ? "var(--GT)" : "var(--RT)",
            border: `1px solid ${msg.kind === "success" ? "rgba(46,204,138,.3)" : "rgba(224,82,82,.3)"}`,
            color: msg.kind === "success" ? "var(--G)" : "var(--R)",
          }}
        >
          {msg.text}
        </div>
      )}

      <Card title="Document Types">
        {loading ? (
          <div style={{ padding: 32, textAlign: "center", color: "var(--sil)" }}>Loading document types…</div>
        ) : (
          <DataTable<Row>
            columns={cols}
            rows={types}
            rowKey={(r) => r._key}
            emptyMessage="No document types registered"
            pageSize={10}
          />
        )}
      </Card>

      {/* ── Create / Edit modal ── */}
      {editor && (
        <Modal
          open
          onClose={() => !saving && setEditor(null)}
          title={editor.mode === "create" ? "New document type" : `Edit "${editor.code}"`}
          width={680}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {editor.mode === "create" && (
              <FormField
                label="Code *"
                placeholder="e.g. BT_TRADE_LICENSE"
                value={editor.code}
                disabled={saving}
                onChange={(e) => setEditor({ ...editor, code: e.target.value })}
              />
            )}
            {editor.mode === "edit" && editor.system && (
              <div style={{ marginBottom: 8, fontSize: 11, color: "var(--B)" }}>
                System type — code cannot change and it cannot be deleted, but its
                schema and description are editable.
              </div>
            )}
            <FormField
              as="textarea"
              label="Description"
              rows={2}
              value={editor.description}
              disabled={saving}
              onChange={(e) => setEditor({ ...editor, description: e.target.value })}
            />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              <FormField
                label="Category"
                value={editor.category}
                disabled={saving}
                onChange={(e) => setEditor({ ...editor, category: e.target.value })}
              />
              <FormField
                label="Jurisdiction / Issuer (jurisdiction)"
                value={editor.jurisdiction}
                disabled={saving}
                onChange={(e) => setEditor({ ...editor, jurisdiction: e.target.value })}
              />
              <FormField
                label="Issuer"
                value={editor.issuer}
                disabled={saving}
                onChange={(e) => setEditor({ ...editor, issuer: e.target.value })}
              />
            </div>

            {/* Field editor */}
            <div style={{ marginTop: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".5px", color: "var(--sil)" }}>
                  Metadata fields
                </span>
                <button className="btn bb xs" type="button" onClick={() => setAutoOpen(true)} disabled={saving} aria-label="Auto-detect fields">
                  Auto-detect fields
                </button>
              </div>
              <FieldEditor
                rows={editor.rows}
                disabled={saving}
                onChange={(rows) => setEditor({ ...editor, rows })}
              />
            </div>

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, borderTop: "1px solid var(--bd)", paddingTop: 12, marginTop: 10 }}>
              <button className="btn bs sm" type="button" onClick={() => setEditor(null)} disabled={saving}>
                Cancel
              </button>
              <button
                className="btn bg sm"
                type="button"
                onClick={handleSave}
                disabled={saving || !canWrite}
                aria-label="Save doc type"
              >
                {saving ? "Saving…" : editor.mode === "create" ? "Create type" : "Save changes"}
              </button>
            </div>
          </div>

          <AutoDetectModal
            open={autoOpen}
            onClose={() => setAutoOpen(false)}
            docTypeHint={editor.code || undefined}
            onApply={applyDetectedFields}
          />
        </Modal>
      )}

      {/* ── Accept suggested type modal ── */}
      {suggestOpen && (
        <Modal open onClose={() => !saving && setSuggestOpen(false)} title="Accept suggested new type" width={520}>
          <div>
            <div style={{ fontSize: 11, color: "var(--sil)", marginBottom: 12 }}>
              Persist an AI-suggested new document type into the registry. It will be
              created as a custom type; you can refine its fields afterwards.
            </div>
            <FormField
              label="Proposed name (code) *"
              placeholder="e.g. utility_bill"
              value={suggestName}
              disabled={saving}
              onChange={(e) => setSuggestName(e.target.value)}
            />
            <FormField
              as="textarea"
              label="Reason"
              rows={2}
              value={suggestReason}
              disabled={saving}
              onChange={(e) => setSuggestReason(e.target.value)}
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
              <button className="btn bs sm" type="button" onClick={() => setSuggestOpen(false)} disabled={saving}>
                Cancel
              </button>
              <button className="btn bg sm" type="button" onClick={handleAcceptSuggestion} disabled={saving} aria-label="Confirm accept suggestion">
                {saving ? "Saving…" : "Accept & create"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default DocTypesPanel;
