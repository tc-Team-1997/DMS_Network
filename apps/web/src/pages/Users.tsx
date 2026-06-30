import { useEffect, useState, useCallback, type FormEvent } from "react";
import { useAuth } from "../auth/AuthContext.js";
import { useUrlState } from "../hooks/useUrlState.js";
import { SVC } from "../config.js";
import { getToken } from "../api/client.js";
import { rolesApi, type Role } from "../api/rolesApi.js";

interface Row { id: number; username: string; full_name?: string; email?: string; branch?: string; status: string; }
const ROLES = ["CDO", "Supervisor", "Maker", "Checker", "Indexer", "Viewer", "Auditor"];
const PAGE_SIZE = 10;

async function apiGet(path: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { method: "GET", headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function apiPost(path: string, body: unknown) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export function Users() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [form, setForm] = useState({ username: "", password: "", role: "Maker" });
  const canCreate = user?.permissions.includes("user:create");
  const canManageRoles = !!user?.permissions.includes("role:assign");

  // Roles matrix (SC-16) — consolidated into User Management.
  const [roles, setRoles] = useState<Role[]>([]);
  const [roleForm, setRoleForm] = useState({ name: "", permissions: "" });
  const [roleErr, setRoleErr] = useState<string | null>(null);
  const refreshRoles = useCallback(async () => {
    try { setRoles(await rolesApi.listRoles()); } catch (e: any) { setRoleErr(String(e?.message ?? e)); }
  }, []);

  const [urlState, setUrlState] = useUrlState({ role: "", page: "1" });
  const roleFilter = urlState.role;
  const page       = Math.max(1, Number(urlState.page) || 1);
  const setRoleFilter = (r: string) => setUrlState({ role: r, page: "1" });
  const setPage       = (p: number) => setUrlState({ page: String(p) });

  const refresh = useCallback(async () => {
    const data = await apiGet(`${SVC.gateway}/users`);
    setRows(data.users ?? []);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { void refreshRoles(); }, [refreshRoles]);

  async function create(e: FormEvent) {
    e.preventDefault();
    await apiPost(`${SVC.gateway}/users`, { username: form.username, password: form.password, roles: [form.role] });
    setForm({ username: "", password: "", role: "Maker" });
    await refresh();
  }

  async function createRole(e: FormEvent) {
    e.preventDefault();
    setRoleErr(null);
    const permissions = roleForm.permissions.split(",").map((p) => p.trim()).filter(Boolean);
    try {
      await rolesApi.createRole({ name: roleForm.name.trim(), permissions });
      setRoleForm({ name: "", permissions: "" });
      await refreshRoles();
    } catch (e: any) { setRoleErr(String(e?.message ?? e)); }
  }

  async function removeRole(r: Role) {
    setRoleErr(null);
    try { await rolesApi.deleteRole(r.id); await refreshRoles(); }
    catch (e: any) { setRoleErr(String(e?.message ?? e)); }
  }

  const filtered = roleFilter
    ? rows.filter((r) => (r as any).roles?.includes?.(roleFilter))
    : rows;
  const totalPages  = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage    = Math.min(page, totalPages);
  const visible     = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <div style={{ padding: 32 }}>
      <h2>User Management</h2>
      <p style={{ color: "var(--muted)" }}>Supervisors can add an unlimited number of users — access is governed by RBAC.</p>

      <div style={{ marginTop: 12, marginBottom: 8 }}>
        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}
          style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid var(--bd)", background: "var(--ink2)", color: "var(--wh)", fontSize: 12 }}>
          <option value="">All roles</option>
          {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
        <thead><tr><th style={{ textAlign: "left", padding: 8 }}>User</th><th style={{ textAlign: "left", padding: 8 }}>Email</th><th style={{ textAlign: "left", padding: 8 }}>Branch</th><th style={{ textAlign: "left", padding: 8 }}>Status</th></tr></thead>
        <tbody>
          {visible.map((r) => (<tr key={r.id} style={{ borderTop: "1px solid var(--line)" }}><td style={{ padding: 8 }}>{r.username}</td><td style={{ padding: 8 }}>{r.email ?? "—"}</td><td style={{ padding: 8 }}>{r.branch ?? "—"}</td><td style={{ padding: 8 }}>{r.status}</td></tr>))}
          {visible.length === 0 && (<tr><td colSpan={4} style={{ padding: 16, textAlign: "center", color: "var(--sil)" }}>No users found</td></tr>)}
        </tbody>
      </table>

      {totalPages > 1 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, padding: "10px 0", fontSize: 11, color: "var(--sil)" }}>
          <button className="btn bs xs" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)} aria-label="Previous page">Prev</button>
          <span>Page {safePage} of {totalPages} &middot; {filtered.length} items</span>
          <button className="btn bs xs" disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)} aria-label="Next page">Next</button>
        </div>
      )}

      {canCreate && (
        <form onSubmit={create} style={{ marginTop: 24, display: "flex", gap: 8, flexWrap: "wrap", maxWidth: 640 }}>
          <input className="field" style={{ width: 180 }} placeholder="username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          <input className="field" style={{ width: 180 }} type="password" placeholder="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <select className="field" style={{ width: 160 }} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select>
          <button className="btn-primary" style={{ width: 140 }}>Add user</button>
        </form>
      )}

      {/* ── Roles matrix (SC-16: users + roles in one place) ── */}
      <h3 style={{ marginTop: 32 }}>Roles & Permissions</h3>
      {roleErr && <div role="alert" style={{ color: "var(--R, #c0392b)" }}>{roleErr}</div>}
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
        <thead><tr>
          <th style={{ textAlign: "left", padding: 8 }}>Role</th>
          <th style={{ textAlign: "left", padding: 8 }}>Permissions</th>
          <th style={{ textAlign: "left", padding: 8 }}>Users</th>
          <th style={{ textAlign: "left", padding: 8 }}>System</th>
          {canManageRoles && <th style={{ padding: 8 }}></th>}
        </tr></thead>
        <tbody>
          {roles.map((r) => (
            <tr key={r.id} style={{ borderTop: "1px solid var(--line)" }}>
              <td style={{ padding: 8 }}>{r.name}</td>
              <td style={{ padding: 8, fontSize: 12, color: "var(--sil)" }}>{r.permissions.length} ({r.permissions.slice(0, 4).join(", ")}{r.permissions.length > 4 ? "…" : ""})</td>
              <td style={{ padding: 8 }}>{r.userCount}</td>
              <td style={{ padding: 8 }}>{r.system ? "Yes" : "No"}</td>
              {canManageRoles && (
                <td style={{ padding: 8 }}>
                  {!r.system && <button className="btn bs xs" onClick={() => removeRole(r)} aria-label={`delete role ${r.name}`}>Delete</button>}
                </td>
              )}
            </tr>
          ))}
          {roles.length === 0 && <tr><td colSpan={canManageRoles ? 5 : 4} style={{ padding: 16, textAlign: "center", color: "var(--sil)" }}>No roles</td></tr>}
        </tbody>
      </table>
      {canManageRoles && (
        <form onSubmit={createRole} style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap", maxWidth: 700, alignItems: "center" }}>
          <input className="field" style={{ width: 160 }} placeholder="role name" value={roleForm.name} onChange={(e) => setRoleForm({ ...roleForm, name: e.target.value })} aria-label="role name" required />
          <input className="field" style={{ width: 320 }} placeholder="permissions (comma-separated, e.g. user:read, admin:read)" value={roleForm.permissions} onChange={(e) => setRoleForm({ ...roleForm, permissions: e.target.value })} aria-label="role permissions" />
          <button className="btn-primary" style={{ width: 130 }}>Add role</button>
        </form>
      )}
    </div>
  );
}
