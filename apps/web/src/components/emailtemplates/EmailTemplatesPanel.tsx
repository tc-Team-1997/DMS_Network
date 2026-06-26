/**
 * EmailTemplatesPanel — admin Email Template management.
 *
 * Mounted as a tab inside System Administration (RBAC admin-gated by the parent).
 *
 * Features:
 *   - LIST all templates (key, name, category, enabled).
 *   - CREATE / EDIT a template: name, key, category, subject + HTML body.
 *   - MERGE-TAG palette — clickable chips insert {{tags}} (incl. {{doc.link}}
 *     which routes back into the app) at the cursor.
 *   - LIVE PREVIEW — server-rendered subject + HTML with sample data.
 *   - TEST-SEND — render and email one recipient via the real SMTP pipeline.
 *   - DELETE a template.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Card, DataTable, Tag, Modal, FormField } from "../ui/index.js";
import type { Column } from "../ui/index.js";
import { emailTemplatesApi } from "../../api/emailTemplatesApi.js";
import type {
  EmailTemplate,
  CreateEmailTemplatePayload,
  MergeTag,
  RenderedEmail,
} from "../../api/emailTemplatesApi.js";

type Row = EmailTemplate & { _key: string };

interface EditorState {
  mode: "create" | "edit";
  id?: string;
  key: string;
  name: string;
  category: string;
  description: string;
  subjectTemplate: string;
  htmlBodyTemplate: string;
  enabled: boolean;
}

function blankEditor(): EditorState {
  return {
    mode: "create",
    key: "",
    name: "",
    category: "",
    description: "",
    subjectTemplate: "",
    htmlBodyTemplate: "<p>Hello {{recipient.name}},</p>\n<p>{{alert.title}}</p>\n<p><a href=\"{{doc.link}}\">Open document</a></p>",
    enabled: true,
  };
}

function editorFrom(t: EmailTemplate): EditorState {
  return {
    mode: "edit",
    id: t.id,
    key: t.key,
    name: t.name,
    category: t.category ?? "",
    description: t.description ?? "",
    subjectTemplate: t.subject_template,
    htmlBodyTemplate: t.html_body_template,
    enabled: t.enabled,
  };
}

export interface EmailTemplatesPanelProps {
  /** Whether the current user may create/edit/delete/test-send. */
  canWrite: boolean;
}

type Msg = { kind: "success" | "error"; text: string } | null;

