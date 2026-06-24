import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bell, BellOff, CheckCheck, ChevronDown, ChevronUp,
  Plus, RefreshCw, Shield, Zap, AlertTriangle, Info, X,
} from "lucide-react";
import {
  KpiCard,
  Card,
  DataTable,
  Tag,
  StatusDot,
  Tabs,
  Modal,
  FormField,
  DonutChartCard,
  BarChartCard,
  LineChartCard,
} from "../components/ui/index.js";
import { useAuth } from "../auth/AuthContext.js";
import {
  notifyApi,
  type Alert,
  type AlertLevel,
  type AlertRule,
  type CreateRuleRequest,
} from "../api/notifyApi.js";
import { getToken } from "../api/client.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function levelTag(level: AlertLevel) {
  if (level === "critical") return <Tag variant="red">Critical</Tag>;
  if (level === "warning")  return <Tag variant="amber">Warning</Tag>;
  return <Tag variant="blue">Info</Tag>;
}

function levelIcon(level: AlertLevel) {
  if (level === "critical") return <AlertTriangle size={14} color="var(--R)" />;
  if (level === "warning")  return <Shield size={14} color="var(--W)" />;
  return <Info size={14} color="var(--B)" />;
}

function levelDot(level: AlertLevel) {
  if (level === "critical") return <StatusDot color="red" pulse />;
  if (level === "warning")  return <StatusDot color="amber" />;
  return <StatusDot color="blue" />;
}

function relativeTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(ts).toLocaleDateString();
}

const CHANNEL_LABELS: Record<string, string> = {
  email: "Email",
  sms: "SMS",
  whatsapp: "WhatsApp",
  teams: "MS Teams",
  inapp: "In-App",
};

const TRIGGER_OPTIONS = [
  "document.expiring",
  "workflow.escalated",
  "document.indexed",
  "document.rejected",
  "compliance.breach",
];

// ─── Alert Rule Form ──────────────────────────────────────────────────────────

interface RuleFormState {
  name: string;
  trigger: string;
  channels: string[];
  escalationTarget: string;
  scope: string;
  params: string;
}

const EMPTY_RULE: RuleFormState = {
  name: "",
  trigger: "document.expiring",
  channels: ["inapp", "email"],
  escalationTarget: "",
  scope: "",
  params: "{}",
};

function AlertRuleForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial?: RuleFormState;
  onSave: (form: RuleFormState) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [form, setForm] = useState<RuleFormState>(initial ?? EMPTY_RULE);
  const [paramsError, setParamsError] = useState("");

  const ALL_CHANNELS = ["email", "sms", "whatsapp", "teams", "inapp"];

  function toggleChannel(ch: string) {
    setForm((f) => ({
      ...f,
      channels: f.channels.includes(ch)
        ? f.channels.filter((c) => c !== ch)
        : [...f.channels, ch],
    }));
  }

  function handleSubmit() {
    try {
      JSON.parse(form.params);
      setParamsError("");
    } catch {
      setParamsError("Invalid JSON");
      return;
    }
    onSave(form);
  }

  return (
    <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
      <FormField
        label="Rule Name"
        placeholder="KYC expiry 30-day alert…"
        value={form.name}
        onChange={(e) => setForm({ ...form, name: (e.target as HTMLInputElement).value })}
      />

      <FormField
        as="select"
        label="Trigger Event"
        value={form.trigger}
        onChange={(e) => setForm({ ...form, trigger: (e.target as HTMLSelectElement).value })}
      >
        {TRIGGER_OPTIONS.map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </FormField>

      <div>
        <label style={{ display: "block", fontSize: 10.5, color: "var(--sil)", marginBottom: 6 }}>
          Notification Channels
        </label>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {ALL_CHANNELS.map((ch) => (
            <button
              key={ch}
              type="button"
              onClick={() => toggleChannel(ch)}
              className={form.channels.includes(ch) ? "btn-primary" : "btn"}
              style={{ fontSize: 11, padding: "4px 10px" }}
            >
              {CHANNEL_LABELS[ch]}
            </button>
          ))}
        </div>
      </div>

      <FormField
        label="Escalation Target Role (optional)"
        placeholder="Supervisor, CDO…"
        value={form.escalationTarget}
        onChange={(e) => setForm({ ...form, escalationTarget: (e.target as HTMLInputElement).value })}
        hint="RBAC role name — this role's members receive escalation emails"
      />

      <FormField
        label="Scope (optional)"
        placeholder="Thimphu, Paro…"
        value={form.scope}
        onChange={(e) => setForm({ ...form, scope: (e.target as HTMLInputElement).value })}
        hint="Restrict rule to a specific branch or region"
      />

      <FormField
        as="textarea"
        label="Parameters JSON"
        rows={3}
        value={form.params}
        onChange={(e) => setForm({ ...form, params: (e.target as HTMLTextAreaElement).value })}
        error={paramsError}
        hint='e.g. {"tiers": ["T-60","T-30","T-07","T-00"]}'
      />

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button className="btn" onClick={onCancel}>Cancel</button>
        <button
          className="btn-primary"
          onClick={handleSubmit}
          disabled={saving || !form.name.trim()}
        >
          {saving ? "Saving…" : "Save Rule"}
        </button>
      </div>
    </div>
  );
}

