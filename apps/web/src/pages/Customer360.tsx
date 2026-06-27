import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.js";
import {
  KpiCard, Card, DataTable, Tag, StatusDot, Tabs,
  DonutChartCard, RefId,
  type Column,
} from "../components/ui/index.js";
import { fetchCustomerProfile, type CustomerProfile, type KycRequirement } from "../api/customer360.js";

/* ─── Doc type icon mapping ──────────────────────────────────── */
const DOC_ICONS: Record<string, string> = {
  BT_CID_4G: "🪪",
  BT_CITIZENSHIP: "🏛",
  BT_PASSPORT: "🛂",
  FOREIGN_PASSPORT: "🛂",
  BOB_ACCOUNT_FORM: "🏦",
  NOMINEE_FORM: "📋",
  PHOTO: "🖼",
  SIGNATURE: "✍",
  BOB_LOAN_APPLICATION: "📄",
  SAR_REPORT: "🔍",
  GENERAL_LETTER: "📩",
};

function docIcon(type: string): string {
  return DOC_ICONS[type] ?? "📄";
}

/* ─── Status variants ────────────────────────────────────────── */
function kycTagVariant(status: CustomerProfile["kyc"]["status"]) {
  if (status === "Complete") return "green";
  if (status === "Partial")  return "amber";
  return "red";
}

/* ─── KYC SVG ring ───────────────────────────────────────────── */
function KycRing({ pct }: { pct: number }) {
  const r = 26;
  const circ = 2 * Math.PI * r; // ≈163.4
  const dash = (pct / 100) * circ;
  return (
    <div style={{ position: "relative", width: 68, height: 68, flexShrink: 0 }}>
      <svg width="68" height="68" viewBox="0 0 68 68">
        <circle cx="34" cy="34" r={r} fill="none" stroke="rgba(15,23,42,.08)" strokeWidth="6" />
        <circle
          cx="34" cy="34" r={r} fill="none"
          stroke="var(--gold2)" strokeWidth="6"
          strokeDasharray={`${dash.toFixed(1)} ${circ.toFixed(1)}`}
          strokeLinecap="round"
          transform="rotate(-90 34 34)"
        />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Cormorant Garamond',serif", fontSize: 14, fontWeight: 700, color: "var(--gold3)" }}>
        {pct}%
      </div>
    </div>
  );
}

/* ─── Timeline item ──────────────────────────────────────────── */
function TimelineItem({ ts, action, details }: { ts: string; action: string; details?: string }) {
  const isRecent = new Date(ts) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  return (
    <div className="tli">
      <div className={`tld ${isRecent ? "act" : "done"}`} />
      <div>
        <div className="tlt">{action}</div>
        <div className="tls">{details ?? ""} · {ts.slice(0, 10)}</div>
      </div>
    </div>
  );
}

/* ─── Document table columns ────────────────────────────────── */
const docColumns: Column<CustomerProfile["documents"][0] & Record<string, unknown>>[] = [
  {
    key: "doc_type",
    header: "Type",
    render: (r) => (
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 15 }}>{docIcon(String(r.doc_type))}</span>
        <Tag variant="gold" style={{ fontSize: 10 }}>{String(r.doc_type)}</Tag>
      </span>
    ),
    sortable: true,
  },
  { key: "doc_no", header: "Doc No.", render: (r) => r.doc_no ? <RefId value={String(r.doc_no)} className="mono" style={{ fontSize: 11 }} /> : <span style={{ color: "var(--sil)" }}>—</span> },
  {
    key: "status",
    header: "Status",
    render: (r) => {
      const s = String(r.status);
      const v = s === "Indexed" || s === "Archived" ? "green" : s === "Disposed" ? "red" : "amber";
      return <Tag variant={v}>{s}</Tag>;
    },
    sortable: true,
  },
  { key: "created_at", header: "Captured", render: (r) => r.created_at ? String(r.created_at).slice(0, 10) : "—", sortable: true },
];

