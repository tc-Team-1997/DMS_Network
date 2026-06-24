import { useState, useEffect, useCallback } from "react";
import {
  KpiCard, Card, DataTable, Tag, StatusDot, Tabs, Modal, FormField,
  BarChartCard, DonutChartCard,
} from "../components/ui/index.js";
import type { Column } from "../components/ui/index.js";
import { useAuth } from "../auth/AuthContext.js";
import {
  securityApi,
  type UserRow,
  type CreateUserPayload,
} from "../api/securityScreen.js";

/* ─── Types ─── */
type UserTableRow = UserRow & Record<string, unknown>;

/* ─── Permission matrix (static) ─── */
const PERMISSION_MATRIX = [
  { module: "Capture & Scan",    CDO: "✓", Maker: "✓", Checker: "✗", Indexer: "✓", Viewer: "✗", Auditor: "✗" },
  { module: "Indexing",          CDO: "✓", Maker: "✓", Checker: "~", Indexer: "✓", Viewer: "✗", Auditor: "✗" },
  { module: "Approve / Reject",  CDO: "✓", Maker: "✗", Checker: "✓", Indexer: "✗", Viewer: "✗", Auditor: "✗" },
  { module: "Repository View",   CDO: "✓", Maker: "✓", Checker: "✓", Indexer: "✓", Viewer: "✓", Auditor: "✓" },
  { module: "Legal Hold",        CDO: "✓", Maker: "✗", Checker: "✗", Indexer: "✗", Viewer: "✗", Auditor: "~" },
  { module: "Compliance & Audit",CDO: "✓", Maker: "✗", Checker: "✗", Indexer: "✗", Viewer: "✗", Auditor: "✓" },
  { module: "Admin Panel",       CDO: "✓", Maker: "✗", Checker: "✗", Indexer: "✗", Viewer: "✗", Auditor: "✗" },
  { module: "Cross-Branch",      CDO: "✓", Maker: "~", Checker: "~", Indexer: "✗", Viewer: "✗", Auditor: "✓" },
  { module: "Integration Hub",   CDO: "✓", Maker: "✗", Checker: "✗", Indexer: "✗", Viewer: "✗", Auditor: "~" },
  { module: "User Management",   CDO: "✓", Maker: "✗", Checker: "✗", Indexer: "✗", Viewer: "✗", Auditor: "✗" },
] as const;

type MatrixRow = typeof PERMISSION_MATRIX[number] & Record<string, unknown>;

function PermCell({ val }: { val: string }) {
  if (val === "✓") return <div style={{ textAlign: "center", color: "var(--G)", fontWeight: 700 }}>✓</div>;
  if (val === "✗") return <div style={{ textAlign: "center", color: "var(--R)", fontWeight: 700 }}>✗</div>;
  return <div style={{ textAlign: "center", color: "var(--W)", fontWeight: 700 }}>~</div>;
}

/* ─── Security policy cards ─── */
const POLICY_CARDS = [
  {
    title: "Multi-Factor Auth (MFA)",
    body: "TOTP + SMS OTP. Enforced for all Maker, Checker, CDO and Admin roles. Biometric option enabled on mobile.",
    enabled: true,
    color: "var(--G)",
  },
  {
    title: "Single Sign-On (SSO)",
    body: "SAML 2.0 with Active Directory. Session timeout: 8h. Concurrent sessions: 2 max. Forced re-auth on suspicious activity.",
    enabled: true,
    color: "var(--G)",
  },
  {
    title: "Encryption at Rest",
    body: "AES-256 on all documents, metadata and audit trails. Key rotation every 90 days. HSM-managed keys (SafeNet Luna).",
    enabled: true,
    color: "var(--G)",
  },
  {
    title: "Zero-Trust Network",
    body: "All internal service calls require mTLS. JWT validated at gateway + per-service. IP allowlist enforced per environment.",
    enabled: true,
    color: "var(--G)",
  },
  {
    title: "Session Management",
    body: "Sliding 8h window with forced re-auth. Max 2 concurrent sessions per user. Suspicious-IP auto-block after 5 failed logins.",
    enabled: true,
    color: "var(--G)",
  },
  {
    title: "Audit Trail Immutability",
    body: "All audit_log entries are append-only (no UPDATE/DELETE). Exported to S3 Glacier for 7-year compliance archiving.",
    enabled: true,
    color: "var(--G)",
  },
];

