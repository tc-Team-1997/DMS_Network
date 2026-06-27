/**
 * ConnectorsPanel — admin management of integration connectors (config-driven).
 *
 * Lists the connected systems (CBS/BANCS, LOS, KYC, Active Directory, …) and
 * lets an operator point each at a real endpoint, choose its auth type, rotate
 * its secret, enable/disable it, and run a live test — all without code/env
 * changes. Backed by integration_config via /integration/systems.
 */
import { useCallback, useEffect, useState } from "react";
import { Card, DataTable, Tag, Modal, FormField } from "../ui/index.js";
import type { Column } from "../ui/index.js";
import { integrationHubApi, type ConnectedSystem } from "../../api/integrationHub.js";

type Row = ConnectedSystem & { _key: string };
type Msg = { kind: "success" | "error"; text: string } | null;

interface EditorState {
  system: string;
  base_url: string;
  auth_type: "none" | "bearer" | "hmac" | "basic";
  enabled: boolean;
  secret: string;
}

export function ConnectorsPanel({ canWrite }: { canWrite: boolean }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<Msg>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await integrationHubApi.getSystems();
      setRows(res.systems.map((s) => ({ ...s, _key: s.system })));
    } catch {
      setMsg({ kind: "error", text: "Failed to load connectors." });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!editor) return;
    setSaving(true);
    setMsg(null);
    try {
      await integrationHubApi.upsertConnector(editor.system, {
        base_url: editor.base_url.trim() || null,
        auth_type: editor.auth_type,
        enabled: editor.enabled,
        ...(editor.secret.trim() ? { secret: editor.secret.trim() } : {}),
      });
      setMsg({ kind: "success", text: `Saved "${editor.system}".` });
      setEditor(null);
      await load();
    } catch (e: unknown) {
      const err = e as { body?: { error?: string } };
      setMsg({ kind: "error", text: err?.body?.error ?? "Save failed." });
    } finally {
      setSaving(false);
    }
  }

  async function test(system: string) {
    setTesting(system);
    setMsg(null);
    try {
      const r = await integrationHubApi.testConnector(system);
      const where = r.mode === "live" ? `live (${r.baseUrl})` : "mock (no endpoint configured)";
      setMsg({
        kind: r.ok ? "success" : "error",
        text: `${system}: ${r.ok ? "reachable" : "unreachable"} — ${where}${r.error ? ` · ${r.error}` : ""}`,
      });
    } catch {
      setMsg({ kind: "error", text: `${system}: test failed.` });
    } finally {
      setTesting(null);
    }
  }

  const cols: Column<Row>[] = [
    {
      key: "system", header: "Connector", sortable: true,
      render: (r) => <span className="mono" style={{ fontWeight: 700 }}>{r.system}</span>,
    },
    {
      key: "base_url", header: "Endpoint",
      render: (r) => r.base_url
        ? <span className="mono" style={{ fontSize: 11, color: "var(--sil)" }}>{r.base_url}</span>
        : <Tag variant="amber">mock</Tag>,
    },
    {
      key: "status", header: "Status", width: 110,
      render: (r) =>
        !r.enabled ? <Tag variant="amber">disabled</Tag>
        : r.status === "down" ? <Tag variant="red">down</Tag>
        : <Tag variant="green">up</Tag>,
    },
    {
      key: "recentErrors", header: "Errors", width: 80,
      render: (r) => <span style={{ color: r.recentErrors ? "var(--Rtx)" : "var(--sil)" }}>{r.recentErrors}</span>,
    },
    {
      key: "_actions", header: "Actions", width: 200,
      render: (r) => (
        <span style={{ display: "flex", gap: 6 }}>
          <button className="btn bs" style={{ fontSize: 11, padding: "3px 8px" }} disabled={testing === r.system} onClick={() => test(r.system)}>
            {testing === r.system ? "…" : "Test"}
          </button>
          {canWrite && (
            <button
              className="btn bs"
              style={{ fontSize: 11, padding: "3px 8px" }}
              onClick={() => setEditor({ system: r.system, base_url: r.base_url ?? "", auth_type: "none", enabled: r.enabled, secret: "" })}
            >
              Configure
            </button>
          )}
        </span>
      ),
    },
  ];

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: 12, color: "var(--sil)", marginBottom: 12 }}>
        Connectors are config-driven — point a system (e.g. <b>cbs</b> at BANCS or a new GBP version) at a real
        endpoint here; with no endpoint it runs in safe mock mode.
      </div>

      {msg && (
        <div style={{
          padding: "8px 12px", borderRadius: 6, fontSize: 12, marginBottom: 12,
          background: msg.kind === "success" ? "var(--GT)" : "var(--RT)",
          border: `1px solid ${msg.kind === "success" ? "rgba(46,204,138,.3)" : "rgba(224,82,82,.3)"}`,
          color: msg.kind === "success" ? "var(--Gtx)" : "var(--Rtx)",
        }}>{msg.text}</div>
      )}

      <Card title="Integration Connectors">
        {loading ? (
          <div style={{ padding: 24, textAlign: "center", color: "var(--sil)", fontSize: 12 }}>Loading…</div>
        ) : (
          <DataTable columns={cols} rows={rows} rowKey={(r) => r._key} emptyMessage="No connectors configured" />
        )}
      </Card>

      {editor && (
        <Modal open onClose={() => !saving && setEditor(null)} title={`Configure "${editor.system}"`} width={560}>
          <FormField
            label="Endpoint base URL"
            placeholder="https://bancs.bank.internal/api/v2"
            value={editor.base_url}
            hint="Leave blank to run in mock mode. Switching a CBS version = change this URL."
            onChange={(e) => setEditor({ ...editor, base_url: (e.target as HTMLInputElement).value })}
          />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <FormField as="select" label="Auth type" value={editor.auth_type} onChange={(e) => setEditor({ ...editor, auth_type: (e.target as HTMLSelectElement).value as EditorState["auth_type"] })}>
              <option value="none">None</option>
              <option value="bearer">Bearer token</option>
              <option value="hmac">HMAC</option>
              <option value="basic">Basic</option>
            </FormField>
            <FormField as="select" label="Status" value={editor.enabled ? "on" : "off"} onChange={(e) => setEditor({ ...editor, enabled: (e.target as HTMLSelectElement).value === "on" })}>
              <option value="on">Enabled</option>
              <option value="off">Disabled</option>
            </FormField>
          </div>
          <FormField
            label="Secret / token (write-only)"
            type="password"
            placeholder="leave blank to keep current"
            value={editor.secret}
            hint="Stored securely and never displayed. Blank keeps the existing secret."
            onChange={(e) => setEditor({ ...editor, secret: (e.target as HTMLInputElement).value })}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
            <button className="btn bs" onClick={() => setEditor(null)} disabled={saving}>Cancel</button>
            <button className="btn bg" onClick={save} disabled={saving || !canWrite}>{saving ? "Saving…" : "Save connector"}</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