export function EmailTemplatesPanel({ canWrite }: EmailTemplatesPanelProps) {
  const [rows, setRows] = useState<Row[]>([]);
  const [tags, setTags] = useState<MergeTag[]>([]);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  const [editor, setEditor] = useState<EditorState | null>(null);
  const [saving, setSaving] = useState(false);

  const [preview, setPreview] = useState<RenderedEmail | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const [testOpen, setTestOpen] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [sending, setSending] = useState(false);

  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, tagList] = await Promise.all([
        emailTemplatesApi.list(),
        emailTemplatesApi.tags().catch(() => ({ tags: [] as MergeTag[] })),
      ]);
      setRows(list.templates.map((t) => ({ ...t, _key: t.id })));
      setTags(tagList.tags);
    } catch {
      setMsg({ kind: "error", text: "Failed to load email templates." });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Insert a merge tag at the textarea cursor (or append if not focused).
  function insertTag(tag: string) {
    if (!editor) return;
    const el = bodyRef.current;
    if (!el) {
      setEditor({ ...editor, htmlBodyTemplate: editor.htmlBodyTemplate + tag });
      return;
    }
    const start = el.selectionStart ?? editor.htmlBodyTemplate.length;
    const end = el.selectionEnd ?? start;
    const next = editor.htmlBodyTemplate.slice(0, start) + tag + editor.htmlBodyTemplate.slice(end);
    setEditor({ ...editor, htmlBodyTemplate: next });
    // restore caret after the inserted tag on next tick
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + tag.length;
      el.setSelectionRange(pos, pos);
    });
  }

  async function handleSave() {
    if (!editor) return;
    if (!editor.key.trim() || !editor.name.trim() || !editor.subjectTemplate.trim() || !editor.htmlBodyTemplate.trim()) {
      setMsg({ kind: "error", text: "Key, name, subject and HTML body are required." });
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      const payload: CreateEmailTemplatePayload = {
        key: editor.key.trim(),
        name: editor.name.trim(),
        category: editor.category.trim() || null,
        description: editor.description.trim() || null,
        subjectTemplate: editor.subjectTemplate,
        htmlBodyTemplate: editor.htmlBodyTemplate,
        enabled: editor.enabled,
      };
      if (editor.mode === "create") {
        await emailTemplatesApi.create(payload);
        setMsg({ kind: "success", text: `Created "${editor.name}".` });
      } else {
        const { key: _omit, ...rest } = payload;
        void _omit;
        await emailTemplatesApi.update(editor.id!, rest);
        setMsg({ kind: "success", text: `Updated "${editor.name}".` });
      }
      setEditor(null);
      setPreview(null);
      await load();
    } catch (e: unknown) {
      const err = e as { status?: number; body?: { error?: string; detail?: string } };
      const detail =
        (err?.status === 409 ? "A template with that key already exists." : null) ??
        err?.body?.detail ?? err?.body?.error ?? "Save failed.";
      setMsg({ kind: "error", text: detail });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(r: Row) {
    if (!window.confirm(`Delete email template "${r.name}"? This cannot be undone.`)) return;
    try {
      await emailTemplatesApi.remove(r.id);
      setMsg({ kind: "success", text: `Deleted "${r.name}".` });
      await load();
    } catch {
      setMsg({ kind: "error", text: "Delete failed." });
    }
  }

  // Preview uses the SAVED template; prompt to save first if editing unsaved.
  async function handlePreview(id: string) {
    setPreviewing(true);
    setPreview(null);
    try {
      const res = await emailTemplatesApi.preview(id);
      setPreview(res.rendered);
    } catch {
      setMsg({ kind: "error", text: "Preview failed (save the template first)." });
    } finally {
      setPreviewing(false);
    }
  }

  async function handleTestSend(id: string) {
    if (!testTo.trim()) { setMsg({ kind: "error", text: "Enter a recipient email." }); return; }
    setSending(true);
    try {
      const res = await emailTemplatesApi.testSend(id, testTo.trim());
      setMsg({ kind: "success", text: `Test email sent to ${res.sentTo}.` });
      setTestOpen(false);
      setTestTo("");
    } catch (e: unknown) {
      const err = e as { body?: { detail?: string; error?: string } };
      setMsg({ kind: "error", text: err?.body?.detail ?? err?.body?.error ?? "Test send failed." });
    } finally {
      setSending(false);
    }
  }

  const cols: Column<Row>[] = [
    {
      key: "name", header: "Template", sortable: true,
      render: (r) => (
        <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontWeight: 600, color: "var(--mist)" }}>{r.name}</span>
          <span className="mono" style={{ fontSize: 10, color: "var(--sil)" }}>{r.key}</span>
        </span>
      ),
    },
    {
      key: "category", header: "Category", width: 140,
      render: (r) => (r.category ? <Tag variant="blue">{r.category}</Tag> : <span style={{ color: "var(--sil)" }}>—</span>),
    },
    { key: "subject_template", header: "Subject", render: (r) => <span style={{ color: "var(--sil)", fontSize: 12 }}>{r.subject_template}</span> },
    {
      key: "enabled", header: "Status", width: 90,
      render: (r) => (r.enabled ? <Tag variant="green">Enabled</Tag> : <Tag variant="amber">Disabled</Tag>),
    },
    {
      key: "_actions", header: "Actions", width: 230,
      render: (r) => (
        <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <button className="btn bs" style={{ fontSize: 11, padding: "3px 8px" }} onClick={() => { setPreview(null); handlePreview(r.id); }}>Preview</button>
          {canWrite && <button className="btn bs" style={{ fontSize: 11, padding: "3px 8px" }} onClick={() => { setEditor(editorFrom(r)); setPreview(null); }}>Edit</button>}
          {canWrite && <button className="btn bs" style={{ fontSize: 11, padding: "3px 8px" }} onClick={() => { setEditor(editorFrom(r)); setTestOpen(true); }}>Test send</button>}
          {canWrite && <button className="btn bx" style={{ fontSize: 11, padding: "3px 8px" }} onClick={() => handleDelete(r)}>Delete</button>}
        </span>
      ),
    },
  ];

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={{ fontSize: 12, color: "var(--sil)" }}>
          {rows.length} template{rows.length === 1 ? "" : "s"} · merge tags expand to live document links
        </div>
        {canWrite && (
          <button className="btn bg" onClick={() => { setEditor(blankEditor()); setPreview(null); }}>+ New Template</button>
        )}
      </div>

      {msg && (
        <div style={{
          padding: "8px 12px", borderRadius: 6, fontSize: 12, marginBottom: 12,
          background: msg.kind === "success" ? "var(--GT)" : "var(--RT)",
          border: `1px solid ${msg.kind === "success" ? "rgba(46,204,138,.3)" : "rgba(224,82,82,.3)"}`,
          color: msg.kind === "success" ? "var(--Gtx)" : "var(--Rtx)",
        }}>
          {msg.text}
        </div>
      )}

      <Card title="Email Templates">
        {loading ? (
          <div style={{ padding: 28, textAlign: "center", color: "var(--sil)", fontSize: 12 }}>Loading…</div>
        ) : (
          <DataTable columns={cols} rows={rows} rowKey={(r) => r._key} emptyMessage="No email templates yet" pageSize={10} />
        )}
      </Card>

      {/* Standalone preview (from list "Preview" action) */}
      {preview && !editor && (
        <Card title="Preview" style={{ marginTop: 14 }} action={<button className="btn bs" style={{ fontSize: 11 }} onClick={() => setPreview(null)}>Close</button>}>
          <PreviewPane rendered={preview} loading={previewing} />
        </Card>
      )}

      {/* Editor modal */}
      {editor && (
        <Modal open onClose={() => !saving && setEditor(null)} title={editor.mode === "create" ? "New Email Template" : `Edit "${editor.name}"`} width={820}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <FormField label="Name *" placeholder="KYC Expiry Notice" value={editor.name} onChange={(e) => setEditor({ ...editor, name: e.target.value })} />
            <FormField
              label="Key *"
              placeholder="kyc_expiry"
              value={editor.key}
              disabled={editor.mode === "edit"}
              hint={editor.mode === "edit" ? "Key is immutable" : "lowercase, digits, underscores"}
              onChange={(e) => setEditor({ ...editor, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })}
            />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 10 }}>
            <FormField label="Category" placeholder="Compliance" value={editor.category} onChange={(e) => setEditor({ ...editor, category: e.target.value })} />
            <FormField as="select" label="Status" value={editor.enabled ? "on" : "off"} onChange={(e) => setEditor({ ...editor, enabled: e.target.value === "on" })}>
              <option value="on">Enabled</option>
              <option value="off">Disabled</option>
            </FormField>
          </div>

          <div style={{ marginTop: 10 }}>
            <FormField label="Subject *" placeholder="Action required: {{doc.title}} expiring" value={editor.subjectTemplate} onChange={(e) => setEditor({ ...editor, subjectTemplate: e.target.value })} />
          </div>

          {/* Merge-tag palette */}
          {tags.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--sil)", marginBottom: 6 }}>Insert merge tag</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {tags.map((t) => (
                  <button
                    key={t.tag}
                    type="button"
                    title={`${t.label} — e.g. ${t.example}`}
                    onClick={() => insertTag(t.tag)}
                    className="mono"
                    style={{ fontSize: 10.5, padding: "3px 8px", borderRadius: 6, border: "1px solid var(--bd)", background: "var(--ink3)", color: "var(--Btx)", cursor: "pointer" }}
                  >
                    {t.tag}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div style={{ marginTop: 12 }}>
            <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "var(--mist)", marginBottom: 6 }}>HTML Body *</label>
            <textarea
              ref={bodyRef}
              rows={12}
              value={editor.htmlBodyTemplate}
              onChange={(e) => setEditor({ ...editor, htmlBodyTemplate: e.target.value })}
              spellCheck={false}
              style={{ width: "100%", boxSizing: "border-box", fontFamily: "monospace", fontSize: 12, padding: 10, border: "1px solid var(--bd)", borderRadius: 8, background: "var(--ink2)", color: "var(--mist)", resize: "vertical" }}
            />
            <div style={{ fontSize: 10.5, color: "var(--sil)", marginTop: 4 }}>
              Use tags like <span className="mono">{"{{doc.link}}"}</span> — they expand to a clickable link that opens the document in ZorDMS.
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginTop: 16 }}>
            <div>
              {editor.mode === "edit" && (
                <button className="btn bs" disabled={previewing} onClick={() => handlePreview(editor.id!)}>{previewing ? "Rendering…" : "Preview saved"}</button>
              )}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn bs" onClick={() => setEditor(null)} disabled={saving}>Cancel</button>
              <button className="btn bg" onClick={handleSave} disabled={saving || !canWrite}>{saving ? "Saving…" : "Save"}</button>
            </div>
          </div>

          {preview && editor.mode === "edit" && (
            <div style={{ marginTop: 14, borderTop: "1px solid var(--bd)", paddingTop: 12 }}>
              <PreviewPane rendered={preview} loading={previewing} />
            </div>
          )}
        </Modal>
      )}

      {/* Test-send modal */}
      {testOpen && editor && (
        <Modal open onClose={() => !sending && setTestOpen(false)} title={`Test send "${editor.name}"`} width={460}>
          <p style={{ fontSize: 12.5, color: "var(--sil)", margin: "0 0 14px" }}>
            Renders the saved template with sample data and emails one recipient via the live SMTP pipeline.
          </p>
          <FormField label="Recipient email" type="email" placeholder="you@zorfinotech.com" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
            <button className="btn bs" onClick={() => setTestOpen(false)} disabled={sending}>Cancel</button>
            <button className="btn bg" onClick={() => handleTestSend(editor.id!)} disabled={sending}>{sending ? "Sending…" : "Send test"}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function PreviewPane({ rendered, loading }: { rendered: RenderedEmail; loading: boolean }) {
  if (loading) return <div style={{ padding: 16, color: "var(--sil)", fontSize: 12 }}>Rendering…</div>;
  return (
    <div>
      <div style={{ fontSize: 11, color: "var(--sil)", marginBottom: 4 }}>Subject</div>
      <div style={{ fontWeight: 600, color: "var(--mist)", marginBottom: 12 }}>{rendered.subject}</div>
      <div style={{ fontSize: 11, color: "var(--sil)", marginBottom: 4 }}>Rendered HTML</div>
      <iframe
        title="email-preview"
        srcDoc={rendered.html}
        style={{ width: "100%", height: 320, border: "1px solid var(--bd)", borderRadius: 8, background: "#fff" }}
      />
    </div>
  );
}
