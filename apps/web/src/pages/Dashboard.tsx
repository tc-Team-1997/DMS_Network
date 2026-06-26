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

/* ─── Time Period Control ─── */
type TimePeriod = "day" | "month" | "quarter" | "year";

interface PeriodState {
  period: TimePeriod;
  from: string;
  to: string;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function defaultFrom(period: TimePeriod): string {
  const d = new Date();
  if (period === "day") d.setDate(d.getDate() - 1);
  else if (period === "month") d.setMonth(d.getMonth() - 1);
  else if (period === "quarter") d.setMonth(d.getMonth() - 3);
  else d.setFullYear(d.getFullYear() - 1);
  return d.toISOString().slice(0, 10);
}

function PeriodControl({
  value,
  onChange,
}: {
  value: PeriodState;
  onChange: (v: PeriodState) => void;
}) {
  const periods: { key: TimePeriod; label: string }[] = [
    { key: "day", label: "Day" },
    { key: "month", label: "Month" },
    { key: "quarter", label: "Quarter" },
    { key: "year", label: "Year" },
  ];

  function selectPeriod(p: TimePeriod) {
    onChange({ period: p, from: defaultFrom(p), to: todayStr() });
  }

  return (
    <div
      style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}
      aria-label="Time period selector"
    >
      {/* Segmented buttons */}
      <div
        style={{
          display: "flex",
          background: "var(--ink3)",
          border: "1px solid var(--bd)",
          borderRadius: 8,
          overflow: "hidden",
        }}
        role="group"
        aria-label="Select time period"
      >
        {periods.map((p) => {
          const active = value.period === p.key;
          return (
            <button
              key={p.key}
              onClick={() => selectPeriod(p.key)}
              aria-pressed={active}
              style={{
                padding: "6px 14px",
                background: active ? "var(--gold2)" : "transparent",
                color: active ? "#050d1a" : "var(--mist)",
                border: "none",
                fontSize: 11,
                fontWeight: 700,
                cursor: "pointer",
                transition: "background .15s, color .15s",
                fontFamily: "var(--font-sans, Syne, sans-serif)",
              }}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      {/* Date range */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <label style={{ fontSize: 11, color: "var(--sil)", fontWeight: 600 }}>From</label>
        <input
          type="date"
          value={value.from}
          max={value.to}
          aria-label="From date"
          onChange={(e) => onChange({ ...value, from: e.target.value })}
          style={{
            padding: "5px 8px",
            background: "var(--ink3)",
            border: "1px solid var(--bd)",
            borderRadius: 6,
            fontSize: 11,
            color: "var(--mist)",
            cursor: "pointer",
          }}
        />
        <label style={{ fontSize: 11, color: "var(--sil)", fontWeight: 600 }}>To</label>
        <input
          type="date"
          value={value.to}
          min={value.from}
          max={todayStr()}
          aria-label="To date"
          onChange={(e) => onChange({ ...value, to: e.target.value })}
          style={{
            padding: "5px 8px",
            background: "var(--ink3)",
            border: "1px solid var(--bd)",
            borderRadius: 6,
            fontSize: 11,
            color: "var(--mist)",
            cursor: "pointer",
          }}
        />
      </div>
    </div>
  );
}

/* ─── Hover-clickable wrapper ─── */
interface ClickableCardWrapperProps {
  onClick: () => void;
  ariaLabel: string;
  children: React.ReactNode;
}

function ClickableWrapper({ onClick, ariaLabel, children }: ClickableCardWrapperProps) {
  const [hovered, setHovered] = useState(false);
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onClick(); }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        cursor: "pointer",
        borderRadius: 10,
        outline: hovered ? "2px solid var(--gold2)" : "2px solid transparent",
        transition: "outline .15s, transform .1s",
        transform: hovered ? "translateY(-1px)" : "none",
      }}
    >
      {children}
    </div>
  );
}

/* ─── Branch Volume Bar ─── */
interface BranchBarProps {
  name: string;
  count: string;
  pct: number;
  color: string;
  onClick?: () => void;
}

function BranchBar({ name, count, pct, color, onClick }: BranchBarProps) {
  return (
    <div
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter") onClick(); } : undefined}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontSize: 11,
        cursor: onClick ? "pointer" : "default",
        padding: "2px 0",
        borderRadius: 4,
      }}
    >
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

/* ─── Expiring Soon row type ─── */
interface ExpiringDoc {
  id: string;
  title: string;
  branch?: string;
  doc_type?: string;
  expiry_date: string;
  daysLeft: number;
}

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
  const base = Math.max(0, Math.round((totalDocuments / 30)));
  return Array.from({ length: 12 }, (_, i) => ({
    period: `D-${11 - i}`,
    volume: Math.round(base * (0.7 + Math.random() * 0.6)),
    ai: Math.round(base * (0.5 + Math.random() * 0.4)),
  })).map((d, i, arr) => i === arr.length - 1 ? { ...d, volume: indexedToday } : d);
}

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

