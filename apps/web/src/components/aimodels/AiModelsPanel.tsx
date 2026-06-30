import { useCallback, useEffect, useState } from "react";
import { Card } from "../ui/index.js";
import { aiConfigApi, type AiFeature } from "../../api/aiConfigApi.js";

/**
 * AiModelsPanel — AI model/feature management (SC-18) inside System
 * Administration. Lists the AI features with their enable toggle, tunable
 * confidence threshold, and latest accuracy/throughput metric, on the core
 * /ai-config backend (built this session). RBAC-gated by the parent.
 */
export function AiModelsPanel({ canWrite }: { canWrite: boolean }) {
  const [features, setFeatures] = useState<AiFeature[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try { setFeatures(await aiConfigApi.listFeatures()); }
    catch (e: any) { setError(String(e?.message ?? e)); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function toggle(f: AiFeature) {
    setBusy(f.featureKey); setError(null);
    try { await aiConfigApi.setFeature(f.featureKey, { enabled: !f.enabled }); await refresh(); }
    catch (e: any) { setError(String(e?.message ?? e)); }
    finally { setBusy(null); }
  }

  async function saveThreshold(f: AiFeature) {
    const raw = edits[f.featureKey];
    const n = raw === "" ? null : Number(raw);
    if (n !== null && (Number.isNaN(n) || n < 0 || n > 1)) { setError(`threshold for ${f.featureKey} must be 0–1`); return; }
    setBusy(f.featureKey); setError(null);
    try {
      await aiConfigApi.setFeature(f.featureKey, { threshold: n });
      setEdits((p) => { const x = { ...p }; delete x[f.featureKey]; return x; });
      await refresh();
    } catch (e: any) { setError(String(e?.message ?? e)); }
    finally { setBusy(null); }
  }

  return (
    <Card title="AI Models & Features">
      {error && <div role="alert" style={{ color: "var(--R, #c0392b)", marginBottom: 8 }}>{error}</div>}
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {["Feature", "Enabled", "Threshold", "Accuracy", "Throughput", ...(canWrite ? [""] : [])].map((h) => (
              <th key={h} style={{ textAlign: "left", padding: 8 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {features.map((f) => {
            const thrEditing = f.featureKey in edits;
            const thrValue = thrEditing ? edits[f.featureKey] : (f.threshold ?? "").toString();
            return (
              <tr key={f.featureKey} style={{ borderTop: "1px solid var(--line)" }}>
                <td style={{ padding: 8 }}>{f.name}<div style={{ fontSize: 11, color: "var(--sil)", fontFamily: "monospace" }}>{f.featureKey}</div></td>
                <td style={{ padding: 8 }}>{f.enabled ? "Yes" : "No"}</td>
                <td style={{ padding: 8 }}>
                  {canWrite ? (
                    <input className="field" aria-label={`threshold for ${f.featureKey}`} style={{ width: 80, fontSize: 12 }}
                      value={thrValue} placeholder="—"
                      onChange={(e) => setEdits((p) => ({ ...p, [f.featureKey]: e.target.value }))} />
                  ) : (f.threshold ?? "—")}
                </td>
                <td style={{ padding: 8 }}>{f.latestMetric?.accuracy != null ? `${(f.latestMetric.accuracy * 100).toFixed(0)}%` : "—"}</td>
                <td style={{ padding: 8 }}>{f.latestMetric?.throughput ?? "—"}</td>
                {canWrite && (
                  <td style={{ padding: 8, display: "flex", gap: 6 }}>
                    <button className="btn bs xs" disabled={busy === f.featureKey} onClick={() => toggle(f)} aria-label={`toggle ${f.featureKey}`}>{f.enabled ? "Disable" : "Enable"}</button>
                    <button className="btn bs xs" disabled={!thrEditing || busy === f.featureKey} onClick={() => saveThreshold(f)} aria-label={`save threshold ${f.featureKey}`}>Save</button>
                  </td>
                )}
              </tr>
            );
          })}
          {features.length === 0 && <tr><td colSpan={canWrite ? 6 : 5} style={{ padding: 16, textAlign: "center", color: "var(--sil)" }}>No AI features</td></tr>}
        </tbody>
      </table>
    </Card>
  );
}

export default AiModelsPanel;
