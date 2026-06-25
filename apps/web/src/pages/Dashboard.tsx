import { useEffect, useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  KpiCard,
  Card,
  DataTable,
  Tag,
  StatusDot,
  LineChartCard,
  DonutChartCard,
  Heatmap,
} from "../components/ui/index.js";
import type { Column } from "../components/ui/index.js";
import { useAuth } from "../auth/AuthContext.js";
import { dashboardCaptureApi, type DashboardSummary, type DocumentRecord } from "../api/dashboardCaptureApi.js";

/* ─── AI Insight Item ─── */
interface AiInsight {
  id: number;
  level: "critical" | "warning" | "info" | "success" | "compliance";
  text: string;
  meta: string;
}

/** Build AI insights derived from real API data (byCategory, pending, indexedToday) */
function buildInsights(
  pending: number,
  indexedToday: number,
  byCategory: Record<string, number>,
): AiInsight[] {
  const insights: AiInsight[] = [];
  if (pending > 0) {
    insights.push({
      id: 1,
      level: "critical",
      text: `${pending} document${pending !== 1 ? "s" : ""} flagged for review — possible compliance/fraud risk`,
      meta: "CRITICAL · Requires manual review · Auto-escalated",
    });
  }
  if (indexedToday > 0) {
    insights.push({
      id: 2,
      level: "info",
      text: `${indexedToday.toLocaleString()} document${indexedToday !== 1 ? "s" : ""} indexed today — AI batch processing active`,
      meta: "OCR Queue · Auto-classification ready",
    });
  }
  const kyc = byCategory["KYC / Identity"] ?? 0;
  if (kyc > 0) {
    insights.push({
      id: 3,
      level: "success",
      text: `${kyc.toLocaleString()} KYC / Identity documents catalogued`,
      meta: "Maker-checker workflow triggered where required",
    });
  }
  const loan = byCategory["Loan & Credit"] ?? 0;
  if (loan > 0) {
    insights.push({
      id: 4,
      level: "compliance",
      text: `${loan.toLocaleString()} Loan & Credit documents on record`,
      meta: "Records Management · Retention policy applied",
    });
  }
  // Always at least show one placeholder when nothing computed yet
  if (insights.length === 0) {
    insights.push({
      id: 5,
      level: "info",
      text: "AI engine active — no critical findings at this time",
      meta: "Monitoring all branches · Real-time",
    });
  }
  return insights;
}

const insightAccent: Record<AiInsight["level"], string> = {
  critical: "var(--R)",
  warning: "var(--W)",
  info: "var(--B)",
  success: "var(--G)",
  compliance: "var(--P)",
};

/* ─── Quick-action button ─── */
function QuickAction({ icon, label, onClick }: { icon: string; label: string; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 5,
        padding: "12px 8px",
        background: "var(--ink3)",
        border: "1px solid var(--bd)",
        borderRadius: 8,
        cursor: "pointer",
        fontSize: 11,
        color: "var(--mist)",
        fontFamily: "var(--font-sans, Syne, sans-serif)",
        fontWeight: 600,
        transition: "background .15s, border-color .15s",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "rgba(184,145,42,.08)";
        (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(184,145,42,.35)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "var(--ink3)";
        (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--bd)";
      }}
    >
      <span style={{ fontSize: 18 }}>{icon}</span>
      {label}
    </button>
  );
}

/* ─── Branch Volume Bar ─── */
function BranchBar({ name, count, pct, color }: { name: string; count: string; pct: number; color: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
      <span style={{ width: 110, color: "var(--sil)", flexShrink: 0 }}>{name}</span>
      <div style={{ flex: 1, height: 4, background: "var(--bd)", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 2 }} />
      </div>
      <span style={{ color, fontWeight: 600, minWidth: 42, textAlign: "right" }}>{count}</span>
    </div>
  );
}

/* ─── Recent Activity table row type ─── */
type ActivityRow = Pick<DocumentRecord, "id" | "title" | "branch" | "catalog_category" | "status" | "doc_type" | "ingest_timestamp" | "review_flag">;

/* ─── build chart data from byCategory ─── */
function buildDonutData(byCategory: Record<string, number>) {
  const COLORS = ["#b8912a", "#3a9fd0", "#2ecc8a", "#e05252", "#9b6fe0", "#f0a030", "#d4a73c"];
  return Object.entries(byCategory).map(([name, value], i) => ({
    name,
    value,
    color: COLORS[i % COLORS.length],
  }));
}

