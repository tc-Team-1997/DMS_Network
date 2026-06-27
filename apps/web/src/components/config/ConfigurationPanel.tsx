/**
 * ConfigurationPanel — admin-editable dynamic platform settings.
 *
 * Centralises configuration that used to be hard-coded (retention defaults,
 * branch list, AI confidence threshold, auto folder routing) so operators can
 * tune the system without code/env changes. Persisted via /admin/settings.
 */
import { useCallback, useEffect, useState } from "react";
import { Card, FormField } from "../ui/index.js";
import { systemAdministrationApi, type PlatformSettings } from "../../api/systemAdministration.js";

type Msg = { kind: "success" | "error"; text: string } | null;

export function ConfigurationPanel({ canWrite }: { canWrite: boolean }) {
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [branchesText, setBranchesText] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { settings: s } = await systemAdministrationApi.getSettings();
      setSettings(s);
      setBranchesText(s.branches.join("\n"));
    } catch {
      setMsg({ kind: "error", text: "Failed to load configuration." });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!settings) return;
    setSaving(true);
    setMsg(null);
    try {
      const branches = branchesText.split("\n").map((b) => b.trim()).filter(Boolean);
      const { settings: updated } = await systemAdministrationApi.putSettings({ ...settings, branches });
      setSettings(updated);
      setBranchesText(updated.branches.join("\n"));
      setMsg({ kind: "success", text: "Configuration saved." });
    } catch (e: unknown) {
      const err = e as { body?: { errors?: string[]; detail?: string } };
      setMsg({ kind: "error", text: err?.body?.errors?.join("; ") ?? err?.body?.detail ?? "Save failed." });
    } finally {
      setSaving(false);
    }
  }

  if (loading || !settings) {
    return <div style={{ padding: 20, color: "var(--sil)", fontSize: 12 }}>Loading configuration…</div>;
  }

  return (
    <div style={{ marginTop: 14, maxWidth: 620 }}>
      {msg && (
        <div style={{
          padding: "8px 12px", borderRadius: 6, fontSize: 12, marginBottom: 12,
          background: msg.kind === "success" ? "var(--GT)" : "var(--RT)",
          border: `1px solid ${msg.kind === "success" ? "rgba(46,204,138,.3)" : "rgba(224,82,82,.3)"}`,
          color: msg.kind === "success" ? "var(--Gtx)" : "var(--Rtx)",
        }}>{msg.text}</div>
      )}

      <Card title="Platform Configuration">
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <FormField
              label="Default Retention (years)"
              type="number"
              value={String(settings.defaultRetentionYears)}
              disabled={!canWrite}
              hint="Applied when a document type defines no retention period."
              onChange={(e) => setSettings({ ...settings, defaultRetentionYears: Number((e.target as HTMLInputElement).value) })}
            />
            <FormField
              label="AI Confidence Threshold (0–1)"
              type="number"
              value={String(settings.aiConfidenceThreshold)}
              disabled={!canWrite}
              hint="Below this, captured docs are flagged for human review."
              onChange={(e) => setSettings({ ...settings, aiConfidenceThreshold: Number((e.target as HTMLInputElement).value) })}
            />
          </div>

          <FormField
            as="select"
            label="Auto Folder Routing"
            value={settings.autoFolderRouting ? "on" : "off"}
            disabled={!canWrite}
            hint="Route captured documents into the AI-suggested folder hierarchy automatically."
            onChange={(e) => setSettings({ ...settings, autoFolderRouting: (e.target as HTMLSelectElement).value === "on" })}
          >
            <option value="on">Enabled</option>
            <option value="off">Disabled</option>
          </FormField>

          <FormField
            as="textarea"
            label="Branches (one per line)"
            rows={6}
            value={branchesText}
            disabled={!canWrite}
            hint="Branch list used across capture, dashboard scoping and reporting."
            onChange={(e) => setBranchesText((e.target as HTMLTextAreaElement).value)}
          />

          {canWrite && (
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button className="btn bs" onClick={load} disabled={saving}>Reset</button>
              <button className="btn bg" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save configuration"}</button>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
