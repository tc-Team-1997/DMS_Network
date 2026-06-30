import { useEffect, useState, useCallback } from "react";
import { useAuth } from "../auth/AuthContext.js";
import { reportsApi, type ReportSource, type RunResult, type ReportDefinition } from "../api/reportsApi.js";

/**
 * Reports — report builder + saved library + CSV export, on the core report
 * engine (built this session). Pick a source + group-by columns, run, save,
 * export. No mock data.
 */
export function Reports() {
  const { user } = useAuth();
  const canManage = !!user?.permissions.includes("admin:access");

  const [sources, setSources] = useState<ReportSource[]>([]);
  const [source, setSource] = useState<string>("");
  const [groupBy, setGroupBy] = useState<string[]>([]);
  const [result, setResult] = useState<RunResult | null>(null);
  const [library, setLibrary] = useState<ReportDefinition[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const refreshLibrary = useCallback(async () => {
    try { setLibrary(await reportsApi.listLibrary()); } catch (e: any) { setError(String(e?.message ?? e)); }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const s = await reportsApi.getSources();
        setSources(s);
        if (s[0]) setSource(s[0].source);
      } catch (e: any) { setError(String(e?.message ?? e)); }
    })();
    void refreshLibrary();
  }, [refreshLibrary]);

  const current = sources.find((s) => s.source === source);

  function toggleCol(col: string) {
    setGroupBy((prev) => (prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]));
  }

  async function run() {
    setError(null);
    try {
      setResult(await reportsApi.runReport({ source, group_by: groupBy, measures: [{ fn: "count", alias: "count" }] }));
    } catch (e: any) { setError(String(e?.message ?? e)); }
  }

  async function save() {
    setError(null);
    try {
      await reportsApi.saveReport({ name: name.trim() || `${source} report`, source, group_by: groupBy, measures: [{ fn: "count", alias: "count" }] });
      setName("");
      await refreshLibrary();
    } catch (e: any) { setError(String(e?.message ?? e)); }
  }

  async function runSaved(def: ReportDefinition) {
    setError(null);
    try {
      setSource(def.source);
      setGroupBy(def.groupBy);
      setResult(await reportsApi.runReport({ source: def.source, group_by: def.groupBy, measures: def.measures, filters: def.filters }));
    } catch (e: any) { setError(String(e?.message ?? e)); }
  }

  return (
    <div style={{ padding: 32 }}>
      <h2>Reports</h2>
      <p style={{ color: "var(--muted)" }}>Build, save and export aggregate reports over documents, jobs and customers.</p>
      {error && <div role="alert" style={{ color: "var(--danger, #c0392b)", marginTop: 8 }}>{error}</div>}

      {/* Builder */}
      <section style={{ marginTop: 16 }}>
        <h3>Builder</h3>
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <label>Source{" "}
            <select className="field" aria-label="source" value={source} onChange={(e) => { setSource(e.target.value); setGroupBy([]); setResult(null); }}>
              {sources.map((s) => <option key={s.source} value={s.source}>{s.source}</option>)}
            </select>
          </label>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {current?.groupable.map((col) => (
              <label key={col} style={{ fontSize: 12 }}>
                <input type="checkbox" aria-label={`group by ${col}`} checked={groupBy.includes(col)} onChange={() => toggleCol(col)} /> {col}
              </label>
            ))}
          </div>
          <button className="btn-primary" style={{ width: 110 }} onClick={run}>Run</button>
          {canManage && (
            <>
              <input className="field" style={{ width: 180 }} placeholder="report name" value={name} onChange={(e) => setName(e.target.value)} aria-label="report name" />
              <button className="btn bs" onClick={save} aria-label="save report">Save</button>
            </>
          )}
        </div>
      </section>

      {/* Result */}
      {result && (
        <section style={{ marginTop: 24 }}>
          <h3>Result</h3>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>{result.columns.map((c) => <th key={c} style={{ textAlign: "left", padding: 8 }}>{c}</th>)}</tr></thead>
            <tbody>
              {result.rows.map((row, i) => (
                <tr key={i} style={{ borderTop: "1px solid var(--line)" }}>
                  {result.columns.map((c) => <td key={c} style={{ padding: 8 }}>{String(row[c] ?? "")}</td>)}
                </tr>
              ))}
              {result.rows.length === 0 && <tr><td colSpan={result.columns.length} style={{ padding: 16, textAlign: "center", color: "var(--sil)" }}>No rows</td></tr>}
            </tbody>
          </table>
        </section>
      )}

      {/* Library */}
      <section style={{ marginTop: 24 }}>
        <h3>Saved reports</h3>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th style={{ textAlign: "left", padding: 8 }}>Name</th><th style={{ textAlign: "left", padding: 8 }}>Source</th><th style={{ textAlign: "left", padding: 8 }}>Group by</th><th style={{ padding: 8 }}></th></tr></thead>
          <tbody>
            {library.map((d) => (
              <tr key={d.id} style={{ borderTop: "1px solid var(--line)" }}>
                <td style={{ padding: 8 }}>{d.name}</td>
                <td style={{ padding: 8 }}>{d.source}</td>
                <td style={{ padding: 8, fontFamily: "monospace", fontSize: 12 }}>{d.groupBy.join(", ") || "—"}</td>
                <td style={{ padding: 8, display: "flex", gap: 6 }}>
                  <button className="btn bs xs" onClick={() => runSaved(d)} aria-label={`run ${d.name}`}>Run</button>
                  <button className="btn bs xs" onClick={() => reportsApi.exportReport(d.id, d.name).catch((e) => setError(String(e?.message ?? e)))} aria-label={`export ${d.name}`}>Export CSV</button>
                  {canManage && <button className="btn bs xs" onClick={() => reportsApi.deleteReport(d.id).then(refreshLibrary).catch((e) => setError(String(e?.message ?? e)))} aria-label={`delete ${d.name}`}>Delete</button>}
                </td>
              </tr>
            ))}
            {library.length === 0 && <tr><td colSpan={4} style={{ padding: 16, textAlign: "center", color: "var(--sil)" }}>No saved reports</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  );
}

export default Reports;