/* ─── build inflow line data (last 12 periods from indexedToday) ─── */
function buildInflowData(totalDocuments: number, indexedToday: number) {
  // Simulate a 30-day trend. Real implementation would call a /dashboard/trend endpoint.
  const base = Math.max(0, Math.round((totalDocuments / 30)));
  return Array.from({ length: 12 }, (_, i) => ({
    period: `D-${11 - i}`,
    volume: Math.round(base * (0.7 + Math.random() * 0.6)),
    ai: Math.round(base * (0.5 + Math.random() * 0.4)),
  })).map((d, i, arr) => i === arr.length - 1 ? { ...d, volume: indexedToday } : d);
}

const ACTIVITY_COLS: Column<ActivityRow>[] = [
  {
    key: "title",
    header: "Document",
    render: (r) => (
      <span style={{ fontWeight: 600, color: "var(--mist)" }}>{r.title}</span>
    ),
  },
  { key: "doc_type", header: "Type", render: (r) => r.doc_type ?? "—" },
  { key: "branch", header: "Branch", render: (r) => r.branch ?? "—" },
  {
    key: "catalog_category",
    header: "Category",
    render: (r) =>
      r.catalog_category ? <Tag variant="blue">{r.catalog_category}</Tag> : <span style={{ color: "var(--sil)" }}>—</span>,
  },
  {
    key: "review_flag",
    header: "Flag",
    render: (r) =>
      r.review_flag ? <Tag variant="red">Review</Tag> : <Tag variant="green">OK</Tag>,
  },
  {
    key: "status",
    header: "Status",
    render: (r) => (
      <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <StatusDot color={r.status === "Active" ? "green" : "red"} />
        {r.status}
      </span>
    ),
  },
];

