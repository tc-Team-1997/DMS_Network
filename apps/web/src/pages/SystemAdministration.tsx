import { useEffect, useState, useCallback } from "react";
import { useAuth } from "../auth/AuthContext.js";
import {
  KpiCard, Card, DataTable, Tag, StatusDot, Tabs,
} from "../components/ui/index.js";
import type { Column } from "../components/ui/index.js";
import { systemAdministrationApi } from "../api/systemAdministration.js";
import type {
  ServiceHealth,
  DrPosture,
  ScheduleEntry,
  DedupConfig,
} from "../api/systemAdministration.js";
import { useUrlState } from "../hooks/useUrlState.js";
import { DocTypesPanel } from "../components/doctypes/DocTypesPanel.js";
import { EmailTemplatesPanel } from "../components/emailtemplates/EmailTemplatesPanel.js";
import { ApiDocsPanel } from "../components/apidocs/ApiDocsPanel.js";
import { ConfigurationPanel } from "../components/config/ConfigurationPanel.js";
import { listJobs } from "../api/jobsApi.js";
import type { JobStatus, MonitorJob } from "../api/jobsApi.js";

/* ─── helpers ─── */
function healthVariant(s: ServiceHealth["status"]): "green" | "amber" | "red" {
  if (s === "Up") return "green";
  if (s === "Degraded") return "amber";
  return "red";
}

function healthTagVariant(s: ServiceHealth["status"]): "green" | "amber" | "red" | "blue" | "purple" | "gold" {
  if (s === "Up") return "green";
  if (s === "Degraded") return "amber";
  return "red";
}

function kindTagVariant(k: "backup" | "maintenance"): "green" | "amber" | "red" | "blue" | "purple" | "gold" {
  return k === "backup" ? "blue" : "gold";
}

const TABS = [
  { key: "health", label: "Service Health" },
  { key: "dr", label: "Disaster Recovery" },
  { key: "schedules", label: "Backup & Maintenance" },
  { key: "queue", label: "Processing Queue" },
  { key: "dedup", label: "Duplicate Detection" },
  { key: "config", label: "Configuration" },
  { key: "doctypes", label: "Document Types" },
  { key: "emailtemplates", label: "Email Templates" },
  { key: "apidocs", label: "API Documentation" },
];

type HealthRow = ServiceHealth & { _key: string };
type ScheduleRow = ScheduleEntry & { _key: string };

/* ─── Processing-queue helpers (P8 background job monitor) ─── */
const JOB_STATUS_ORDER: JobStatus[] = ["queued", "running", "succeeded", "failed", "dead"];

function jobStatusTagVariant(s: JobStatus): "green" | "amber" | "red" | "blue" | "purple" | "gold" {
  switch (s) {
    case "succeeded":
      return "green";
    case "running":
      return "blue";
    case "queued":
      return "purple";
    case "failed":
      return "amber";
    case "dead":
      return "red";
    default:
      return "gold";
  }
}