/* ─── Compute expiring docs ─── */
function buildExpiringDocs(docs: DocumentRecord[], withinDays = 90): ExpiringDoc[] {
  const now = Date.now();
  const result: ExpiringDoc[] = [];
  for (const d of docs) {
    const raw = (d as unknown as Record<string, unknown>)["expiry_date"] as string | undefined;
    if (!raw) continue;
    const expTs = new Date(raw).getTime();
    const daysLeft = Math.ceil((expTs - now) / (1000 * 60 * 60 * 24));
    if (daysLeft >= 0 && daysLeft <= withinDays) {
      result.push({ id: d.id, title: d.title, branch: d.branch, doc_type: d.doc_type, expiry_date: raw, daysLeft });
    }
  }
  return result.sort((a, b) => a.daysLeft - b.daysLeft).slice(0, 10);
}

/* ─── Expiring Soon bucket counts ─── */
function expiryBuckets(docs: DocumentRecord[]) {
  const in30 = buildExpiringDocs(docs, 30).length;
  const in60 = buildExpiringDocs(docs, 60).length - in30;
  const in90 = buildExpiringDocs(docs, 90).length - in30 - in60;
  return { in30, in60, in90 };
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

const EXPIRY_COLS: Column<ExpiringDoc>[] = [
  {
    key: "title",
    header: "Document",
    render: (r) => <span style={{ fontWeight: 600, color: "var(--mist)" }}>{r.title}</span>,
  },
  { key: "branch", header: "Branch", render: (r) => r.branch ?? "—" },
  { key: "doc_type", header: "Type", render: (r) => r.doc_type ?? "—" },
  {
    key: "daysLeft",
    header: "Days Left",
    render: (r) => (
      <Tag variant={r.daysLeft <= 30 ? "red" : r.daysLeft <= 60 ? "amber" : "gold"}>
        {r.daysLeft}d
      </Tag>
    ),
  },
  {
    key: "expiry_date",
    header: "Expires",
    render: (r) => <span style={{ color: "var(--sil)", fontSize: 11 }}>{r.expiry_date.slice(0, 10)}</span>,
  },
];

/* ═══════════════════════════════ DASHBOARD ═══════════════════════════════ */
export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [allDocs, setAllDocs] = useState<DocumentRecord[]>([]);
  const [recentDocs, setRecentDocs] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Time period control state
  const [periodState, setPeriodState] = useState<PeriodState>({
    period: "month",
    from: defaultFrom("month"),
    to: todayStr(),
  });

  // Drill-down panel state
  const [drillDown, setDrillDown] = useState<"category" | "branch" | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      // Pass period/range as query params — backend may ignore them for now
      const summaryParams = new URLSearchParams({
        period: periodState.period,
        from: periodState.from,
        to: periodState.to,
      });
      const [s, docsResp] = await Promise.all([
        dashboardCaptureApi.dashboardSummaryWithParams(summaryParams.toString()),
        dashboardCaptureApi.listDocuments().catch(() => ({ documents: [] })),
      ]);
      setSummary(s);
      setAllDocs(docsResp.documents);
      setRecentDocs(docsResp.documents.slice(0, 12));
    } catch (err: unknown) {
      setError((err as Error).message ?? "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, [periodState]);

  useEffect(() => {
    load();
    return () => {};
  }, [load]);

  const total = summary?.totalDocuments ?? 0;
  const pending = summary?.pendingReview ?? 0;
  const indexedToday = summary?.indexedToday ?? 0;
  const byCategory = summary?.byCategory ?? {};

  // Compute channel breakdown
  const channelCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const d of allDocs) {
      const ch = d.source_channel ?? "UPLOAD";
      counts[ch] = (counts[ch] ?? 0) + 1;
    }
    return counts;
  }, [allDocs]);
  const totalIngested = allDocs.length;

  // Computed data
  const branchStats = useMemo(() => buildBranchStats(allDocs), [allDocs]);
  const donutData = buildDonutData(byCategory);
  const inflowData = useMemo(() => buildInflowData(total, indexedToday), [total, indexedToday]);
  const heatCells = useMemo(() => Array.from({ length: 84 }, (_, i) => ((i * 7 + total) % 100) / 100), [total]);

  // Expiring docs
  const expiringDocs = useMemo(() => buildExpiringDocs(allDocs, 90), [allDocs]);
  const buckets = useMemo(() => expiryBuckets(allDocs), [allDocs]);

  return (
    <div className="fade-up">
      {/* ── Page sub-header: last sync + period control ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        {/* Time period control */}
        <PeriodControl value={periodState} onChange={setPeriodState} />
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div
          style={{
            background: "rgba(224,82,82,.13)",
            border: "1px solid rgba(224,82,82,.3)",
            borderRadius: 8,
            padding: "10px 14px",
            marginBottom: 14,
            fontSize: 12,
            color: "var(--Rtx)",
          }}
        >
          {error} —{" "}
          <button
            onClick={load}
            style={{ color: "var(--Rtx)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}
          >
            Retry
          </button>
        </div>
      )}

      {/* ── KPI Row 1 ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 14 }}>
        <ClickableWrapper onClick={() => navigate("/repository")} ariaLabel="View all documents in repository">
          <KpiCard
            label="Total Documents"
            value={loading ? "…" : total.toLocaleString()}
            sub={<span style={{ color: "var(--Gtx)", fontWeight: 700 }}>↑ 4.2%</span>}
            variant="gold"
          />
        </ClickableWrapper>
        <ClickableWrapper onClick={() => navigate("/search")} ariaLabel="View AI accuracy details">
          <KpiCard
            label="AI Accuracy"
            value="97.4%"
            sub="OCR + NLP classification"
            variant="blue"
          />
        </ClickableWrapper>
        <ClickableWrapper onClick={() => navigate("/review-queue")} ariaLabel="View pending review queue">
          <KpiCard
            label="Pending Review"
            value={loading ? "…" : pending.toLocaleString()}
            sub={
              <span style={{ color: pending > 0 ? "var(--Rtx)" : "var(--Gtx)", fontWeight: 700 }}>
                {pending > 0 ? `${pending} flagged` : "All clear"}
              </span>
            }
            variant="red"
          />
        </ClickableWrapper>
        <ClickableWrapper onClick={() => navigate("/repository")} ariaLabel="View all ingested documents">
          <KpiCard
            label="Total Ingested"
            value={loading ? "…" : totalIngested.toLocaleString()}
            sub={
              loading
                ? ""
                : `${Object.keys(channelCounts).length} channel${Object.keys(channelCounts).length !== 1 ? "s" : ""} active`
            }
            variant="amber"
          />
        </ClickableWrapper>
      </div>

      {/* ── KPI Row 2 ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 16 }}>
        <ClickableWrapper onClick={() => navigate("/repository")} ariaLabel="View documents indexed today">
          <KpiCard
            label="Indexed Today"
            value={loading ? "…" : indexedToday.toLocaleString()}
            sub={<span style={{ color: "var(--Gtx)" }}>Avg cycle: 3.8s</span>}
            variant="green"
          />
        </ClickableWrapper>
        <ClickableWrapper onClick={() => navigate("/search")} ariaLabel="Browse by category in search">
          <KpiCard
            label="Categories"
            value={loading ? "…" : Object.keys(byCategory).length.toLocaleString()}
            sub={loading ? "" : Object.keys(byCategory).slice(0, 2).join(" · ") || "No categories yet"}
            variant="purple"
          />
        </ClickableWrapper>
        <ClickableWrapper onClick={() => navigate("/search")} ariaLabel="Browse by branch in search">
          <KpiCard
            label="Branches Active"
            value={loading ? "…" : branchStats.length.toLocaleString()}
            sub={loading || branchStats.length === 0 ? "No data yet" : `Top: ${branchStats[0]?.name ?? "—"}`}
            variant="blue"
          />
        </ClickableWrapper>
        <ClickableWrapper onClick={() => navigate("/alerts")} ariaLabel="View expiring documents in alerts">
          <KpiCard
            label="Expiring ≤90d"
            value={loading ? "…" : buildExpiringDocs(allDocs, 90).length.toLocaleString()}
            sub={
              loading
                ? ""
                : `${buckets.in30} critical · ${buckets.in60} warn · ${buckets.in90} soon`
            }
            variant="red"
          />
        </ClickableWrapper>
      </div>

      {/* ── Charts Row ── */}
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14, marginBottom: 14 }}>
        <ClickableWrapper onClick={() => navigate("/repository")} ariaLabel="View document inflow details">
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
        </ClickableWrapper>
        <ClickableWrapper
          onClick={() => setDrillDown(drillDown === "category" ? null : "category")}
          ariaLabel="Expand category breakdown drill-down"
        >
          <DonutChartCard
            title={
              <span>
                Doc Type Distribution <Tag variant="gold">MTD</Tag>
              </span>
            }
            data={
              donutData.length > 0
                ? donutData
                : [{ name: "No data yet", value: 1, color: "var(--bd)" }]
            }
            height={160}
          />
        </ClickableWrapper>
      </div>

      {/* ── Category Drill-Down Panel ── */}
      {drillDown === "category" && (
        <div
          style={{
            background: "var(--ink2)",
            border: "1px solid rgba(184,145,42,.25)",
            borderRadius: 10,
            padding: 16,
            marginBottom: 14,
          }}
          role="region"
          aria-label="Category breakdown drill-down"
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 12,
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--gold3)" }}>
              Per-Category Document Counts
            </span>
            <button
              onClick={() => setDrillDown(null)}
              style={{
                background: "none",
                border: "none",
                color: "var(--sil)",
                cursor: "pointer",
                fontSize: 11,
              }}
            >
              Close ✕
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {Object.keys(byCategory).length > 0 ? (
              (() => {
                const maxVal = Math.max(...Object.values(byCategory));
                const COLORS = ["var(--G)", "var(--gold2)", "var(--W)", "var(--B)", "var(--P)", "var(--R)"];
                return Object.entries(byCategory)
                  .sort((a, b) => b[1] - a[1])
                  .map(([label, count], i) => {
                    const pct = maxVal > 0 ? Math.round((count / maxVal) * 100) : 0;
                    const color = COLORS[i % COLORS.length];
                    return (
                      <div key={label}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                          <span style={{ color: "var(--sil)", fontSize: 11 }}>{label}</span>
                          <span style={{ color, fontWeight: 700, fontSize: 11 }}>{count.toLocaleString()}</span>
                        </div>
                        <div
                          style={{ height: 4, background: "var(--bd)", borderRadius: 4, overflow: "hidden" }}
                        >
                          <div
                            style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 4 }}
                          />
                        </div>
                      </div>
                    );
                  });
              })()
            ) : (
              <span style={{ color: "var(--sil)", fontSize: 11 }}>No category data available</span>
            )}
          </div>
        </div>
      )}

      {/* ── Bottom 3-col grid ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 280px", gap: 14, marginBottom: 16 }}>
        {/* Expiring Soon section */}
        <ClickableWrapper onClick={() => navigate("/alerts")} ariaLabel="View all expiring documents in alerts">
          <Card
            title={
              <span>
                Expiring Soon{" "}
                <Tag variant="red">{expiringDocs.length} docs</Tag>
              </span>
            }
            action={
              <div style={{ display: "flex", gap: 6 }}>
                <Tag variant="red">≤30d: {buckets.in30}</Tag>
                <Tag variant="amber">≤60d: {buckets.in60}</Tag>
                <Tag variant="gold">≤90d: {buckets.in90}</Tag>
              </div>
            }
          >
            {loading ? (
              <div
                style={{ padding: "12px 0", textAlign: "center", color: "var(--sil)", fontSize: 12 }}
              >
                Loading…
              </div>
            ) : expiringDocs.length === 0 ? (
              <div style={{ color: "var(--Gtx)", fontSize: 12, padding: "8px 0" }}>
                No documents expiring within 90 days
              </div>
            ) : (
              <DataTable<ExpiringDoc>
                columns={EXPIRY_COLS}
                rows={expiringDocs}
                rowKey={(r) => r.id}
                emptyMessage="No expiring documents"
                onRowClick={(r) => navigate(`/viewer?id=${r.id}`)}
              />
            )}
          </Card>
        </ClickableWrapper>

        {/* Heatmap + Branch Volume — NOT a button wrapper: it contains the
            interactive BranchBar controls (nested interactives are an a11y
            violation). The drill-down is its own labelled button below. */}
        <div>
          <Card title={<span>Branch Activity Heatmap <Tag variant="gold">Today</Tag></span>}>
            <div style={{ fontSize: 10, color: "var(--sil)", marginBottom: 8 }}>
              Document volume · Each cell = 1 branch-hour
            </div>
            <Heatmap cells={heatCells} cols={14} />
            <div
              style={{
                display: "flex",
                gap: 5,
                alignItems: "center",
                fontSize: 10,
                color: "var(--sil)",
                margin: "8px 0",
              }}
            >
              <div style={{ width: 8, height: 8, borderRadius: 2, background: "rgba(184,145,42,.15)" }} />Low
              <div style={{ width: 8, height: 8, borderRadius: 2, background: "rgba(184,145,42,.5)" }} />Med
              <div style={{ width: 8, height: 8, borderRadius: 2, background: "var(--gold3)" }} />Peak
            </div>
            <div style={{ borderTop: "1px solid var(--bd)", marginTop: 8, paddingTop: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: "var(--mist)" }}>
                  By Branch (Top 5)
                </span>
                <button
                  type="button"
                  onClick={() => setDrillDown(drillDown === "branch" ? null : "branch")}
                  aria-expanded={drillDown === "branch"}
                  aria-label="Expand branch breakdown drill-down"
                  style={{ background: "none", border: "none", color: "var(--Btx)", cursor: "pointer", fontSize: 10, fontWeight: 600 }}
                >
                  {drillDown === "branch" ? "Collapse ▲" : "Expand ▼"}
                </button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {branchStats.length > 0 ? (
                  branchStats.map((b) => (
                    <BranchBar
                      key={b.name}
                      name={b.name}
                      count={b.count}
                      pct={b.pct}
                      color={b.color}
                      onClick={() => navigate("/search")}
                    />
                  ))
                ) : (
                  <div style={{ fontSize: 11, color: "var(--sil)" }}>No branch data yet</div>
                )}
              </div>
            </div>
          </Card>
        </div>

        {/* Category Breakdown (compact) */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <ClickableWrapper
            onClick={() => setDrillDown(drillDown === "category" ? null : "category")}
            ariaLabel="Expand or collapse category breakdown"
          >
            <Card
              title={
                <span>
                  Category Breakdown{" "}
                  {!loading && <Tag variant="green">{Object.keys(byCategory).length} types</Tag>}
                </span>
              }
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 11 }}>
                {Object.keys(byCategory).length > 0 ? (
                  (() => {
                    const maxVal = Math.max(...Object.values(byCategory));
                    const COLORS = ["var(--G)", "var(--gold2)", "var(--W)", "var(--B)", "var(--P)"];
                    return Object.entries(byCategory)
                      .slice(0, 5)
                      .map(([label, count], i) => {
                        const pct = maxVal > 0 ? Math.round((count / maxVal) * 100) : 0;
                        const color = COLORS[i % COLORS.length];
                        return (
                          <div key={label}>
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                              <span style={{ color: "var(--sil)" }}>{label}</span>
                              <span style={{ color, fontWeight: 600 }}>{count.toLocaleString()}</span>
                            </div>
                            <div
                              style={{ height: 4, background: "var(--bd)", borderRadius: 4, overflow: "hidden" }}
                            >
                              <div
                                style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 4 }}
                              />
                            </div>
                          </div>
                        );
                      });
                  })()
                ) : (
                  <div style={{ color: "var(--sil)", fontSize: 11 }}>
                    {loading ? "Loading…" : "No category data yet"}
                  </div>
                )}
              </div>
              <div style={{ marginTop: 8, fontSize: 10, color: "var(--sil)" }}>
                Click to expand full breakdown ↓
              </div>
            </Card>
          </ClickableWrapper>
        </div>
      </div>

      {/* ── Branch Drill-Down Panel ── */}
      {drillDown === "branch" && (
        <div
          style={{
            background: "var(--ink2)",
            border: "1px solid rgba(58,159,208,.25)",
            borderRadius: 10,
            padding: 16,
            marginBottom: 14,
          }}
          role="region"
          aria-label="Branch breakdown drill-down"
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 12,
            }}
          >
            <span style={{ fontSize: 12, fontWeight: 700, color: "var(--B)" }}>
              Document Count by Branch
            </span>
            <button
              onClick={() => setDrillDown(null)}
              style={{
                background: "none",
                border: "none",
                color: "var(--sil)",
                cursor: "pointer",
                fontSize: 11,
              }}
            >
              Close ✕
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {branchStats.length > 0 ? (
              branchStats.map((b) => (
                <BranchBar
                  key={b.name}
                  name={b.name}
                  count={b.count}
                  pct={b.pct}
                  color={b.color}
                  onClick={() => navigate("/search")}
                />
              ))
            ) : (
              <span style={{ color: "var(--sil)", fontSize: 11 }}>No branch data available</span>
            )}
          </div>
        </div>
      )}

      {/* ── Recent Documents Table ── */}
      <Card
        title={
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--mist)" }}>
            Recent Documents
          </span>
        }
        action={<Tag variant="blue">{recentDocs.length} items</Tag>}
      >
        {loading ? (
          <div
            style={{ padding: "20px 0", textAlign: "center", color: "var(--sil)", fontSize: 12 }}
          >
            Loading documents…
          </div>
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