/* ─── Role badge variant ─── */
function roleBadge(roles: string[] | undefined) {
  const r = (roles ?? [])[0] ?? "";
  if (r === "CDO")       return <Tag variant="gold">CDO</Tag>;
  if (r === "Supervisor") return <Tag variant="amber">Supervisor</Tag>;
  if (r === "Maker")     return <Tag variant="blue">Maker</Tag>;
  if (r === "Checker")   return <Tag variant="green">Checker</Tag>;
  if (r === "Indexer")   return <Tag variant="blue">Indexer</Tag>;
  if (r === "Auditor")   return <Tag variant="purple">Auditor</Tag>;
  if (r === "Viewer")    return <Tag variant="purple">Viewer</Tag>;
  return <Tag variant="gold">{r || "—"}</Tag>;
}

/* ─── Available roles ─── */
const ALL_ROLES = ["CDO", "Supervisor", "Maker", "Checker", "Indexer", "Viewer", "Auditor"];

/* ─── MFA chart seed data ─── */
const loginActivityData = [
  { day: "Mon", logins: 142, failed: 3 },
  { day: "Tue", logins: 168, failed: 1 },
  { day: "Wed", logins: 155, failed: 7 },
  { day: "Thu", logins: 171, failed: 2 },
  { day: "Fri", logins: 193, failed: 4 },
  { day: "Sat", logins: 64,  failed: 0 },
  { day: "Sun", logins: 38,  failed: 1 },
];

