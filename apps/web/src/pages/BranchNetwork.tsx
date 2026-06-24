import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthContext.js";
import {
  KpiCard, Card, DataTable, Tag, StatusDot, Tabs, Modal, FormField,
  BarChartCard, Heatmap,
  type Column,
} from "../components/ui/index.js";
import {
  fetchBranches, fetchAccessPolicies, createBranch, setAccessPolicy,
  type Branch, type BranchAccess,
} from "../api/branchNetwork.js";

/* ─── Helpers ─────────────────────────────────── */
const statusVariant = (s: Branch["status"]) =>
  s === "Active" ? "green" : s === "Degraded" ? "amber" : "red";

const replTag = (mode: Branch["replication_mode"]) =>
  mode === "sync" ? <Tag variant="green">Active-Active</Tag>
  : mode === "async" ? <Tag variant="blue">Active-Passive</Tag>
  : <Tag variant="red">Paused</Tag>;

const REGIONS = ["All", "North", "South", "East", "West", "Central", "International"];

function deriveStats(branches: Branch[]) {
  return {
    total:    branches.length,
    active:   branches.filter(b => b.status === "Active").length,
    degraded: branches.filter(b => b.status === "Degraded").length,
    offline:  branches.filter(b => b.status === "Offline").length,
  };
}

/* ─── Access policy table columns ────────────────────────────────────── */
const policyColumns: Column<BranchAccess & Record<string, unknown>>[] = [
  { key: "source_branch", header: "Source Branch", sortable: true },
  { key: "target_branch", header: "Target Branch", sortable: true },
  {
    key: "policy",
    header: "Policy",
    render: (r) =>
      r.policy === "write"
        ? <Tag variant="gold">Read + Write</Tag>
        : <Tag variant="blue">Read Only</Tag>,
  },
  { key: "created_at", header: "Granted", render: (r) => r.created_at ? String(r.created_at).slice(0, 10) : "—" },
];

/* ─── Volume heatmap seed (84 branches × relative activity) ────────── */
function buildHeatmapCells(branches: Branch[]): number[] {
  // Produce a stable pseudo-random set of 84 cells, seeded from branch ids
  const out: number[] = [];
  for (let i = 0; i < 84; i++) {
    const b = branches[i % branches.length];
    const seed = b ? (b.id * 7 + i * 13) : i * 17;
    out.push((seed % 100) / 100);
  }
  return out;
}

/* ─── Chart data ────────────────────────────────────────────────────── */
const INGEST_MOCK = [
  { day: "Mon", docs: 8200 },
  { day: "Tue", docs: 9400 },
  { day: "Wed", docs: 11200 },
  { day: "Thu", docs: 10800 },
  { day: "Fri", docs: 12400 },
  { day: "Sat", docs: 7100 },
  { day: "Sun", docs: 4800 },
];

