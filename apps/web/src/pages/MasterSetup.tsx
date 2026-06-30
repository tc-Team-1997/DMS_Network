import { useEffect, useState, useCallback, type FormEvent } from "react";
import { useAuth } from "../auth/AuthContext.js";
import { departmentsApi, type Department } from "../api/departmentsApi.js";

/**
 * SC-19 Master Setup — master-data CRUD. Departments is the entity that lacked a
 * UI (branches → Branch Network, doc-types → System Admin, workflows → Workflow
 * Engine), so this page owns Departments on the core /departments backend (built
 * this session) and links out to the existing master screens. No mock data.
 */
const LINKS: Array<{ label: string; path: string }> = [
  { label: "Branches → Branch Network", path: "/branch-network" },
  { label: "Document Types → System Administration", path: "/system-administration" },
  { label: "Workflows → Workflow Engine", path: "/workflow-engine" },
];

export function MasterSetup() {
  const { user } = useAuth();
  const canEdit = !!user?.permissions.includes("admin:access");

  const [depts, setDepts] = useState<Department[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ code: "", name: "", head: "", branch: "" });

  const refresh = useCallback(async () => {
    try { setDepts(await departmentsApi.listDepartments()); }
    catch (e: any) { setError(String(e?.message ?? e)); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await departmentsApi.createDepartment({
        code: form.code.trim(),
        name: form.name.trim(),
        head: form.head.trim() || undefined,
        branch: form.branch.trim() || undefined,
      });
      setForm({ code: "", name: "", head: "", branch: "" });
      await refresh();
    } catch (e: any) { setError(String(e?.message ?? e)); }
  }

  async function remove(d: Department) {
    setError(null);
    try { await departmentsApi.deleteDepartment(d.id); await refresh(); }
    catch (e: any) { setError(String(e?.message ?? e)); }
  }

  return (
    <div style={{ padding: 32 }}>
      <h2>Master Setup</h2>
      <p style={{ color: "var(--muted)" }}>Organizational master data. Departments are managed here; other master entities link out.</p>
      {error && <div role="alert" style={{ color: "var(--danger, #c0392b)", marginTop: 8 }}>{error}</div>}

      <section style={{ marginTop: 16 }}>
        <h3>Departments</h3>
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
          <thead>
            <tr>
              {["Code", "Name", "Head", "Branch", "Status", ...(canEdit ? [""] : [])].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: 8 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {depts.map((d) => (
              <tr key={d.id} style={{ borderTop: "1px solid var(--line)" }}>
                <td style={{ padding: 8, fontFamily: "monospace", fontSize: 12 }}>{d.code}</td>
                <td style={{ padding: 8 }}>{d.name}</td>
                <td style={{ padding: 8 }}>{d.head ?? "—"}</td>
                <td style={{ padding: 8 }}>{d.branch ?? "—"}</td>
                <td style={{ padding: 8 }}>{d.status}</td>
                {canEdit && (
                  <td style={{ padding: 8 }}>
                    <button className="btn bs xs" onClick={() => remove(d)} aria-label={`delete ${d.code}`}>Delete</button>
                  </td>
                )}
              </tr>
            ))}
            {depts.length === 0 && <tr><td colSpan={canEdit ? 6 : 5} style={{ padding: 16, textAlign: "center", color: "var(--sil)" }}>No departments</td></tr>}
          </tbody>
        </table>

        {canEdit && (
          <form onSubmit={create} style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap", maxWidth: 760, alignItems: "center" }}>
            <input className="field" style={{ width: 120 }} placeholder="code" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} aria-label="code" required />
            <input className="field" style={{ width: 200 }} placeholder="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-label="name" required />
            <input className="field" style={{ width: 140 }} placeholder="head (optional)" value={form.head} onChange={(e) => setForm({ ...form, head: e.target.value })} aria-label="head" />
            <input className="field" style={{ width: 120 }} placeholder="branch (optional)" value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} aria-label="branch" />
            <button className="btn-primary" style={{ width: 150 }}>Add department</button>
          </form>
        )}
      </section>

      <section style={{ marginTop: 28 }}>
        <h3>Other master data</h3>
        <ul style={{ color: "var(--sil)", fontSize: 13, lineHeight: 1.9 }}>
          {LINKS.map((l) => <li key={l.path}><a href={l.path}>{l.label}</a></li>)}
        </ul>
      </section>
    </div>
  );
}

export default MasterSetup;