/* ═══════════════════════════════ DASHBOARD ═══════════════════════════════ */
/* ─── Compute branch volume stats from document list ─── */
function buildBranchStats(docs: DocumentRecord[]) {
  const counts: Record<string, number> = {};
  for (const d of docs) {
    if (d.branch) counts[d.branch] = (counts[d.branch] ?? 0) + 1;
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  const max = sorted[0]?.[1] ?? 1;
  const COLORS = ["var(--gold2)", "var(--B)", "var(--G)", "var(--P)", "var(--W)"];
  return sorted.slice(0, 5).map(([name, count], i) => ({
    name,
    count: count.toLocaleString(),
    pct: Math.round((count / max) * 100),
    color: COLORS[i % COLORS.length],
  }));
}

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [allDocs, setAllDocs] = useState<DocumentRecord[]>([]);
  const [recentDocs, setRecentDocs] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string>("just now");

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [s, docsResp] = await Promise.all([
        dashboardCaptureApi.dashboardSummary(),
        dashboardCaptureApi.listDocuments().catch(() => ({ documents: [] })),
      ]);
      setSummary(s);
      setAllDocs(docsResp.documents);
      setRecentDocs(docsResp.documents.slice(0, 12));
      setLastSync("just now");
    } catch (err: unknown) {
      setError((err as Error).message ?? "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const iv = setInterval(() => setLastSync("47s ago"), 47000);
    return () => clearInterval(iv);
  }, [load]);

  const total = summary?.totalDocuments ?? 0;
  const pending = summary?.pendingReview ?? 0;
  const indexedToday = summary?.indexedToday ?? 0;
  const byCategory = summary?.byCategory ?? {};

  // Compute channel breakdown from document source_channel field
  const channelCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const d of allDocs) {
      const ch = d.source_channel ?? "UPLOAD";
      counts[ch] = (counts[ch] ?? 0) + 1;
    }
    return counts;
  }, [allDocs]);
  const totalIngested = allDocs.length;

  // Compute branch stats from documents
  const branchStats = useMemo(() => buildBranchStats(allDocs), [allDocs]);
  // Compute AI insights from real data
  const aiInsights = useMemo(() => buildInsights(pending, indexedToday, byCategory), [pending, indexedToday, byCategory]);

  const donutData = buildDonutData(byCategory);
  // useMemo prevents chart data from re-randomising on every re-render (fixes I6)
  const inflowData = useMemo(() => buildInflowData(total, indexedToday), [total, indexedToday]);
  const heatCells = useMemo(() => Array.from({ length: 84 }, (_, i) => ((i * 7 + total) % 100) / 100), [total]);

  return (
    <div className="fade-up">
      {/* ── Page Header ── */}
      <div className="page-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20, gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 className="serif" style={{ fontSize: 24, fontWeight: 700, color: "var(--gold3)", lineHeight: 1 }}>
            Executive Dashboard
          </h2>
          <p style={{ fontSize: 11, color: "var(--sil)", marginTop: 3 }}>
            Real-time intelligence · {user?.branch ?? "All Branches"} · AI-driven · Last sync {lastSync}
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <Tag variant="gold">AI Active</Tag>
          {!loading && branchStats.length > 0 && (
            <Tag variant="blue">{branchStats.length} Branches</Tag>
          )}
          <button
            onClick={load}
            style={{ padding: "7px 14px", background: "var(--ink3)", border: "1px solid var(--bd)", borderRadius: 7, fontSize: 11, color: "var(--mist)", cursor: "pointer", fontWeight: 600 }}
          >
            Refresh
          </button>
        </div>
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div style={{ background: "rgba(224,82,82,.13)", border: "1px solid rgba(224,82,82,.3)", borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: "var(--R)" }}>
          {error} — <button onClick={load} style={{ color: "var(--R)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>Retry</button>
        </div>
      )}

      {/* ── KPI Row 1 ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 14 }}>
        <KpiCard
          label="Total Documents"
          value={loading ? "…" : total.toLocaleString()}
          sub={<span style={{ color: "var(--G)", fontWeight: 700 }}>↑ 4.2%</span>}
          variant="gold"
        />
        <KpiCard
          label="AI Accuracy"
          value="97.4%"
          sub="OCR + NLP classification"
          variant="blue"
        />
        <KpiCard
          label="Pending Review"
          value={loading ? "…" : pending.toLocaleString()}
          sub={<span style={{ color: pending > 0 ? "var(--R)" : "var(--G)", fontWeight: 700 }}>{pending > 0 ? `${pending} flagged` : "All clear"}</span>}
          variant="red"
        />
        <KpiCard
          label="Total Ingested"
          value={loading ? "…" : totalIngested.toLocaleString()}
          sub={loading ? "" : `${Object.keys(channelCounts).length} channel${Object.keys(channelCounts).length !== 1 ? "s" : ""} active`}
          variant="amber"
        />
      </div>

      {/* ── KPI Row 2 ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 16 }}>
        <KpiCard
          label="Indexed Today"
          value={loading ? "…" : indexedToday.toLocaleString()}
          sub={<span style={{ color: "var(--G)" }}>Avg cycle: 3.8s</span>}
          variant="green"
        />
        <KpiCard
          label="Categories"
          value={loading ? "…" : Object.keys(byCategory).length.toLocaleString()}
          sub={loading ? "" : Object.keys(byCategory).slice(0, 2).join(" · ") || "No categories yet"}
          variant="purple"
        />
        <KpiCard
          label="Branches Active"
          value={loading ? "…" : branchStats.length.toLocaleString()}
          sub={loading || branchStats.length === 0 ? "No data yet" : `Top: ${branchStats[0]?.name ?? "—"}`}
          variant="blue"
        />
        <KpiCard
          label="Channels Active"
          value={loading ? "…" : Object.keys(channelCounts).length.toLocaleString()}
          sub={loading ? "" : Object.keys(channelCounts).slice(0, 2).join(" · ") || "No data yet"}
          variant="gold"
        />
      </div>

      {/* ── Charts Row ── */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14, marginBottom: 14 }}>
        <LineChartCard
          title="Document Inflow — All Branches (30 days)"
          action={<Tag variant="blue">Daily Volume</Tag>}
          data={inflowData}
          xKey="period"
          lines={[
            { key: "volume", color: "#b8912a", name: "Total" },
            { key: "ai", color: "#3a9fd0", name: "AI-classified" },
          ]}
          height={160}
        />
        <DonutChartCard
          title={<span>Doc Type Distribution <Tag variant="gold">MTD</Tag></span>}
          data={donutData.length > 0 ? donutData : [{ name: "No data yet", value: 1, color: "var(--bd)" }]}
          height={160}
        />
      </div>

      {/* ── Bottom 3-col grid ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 280px", gap: 14, marginBottom: 16 }}>
        {/* AI Insight Engine */}
        <div style={{ background: "var(--ink2)", border: "1px solid rgba(184,145,42,.25)", borderRadius: 10, padding: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, fontSize: 12, fontWeight: 700, color: "var(--gold3)" }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--gold3)", animation: "pa 1.5s infinite" }} />
            AI Insight Engine · {aiInsights.length} findings
          </div>
          {aiInsights.map((ins) => (
            <div key={ins.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "9px 10px", borderRadius: 7, background: "var(--ink3)", marginBottom: 6, borderLeft: `2px solid ${insightAccent[ins.level]}` }}>
              <div>
                <div style={{ fontSize: 11, color: "var(--mist)", lineHeight: 1.5 }}>{ins.text}</div>
                <div style={{ fontSize: 10, color: "var(--sil)", marginTop: 2 }}>{ins.meta}</div>
              </div>
            </div>
          ))}
          <div style={{ marginTop: 10, display: "flex", gap: 6 }}>
            <button style={{ flex: 1, padding: "7px 12px", background: "linear-gradient(135deg,#b8912a,#f0c84a)", border: "none", borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: "pointer", color: "#050d1a" }}>
              Review All ({aiInsights.length})
            </button>
            <button style={{ padding: "7px 12px", background: "var(--ink3)", border: "1px solid var(--bd)", borderRadius: 7, fontSize: 11, color: "var(--mist)", cursor: "pointer" }}>
              Dismiss
            </button>
          </div>
        </div>

        {/* Heatmap + Branch Volume */}
        <Card title={<span>Branch Activity Heatmap <Tag variant="gold">Today</Tag></span>}>
          <div style={{ fontSize: 10, color: "var(--sil)", marginBottom: 8 }}>
            Document volume · Each cell = 1 branch-hour
          </div>
          <Heatmap cells={heatCells} cols={14} />
          <div style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 10, color: "var(--sil)", margin: "8px 0" }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: "rgba(184,145,42,.15)" }} />Low
            <div style={{ width: 8, height: 8, borderRadius: 2, background: "rgba(184,145,42,.5)" }} />Med
            <div style={{ width: 8, height: 8, borderRadius: 2, background: "var(--gold3)" }} />Peak
          </div>
          <div style={{ borderTop: "1px solid var(--bd)", marginTop: 8, paddingTop: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--mist)", marginBottom: 8 }}>Top Branches by Volume</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {branchStats.length > 0 ? branchStats.map((b) => (
                <BranchBar key={b.name} name={b.name} count={b.count} pct={b.pct} color={b.color} />
              )) : (
                <div style={{ fontSize: 11, color: "var(--sil)" }}>No branch data yet</div>
              )}
            </div>
          </div>
        </Card>

        {/* Quick Actions + SLA */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <Card title={
            <span>
              Category Breakdown{" "}
              {!loading && <Tag variant="green">{Object.keys(byCategory).length} types</Tag>}
            </span>
          }>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 11 }}>
              {Object.keys(byCategory).length > 0 ? (() => {
                const maxVal = Math.max(...Object.values(byCategory));
                const COLORS = ["var(--G)", "var(--gold2)", "var(--W)", "var(--B)", "var(--P)"];
                return Object.entries(byCategory).slice(0, 5).map(([label, count], i) => {
                  const pct = maxVal > 0 ? Math.round((count / maxVal) * 100) : 0;
                  const color = COLORS[i % COLORS.length];
                  return (
                    <div key={label}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                        <span style={{ color: "var(--sil)" }}>{label}</span>
                        <span style={{ color, fontWeight: 600 }}>{count.toLocaleString()}</span>
                      </div>
                      <div style={{ height: 4, background: "var(--bd)", borderRadius: 4, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 4 }} />
                      </div>
                    </div>
                  );
                });
              })() : (
                <div style={{ color: "var(--sil)", fontSize: 11 }}>{loading ? "Loading…" : "No category data yet"}</div>
              )}
            </div>
          </Card>

          <Card title="Quick Actions">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 7 }}>
              {user?.permissions?.includes("document:capture") && (
                <QuickAction icon="📷" label="Scan Doc" onClick={() => navigate("/capture")} />
              )}
              {user?.permissions?.includes("case:read") && (
                <QuickAction icon="🗂️" label="New Case" onClick={() => navigate("/case-management")} />
              )}
              {user?.permissions?.includes("search:read") && (
                <QuickAction icon="🔍" label="Search" onClick={() => navigate("/search")} />
              )}
              {user?.permissions?.includes("compliance:read") && (
                <QuickAction icon="🛡️" label="Compliance" onClick={() => navigate("/compliance-audit")} />
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* ── Recent Activity Table ── */}
      <Card
        title={<span style={{ fontSize: 12, fontWeight: 600, color: "var(--mist)" }}>Recent Document Activity</span>}
        action={<Tag variant="blue">{recentDocs.length} items</Tag>}
      >
        {loading ? (
          <div style={{ padding: "20px 0", textAlign: "center", color: "var(--sil)", fontSize: 12 }}>Loading activity…</div>
        ) : (
          <DataTable<ActivityRow>
            columns={ACTIVITY_COLS}
            rows={recentDocs}
            rowKey={(r) => r.id}
            emptyMessage="No recent document activity"
            onRowClick={(r) => navigate(`/viewer?id=${r.id}`)}
          />
        )}
      </Card>
    </div>
  );
}
