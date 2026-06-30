import { useEffect, useState, useCallback } from "react";
import { useAuth } from "../auth/AuthContext.js";
import { configApi, parseConfigValue, type ConfigEntry } from "../api/configApi.js";

/**
 * SC-14 Configuration — institution/AI/upload settings persisted via the core
 * `system_config` store. Read for admins; edit gated on `admin:access`. Values
 * are JSON (numbers/booleans/arrays/objects) and round-trip through the API.
 */
function fmt(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

export function Configuration() {
  const { user } = useAuth();
  const canEdit = !!user?.permissions.includes("admin:access");

  const [entries, setEntries] = useState<ConfigEntry[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setEntries(await configApi.listConfig());
    } catch (e: any) {
      setError(String(e?.message ?? e));
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  async function save(key: string) {
    setSaving(key);
    setError(null);
    setSavedKey(null);
    try {
      const raw = edits[key];
      const updated = await configApi.setConfig(key, parseConfigValue(raw));
      setEntries((prev) => prev.map((e) => (e.key === key ? updated : e)));
      setEdits((prev) => { const n = { ...prev }; delete n[key]; return n; });
      setSavedKey(key);
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setSaving(null);
    }
  }

  // Group by category for a tidy layout.
  const byCategory = entries.reduce<Record<string, ConfigEntry[]>>((acc, e) => {
    const c = e.category ?? "general";
    (acc[c] ??= []).push(e);
    return acc;
  }, {});

  return (
    <div style={{ padding: 32 }}>
      <h2>Configuration</h2>
      <p style={{ color: "var(--muted)" }}>
        Runtime settings — AI thresholds, upload limits, formats. Changes are audited and apply across the app.
      </p>
      {error && <div role="alert" style={{ color: "var(--danger, #c0392b)", marginTop: 8 }}>{error}</div>}

      {Object.keys(byCategory).sort().map((cat) => (
        <section key={cat} style={{ marginTop: 24 }}>
          <h3 style={{ textTransform: "capitalize" }}>{cat}</h3>
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: 8 }}>Key</th>
                <th style={{ textAlign: "left", padding: 8 }}>Value</th>
                <th style={{ textAlign: "left", padding: 8 }}>Description</th>
                {canEdit && <th style={{ padding: 8 }}></th>}
              </tr>
            </thead>
            <tbody>
              {byCategory[cat].map((e) => {
                const editing = e.key in edits;
                const current = editing ? edits[e.key] : fmt(e.value);
                return (
                  <tr key={e.key} style={{ borderTop: "1px solid var(--line)" }}>
                    <td style={{ padding: 8, fontFamily: "monospace", fontSize: 12 }}>{e.key}</td>
                    <td style={{ padding: 8 }}>
                      {canEdit ? (
                        <input
                          className="field"
                          aria-label={`value for ${e.key}`}
                          style={{ width: 240, fontFamily: "monospace", fontSize: 12 }}
                          value={current}
                          onChange={(ev) => setEdits((p) => ({ ...p, [e.key]: ev.target.value }))}
                        />
                      ) : (
                        <code style={{ fontSize: 12 }}>{fmt(e.value)}</code>
                      )}
                    </td>
                    <td style={{ padding: 8, color: "var(--sil)", fontSize: 12 }}>{e.description ?? "—"}</td>
                    {canEdit && (
                      <td style={{ padding: 8 }}>
                        <button
                          className="btn bs xs"
                          disabled={!editing || saving === e.key}
                          onClick={() => save(e.key)}
                          aria-label={`save ${e.key}`}
                        >
                          {saving === e.key ? "Saving…" : savedKey === e.key ? "Saved ✓" : "Save"}
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ))}

      {entries.length === 0 && !error && (
        <p style={{ color: "var(--sil)", marginTop: 16 }}>No configuration entries.</p>
      )}
    </div>
  );
}

export default Configuration;