/* ═══════════════════════════════════════════════════════════════════════
   BranchNetwork Page
═══════════════════════════════════════════════════════════════════════ */
export default function BranchNetwork() {
  const { user } = useAuth();
  const canRead  = user?.permissions.includes("crossbranch:read") ?? false;
  const canAdmin = user?.permissions.includes("admin:access") ?? false;

  const [branches,   setBranches]   = useState<Branch[]>([]);
  const [policies,   setPolicies]   = useState<BranchAccess[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);
  const [tab,        setTab]        = useState("overview");
  const [regionFilter, setRegion]   = useState("All");
  const [selected,   setSelected]   = useState<Branch | null>(null);
  const [addOpen,    setAddOpen]    = useState(false);
  const [policyOpen, setPolicyOpen] = useState(false);

  /* Add-branch form */
  const [newBranch, setNewBranch] = useState({
    code: "", name: "", region: "", replication_mode: "async" as Branch["replication_mode"],
  });

  /* Policy form */
  const [newPolicy, setNewPolicy] = useState({
    source_branch: "", target_branch: "", policy: "read" as BranchAccess["policy"],
  });

  async function load() {
    setLoading(true); setError(null);
    try {
      const [b, p] = await Promise.all([fetchBranches(), fetchAccessPolicies()]);
      setBranches(b); setPolicies(p);
    } catch {
      setError("Failed to load branch data. Please retry.");
    } finally { setLoading(false); }
  }

  useEffect(() => { if (canRead) load(); }, [canRead]);

  if (!canRead) return (
    <div className="fade-up" style={{ padding: 40 }}>
      <div className="page-header"><div><h2 className="serif">Branch Network</h2></div></div>
      <p style={{ color: "var(--sil)" }}>You don't have permission to view branch network data.</p>
    </div>
  );

  const stats = deriveStats(branches);
  const visible = regionFilter === "All" ? branches : branches.filter(b => b.region === regionFilter);
  const heatCells = buildHeatmapCells(branches.length ? branches : Array.from({ length: 10 }, (_, i) => ({ id: i + 1 }) as Branch));

  async function handleAddBranch(e: FormEvent) {
    e.preventDefault();
    if (!newBranch.code || !newBranch.name) return;
    try {
      await createBranch(newBranch);
      setNewBranch({ code: "", name: "", region: "", replication_mode: "async" });
      setAddOpen(false);
      await load();
    } catch {
      setError("Failed to create branch. Please check your input and try again.");
    }
  }

  return (
    <div className="fade-up">
      {/* ─── Page Header ─────────────────────────────────────── */}
      <div className="page-header">
        <div>
          <h2 className="serif">Branch Network</h2>
          <p>{stats.total} branches · {[...new Set(branches.map(b => b.region).filter(Boolean))].length || 6} regions · Multi-branch governance, access control &amp; replication</p>
        </div>
        <div className="phr">
          <button className="btn bs sm">Network Report</button>
          {canAdmin && (
            <button className="btn bg sm" onClick={() => setAddOpen(true)}>+ Add Branch</button>
          )}
        </div>
      </div>

      {error && (
        <div style={{ background: "rgba(224,82,82,.1)", border: "1px solid rgba(224,82,82,.3)", borderRadius: 8, padding: "10px 16px", marginBottom: 14, color: "var(--R)", fontSize: 13 }}>
          {error} <button className="btn bs xs" style={{ marginLeft: 10 }} onClick={load}>Retry</button>
        </div>
      )}

      {/* ─── KPI Row ─────────────────────────────────────────── */}
      <div className="g4" style={{ marginBottom: 16 }}>
        <KpiCard label="Active Branches"        value={loading ? "—" : stats.active}   sub={`${stats.total} total`}         variant="green" />
        <KpiCard label="Cross-Branch Docs Today" value="4,821"  sub="Shared access transactions"  variant="blue" />
        <KpiCard label="Branches with Issues"    value={loading ? "—" : stats.degraded + stats.offline} sub={`${stats.degraded} degraded · ${stats.offline} offline`} variant="red" />
        <KpiCard label="Avg Replication Latency" value="180ms"  sub="Cross-branch sync"            variant="gold" />
      </div>

      {/* ─── Tabs ──────────────────────────────────────────────── */}
      <Tabs
        items={[
          { key: "overview",  label: "Branch Overview" },
          { key: "replication", label: "Replication & Access Policy" },
          { key: "volume",    label: "Volume Heatmap" },
        ]}
        active={tab}
        onChange={setTab}
      />

      {/* ══════════════════════════════════════
          TAB: OVERVIEW
      ══════════════════════════════════════ */}
      {tab === "overview" && (
        <>
          {/* Region filter */}
          <div style={{ display: "flex", gap: 8, margin: "14px 0 12px", flexWrap: "wrap" }}>
            {REGIONS.map(r => (
              <button
                key={r}
                className={regionFilter === r ? "btn bg xs" : "btn bs xs"}
                onClick={() => setRegion(r)}
                type="button"
              >
                {r}
              </button>
            ))}
          </div>

          {loading ? (
            <div style={{ color: "var(--sil)", padding: 32, textAlign: "center" }}>Loading branches…</div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 12, marginBottom: 16 }}>
              {visible.map(b => (
                <div
                  key={b.id}
                  className={`brc${selected?.id === b.id ? " sel" : ""}`}
                  onClick={() => setSelected(b.id === selected?.id ? null : b)}
                  style={{ cursor: "pointer" }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <StatusDot color={b.status === "Active" ? "green" : b.status === "Degraded" ? "amber" : "red"} pulse={b.status === "Active"} />
                    <span style={{ fontSize: 13, fontWeight: 700, color: selected?.id === b.id ? "var(--gold3)" : "var(--mist)", flex: 1 }}>
                      {b.name}
                    </span>
                    {b.status !== "Active" && (
                      <Tag variant={statusVariant(b.status)} style={{ fontSize: 9 }}>{b.status}</Tag>
                    )}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--sil)", marginBottom: 8 }}>
                    {b.code}{b.region ? ` · ${b.region}` : ""}
                  </div>
                  <div style={{ fontSize: 11, display: "flex", flexDirection: "column", gap: 4 }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "var(--sil)" }}>Replication</span>
                      {replTag(b.replication_mode)}
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ color: "var(--sil)" }}>Status</span>
                      <span style={{ color: b.status === "Active" ? "var(--G)" : b.status === "Degraded" ? "var(--W)" : "var(--R)", fontWeight: 600 }}>
                        {b.status}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
              {/* Add-branch card (admin only) */}
              {canAdmin && (
                <div
                  className="brc"
                  style={{ borderStyle: "dashed", display: "flex", alignItems: "center", justifyContent: "center", minHeight: 140, cursor: "pointer" }}
                  onClick={() => setAddOpen(true)}
                >
                  <div style={{ textAlign: "center", color: "var(--sil)" }}>
                    <div style={{ fontSize: 24 }}>+</div>
                    <div style={{ fontSize: 11 }}>Add Branch</div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Detail panel for selected branch */}
          {selected && (
            <Card title={
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <StatusDot color={selected.status === "Active" ? "green" : selected.status === "Degraded" ? "amber" : "red"} />
                <span style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 18, color: "var(--gold3)" }}>{selected.name}</span>
                <span style={{ fontSize: 11, color: "var(--sil)" }}>({selected.code})</span>
              </span>
            } action={<button className="btn bs xs" onClick={() => setSelected(null)}>✕ Close</button>} style={{ marginTop: 12 }}>
              <div className="g4" style={{ padding: "12px 0" }}>
                <div>
                  <div style={{ fontSize: 10, color: "var(--sil)", marginBottom: 2 }}>Region</div>
                  <div style={{ fontSize: 13 }}>{selected.region ?? "—"}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "var(--sil)", marginBottom: 2 }}>Replication Mode</div>
                  {replTag(selected.replication_mode)}
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "var(--sil)", marginBottom: 2 }}>Status</div>
                  <Tag variant={statusVariant(selected.status)}>{selected.status}</Tag>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: "var(--sil)", marginBottom: 2 }}>Created</div>
                  <div style={{ fontSize: 13 }}>{selected.created_at?.slice(0, 10) ?? "—"}</div>
                </div>
              </div>
              {/* Cross-branch policies for this branch */}
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 11, color: "var(--sil)", marginBottom: 6 }}>Cross-branch access policies:</div>
                {policies.filter(p => p.source_branch === selected.code || p.target_branch === selected.code).length === 0
                  ? <span style={{ fontSize: 11, color: "var(--sil)" }}>No policies configured.</span>
                  : policies.filter(p => p.source_branch === selected.code || p.target_branch === selected.code).map(p => (
                    <span key={p.id} style={{ display: "inline-flex", alignItems: "center", gap: 6, marginRight: 8, marginBottom: 4, padding: "3px 8px", background: "var(--gr)", borderRadius: 5, fontSize: 11 }}>
                      {p.source_branch} → {p.target_branch} <Tag variant={p.policy === "write" ? "gold" : "blue"} style={{ fontSize: 9 }}>{p.policy}</Tag>
                    </span>
                  ))
                }
              </div>
            </Card>
          )}
        </>
      )}

      {/* ══════════════════════════════════════
          TAB: REPLICATION & ACCESS POLICY
      ══════════════════════════════════════ */}
      {tab === "replication" && (
        <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          {/* Replication posture table */}
          <Card title="Cross-Branch Access &amp; Replication Policy">
            {loading ? (
              <div style={{ color: "var(--sil)", padding: 16, textAlign: "center" }}>Loading…</div>
            ) : (
              <DataTable<Branch & Record<string, unknown>>
                columns={[
                  {
                    key: "name",
                    header: "Branch",
                    render: (r) => (
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <StatusDot color={(r.status as Branch["status"]) === "Active" ? "green" : (r.status as Branch["status"]) === "Degraded" ? "amber" : "red"} />
                        {String(r.name)}
                      </div>
                    ),
                    sortable: true,
                  },
                  {
                    key: "replication_mode",
                    header: "Replication",
                    render: (r) => replTag(r.replication_mode as Branch["replication_mode"]),
                  },
                  {
                    key: "region",
                    header: "Region",
                    render: (r) => <span style={{ fontSize: 11, color: "var(--sil)" }}>{String(r.region ?? "—")}</span>,
                  },
                  {
                    key: "status",
                    header: "Status",
                    render: (r) => <Tag variant={statusVariant(r.status as Branch["status"])}>{String(r.status)}</Tag>,
                  },
                ]}
                rows={branches as Array<Branch & Record<string, unknown>>}
                rowKey={(r) => r.id}
                emptyMessage="No branches configured."
              />
            )}
          </Card>

          {/* Access policies */}
          <Card
            title={<span>Cross-Branch Access Policies <Tag variant="blue">{policies.length}</Tag></span>}
            action={canAdmin && (
              <button className="btn bg xs" onClick={() => setPolicyOpen(true)}>+ Set Policy</button>
            )}
          >
            {loading ? (
              <div style={{ color: "var(--sil)", padding: 16, textAlign: "center" }}>Loading…</div>
            ) : (
              <DataTable<BranchAccess & Record<string, unknown>>
                columns={policyColumns}
                rows={policies as Array<BranchAccess & Record<string, unknown>>}
                rowKey={(r) => r.id}
                emptyMessage="No access policies configured."
              />
            )}
          </Card>
        </div>
      )}

      {/* ══════════════════════════════════════
          TAB: VOLUME HEATMAP
      ══════════════════════════════════════ */}
      {tab === "volume" && (
        <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 360px", gap: 14 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Heatmap
              title="Branch Document Activity Heatmap (84 branches · 12 weeks)"
              cells={heatCells}
              cols={12}
            />
            <BarChartCard
              title="Cross-Branch Volume — Last 7 Days"
              data={INGEST_MOCK}
              xKey="day"
              bars={[{ key: "docs", color: "var(--gold2)", name: "Documents Shared" }]}
              height={220}
            />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Card title="Replication Health Summary">
              <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 12 }}>
                {[
                  { label: "Active-Active Sync", count: branches.filter(b => b.replication_mode === "sync").length, color: "var(--G)" },
                  { label: "Active-Passive Async", count: branches.filter(b => b.replication_mode === "async").length, color: "var(--B)" },
                  { label: "Paused / No Replication", count: branches.filter(b => b.replication_mode === "none").length, color: "var(--R)" },
                ].map(item => (
                  <div key={item.label}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ color: "var(--sil)" }}>{item.label}</span>
                      <span style={{ color: item.color, fontWeight: 600 }}>{item.count}</span>
                    </div>
                    <div className="bw2">
                      <div
                        className="bf"
                        style={{
                          width: branches.length ? `${(item.count / branches.length) * 100}%` : "0%",
                          background: item.color,
                          height: 6,
                          borderRadius: 3,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </Card>
            <Card title="Status Distribution">
              <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 12 }}>
                {(["Active", "Degraded", "Offline"] as Branch["status"][]).map(s => {
                  const count = branches.filter(b => b.status === s).length;
                  return (
                    <div key={s} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <StatusDot color={s === "Active" ? "green" : s === "Degraded" ? "amber" : "red"} />
                      <span style={{ color: "var(--mist)", flex: 1 }}>{s}</span>
                      <strong style={{ color: s === "Active" ? "var(--G)" : s === "Degraded" ? "var(--W)" : "var(--R)" }}>{count}</strong>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* ─── Add Branch Modal ──────────────────── */}
      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add New Branch" width={480}>
        <form onSubmit={handleAddBranch} style={{ display: "flex", flexDirection: "column", gap: 12, padding: "8px 0" }}>
          <div className="g2">
            <FormField
              label="Branch Code *"
              placeholder="THI001"
              value={newBranch.code}
              onChange={(e) => setNewBranch({ ...newBranch, code: (e.target as HTMLInputElement).value })}
            />
            <FormField
              label="Branch Name *"
              placeholder="Thimphu Main"
              value={newBranch.name}
              onChange={(e) => setNewBranch({ ...newBranch, name: (e.target as HTMLInputElement).value })}
            />
          </div>
          <div className="g2">
            <FormField
              label="Region"
              placeholder="West"
              value={newBranch.region}
              onChange={(e) => setNewBranch({ ...newBranch, region: (e.target as HTMLInputElement).value })}
            />
            <FormField
              as="select"
              label="Replication Mode"
              value={newBranch.replication_mode}
              onChange={(e) => setNewBranch({ ...newBranch, replication_mode: (e.target as HTMLSelectElement).value as Branch["replication_mode"] })}
            >
              <option value="sync">Active-Active (sync)</option>
              <option value="async">Active-Passive (async)</option>
              <option value="none">None (paused)</option>
            </FormField>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button type="submit" className="btn bg" style={{ flex: 1 }}>Create Branch</button>
            <button type="button" className="btn bs" onClick={() => setAddOpen(false)}>Cancel</button>
          </div>
        </form>
      </Modal>

      {/* ─── Set Access Policy Modal ──────────── */}
      <Modal open={policyOpen} onClose={() => setPolicyOpen(false)} title="Set Cross-Branch Access Policy" width={480}>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!newPolicy.source_branch || !newPolicy.target_branch) return;
            try {
              await setAccessPolicy(newPolicy);
              setNewPolicy({ source_branch: "", target_branch: "", policy: "read" });
              setPolicyOpen(false);
              await load();
            } catch {
              setError("Failed to set access policy. Please try again.");
            }
          }}
          style={{ display: "flex", flexDirection: "column", gap: 12, padding: "8px 0" }}
        >
          <FormField
            as="select"
            label="Source Branch"
            value={newPolicy.source_branch}
            onChange={(e) => setNewPolicy({ ...newPolicy, source_branch: (e.target as HTMLSelectElement).value })}
          >
            <option value="">— Select source —</option>
            {branches.map(b => <option key={b.id} value={b.code}>{b.name} ({b.code})</option>)}
          </FormField>
          <FormField
            as="select"
            label="Target Branch"
            value={newPolicy.target_branch}
            onChange={(e) => setNewPolicy({ ...newPolicy, target_branch: (e.target as HTMLSelectElement).value })}
          >
            <option value="">— Select target —</option>
            {branches.map(b => <option key={b.id} value={b.code}>{b.name} ({b.code})</option>)}
          </FormField>
          <FormField
            as="select"
            label="Access Policy"
            value={newPolicy.policy}
            onChange={(e) => setNewPolicy({ ...newPolicy, policy: (e.target as HTMLSelectElement).value as BranchAccess["policy"] })}
          >
            <option value="read">Read Only</option>
            <option value="write">Read + Write</option>
          </FormField>
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button type="submit" className="btn bg" style={{ flex: 1 }}>Apply Policy</button>
            <button type="button" className="btn bs" onClick={() => setPolicyOpen(false)}>Cancel</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
