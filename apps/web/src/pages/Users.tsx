import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthContext.js";
import { api } from "../api/client.js";

interface Row { id: number; username: string; full_name?: string; branch?: string; status: string; }
const ROLES = ["CDO", "Supervisor", "Maker", "Checker", "Indexer", "Viewer", "Auditor"];

export function Users() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [form, setForm] = useState({ username: "", password: "", role: "Maker" });
  const canCreate = user?.permissions.includes("user:create");

  async function refresh() { setRows((await api.get("/users")).users); }
  useEffect(() => { refresh(); }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    await api.post("/users", { username: form.username, password: form.password, roles: [form.role] });
    setForm({ username: "", password: "", role: "Maker" });
    await refresh();
  }

  return (
    <div style={{ padding: 32 }}>
      <h2>User Management</h2>
      <p style={{ color: "var(--muted)" }}>Supervisors can add an unlimited number of users — access is governed by RBAC.</p>
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 16 }}>
        <thead><tr><th style={{ textAlign: "left", padding: 8 }}>User</th><th style={{ textAlign: "left", padding: 8 }}>Branch</th><th style={{ textAlign: "left", padding: 8 }}>Status</th></tr></thead>
        <tbody>{rows.map((r) => (<tr key={r.id} style={{ borderTop: "1px solid var(--line)" }}><td style={{ padding: 8 }}>{r.username}</td><td style={{ padding: 8 }}>{r.branch ?? "—"}</td><td style={{ padding: 8 }}>{r.status}</td></tr>))}</tbody>
      </table>

      {canCreate && (
        <form onSubmit={create} style={{ marginTop: 24, display: "flex", gap: 8, flexWrap: "wrap", maxWidth: 640 }}>
          <input className="field" style={{ width: 180 }} placeholder="username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          <input className="field" style={{ width: 180 }} type="password" placeholder="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <select className="field" style={{ width: 160 }} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select>
          <button className="btn-primary" style={{ width: 140 }}>Add user</button>
        </form>
      )}
    </div>
  );
}