/* ─── Main component ─── */
export default function Security() {
  const { user } = useAuth();
  const canCreate = user?.permissions.includes("user:create") ?? false;
  const canUpdate = user?.permissions.includes("user:update") ?? false;
  const canRead   = user?.permissions.includes("user:read")   ?? false;

  const [tab, setTab]         = useState("users");
  const [users, setUsers]     = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  /* Add user modal */
  const [addOpen, setAddOpen]   = useState(false);
  const [form, setForm]         = useState<Partial<CreateUserPayload>>({ roles: ["Viewer"] });
  const [formErr, setFormErr]   = useState("");
  const [saving, setSaving]     = useState(false);
  const [selectedRole, setSelectedRole] = useState("Viewer");

  /* Lock confirmation */
  const [lockUser, setLockUser] = useState<UserRow | null>(null);
  const [locking, setLocking]   = useState(false);

  const load = useCallback(async () => {
    if (!canRead) { setLoading(false); return; }
    setLoading(true);
    setError(null);
    try {
      const res = await securityApi.getUsers();
      setUsers(res.users);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [canRead]);

  useEffect(() => { void load(); }, [load]);

  /* KPI computations */
  const activeUsers    = users.filter((u) => u.status === "Active").length || 284;
  const mfaCount       = users.filter((u) => u.mfa_enabled).length;
  const mfaPct         = users.length ? Math.round((mfaCount / users.length) * 100) : 97;
  const lockedCount    = users.filter((u) => u.status === "Locked").length;

  const mfaDonut = [
    { name: "TOTP Enrolled",   value: Math.round(mfaPct * 0.6), color: "var(--G)" },
    { name: "SMS OTP",         value: Math.round(mfaPct * 0.4), color: "var(--B)" },
    { name: "Pending Enroll",  value: 100 - mfaPct,             color: "var(--W)" },
  ];

  /* User table columns */
  const userColumns: Column<UserTableRow>[] = [
    {
      key: "full_name", header: "User", sortable: true,
      render: (r) => (
        <div>
          <div style={{ fontWeight: 600 }}>{String(r.full_name || r.username)}</div>
          <div style={{ fontSize: 10, color: "var(--sil)" }}>@{r.username}</div>
        </div>
      ),
    },
    {
      key: "roles", header: "Role",
      render: (r) => roleBadge((r as UserTableRow & { roles?: string[] }).roles),
    },
    {
      key: "branch", header: "Branch",
      render: (r) => <span style={{ fontSize: 12 }}>{String(r.branch || "—")}</span>,
    },
    {
      key: "mfa_enabled", header: "MFA",
      render: (r) => r.mfa_enabled
        ? <span style={{ color: "var(--G)", fontSize: 12 }}>✓ TOTP</span>
        : <span style={{ color: "var(--W)", fontSize: 12 }}>⚠ Pending</span>,
    },
    {
      key: "email", header: "Email",
      render: (r) => <span style={{ fontSize: 11, color: "var(--sil)" }}>{String(r.email || "—")}</span>,
    },
    {
      key: "status", header: "Status",
      render: (r) => r.status === "Active"
        ? <Tag variant="green">Active</Tag>
        : <Tag variant="red">Locked</Tag>,
    },
    ...(canUpdate ? [{
      key: "_actions", header: "",
      render: (r: UserTableRow) => (
        <button
          className="btn bs sm"
          style={{ fontSize: 11, padding: "2px 10px" }}
          onClick={(e) => { e.stopPropagation(); setLockUser(r as UserRow); }}
        >
          {r.status === "Active" ? "Lock" : "Unlock"}
        </button>
      ),
    }] : []),
  ];

  /* Matrix columns */
  const matrixColumns: Column<MatrixRow>[] = [
    { key: "module", header: "Module", render: (r) => <span style={{ fontSize: 11 }}>{String(r.module)}</span> },
    { key: "CDO",     header: "CDO",     render: (r) => <PermCell val={String(r.CDO)} /> },
    { key: "Maker",   header: "Maker",   render: (r) => <PermCell val={String(r.Maker)} /> },
    { key: "Checker", header: "Checker", render: (r) => <PermCell val={String(r.Checker)} /> },
    { key: "Indexer", header: "Indexer", render: (r) => <PermCell val={String(r.Indexer)} /> },
    { key: "Viewer",  header: "Viewer",  render: (r) => <PermCell val={String(r.Viewer)} /> },
    { key: "Auditor", header: "Auditor", render: (r) => <PermCell val={String(r.Auditor)} /> },
  ];

  async function handleCreateUser() {
    if (!form.username?.trim()) { setFormErr("Username is required"); return; }
    if (!form.password?.trim()) { setFormErr("Password is required"); return; }
    setSaving(true); setFormErr("");
    try {
      await securityApi.createUser({ ...form, roles: [selectedRole] } as CreateUserPayload);
      setAddOpen(false);
      setForm({ roles: ["Viewer"] });
      setSelectedRole("Viewer");
      await load();
    } catch (e) {
      setFormErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleLock() {
    if (!lockUser) return;
    setLocking(true);
    try {
      await securityApi.toggleLock(lockUser.id);
      setLockUser(null);
      await load();
    } catch (e) {
      setError((e as Error).message);
      setLockUser(null);
    } finally {
      setLocking(false);
    }
  }

  return (
    <div className="fade-up">
      {/* Page header */}
      <div className="page-header">
        <div>
          <h2 className="serif">Security &amp; Access Control</h2>
          <p>RBAC · MFA · SSO · Zero-Trust · AES-256 Encryption · Permission Matrix · Session Audit</p>
        </div>
        <div className="phr">
          {canCreate && (
            <button className="btn bg sm" onClick={() => setAddOpen(true)}>+ Add User</button>
          )}
          <button className="btn bs sm" onClick={() => void load()}>↻ Refresh</button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div style={{ background: "rgba(224,82,82,0.12)", border: "1px solid var(--R)", borderRadius: 8, padding: "10px 16px", marginBottom: 14, color: "var(--R)", fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* KPI row */}
      <div className="g4" style={{ marginBottom: 14 }}>
        <KpiCard label="Active Users"        value={loading ? "…" : activeUsers}          sub="across all branches"         variant="green" />
        <KpiCard label="MFA Enrolled"        value={loading ? "…" : `${mfaPct}%`}         sub={`${100 - mfaPct}% pending`} variant="blue" />
        <KpiCard label="Failed Logins (24h)" value={7}                                     sub="3 IPs auto-blocked"          variant="red" />
        <KpiCard label="Locked Accounts"     value={loading ? "…" : lockedCount}           sub="pending review"              variant="amber" />
      </div>

      {/* Tabs */}
      <Tabs
        items={[
          { key: "users",   label: "User Management" },
          { key: "matrix",  label: "Permission Matrix" },
          { key: "policy",  label: "Security Policies" },
          { key: "charts",  label: "Access Analytics" },
        ]}
        active={tab}
        onChange={setTab}
      />

      <div style={{ marginTop: 16 }}>

        {/* ── Users tab ── */}
        {tab === "users" && (
          <div className="g2">
            <Card
              title="User Management"
              action={canCreate ? <button className="btn bg sm" onClick={() => setAddOpen(true)}>+ Add User</button> : undefined}
            >
              {loading ? (
                <div style={{ color: "var(--sil)", padding: 24, textAlign: "center" }}>Loading users…</div>
              ) : !canRead ? (
                <div style={{ color: "var(--sil)", padding: 24, textAlign: "center" }}>Insufficient permissions to view users.</div>
              ) : (
                <DataTable<UserTableRow>
                  columns={userColumns}
                  rows={users as UserTableRow[]}
                  rowKey={(r) => r.id}
                  emptyMessage="No users found"
                />
              )}
            </Card>

            {/* Side panel — role distribution + recent activity */}
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <DonutChartCard
                title="MFA Enrollment Status"
                data={mfaDonut}
                height={180}
              />
              <Card title="Role Distribution">
                {[
                  { role: "CDO",        count: users.filter(u => (u as any).roles?.includes?.("CDO")).length || 2,   color: "var(--gold2)" },
                  { role: "Supervisor", count: users.filter(u => (u as any).roles?.includes?.("Supervisor")).length || 8,  color: "var(--W)" },
                  { role: "Maker",      count: users.filter(u => (u as any).roles?.includes?.("Maker")).length || 84,     color: "var(--B)" },
                  { role: "Checker",    count: users.filter(u => (u as any).roles?.includes?.("Checker")).length || 62,    color: "var(--G)" },
                  { role: "Indexer",    count: users.filter(u => (u as any).roles?.includes?.("Indexer")).length || 48,    color: "var(--B)" },
                  { role: "Viewer",     count: users.filter(u => (u as any).roles?.includes?.("Viewer")).length || 56,     color: "var(--P)" },
                  { role: "Auditor",    count: users.filter(u => (u as any).roles?.includes?.("Auditor")).length || 24,    color: "var(--P)" },
                ].map((item) => (
                  <div key={item.role} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", background: item.color, flexShrink: 0 }} />
                    <span style={{ fontSize: 12, flex: 1 }}>{item.role}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "var(--wh)" }}>{item.count}</span>
                    <div style={{ width: 80, height: 6, background: "var(--ink3)", borderRadius: 3, overflow: "hidden" }}>
                      <div style={{ width: `${Math.min(100, (item.count / (activeUsers || 1)) * 100)}%`, height: "100%", background: item.color, borderRadius: 3 }} />
                    </div>
                  </div>
                ))}
              </Card>
              <Card title="Active Sessions">
                <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12 }}>
                  {[
                    { label: "Total Active Sessions", value: "142", color: "var(--wh)" },
                    { label: "Across Branches",       value: "84",  color: "var(--B)" },
                    { label: "Mobile Sessions",       value: "38",  color: "var(--G)" },
                    { label: "API Tokens Active",     value: "17",  color: "var(--gold2)" },
                    { label: "Sessions > 6h",         value: "9",   color: "var(--W)" },
                  ].map((item) => (
                    <div key={item.label} style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "var(--sil)" }}>{item.label}</span>
                      <span style={{ color: item.color, fontWeight: 600 }}>{item.value}</span>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </div>
        )}

        {/* ── Permission Matrix tab ── */}
        {tab === "matrix" && (
          <Card
            title={
              <span>
                Permission Matrix &nbsp;
                <span style={{ fontSize: 10, color: "var(--sil)", fontWeight: 400 }}>
                  ✓ Full &nbsp; ~ Partial &nbsp; ✗ None
                </span>
              </span>
            }
          >
            <DataTable<MatrixRow>
              columns={matrixColumns}
              rows={PERMISSION_MATRIX as unknown as MatrixRow[]}
              rowKey={(r) => String(r.module)}
              emptyMessage="No matrix data"
            />
          </Card>
        )}

        {/* ── Security Policies tab ── */}
        {tab === "policy" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="g3">
              {POLICY_CARDS.map((p) => (
                <div key={p.title} style={{ padding: 14, background: "var(--gr)", border: "1px solid var(--bd)", borderRadius: 9 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{p.title}</div>
                    <div style={{ width: 36, height: 20, background: p.enabled ? "var(--G)" : "var(--sil)", borderRadius: 10, position: "relative" }}>
                      <div style={{ width: 16, height: 16, background: "#fff", borderRadius: "50%", position: "absolute", right: p.enabled ? 2 : undefined, left: p.enabled ? undefined : 2, top: 2 }} />
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--sil)", lineHeight: 1.5 }}>{p.body}</div>
                </div>
              ))}
            </div>

            {/* RBAC enforcement summary */}
            <Card title="RBAC Enforcement Points">
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {[
                  { layer: "React UI Layer",       desc: "ProtectedRoute gates by permission string; nav items RBAC-filtered in AppShell." },
                  { layer: "Gateway (Express)",     desc: "requireAuth verifies JWT; requirePermission enforces resource:action per route." },
                  { layer: "Integration Service",   desc: "integration:read / integration:manage enforced on all /logs, /systems, /webhooks routes." },
                  { layer: "Core Service",          desc: "document:read, document:capture, document:approve gated per endpoint." },
                  { layer: "Workflow Service",      desc: "workflow:read, workflow:act enforced; case data scoped to branch." },
                  { layer: "Audit Trail",           desc: "Every sensitive action writes to audit_log with actor, entity, timestamp." },
                ].map((item) => (
                  <div key={item.layer} style={{ padding: "10px 12px", background: "var(--ink3)", border: "1px solid var(--bd)", borderRadius: 6 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "var(--gold2)", marginBottom: 4 }}>{item.layer}</div>
                    <div style={{ fontSize: 11, color: "var(--sil)", lineHeight: 1.5 }}>{item.desc}</div>
                  </div>
                ))}
              </div>
            </Card>

            {/* Compliance badges */}
            <Card title="Compliance &amp; Certification Status">
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                {[
                  { standard: "ISO 27001",   domain: "Information Security", score: "93%", status: "Certified" as const },
                  { standard: "PCI DSS v4",  domain: "Payment Security",     score: "98%", status: "Certified" as const },
                  { standard: "GDPR",        domain: "Data Privacy",         score: "91%", status: "Compliant" as const },
                  { standard: "SOC 2 Type II", domain: "Trust Services",     score: "96%", status: "Certified" as const },
                  { standard: "NBB Circular", domain: "Banking Regulations", score: "100%",status: "Compliant" as const },
                ].map((cert) => (
                  <div key={cert.standard} style={{ flex: "1 1 180px", padding: "12px 14px", background: "var(--gr)", border: "1px solid var(--bd)", borderRadius: 8 }}>
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{cert.standard}</div>
                    <div style={{ fontSize: 10, color: "var(--sil)", marginTop: 2 }}>{cert.domain}</div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
                      <span style={{ color: "var(--G)", fontSize: 14, fontWeight: 700 }}>{cert.score}</span>
                      <Tag variant="green">{cert.status}</Tag>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        )}

        {/* ── Analytics tab ── */}
        {tab === "charts" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="g2">
              <BarChartCard
                title="Login Activity (Last 7 Days)"
                data={loginActivityData}
                xKey="day"
                bars={[
                  { key: "logins", name: "Successful Logins", color: "var(--G)" },
                  { key: "failed", name: "Failed Logins",     color: "var(--R)" },
                ]}
                height={220}
              />
              <DonutChartCard
                title="Permission Coverage by Role"
                data={[
                  { name: "CDO",         value: 100, color: "var(--gold2)" },
                  { name: "Supervisor",  value: 40,  color: "var(--W)" },
                  { name: "Maker",       value: 25,  color: "var(--B)" },
                  { name: "Checker",     value: 20,  color: "var(--G)" },
                  { name: "Indexer",     value: 12,  color: "var(--B)" },
                  { name: "Viewer",      value: 5,   color: "var(--P)" },
                  { name: "Auditor",     value: 15,  color: "var(--P)" },
                ]}
                height={220}
              />
            </div>
            <div className="g2">
              <Card title="Recent Security Events">
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {[
                    { time: "10:42", event: "USER_CREATE",  actor: "admin",  entity: "user/maker_99",    severity: "info"    },
                    { time: "09:18", event: "USER_LOCK",    actor: "admin",  entity: "user/viewer_44",   severity: "warning" },
                    { time: "08:55", event: "LOGIN",        actor: "cdo_01", entity: "auth",             severity: "info"    },
                    { time: "08:31", event: "USER_ROLES",   actor: "admin",  entity: "user/indexer_12",  severity: "info"    },
                    { time: "08:07", event: "LOGIN_FAILED", actor: "unknown",entity: "auth",             severity: "danger"  },
                    { time: "07:44", event: "LOGIN_FAILED", actor: "unknown",entity: "auth",             severity: "danger"  },
                    { time: "07:20", event: "LOGIN",        actor: "maker_01",entity: "auth",            severity: "info"    },
                  ].map((ev, i) => (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", background: "var(--gr)", border: "1px solid var(--bd)", borderRadius: 6 }}>
                      <StatusDot color={ev.severity === "danger" ? "red" : ev.severity === "warning" ? "amber" : "green"} />
                      <span style={{ fontSize: 10, color: "var(--sil)", width: 36, flexShrink: 0 }}>{ev.time}</span>
                      <Tag variant={ev.severity === "danger" ? "red" : ev.severity === "warning" ? "amber" : "blue"} style={{ fontSize: 10 }}>{ev.event}</Tag>
                      <span style={{ fontSize: 11, flex: 1 }}>
                        <strong>{ev.actor}</strong> → <span style={{ color: "var(--sil)" }}>{ev.entity}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
              <Card title="Threat Intelligence">
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {[
                    { label: "Blocked IPs (24h)",     value: "3",    color: "var(--R)" },
                    { label: "Failed Login Attempts",  value: "7",    color: "var(--W)" },
                    { label: "Suspicious API Calls",   value: "2",    color: "var(--W)" },
                    { label: "Brute-force Attempts",   value: "1",    color: "var(--R)" },
                    { label: "MFA Bypass Attempts",    value: "0",    color: "var(--G)" },
                    { label: "Privilege Escalations",  value: "0",    color: "var(--G)" },
                    { label: "Data Exfil Attempts",    value: "0",    color: "var(--G)" },
                  ].map((item) => (
                    <div key={item.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid var(--bd)" }}>
                      <span style={{ fontSize: 12, color: "var(--mist)" }}>{item.label}</span>
                      <span style={{ fontSize: 14, fontWeight: 700, color: item.color }}>{item.value}</span>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          </div>
        )}
      </div>

      {/* ── Add User modal ── */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add User" width={540}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="g2">
            <FormField
              label="Username"
              placeholder="e.g. maker_001"
              value={form.username ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
            />
            <FormField
              label="Password"
              placeholder="Min 8 characters"
              value={form.password ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            />
          </div>
          <div className="g2">
            <FormField
              label="Full Name"
              placeholder="Display name"
              value={form.full_name ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
            />
            <FormField
              label="Email"
              placeholder="user@bank.bt"
              value={form.email ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            />
          </div>
          <div className="g2">
            <FormField
              label="Branch"
              placeholder="e.g. Thimphu HQ"
              value={form.branch ?? ""}
              onChange={(e) => setForm((f) => ({ ...f, branch: e.target.value }))}
            />
            <FormField
              as="select"
              label="Role"
              value={selectedRole}
              onChange={(e) => setSelectedRole(e.target.value)}
            >
              {ALL_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </FormField>
          </div>
          {formErr && <div style={{ color: "var(--R)", fontSize: 12 }}>{formErr}</div>}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button className="btn bs sm" onClick={() => { setAddOpen(false); setForm({ roles: ["Viewer"] }); setFormErr(""); }}>Cancel</button>
            <button className="btn bg sm" onClick={handleCreateUser} disabled={saving}>
              {saving ? "Creating…" : "Create User"}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Lock confirmation modal ── */}
      <Modal open={!!lockUser} onClose={() => setLockUser(null)} title={lockUser?.status === "Active" ? "Lock Account" : "Unlock Account"} width={420}>
        {lockUser && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <p style={{ color: "var(--mist)", fontSize: 13 }}>
              {lockUser.status === "Active"
                ? `Lock account for ${lockUser.full_name ?? lockUser.username}? They will be unable to log in until unlocked.`
                : `Unlock account for ${lockUser.full_name ?? lockUser.username}? They will regain access.`}
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn bs sm" onClick={() => setLockUser(null)}>Cancel</button>
              <button
                className={lockUser.status === "Active" ? "btn bs sm" : "btn bg sm"}
                style={lockUser.status === "Active" ? { color: "var(--R)", borderColor: "var(--R)" } : undefined}
                onClick={handleToggleLock}
                disabled={locking}
              >
                {locking ? "Processing…" : lockUser.status === "Active" ? "Lock Account" : "Unlock Account"}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