// ─── Alert Detail Panel ───────────────────────────────────────────────────────

function AlertDetailPanel({
  alert,
  onClose,
  onMarkRead,
  onEscalate,
  canManage,
}: {
  alert: Alert;
  onClose: () => void;
  onMarkRead: (id: number) => void;
  onEscalate: (id: number, target: string) => void;
  canManage: boolean;
}) {
  const [escTarget, setEscTarget] = useState("");
  const [escalating, setEscalating] = useState(false);
  let meta: Record<string, unknown> = {};
  try {
    meta = typeof alert.meta === "string" ? JSON.parse(alert.meta) : (alert.meta ?? {});
  } catch {}

  async function handleEscalate() {
    if (!escTarget.trim()) return;
    setEscalating(true);
    try { await onEscalate(alert.id, escTarget); } finally { setEscalating(false); }
  }

  return (
    <div
      style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: 380,
        background: "var(--ink2)", borderLeft: "1px solid var(--bd)",
        zIndex: 200, overflowY: "auto", padding: 24,
        display: "flex", flexDirection: "column", gap: 16,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {levelIcon(alert.level)}
          <h3 style={{ margin: 0, fontSize: 14 }}>Alert Details</h3>
        </div>
        <button className="ic" onClick={onClose} aria-label="Close"><X size={14} /></button>
      </div>

      <div>
        <div style={{ fontSize: 10, color: "var(--sil)", marginBottom: 4 }}>TITLE</div>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{alert.title}</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div>
          <div style={{ fontSize: 10, color: "var(--sil)", marginBottom: 3 }}>SEVERITY</div>
          {levelTag(alert.level)}
        </div>
        <div>
          <div style={{ fontSize: 10, color: "var(--sil)", marginBottom: 3 }}>STATUS</div>
          {alert.is_read
            ? <Tag variant="green">Read</Tag>
            : <Tag variant="amber">Unread</Tag>}
        </div>
        <div>
          <div style={{ fontSize: 10, color: "var(--sil)", marginBottom: 3 }}>BRANCH</div>
          <div style={{ fontSize: 11 }}>{alert.branch ?? "—"}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: "var(--sil)", marginBottom: 3 }}>RAISED</div>
          <div style={{ fontSize: 11 }}>{relativeTime(alert.created_at)}</div>
        </div>
      </div>

      {Object.keys(meta).length > 0 && (
        <div>
          <div style={{ fontSize: 10, color: "var(--sil)", marginBottom: 6 }}>METADATA</div>
          <div style={{ background: "var(--ink3)", borderRadius: 6, padding: 10, fontSize: 11, fontFamily: "monospace", lineHeight: 1.6 }}>
            {Object.entries(meta).map(([k, v]) => (
              <div key={k}>
                <span style={{ color: "var(--gold2)" }}>{k}</span>: {JSON.stringify(v)}
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
        {!alert.is_read && (
          <button className="btn" onClick={() => onMarkRead(alert.id)} style={{ width: "100%" }}>
            <CheckCheck size={13} style={{ marginRight: 6 }} />
            Mark as Read
          </button>
        )}

        {canManage && (
          <div>
            <div style={{ fontSize: 10, color: "var(--sil)", marginBottom: 6 }}>ESCALATE TO ROLE</div>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                className="field"
                style={{ flex: 1 }}
                placeholder="Supervisor, CDO…"
                value={escTarget}
                onChange={(e) => setEscTarget(e.target.value)}
              />
              <button
                className="btn-primary"
                onClick={handleEscalate}
                disabled={escalating || !escTarget.trim()}
                style={{ flexShrink: 0 }}
              >
                {escalating ? "…" : "Escalate"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Alerts() {
  const { user } = useAuth();
  const canView       = user?.permissions.includes("alert:read") ?? false;
  const canManage     = user?.permissions.includes("alert:manage") ?? false;
  const canManageRule = user?.permissions.includes("alert_rule:manage") ?? false;

  // Data
  const [alerts,    setAlerts]    = useState<Alert[]>([]);
  const [rules,     setRules]     = useState<AlertRule[]>([]);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const [rulesLoading, setRulesLoading] = useState(false);

  // Filters
  const [levelFilter, setLevelFilter] = useState<AlertLevel | "all">("all");
  const [unreadOnly,  setUnreadOnly]  = useState(false);

  // UI
  const [tab,           setTab]           = useState<"alerts" | "rules" | "analytics">("alerts");
  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null);
  const [showRuleModal, setShowRuleModal] = useState(false);
  const [editingRule,   setEditingRule]   = useState<AlertRule | null>(null);
  const [ruleSaving,    setRuleSaving]    = useState(false);

  // Real-time SSE / WS connection state
  const [realtimeConn, setRealtimeConn] = useState<"connected" | "disconnected">("disconnected");
  const wsRef = useRef<WebSocket | null>(null);

  const loadAlerts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: { level?: AlertLevel; unread?: boolean } = {};
      if (levelFilter !== "all") params.level = levelFilter;
      if (unreadOnly) params.unread = true;
      const res = await notifyApi.listAlerts(params);
      setAlerts(res.alerts);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load alerts");
    } finally {
      setLoading(false);
    }
  }, [levelFilter, unreadOnly]);

  const loadRules = useCallback(async () => {
    setRulesLoading(true);
    try {
      const res = await notifyApi.listRules();
      setRules(res.rules);
    } catch {
      setRules([]);
    } finally {
      setRulesLoading(false);
    }
  }, []);

  // Load alerts only when the user has the required view permission (I-2).
  useEffect(() => { if (canView) loadAlerts(); }, [canView, loadAlerts]);
  // Eagerly load rules on mount so the "Active Rules" KPI card is populated
  // immediately without requiring the user to click the Rules tab (I-6).
  useEffect(() => { if (canView) loadRules(); }, [canView, loadRules]);
  // Reload rules when the user switches to the Rules tab (keeps data fresh)
  useEffect(() => { if (tab === "rules" && canView) loadRules(); }, [tab, canView, loadRules]);

  // WebSocket real-time feed for new alerts.
  // Route through the Vite dev proxy (/svc/notify -> :4003) so that:
  //   1. The browser never attempts to connect to a private-network port directly.
  //   2. The JWT token is appended as a query param (C-1 fix).
  useEffect(() => {
    const token = getToken();
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${proto}//${window.location.host}/svc/notify/ws/alerts?token=${encodeURIComponent(token ?? "")}`;
    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen  = () => setRealtimeConn("connected");
      ws.onclose = () => setRealtimeConn("disconnected");
      ws.onerror = () => setRealtimeConn("disconnected");
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === "alert.raised" && msg.alert) {
            setAlerts((prev) => [msg.alert as Alert, ...prev]);
          }
        } catch {}
      };

      return () => { ws.close(); };
    } catch {
      return () => {};
    }
  }, []);

  async function handleMarkRead(id: number) {
    await notifyApi.markRead(id).catch(() => {});
    setAlerts((prev) => prev.map((a) => a.id === id ? { ...a, is_read: true } : a));
    if (selectedAlert?.id === id) setSelectedAlert((a) => a ? { ...a, is_read: true } : a);
  }

  async function handleMarkAllRead() {
    const unread = alerts.filter((a) => !a.is_read);
    await Promise.all(unread.map((a) => notifyApi.markRead(a.id).catch(() => {})));
    setAlerts((prev) => prev.map((a) => ({ ...a, is_read: true })));
  }

  async function handleEscalate(id: number, target: string) {
    await notifyApi.escalate(id, target);
    await loadAlerts();
  }

  async function handleSaveRule(form: RuleFormState) {
    setRuleSaving(true);
    try {
      let params: Record<string, unknown> = {};
      try { params = JSON.parse(form.params); } catch {}
      const body: CreateRuleRequest = {
        name: form.name,
        trigger: form.trigger,
        channels: form.channels,
        params,
        escalationTarget: form.escalationTarget || undefined,
        scope: form.scope || undefined,
      };
      if (editingRule) {
        await notifyApi.patchRule(editingRule.id, body);
      } else {
        await notifyApi.createRule(body);
      }
      setShowRuleModal(false);
      setEditingRule(null);
      await loadRules();
    } finally {
      setRuleSaving(false);
    }
  }

  async function handleToggleRule(rule: AlertRule) {
    await notifyApi.patchRule(rule.id, { enabled: !rule.enabled }).catch(() => {});
    setRules((prev) => prev.map((r) => r.id === rule.id ? { ...r, enabled: !r.enabled } : r));
  }

  // KPI aggregations
  const critical = alerts.filter((a) => a.level === "critical").length;
  const warnings  = alerts.filter((a) => a.level === "warning").length;
  const unread    = alerts.filter((a) => !a.is_read).length;
  const total     = alerts.length;

  // Analytics data
  const byLevel = [
    { name: "Critical", value: critical, color: "var(--R)" },
    { name: "Warning",  value: warnings,  color: "var(--W)" },
    { name: "Info",     value: alerts.filter((a) => a.level === "info").length, color: "var(--B)" },
  ].filter((d) => d.value > 0);

  const byBranch = Object.entries(
    alerts.reduce((acc: Record<string, number>, a) => {
      const b = a.branch ?? "Unknown";
      acc[b] = (acc[b] ?? 0) + 1;
      return acc;
    }, {})
  )
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  // Timeline data — last 7 days grouped
  const nowMs = Date.now();
  const DAY = 86400000;
  const timelineData = Array.from({ length: 7 }, (_, i) => {
    const dayStart = nowMs - (6 - i) * DAY;
    const dayEnd   = dayStart + DAY;
    const day = new Date(dayStart);
    const label = day.toLocaleDateString("en-US", { weekday: "short" });
    const dayAlerts = alerts.filter((a) => {
      const ts = new Date(a.created_at).getTime();
      return ts >= dayStart && ts < dayEnd;
    });
    return {
      day: label,
      critical: dayAlerts.filter((a) => a.level === "critical").length,
      warning:  dayAlerts.filter((a) => a.level === "warning").length,
      info:     dayAlerts.filter((a) => a.level === "info").length,
    };
  });

  // Columns for alerts table
  const alertColumns = [
    {
      key: "level",
      header: "Severity",
      sortable: true,
      width: 90,
      render: (row: Record<string, unknown>) => (
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {levelDot(row.level as AlertLevel)}
          {levelTag(row.level as AlertLevel)}
        </div>
      ),
    },
    {
      key: "title",
      header: "Alert",
      render: (row: Record<string, unknown>) => (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {!row.is_read && (
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--gold2)", display: "inline-block", flexShrink: 0 }} />
          )}
          <span style={{ fontSize: 12, fontWeight: row.is_read ? 400 : 600 }}>
            {row.title as string}
          </span>
        </div>
      ),
    },
    {
      key: "branch",
      header: "Branch",
      sortable: true,
      width: 110,
      render: (row: Record<string, unknown>) => (
        <span style={{ fontSize: 11 }}>{(row.branch as string) ?? "—"}</span>
      ),
    },
    {
      key: "is_read",
      header: "Status",
      width: 80,
      render: (row: Record<string, unknown>) =>
        row.is_read
          ? <Tag variant="green">Read</Tag>
          : <Tag variant="amber">Unread</Tag>,
    },
    {
      key: "created_at",
      header: "Raised",
      sortable: true,
      width: 100,
      render: (row: Record<string, unknown>) => (
        <span style={{ fontSize: 11, color: "var(--sil)" }}>
          {relativeTime(row.created_at as string)}
        </span>
      ),
    },
    {
      key: "_actions",
      header: "",
      width: 60,
      render: (row: Record<string, unknown>) => (
        !row.is_read ? (
          <button
            className="ic"
            title="Mark as read"
            onClick={(e) => { e.stopPropagation(); handleMarkRead(row.id as number); }}
          >
            <CheckCheck size={12} />
          </button>
        ) : null
      ),
    },
  ];

  // Rules table columns
  const ruleColumns = [
    {
      key: "name",
      header: "Rule",
      render: (row: Record<string, unknown>) => (
        <span style={{ fontSize: 12, fontWeight: 500 }}>{row.name as string}</span>
      ),
    },
    {
      key: "trigger",
      header: "Trigger",
      sortable: true,
      render: (row: Record<string, unknown>) => (
        <span style={{ fontSize: 11, fontFamily: "monospace", color: "var(--gold2)" }}>
          {row.trigger as string}
        </span>
      ),
    },
    {
      key: "channels",
      header: "Channels",
      render: (row: Record<string, unknown>) => {
        const channels = row.channels as string[];
        return (
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
            {(channels ?? []).map((ch) => (
              <Tag key={ch} variant="blue" style={{ fontSize: 10 }}>
                {CHANNEL_LABELS[ch] ?? ch}
              </Tag>
            ))}
          </div>
        );
      },
    },
    {
      key: "escalation_target",
      header: "Escalation",
      render: (row: Record<string, unknown>) => (
        <span style={{ fontSize: 11 }}>{(row.escalation_target as string) ?? "—"}</span>
      ),
    },
    {
      key: "enabled",
      header: "Status",
      width: 90,
      render: (row: Record<string, unknown>) =>
        row.enabled
          ? <Tag variant="green">Active</Tag>
          : <Tag variant="red">Disabled</Tag>,
    },
    {
      key: "_actions",
      header: "",
      width: 120,
      render: (row: Record<string, unknown>) => (
        <div style={{ display: "flex", gap: 4 }}>
          {canManageRule && (
            <>
              <button
                className="btn"
                style={{ fontSize: 10, padding: "3px 8px" }}
                onClick={(e) => {
                  e.stopPropagation();
                  const rule = row as unknown as AlertRule;
                  setEditingRule(rule);
                  setShowRuleModal(true);
                }}
              >
                Edit
              </button>
              <button
                className="btn"
                style={{ fontSize: 10, padding: "3px 8px" }}
                onClick={(e) => {
                  e.stopPropagation();
                  handleToggleRule(row as unknown as AlertRule);
                }}
              >
                {row.enabled ? "Disable" : "Enable"}
              </button>
            </>
          )}
        </div>
      ),
    },
  ];

  const alertRows = alerts
    .filter((a) => {
      if (levelFilter !== "all" && a.level !== levelFilter) return false;
      if (unreadOnly && a.is_read) return false;
      return true;
    })
    .map((a) => a as unknown as Record<string, unknown>);

  const ruleRows = rules.map((r) => r as unknown as Record<string, unknown>);

  // I-2: Guard — users without alert:read get a graceful access-denied message
  // instead of hitting the API and seeing a red error banner.
  if (!canView) {
    return (
      <div className="fade-up" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="page-header">
          <div>
            <h2 className="serif">Alerts &amp; Event Management</h2>
            <p>Real-time compliance alerts, expiry notifications and AI-driven system events</p>
          </div>
        </div>
        <div
          style={{
            background: "rgba(220,38,38,.08)",
            border: "1px solid var(--R)",
            borderRadius: 8,
            padding: 24,
            textAlign: "center",
            color: "var(--R)",
          }}
          role="alert"
          aria-label="Access denied"
        >
          <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>Access Denied</div>
          <div style={{ fontSize: 12, color: "var(--fg)" }}>
            You do not have permission to view alerts. Contact your administrator to request{" "}
            <code>alert:read</code> access.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fade-up" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Page header */}
      <div className="page-header">
        <div>
          <h2 className="serif">Alerts &amp; Event Management</h2>
          <p>Real-time compliance alerts, expiry notifications and AI-driven system events</p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {/* Real-time status */}
          <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 11, color: "var(--sil)" }}>
            <StatusDot color={realtimeConn === "connected" ? "green" : "red"} pulse={realtimeConn === "connected"} />
            {realtimeConn === "connected" ? "Live" : "Offline"}
          </div>

          <button className="btn" onClick={loadAlerts} title="Refresh">
            <RefreshCw size={13} />
          </button>

          {unread > 0 && (canView || canManage) && (
            <button className="btn" onClick={handleMarkAllRead} title="Mark all read">
              <CheckCheck size={13} />
              <span style={{ marginLeft: 5 }}>Mark all read</span>
            </button>
          )}

          {canManageRule && (
            <button
              className="btn-primary"
              onClick={() => { setEditingRule(null); setShowRuleModal(true); }}
            >
              <Plus size={13} style={{ marginRight: 5 }} />
              New Rule
            </button>
          )}
        </div>
      </div>

      {/* KPI Row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        <KpiCard
          label="Total Alerts"
          value={total}
          sub={`${unread} unread`}
          variant="gold"
        />
        <KpiCard
          label="Critical"
          value={critical}
          sub="Require immediate action"
          variant="red"
        />
        <KpiCard
          label="Warnings"
          value={warnings}
          sub="Elevated attention needed"
          variant="amber"
        />
        <KpiCard
          label="Active Rules"
          value={rules.filter((r) => r.enabled).length || "—"}
          sub="Alert rules configured"
          variant="blue"
        />
      </div>

      {/* Error state */}
      {error && (
        <div style={{ background: "rgba(220,38,38,.12)", border: "1px solid var(--R)", borderRadius: 8, padding: 12, color: "var(--R)", fontSize: 12 }}>
          {error}
        </div>
      )}

      {/* Tabs */}
      <Tabs
        items={[
          { key: "alerts",    label: `Alerts${total > 0 ? ` (${total})` : ""}` },
          { key: "rules",     label: "Alert Rules" },
          { key: "analytics", label: "Analytics" },
        ]}
        active={tab}
        onChange={(k) => setTab(k as "alerts" | "rules" | "analytics")}
      />

      {/* ── Alerts Tab ── */}
      {tab === "alerts" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Filter bar */}
          <Card>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 11, color: "var(--sil)" }}>Filter:</span>
              {(["all", "critical", "warning", "info"] as const).map((l) => (
                <button
                  key={l}
                  className={`tab${levelFilter === l ? " on" : ""}`}
                  onClick={() => setLevelFilter(l)}
                  style={{ fontSize: 11, padding: "4px 10px", textTransform: "capitalize" }}
                >
                  {l === "all" ? "All" : l.charAt(0).toUpperCase() + l.slice(1)}
                  {l === "critical" && critical > 0 && (
                    <span style={{ marginLeft: 4, fontSize: 9, background: "var(--R)", color: "#fff", borderRadius: 8, padding: "1px 4px" }}>
                      {critical}
                    </span>
                  )}
                </button>
              ))}

              <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
                <label style={{ fontSize: 11, display: "flex", gap: 6, alignItems: "center", cursor: "pointer", color: "var(--sil)" }}>
                  <input
                    type="checkbox"
                    checked={unreadOnly}
                    onChange={(e) => setUnreadOnly(e.target.checked)}
                  />
                  Unread only
                </label>
              </div>
            </div>
          </Card>

          {loading ? (
            <div style={{ textAlign: "center", padding: 40, color: "var(--sil)" }}>
              <Bell size={24} style={{ marginBottom: 8, opacity: 0.5 }} />
              <div>Loading alerts…</div>
            </div>
          ) : alertRows.length === 0 ? (
            <div style={{ textAlign: "center", padding: 60, color: "var(--sil)" }}>
              <BellOff size={36} style={{ marginBottom: 12, opacity: 0.3 }} />
              <div style={{ fontSize: 14 }}>
                {unreadOnly ? "No unread alerts" : "No alerts found"}
              </div>
              <div style={{ fontSize: 12, marginTop: 4 }}>
                The system is monitoring for events. New alerts will appear here in real time.
              </div>
            </div>
          ) : (
            <Card>
              <DataTable
                columns={alertColumns}
                rows={alertRows}
                rowKey={(r) => r.id as number}
                onRowClick={(r) => setSelectedAlert(r as unknown as Alert)}
                emptyMessage="No alerts"
              />
            </Card>
          )}
        </div>
      )}

      {/* ── Rules Tab ── */}
      {tab === "rules" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Card
            title={<><Zap size={13} style={{ marginRight: 6 }} />Alert Rules</>}
            action={
              canManageRule ? (
                <button
                  className="btn-primary"
                  style={{ fontSize: 11 }}
                  onClick={() => { setEditingRule(null); setShowRuleModal(true); }}
                >
                  <Plus size={12} style={{ marginRight: 4 }} />
                  New Rule
                </button>
              ) : null
            }
          >
            {rulesLoading ? (
              <div style={{ textAlign: "center", padding: 30, color: "var(--sil)", fontSize: 12 }}>
                Loading rules…
              </div>
            ) : (
              <DataTable
                columns={ruleColumns}
                rows={ruleRows}
                rowKey={(r) => r.id as number}
                emptyMessage="No alert rules configured"
              />
            )}
          </Card>

          {/* Channel legend */}
          <Card title="Channel Adapters" style={{ padding: 16 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
              {Object.entries(CHANNEL_LABELS).map(([key, label]) => (
                <div key={key} style={{ textAlign: "center" }}>
                  <div style={{ fontSize: 11, fontWeight: 600 }}>{label}</div>
                  <div style={{ fontSize: 10, color: "var(--sil)", marginTop: 2 }}>{key}</div>
                  <div style={{ marginTop: 6 }}>
                    <Tag variant="green" style={{ fontSize: 9 }}>Active</Tag>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* ── Analytics Tab ── */}
      {tab === "analytics" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Timeline */}
          <LineChartCard
            title="Alert Trend — Last 7 Days"
            data={timelineData}
            xKey="day"
            lines={[
              { key: "critical", color: "var(--R)",     name: "Critical" },
              { key: "warning",  color: "var(--W)",     name: "Warning" },
              { key: "info",     color: "var(--B)",     name: "Info" },
            ]}
            height={200}
          />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {/* Severity donut */}
            {byLevel.length > 0 ? (
              <DonutChartCard
                title="Alerts by Severity"
                data={byLevel}
                height={200}
              />
            ) : (
              <Card title="Alerts by Severity">
                <div style={{ textAlign: "center", padding: 40, color: "var(--sil)", fontSize: 12 }}>
                  No data
                </div>
              </Card>
            )}

            {/* By branch */}
            {byBranch.length > 0 ? (
              <BarChartCard
                title="Alerts by Branch"
                data={byBranch}
                xKey="name"
                bars={[{ key: "count", color: "var(--gold2)", name: "Alerts" }]}
                height={200}
              />
            ) : (
              <Card title="Alerts by Branch">
                <div style={{ textAlign: "center", padding: 40, color: "var(--sil)", fontSize: 12 }}>
                  No data
                </div>
              </Card>
            )}
          </div>

          {/* Summary stats */}
          <Card title="Alert Statistics">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, padding: 4 }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 24, fontWeight: 700, color: "var(--R)" }}>{critical}</div>
                <div style={{ fontSize: 11, color: "var(--sil)" }}>Critical</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 24, fontWeight: 700, color: "var(--W)" }}>{warnings}</div>
                <div style={{ fontSize: 11, color: "var(--sil)" }}>Warnings</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 24, fontWeight: 700, color: "var(--gold2)" }}>{unread}</div>
                <div style={{ fontSize: 11, color: "var(--sil)" }}>Unread</div>
              </div>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 24, fontWeight: 700 }}>{total}</div>
                <div style={{ fontSize: 11, color: "var(--sil)" }}>Total</div>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* Alert detail side panel */}
      {selectedAlert && (
        <AlertDetailPanel
          alert={selectedAlert}
          onClose={() => setSelectedAlert(null)}
          onMarkRead={handleMarkRead}
          onEscalate={handleEscalate}
          canManage={canManage}
        />
      )}

      {/* Alert Rule Modal */}
      <Modal
        open={showRuleModal}
        onClose={() => { setShowRuleModal(false); setEditingRule(null); }}
        title={editingRule ? "Edit Alert Rule" : "Configure Alert Rule"}
        width={560}
      >
        <AlertRuleForm
          initial={
            editingRule
              ? {
                  name: editingRule.name,
                  trigger: editingRule.trigger,
                  channels: editingRule.channels ?? [],
                  escalationTarget: editingRule.escalation_target ?? "",
                  scope: editingRule.scope ?? "",
                  params: JSON.stringify(editingRule.params ?? {}, null, 2),
                }
              : undefined
          }
          onSave={handleSaveRule}
          onCancel={() => { setShowRuleModal(false); setEditingRule(null); }}
          saving={ruleSaving}
        />
      </Modal>
    </div>
  );
}