export function SystemAdministration() {
  const { user } = useAuth();
  const canAdmin = Boolean(user?.permissions.includes("admin:access"));
  // `doctype:write` (P5) gates create/edit/delete of document types; CDO has all perms.
  const canWriteDocTypes = Boolean(
    user?.permissions.includes("doctype:write") || user?.permissions.includes("admin:access"),
  );
  const canWriteEmailTemplates = Boolean(
    user?.permissions.includes("email_template:manage") || user?.permissions.includes("admin:access"),
  );

  /* ─── Pattern 2: URL-driven tab selection ─── */
  const [urlState, setUrlState] = useUrlState({
    tab: "health",
  });

  const tab = urlState.tab;
  const setTab = (t: string) => setUrlState({ tab: t });

  const [health, setHealth] = useState<HealthRow[]>([]);
  const [dr, setDr] = useState<DrPosture | null>(null);
  const [schedules, setSchedules] = useState<ScheduleRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  // Dedup config state
  const [dedupConfig, setDedupConfig] = useState<DedupConfig | null>(null);
  const [dedupDraft, setDedupDraft] = useState<DedupConfig | null>(null);
  const [dedupLoading, setDedupLoading] = useState(false);
  const [dedupSaving, setDedupSaving] = useState(false);
  const [dedupMsg, setDedupMsg] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  // ── Processing queue (P8 background job monitor) ──
  const [jobCounts, setJobCounts] = useState<Record<string, number>>({});
  const [jobs, setJobs] = useState<MonitorJob[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [jobsRefreshedAt, setJobsRefreshedAt] = useState<Date | null>(null);

  const loadAll = useCallback(async () => {
    if (!canAdmin) return;
    setLoading(true);
    setError(null);
    try {
      const [h, d, s] = await Promise.all([
        systemAdministrationApi.getHealth(),
        systemAdministrationApi.getDrPosture(),
        systemAdministrationApi.getSchedules(),
      ]);
      setHealth(h.health.map((svc) => ({ ...svc, _key: svc.service })));
      setDr(d.dr);
      setSchedules(s.schedules.map((e, i) => ({ ...e, _key: `${e.name}-${i}` })));
      setLastRefresh(new Date());
    } catch (e: any) {
      setError(String(e?.message ?? "Failed to load system administration data"));
    } finally {
      setLoading(false);
    }
  }, [canAdmin]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const loadDedupConfig = useCallback(async () => {
    if (!canAdmin) return;
    setDedupLoading(true);
    try {
      const res = await systemAdministrationApi.getDedupConfig();
      setDedupConfig(res.dedupConfig);
      setDedupDraft({ ...res.dedupConfig });
    } catch {
      // best-effort
    } finally {
      setDedupLoading(false);
    }
  }, [canAdmin]);

  useEffect(() => {
    if (tab === "dedup" && canAdmin && !dedupConfig) {
      loadDedupConfig();
    }
  }, [tab, canAdmin, dedupConfig, loadDedupConfig]);

  const loadJobs = useCallback(async () => {
    if (!canAdmin) return;
    setJobsLoading(true);
    setJobsError(null);
    try {
      const res = await listJobs({ limit: 50 });
      setJobCounts(res.counts ?? {});
      setJobs(res.jobs ?? []);
      setJobsRefreshedAt(new Date());
    } catch (e: any) {
      setJobsError(String(e?.message ?? "Failed to load processing queue"));
    } finally {
      setJobsLoading(false);
    }
  }, [canAdmin]);

  useEffect(() => {
    if (tab === "queue" && canAdmin && jobsRefreshedAt === null) {
      loadJobs();
    }
  }, [tab, canAdmin, jobsRefreshedAt, loadJobs]);

  async function handleSaveDedupConfig() {
    if (!dedupDraft) return;
    setDedupSaving(true);
    setDedupMsg(null);
    try {
      const res = await systemAdministrationApi.putDedupConfig(dedupDraft);
      setDedupConfig(res.dedupConfig);
      setDedupDraft({ ...res.dedupConfig });
      setDedupMsg({ kind: "success", text: "Duplicate detection configuration saved." });
    } catch (e: unknown) {
      const err = e as { body?: { errors?: string[] }; message?: string };
      const detail = err?.body?.errors?.join(", ") ?? err?.message ?? "Save failed.";
      setDedupMsg({ kind: "error", text: detail });
    } finally {
      setDedupSaving(false);
    }
  }

  if (!canAdmin) {
    return (
      <div className="fade-up">
        <div className="page-header">
          <div>
            <h2 className="serif">System Administration</h2>
            <p>You do not have permission to view this page.</p>
          </div>
        </div>
      </div>
    );
  }

  /* ─── derived stats ─── */
  const upCount = health.filter((h) => h.status === "Up").length;
  const degradedCount = health.filter((h) => h.status === "Degraded").length;
  const downCount = health.filter((h) => h.status === "Down").length;
  const avgLatency = health.length
    ? Math.round(health.reduce((s, h) => s + h.latency_ms, 0) / health.length)
    : 0;

  /* ─── table columns ─── */
  const healthCols: Column<HealthRow>[] = [
    {
      key: "service", header: "Service", sortable: true,
      render: (r) => (
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <StatusDot
            color={healthVariant(r.status)}
            pulse={r.status === "Up"}
          />
          <span style={{ fontWeight: 600, textTransform: "capitalize" }}>{r.service}</span>
        </span>
      ),
    },
    {
      key: "status", header: "Status", width: 120,
      render: (r) => <Tag variant={healthTagVariant(r.status)}>{r.status}</Tag>,
    },
    {
      key: "latency_ms", header: "Latency", width: 100, sortable: true,
      render: (r) => (
        <span
          style={{
            fontSize: 12, fontWeight: 600,
            color: r.latency_ms > 500 ? "var(--R)" : r.latency_ms > 100 ? "var(--W)" : "var(--G)",
          }}
        >
          {r.latency_ms > 0 ? `${r.latency_ms}ms` : "—"}
        </span>
      ),
    },
    {
      key: "_bar", header: "Latency (relative)", width: 160,
      render: (r) => {
        const pct = Math.min(100, r.latency_ms > 0 ? Math.min(r.latency_ms / 10, 100) : 0);
        const barColor = pct > 80 ? "var(--R)" : pct > 50 ? "var(--W)" : "var(--G)";
        return (
          <div style={{ background: "rgba(15,23,42,.06)", borderRadius: 3, height: 6, overflow: "hidden" }}>
            <div style={{ width: `${pct}%`, height: "100%", background: barColor, borderRadius: 3, minWidth: pct > 0 ? 4 : 0 }} />
          </div>
        );
      },
    },
  ];

  const scheduleCols: Column<ScheduleRow>[] = [
    { key: "name", header: "Task", sortable: true },
    {
      key: "kind", header: "Kind", width: 120,
      render: (r) => <Tag variant={kindTagVariant(r.kind)}>{r.kind}</Tag>,
    },
    {
      key: "cron", header: "Schedule", width: 130,
      render: (r) => <span className="mono" style={{ fontSize: 11 }}>{r.cron}</span>,
    },
    {
      key: "last_run", header: "Last Run", width: 170,
      render: (r) => (
        <span style={{ fontSize: 11, color: "var(--sil)" }}>
          {r.last_run ? new Date(r.last_run).toLocaleString() : "—"}
        </span>
      ),
    },
    {
      key: "next_run", header: "Next Run", width: 170,
      render: (r) => (
        <span style={{ fontSize: 11, color: "var(--gold3)" }}>
          {r.next_run ? new Date(r.next_run).toLocaleString() : "—"}
        </span>
      ),
    },
  ];

  return (
    <div className="fade-up">
      {/* ── page header ── */}
      <div className="page-header">
        <div>
          <h2 className="serif">System Administration</h2>
          <p>Platform health · Disaster Recovery · Backup · Storage · Maintenance scheduling</p>
        </div>
        <div className="phr">
          <button className="btn bg sm" onClick={loadAll} disabled={loading}>
            {loading ? "Loading…" : "Run Diagnostics"}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: "10px 14px", background: "var(--RT)", border: "1px solid rgba(224,82,82,.3)", borderRadius: 8, marginBottom: 14, fontSize: 12, color: "var(--R)" }}>
          {error}
        </div>
      )}

      {lastRefresh && (
        <div style={{ marginBottom: 12, fontSize: 11, color: "var(--sil)" }}>
          Last refreshed: {lastRefresh.toLocaleTimeString()}
        </div>
      )}

      {/* ── KPI row ── */}
      <div className="g4" style={{ marginBottom: 18 }}>
        <KpiCard
          label="Services Up"
          value={`${upCount} / ${health.length}`}
          sub={downCount > 0
            ? <Tag variant="red">{downCount} down</Tag>
            : <span style={{ color: "var(--G)" }}>All systems operational</span>}
          variant="green"
        />
        <KpiCard
          label="Degraded"
          value={degradedCount}
          sub={degradedCount > 0 ? "Elevated latency detected" : "None — stable"}
          variant={degradedCount > 0 ? "amber" : "green"}
        />
        <KpiCard
          label="Avg Response"
          value={`${avgLatency}ms`}
          sub="Cross-service average latency"
          variant="blue"
        />
        <KpiCard
          label="DR Posture"
          value={dr ? `${dr.rpo_minutes}m RPO` : "—"}
          sub={dr ? `${dr.rto_minutes}m RTO · ${dr.replication_lag_seconds}s lag` : "Loading…"}
          variant="gold"
        />
      </div>

      {/* ── Tabs ── */}
      <Tabs items={TABS} active={tab} onChange={setTab} />

      {/* ═══ SERVICE HEALTH TAB ═══ */}
      {tab === "health" && (
        <div style={{ marginTop: 14 }}>
          <Card
            title={
              <span>
                Service Health Monitor{" "}
                {degradedCount > 0 && <Tag variant="amber">{degradedCount} degraded</Tag>}
                {downCount > 0 && <Tag variant="red">{downCount} down</Tag>}
              </span>
            }
          >
            {loading ? (
              <div style={{ padding: 32, textAlign: "center", color: "var(--sil)" }}>Probing services…</div>
            ) : (
              /* Pattern 3: pagination via DataTable pageSize prop */
              <DataTable<HealthRow>
                columns={healthCols}
                rows={health}
                rowKey={(r) => r._key}
                emptyMessage="No service health data"
                pageSize={10}
              />
            )}
          </Card>

          {/* inline health cards when data present */}
          {health.length > 0 && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 10, marginTop: 14 }}>
              {health.map((h) => (
                <div key={h.service} style={{
                  padding: 14,
                  background: "var(--ink3)",
                  border: `1px solid ${h.status === "Up" ? "rgba(46,204,138,.15)" : h.status === "Degraded" ? "rgba(240,160,48,.25)" : "rgba(224,82,82,.3)"}`,
                  borderRadius: 9,
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <span style={{ fontWeight: 700, textTransform: "capitalize", fontSize: 12 }}>{h.service}</span>
                    <StatusDot color={healthVariant(h.status)} pulse={h.status === "Up"} />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <Tag variant={healthTagVariant(h.status)}>{h.status}</Tag>
                    <span style={{ fontSize: 11, color: "var(--sil)" }}>
                      {h.latency_ms > 0 ? `${h.latency_ms}ms` : "—"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══ DISASTER RECOVERY TAB ═══ */}
      {tab === "dr" && (
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 14 }}>
          {dr ? (
            <>
              <div className="g2">
                {/* Primary site */}
                <div style={{
                  background: "var(--ink3)",
                  border: "1px solid rgba(46,204,138,.2)",
                  borderRadius: 10, padding: "16px 18px",
                  display: "flex", alignItems: "center", gap: 14,
                }}>
                  <div style={{ flexShrink: 0 }}>
                    <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "1.5px", color: "var(--G)", marginBottom: 4 }}>Primary Site</div>
                    <div style={{ fontSize: 16, fontWeight: 700 }}>{dr.primary_site}</div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, color: "var(--sil)", marginBottom: 6 }}>Active production site — all live traffic</div>
                    <Tag variant="green">Live · Active</Tag>
                  </div>
                </div>

                {/* DR site */}
                <div style={{
                  background: "var(--ink3)",
                  border: "1px solid rgba(58,159,208,.2)",
                  borderRadius: 10, padding: "16px 18px",
                  display: "flex", alignItems: "center", gap: 14,
                }}>
                  <div style={{ flexShrink: 0 }}>
                    <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "1.5px", color: "var(--B)", marginBottom: 4 }}>DR Site</div>
                    <div style={{ fontSize: 16, fontWeight: 700 }}>{dr.dr_site}</div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, color: "var(--sil)", marginBottom: 6 }}>
                      Standby · {dr.replication_lag_seconds}s replication lag
                    </div>
                    <Tag variant="blue">Synced · Active-Passive</Tag>
                  </div>
                </div>
              </div>

              {/* DR metrics */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 12 }}>
                {[
                  { label: "RPO", value: `${dr.rpo_minutes} min`, hint: "Recovery Point Objective", color: "var(--G)" },
                  { label: "RTO", value: `${dr.rto_minutes} min`, hint: "Recovery Time Objective", color: "var(--G)" },
                  { label: "Replication Lag", value: `${dr.replication_lag_seconds}s`, hint: "Average lag behind primary", color: dr.replication_lag_seconds > 30 ? "var(--W)" : "var(--G)" },
                  { label: "Last DR Test", value: dr.last_failover_test ?? "—", hint: "Most recent failover test", color: "var(--B)" },
                ].map((kv) => (
                  <div key={kv.label} style={{ background: "var(--ink3)", border: "1px solid var(--bd)", borderRadius: 9, padding: "12px 14px" }}>
                    <div style={{ fontSize: 10, color: "var(--sil)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.5px" }}>{kv.label}</div>
                    <div style={{ fontWeight: 700, fontSize: 18, color: kv.color }}>{kv.value}</div>
                    <div style={{ fontSize: 10, color: "var(--sil)", marginTop: 3 }}>{kv.hint}</div>
                  </div>
                ))}
              </div>

              {/* DR readiness checklist */}
              <Card title="DR Readiness Checklist">
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {[
                    { item: "Replication verified — lag within SLA", ok: dr.replication_lag_seconds <= 60 },
                    { item: "RPO target achievable", ok: dr.rpo_minutes <= 30 },
                    { item: "RTO target achievable", ok: dr.rto_minutes <= 120 },
                    { item: "Last failover test recorded", ok: Boolean(dr.last_failover_test) },
                  ].map((c) => (
                    <div key={c.item} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12 }}>
                      <span style={{ color: c.ok ? "var(--G)" : "var(--R)", fontSize: 14, flexShrink: 0 }}>
                        {c.ok ? "✓" : "✗"}
                      </span>
                      <span style={{ color: c.ok ? "var(--mist)" : "var(--sil)" }}>{c.item}</span>
                    </div>
                  ))}
                </div>
              </Card>
            </>
          ) : (
            <Card>
              <div style={{ padding: 40, textAlign: "center", color: "var(--sil)" }}>
                {loading ? "Loading DR posture…" : "No DR data available"}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ═══ PROCESSING QUEUE TAB (P8 background jobs) ═══ */}
      {tab === "queue" && (
        <div style={{ marginTop: 14 }}>
          {/* Counts by status */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
              gap: 10,
              marginBottom: 14,
            }}
          >
            {JOB_STATUS_ORDER.map((s) => {
              const count = jobCounts[s] ?? 0;
              const isDead = s === "dead";
              return (
                <div
                  key={s}
                  data-testid={`job-count-${s}`}
                  style={{
                    background: "var(--ink3)",
                    border: `1px solid ${isDead && count > 0 ? "rgba(224,82,82,.4)" : "var(--bd)"}`,
                    borderRadius: 9,
                    padding: "12px 14px",
                  }}
                >
                  <div
                    style={{
                      fontSize: 10,
                      color: "var(--sil)",
                      marginBottom: 4,
                      textTransform: "uppercase",
                      letterSpacing: "0.5px",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                    }}
                  >
                    {s}
                    {isDead && count > 0 && <Tag variant="red">dead-letter</Tag>}
                  </div>
                  <div
                    style={{
                      fontWeight: 700,
                      fontSize: 22,
                      color: isDead && count > 0 ? "var(--R)" : "var(--mist)",
                    }}
                  >
                    {count}
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: "var(--sil)" }}>
              {jobsRefreshedAt
                ? `Last refreshed: ${jobsRefreshedAt.toLocaleTimeString()}`
                : "Not yet loaded"}
            </span>
            <button
              className="btn bg sm"
              onClick={loadJobs}
              disabled={jobsLoading}
              aria-label="Refresh processing queue"
            >
              {jobsLoading ? "Refreshing…" : "Refresh"}
            </button>
          </div>

          {jobsError && (
            <div
              role="alert"
              style={{
                padding: "10px 14px",
                background: "var(--RT)",
                border: "1px solid rgba(224,82,82,.3)",
                borderRadius: 8,
                marginBottom: 12,
                fontSize: 12,
                color: "var(--R)",
              }}
            >
              {jobsError}
            </div>
          )}

          <Card
            title={
              <span>
                Recent Jobs{" "}
                {(jobCounts.dead ?? 0) > 0 && (
                  <Tag variant="red">{jobCounts.dead} dead-letter</Tag>
                )}
              </span>
            }
          >
            {jobsLoading && jobs.length === 0 ? (
              <div style={{ padding: 32, textAlign: "center", color: "var(--sil)" }}>
                Loading jobs…
              </div>
            ) : (
              <DataTable<MonitorJob & { _key: string }>
                columns={[
                  { key: "type", header: "Type", sortable: true },
                  {
                    key: "status",
                    header: "Status",
                    width: 120,
                    render: (r) => (
                      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <Tag variant={jobStatusTagVariant(r.status)}>{r.status}</Tag>
                        {r.status === "dead" && <StatusDot color="red" />}
                      </span>
                    ),
                  },
                  {
                    key: "attempts",
                    header: "Attempts",
                    width: 100,
                    render: (r) => (
                      <span style={{ fontSize: 12, color: "var(--sil)" }}>
                        {r.attempts} / {r.maxAttempts}
                      </span>
                    ),
                  },
                  {
                    key: "lastError",
                    header: "Last Error",
                    render: (r) => (
                      <span
                        style={{
                          fontSize: 11,
                          color: r.lastError ? "var(--R)" : "var(--sil)",
                          fontFamily: r.lastError ? "monospace" : undefined,
                        }}
                      >
                        {r.lastError ?? "—"}
                      </span>
                    ),
                  },
                  {
                    key: "createdAt",
                    header: "Created",
                    width: 170,
                    render: (r) => (
                      <span style={{ fontSize: 11, color: "var(--sil)" }}>
                        {r.createdAt ? new Date(r.createdAt).toLocaleString() : "—"}
                      </span>
                    ),
                  },
                ]}
                rows={jobs.map((j) => ({ ...j, _key: j.id }))}
                rowKey={(r) => r._key}
                emptyMessage="No jobs in the queue"
                pageSize={10}
              />
            )}
          </Card>
        </div>
      )}

      {/* ═══ DUPLICATE DETECTION TAB ═══ */}
      {tab === "dedup" && (
        <div style={{ marginTop: 14, maxWidth: 560 }}>
          <Card title="Duplicate Detection Configuration">
            {dedupLoading ? (
              <div style={{ padding: 32, textAlign: "center", color: "var(--sil)" }}>Loading…</div>
            ) : dedupDraft ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {/* Enabled toggle */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 600 }}>Enabled</div>
                    <div style={{ fontSize: 11, color: "var(--sil)", marginTop: 2 }}>
                      Enable or disable duplicate detection globally.
                    </div>
                  </div>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={dedupDraft.enabled}
                      onChange={(e) => setDedupDraft({ ...dedupDraft, enabled: e.target.checked })}
                      aria-label="Enable duplicate detection"
                    />
                    <span style={{ fontSize: 11, color: dedupDraft.enabled ? "var(--G)" : "var(--sil)" }}>
                      {dedupDraft.enabled ? "On" : "Off"}
                    </span>
                  </label>
                </div>

                {/* Match By */}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Match By</div>
                  <div style={{ fontSize: 11, color: "var(--sil)", marginBottom: 8 }}>
                    Select which fields to use for duplicate matching.
                  </div>
                  <div style={{ display: "flex", gap: 12 }}>
                    {(["hash", "cid", "doc_no"] as const).map((field) => (
                      <label
                        key={field}
                        style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 12 }}
                      >
                        <input
                          type="checkbox"
                          checked={dedupDraft.matchBy.includes(field)}
                          aria-label={`Match by ${field}`}
                          onChange={(e) => {
                            const next = e.target.checked
                              ? [...dedupDraft.matchBy, field]
                              : dedupDraft.matchBy.filter((f) => f !== field);
                            setDedupDraft({ ...dedupDraft, matchBy: next });
                          }}
                        />
                        <span style={{ fontFamily: "monospace", color: "var(--gold2)" }}>{field}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Action */}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>Action</div>
                  <div style={{ fontSize: 11, color: "var(--sil)", marginBottom: 8 }}>
                    What to do when a duplicate is detected.
                  </div>
                  <div style={{ display: "flex", gap: 12 }}>
                    {(["flag", "auto_version"] as const).map((act) => (
                      <label
                        key={act}
                        style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 12 }}
                      >
                        <input
                          type="radio"
                          name="dedup-action"
                          value={act}
                          checked={dedupDraft.action === act}
                          aria-label={act === "flag" ? "Flag duplicate" : "Auto-version duplicate"}
                          onChange={() => setDedupDraft({ ...dedupDraft, action: act })}
                        />
                        <span>
                          {act === "flag" ? (
                            <>Flag &mdash; <span style={{ color: "var(--sil)", fontSize: 10 }}>report in extract response</span></>
                          ) : (
                            <>Auto-version &mdash; <span style={{ color: "var(--sil)", fontSize: 10 }}>supersede original</span></>
                          )}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Fuzzy Threshold */}
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                    Fuzzy Threshold
                    <span style={{ marginLeft: 8, fontSize: 11, fontFamily: "monospace", color: "var(--gold2)" }}>
                      {dedupDraft.fuzzyThreshold.toFixed(2)}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--sil)", marginBottom: 8 }}>
                    Similarity threshold for fuzzy matching (0.0 – 1.0). Use 1.0 for exact match only.
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={dedupDraft.fuzzyThreshold}
                    aria-label="Fuzzy threshold"
                    onChange={(e) =>
                      setDedupDraft({ ...dedupDraft, fuzzyThreshold: parseFloat(e.target.value) })
                    }
                    style={{ width: "100%" }}
                  />
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--sil)" }}>
                    <span>0.0 (loose)</span>
                    <span>1.0 (exact)</span>
                  </div>
                </div>

                {/* Feedback message */}
                {dedupMsg && (
                  <div
                    role="status"
                    style={{
                      padding: "8px 12px",
                      borderRadius: 6,
                      fontSize: 12,
                      background: dedupMsg.kind === "success" ? "var(--GT)" : "var(--RT)",
                      border: `1px solid ${dedupMsg.kind === "success" ? "rgba(46,204,138,.3)" : "rgba(224,82,82,.3)"}`,
                      color: dedupMsg.kind === "success" ? "var(--G)" : "var(--R)",
                    }}
                  >
                    {dedupMsg.text}
                  </div>
                )}

                {/* Save button — gated on admin:write */}
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
                  <button
                    className="btn bs sm"
                    onClick={() => { setDedupDraft({ ...dedupConfig! }); setDedupMsg(null); }}
                    disabled={dedupSaving}
                  >
                    Reset
                  </button>
                  <button
                    className="btn bg sm"
                    onClick={handleSaveDedupConfig}
                    disabled={dedupSaving || !canAdmin}
                    aria-label="Save dedup config"
                  >
                    {dedupSaving ? "Saving…" : "Save"}
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ padding: 24, textAlign: "center", color: "var(--sil)" }}>
                No configuration available.
              </div>
            )}
          </Card>

          {/* Current values display */}
          {dedupConfig && (
            <Card title="Current Saved Values" style={{ marginTop: 12 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 11 }}>
                {[
                  ["Enabled", dedupConfig.enabled ? "Yes" : "No"],
                  ["Match By", dedupConfig.matchBy.join(", ")],
                  ["Action", dedupConfig.action],
                  ["Fuzzy Threshold", dedupConfig.fuzzyThreshold.toFixed(2)],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid var(--bd)" }}
                  >
                    <span style={{ color: "var(--sil)" }}>{label}</span>
                    <span style={{ fontFamily: "monospace", color: "var(--mist)" }}>{value}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ═══ SCHEDULES TAB ═══ */}
      {tab === "schedules" && (
        <div style={{ marginTop: 14 }}>
          {/* summary */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 10, marginBottom: 14 }}>
            {["backup", "maintenance"].map((kind) => {
              const group = schedules.filter((s) => s.kind === kind);
              return (
                <div key={kind} style={{ background: "var(--ink3)", border: "1px solid var(--bd)", borderRadius: 9, padding: "12px 14px" }}>
                  <div style={{ fontSize: 10, color: "var(--sil)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                    {kind} tasks
                  </div>
                  <div style={{ fontWeight: 700, fontSize: 22 }}>{group.length}</div>
                  <div style={{ fontSize: 10, color: "var(--sil)", marginTop: 3 }}>
                    Scheduled jobs
                  </div>
                </div>
              );
            })}
          </div>

          <Card title="Backup &amp; Maintenance Schedule">
            {loading ? (
              <div style={{ padding: 32, textAlign: "center", color: "var(--sil)" }}>Loading schedules…</div>
            ) : (
              /* Pattern 3: pagination via DataTable pageSize prop */
              <DataTable<ScheduleRow>
                columns={scheduleCols}
                rows={schedules}
                rowKey={(r) => r._key}
                emptyMessage="No scheduled tasks configured"
                pageSize={10}
              />
            )}
          </Card>

          {/* Schedule details cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 12, marginTop: 14 }}>
            {schedules.map((s) => (
              <div key={s._key} style={{ background: "var(--ink3)", border: "1px solid var(--bd)", borderRadius: 9, padding: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontWeight: 700, fontSize: 12 }}>{s.name}</span>
                  <Tag variant={kindTagVariant(s.kind)}>{s.kind}</Tag>
                </div>
                <div style={{ fontSize: 11, display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--sil)" }}>Cron</span>
                    <span className="mono" style={{ fontSize: 10 }}>{s.cron}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--sil)" }}>Last run</span>
                    <span style={{ color: "var(--G)", fontSize: 10 }}>
                      {s.last_run ? new Date(s.last_run).toLocaleDateString() : "—"}
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--sil)" }}>Next run</span>
                    <span style={{ color: "var(--gold3)", fontSize: 10 }}>
                      {s.next_run ? new Date(s.next_run).toLocaleDateString() : "—"}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══ DOCUMENT TYPES TAB ═══ */}
      {tab === "doctypes" && (
        <DocTypesPanel canWrite={canWriteDocTypes} />
      )}

      {/* ═══ EMAIL TEMPLATES TAB ═══ */}
      {tab === "emailtemplates" && (
        <EmailTemplatesPanel canWrite={canWriteEmailTemplates} />
      )}

      {/* ═══ CONFIGURATION TAB ═══ */}
      {tab === "config" && <ConfigurationPanel canWrite={canAdmin} />}

      {/* ═══ API DOCUMENTATION TAB ═══ */}
      {tab === "apidocs" && <ApiDocsPanel />}
    </div>
  );
}

export default SystemAdministration;