/* ═══════════════════════════════════════════════════════════════════════
   CID Search bar (when no cid param)
═══════════════════════════════════════════════════════════════════════ */
function CidSearch({ onSearch }: { onSearch: (cid: string) => void }) {
  const [val, setVal] = useState("");
  function submit(e: FormEvent) { e.preventDefault(); if (val.trim()) onSearch(val.trim()); }
  return (
    <form onSubmit={submit} style={{ display: "flex", gap: 10, alignItems: "flex-end", marginTop: 16 }}>
      <div style={{ flex: 1 }}>
        <label style={{ fontSize: 11, color: "var(--sil)" }}>Customer CID / Account</label>
        <input
          type="text"
          placeholder="Search CID, name, account…"
          value={val}
          onChange={e => setVal(e.target.value)}
          style={{ width: "100%", fontSize: 12 }}
        />
      </div>
      <button className="btn bg sm" type="submit">Find</button>
    </form>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   Customer360 Page
═══════════════════════════════════════════════════════════════════════ */
export default function Customer360() {
  const { user } = useAuth();
  const routeParams = useParams<{ cid?: string }>();
  const canRead = user?.permissions.includes("document:read") ?? false;

  const [cidInput, setCidInput] = useState<string>(routeParams.cid ?? "");
  const [activeCid, setActiveCid] = useState<string>(routeParams.cid ?? "");
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState("overview");

  async function load(cid: string) {
    if (!cid) return;
    setLoading(true); setError(null); setProfile(null);
    try {
      const p = await fetchCustomerProfile(cid);
      setProfile(p);
    } catch {
      setError(`No profile found for CID "${cid}". Please check and try again.`);
    } finally { setLoading(false); }
  }

  useEffect(() => { if (canRead && activeCid) load(activeCid); }, [activeCid, canRead]);

  function handleSearch(cid: string) {
    setCidInput(cid);
    setActiveCid(cid);
  }

  if (!canRead) return (
    <div className="fade-up" style={{ padding: 40 }}>
      <div className="page-header"><div><h2 className="serif">Customer 360°</h2></div></div>
      <p style={{ color: "var(--sil)" }}>You don't have permission to view customer profiles.</p>
    </div>
  );

  const pct  = profile ? Math.round(profile.kyc.completeness * 100) : 0;
  const donutData = profile
    ? [
        { name: "KYC Met",    value: profile.kyc.requirements.filter(r => r.satisfied).length,  color: "var(--G)" },
        { name: "KYC Missing", value: profile.kyc.requirements.filter(r => !r.satisfied).length, color: "var(--R)" },
      ]
    : [];

  const initials = profile?.cid.slice(-4) ?? "—";

  return (
    <div className="fade-up">
      {/* ─── Page Header ──────────────────────────────── */}
      <div className="page-header">
        <div>
          <h2 className="serif">Customer 360°</h2>
          <p>Complete document portfolio · CID-centric view · KYC compliance status</p>
        </div>
        <div className="phr">
          <form
            onSubmit={(e) => { e.preventDefault(); setActiveCid(cidInput); }}
            style={{ display: "flex", gap: 8 }}
          >
            <input
              type="text"
              style={{ width: 240, fontSize: 12 }}
              placeholder="Search CID, name, account…"
              value={cidInput}
              onChange={e => setCidInput(e.target.value)}
            />
            <button className="btn bg sm" type="submit">Find</button>
          </form>
        </div>
      </div>

      {!activeCid ? (
        <CidSearch onSearch={handleSearch} />
      ) : loading ? (
        <div style={{ color: "var(--sil)", padding: 32, textAlign: "center" }}>Loading profile for {activeCid}…</div>
      ) : error ? (
        <div style={{ background: "rgba(224,82,82,.1)", border: "1px solid rgba(224,82,82,.3)", borderRadius: 8, padding: "10px 16px", marginTop: 16, color: "var(--R)", fontSize: 13 }}>
          {error}
        </div>
      ) : profile ? (
        <>
          {/* ─── KPI Row ─────────────────────────────────── */}
          <div className="g4" style={{ marginBottom: 16, marginTop: 14 }}>
            <KpiCard
              label="KYC Completeness"
              value={`${pct}%`}
              sub={profile.kyc.status}
              variant={pct >= 100 ? "green" : pct >= 50 ? "amber" : "red"}
            />
            <KpiCard
              label="Documents"
              value={profile.documents.length}
              sub={`${profile.portfolio.length} doc types`}
              variant="blue"
            />
            <KpiCard
              label="KYC Requirements"
              value={`${profile.kyc.requirements.filter(r => r.satisfied).length}/${profile.kyc.requirements.length}`}
              sub="satisfied"
              variant="gold"
            />
            <KpiCard
              label="Timeline Events"
              value={profile.timeline.length}
              sub="audit events"
              variant={profile.kyc.escalated ? "red" : "green"}
            />
          </div>

          {/* ─── CBS master record (from the integrated core-banking system) ─── */}
          <Card
            title={<span>Core Banking (CBS) Master Record</span>}
            action={profile.master?.source
              ? <Tag variant="blue">source: {profile.master.source}</Tag>
              : <Tag variant="amber">not synced</Tag>}
            style={{ marginBottom: 16 }}
          >
            {profile.master ? (
              <div className="g4" style={{ gap: 14 }}>
                {[
                  ["Name", profile.master.name],
                  ["Branch", profile.master.branch],
                  ["Segment", profile.master.segment],
                  ["CBS KYC Status", profile.master.kyc_status],
                ].map(([label, val]) => (
                  <div key={label}>
                    <div style={{ fontSize: 10, letterSpacing: 1, textTransform: "uppercase", color: "var(--sil)", marginBottom: 4 }}>{label}</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "var(--mist)" }}>{val || "—"}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: "var(--sil)", padding: "6px 0" }}>
                No master record for this customer yet. It populates automatically when the integrated
                CBS (BANCS / GBP) pushes a customer-update event. Configure the CBS connector under
                System Administration → Integrations.
              </div>
            )}
          </Card>

          {/* ─── Tabs ──────────────────────────────────────── */}
          <Tabs
            items={[
              { key: "overview",   label: "Overview" },
              { key: "documents",  label: `Documents (${profile.documents.length})` },
              { key: "kyc",        label: "KYC Status" },
              { key: "timeline",   label: "Activity Timeline" },
            ]}
            active={tab}
            onChange={setTab}
          />

          {/* ══════════════════
              TAB: OVERVIEW
          ══════════════════ */}
          {tab === "overview" && (
            <div className="g21" style={{ marginTop: 14 }}>
              {/* Left column */}
              <div>
                {/* Customer identity card */}
                <Card style={{ marginBottom: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <div style={{ width: 52, height: 52, borderRadius: "50%", background: "linear-gradient(135deg,var(--ink4),var(--gold))", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Cormorant Garamond',serif", fontSize: 18, fontWeight: 700, flexShrink: 0 }}>
                      {initials}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontFamily: "'Cormorant Garamond',serif", fontSize: 20, fontWeight: 700, color: "var(--gold3)" }}>
                        Customer {profile.cid}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
                        <span className="mono" style={{ fontSize: 10, color: "var(--sil)" }}>CID: {profile.cid}</span>
                        <Tag variant={kycTagVariant(profile.kyc.status)}>{profile.kyc.status === "Complete" ? "KYC Verified" : `KYC ${profile.kyc.status}`}</Tag>
                        {profile.kyc.escalated && <Tag variant="red">⚠ Escalated</Tag>}
                      </div>
                    </div>
                  </div>
                </Card>

                {/* KYC Requirements */}
                <Card title="KYC Compliance Status · CBE Requirements" style={{ marginBottom: 14 }}>
                  {profile.kyc.requirements.map((req: KycRequirement) => (
                    <div key={req.key} className="sr">
                      <span>{req.label}</span>
                      <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        {req.satisfied
                          ? <Tag variant="green">On file</Tag>
                          : <Tag variant="red">Missing</Tag>}
                      </span>
                    </div>
                  ))}
                </Card>

                {/* Document Portfolio mini-grid */}
                <Card title={<span>Document Portfolio <Tag variant="blue">{profile.documents.length} Documents</Tag></span>}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 7, marginTop: 8 }}>
                    {profile.portfolio.map(p => (
                      <div
                        key={p.doc_type}
                        style={{ background: "var(--gr)", border: "1px solid var(--bd)", borderRadius: 7, padding: 10, cursor: "pointer", textAlign: "center" }}
                      >
                        <div style={{ fontSize: 18, marginBottom: 4 }}>{docIcon(p.doc_type)}</div>
                        <div style={{ fontSize: 10, fontWeight: 600, color: "var(--mist)" }}>{p.doc_type.replace(/_/g, " ")}</div>
                        <Tag variant="blue" style={{ fontSize: 9, marginTop: 2 }}>{p.count}</Tag>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>

              {/* Right column */}
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {/* Timeline */}
                <Card title="Activity Timeline">
                  <div className="tl">
                    {profile.timeline.length === 0
                      ? <div style={{ color: "var(--sil)", fontSize: 12, padding: "8px 0" }}>No timeline events yet.</div>
                      : profile.timeline.slice(0, 8).map((t) => (
                        <TimelineItem key={`${t.ts}_${t.action}`} ts={t.ts} action={t.action} details={t.details} />
                      ))
                    }
                  </div>
                </Card>

                {/* KYC Completeness gauge */}
                <Card title="KYC Completeness">
                  <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                    <KycRing pct={pct} />
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--mist)", marginBottom: 5 }}>
                        {pct}% Complete · {profile.kyc.requirements.filter(r => !r.satisfied).length} Missing
                      </div>
                      <div style={{ fontSize: 11, color: "var(--sil)", lineHeight: 1.6 }}>
                        {profile.kyc.escalated
                          ? "KYC is materially incomplete. Auto-escalation triggered. RM notification pending."
                          : profile.kyc.status === "Complete"
                          ? "All KYC requirements are satisfied."
                          : "Some KYC requirements are outstanding. Customer notified."}
                      </div>
                    </div>
                  </div>
                </Card>

                {/* Donut chart */}
                {donutData.some(d => d.value > 0) && (
                  <DonutChartCard
                    title="KYC Requirements Breakdown"
                    data={donutData}
                    height={180}
                  />
                )}
              </div>
            </div>
          )}

          {/* ══════════════════
              TAB: DOCUMENTS
          ══════════════════ */}
          {tab === "documents" && (
            <Card title="All Customer Documents" style={{ marginTop: 14 }}>
              <DataTable<CustomerProfile["documents"][0] & Record<string, unknown>>
                columns={docColumns}
                rows={profile.documents as Array<CustomerProfile["documents"][0] & Record<string, unknown>>}
                rowKey={(r) => r.id}
                emptyMessage="No documents found for this customer."
              />
            </Card>
          )}

          {/* ══════════════════
              TAB: KYC
          ══════════════════ */}
          {tab === "kyc" && (
            <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <Card title="KYC Requirements Checklist">
                <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
                  <KycRing pct={pct} />
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: pct >= 100 ? "var(--G)" : pct >= 50 ? "var(--W)" : "var(--R)" }}>
                      {pct}% Complete · {profile.kyc.status}
                    </div>
                    {profile.kyc.escalated && (
                      <Tag variant="red" style={{ marginTop: 4 }}>⚠ Auto-escalated to Relationship Manager</Tag>
                    )}
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  {profile.kyc.requirements.map((req: KycRequirement) => (
                    <div key={req.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", background: "var(--gr)", borderRadius: 7 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <StatusDot color={req.satisfied ? "green" : "red"} />
                        <span style={{ fontSize: 12 }}>{req.label}</span>
                      </div>
                      {req.satisfied
                        ? <Tag variant="green">Satisfied</Tag>
                        : <Tag variant="red">Missing</Tag>}
                    </div>
                  ))}
                </div>
              </Card>
              <DonutChartCard
                title="KYC Status Distribution"
                data={donutData}
                height={280}
              />
            </div>
          )}

          {/* ══════════════════
              TAB: TIMELINE
          ══════════════════ */}
          {tab === "timeline" && (
            <Card title="Full Activity Timeline" style={{ marginTop: 14 }}>
              <div className="tl">
                {profile.timeline.length === 0
                  ? <div style={{ color: "var(--sil)", fontSize: 12, padding: "8px 0" }}>No timeline events recorded.</div>
                  : profile.timeline.map((t) => (
                    <TimelineItem key={`${t.ts}_${t.action}`} ts={t.ts} action={t.action} details={t.details} />
                  ))
                }
              </div>
            </Card>
          )}
        </>
      ) : null}
    </div>
  );
}
