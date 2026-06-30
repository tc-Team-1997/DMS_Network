import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthContext.js";
import {
  KpiCard, Card, DataTable, Tag, StatusDot, Tabs, Modal, FormField,
  BarChartCard, RefId,
  type Column,
} from "../components/ui/index.js";
import {
  fetchFilePlan, fetchLegalHolds, fetchDisposalCandidates,
  placeLegalHold, releaseLegalHold, certifyDisposal,
  saveRetentionRule,
  type RetentionPolicy, type LegalHold, type DisposalCandidate,
} from "../api/recordsManagement.js";

/* ─── Retention file-plan columns ──────────────────────────────── */
const filePlanColumns: Column<RetentionPolicy & Record<string, unknown>>[] = [
  { key: "doc_class", header: "Document Class", sortable: true },
  {
    key: "retention_years",
    header: "Retention",
    render: (r) => (
      <span className="mono" style={{ color: "var(--gold3)", fontWeight: 600 }}>
        {r.retention_years === 0 ? "Immediate" : `${r.retention_years} Years`}
      </span>
    ),
    sortable: true,
  },
  { key: "trigger", header: "Trigger", render: (r) => <span style={{ textTransform: "capitalize" }}>{String(r.trigger)}</span>, sortable: true },
  {
    key: "regulation",
    header: "Regulation",
    render: (r) => r.regulation ? <Tag variant="gold">{String(r.regulation)}</Tag> : <span style={{ color: "var(--sil)" }}>—</span>,
  },
  {
    key: "status",
    header: "Status",
    render: () => <span style={{ color: "var(--G)", fontSize: 11, fontWeight: 600 }}>● Active</span>,
  },
];

/* ─── Disposal table columns ────────────────────────────────────── */
function buildDisposalColumns(
  canDispose: boolean,
  onCertify: (id: string) => void,
): Column<DisposalCandidate & Record<string, unknown>>[] {
  return [
    {
      key: "doc_no",
      header: "Document",
      render: (r) => (
        <RefId
          value={String(r.document_id)}
          label={r.doc_no != null ? String(r.doc_no) : undefined}
          className="gold3"
          style={{ color: "var(--gold3)", fontWeight: 500 }}
        />
      ),
      sortable: true,
    },
    {
      key: "doc_type",
      header: "Type",
      render: (r) => <Tag variant="gold">{String(r.doc_type)}</Tag>,
      sortable: true,
    },
    { key: "destruction_date", header: "Destruction Date", render: (r) => String(r.destruction_date), sortable: true },
    {
      key: "on_hold",
      header: "Legal Hold",
      render: (r) =>
        r.on_hold
          ? <Tag variant="amber">⛔ On Hold</Tag>
          : <span style={{ color: "var(--sil)", fontSize: 12 }}>—</span>,
    },
    {
      key: "actions",
      header: "",
      render: (r) =>
        canDispose && !r.on_hold ? (
          <button
            className="btn bx xs"
            style={{ fontSize: 11 }}
            onClick={(e) => { e.stopPropagation(); onCertify(r.document_id); }}
          >
            Certify Disposal
          </button>
        ) : null,
    },
  ];
}

/* ─── Retention chart data ───────────────────────────────────── */
function buildRetentionChart(policies: RetentionPolicy[]) {
  return policies.slice(0, 8).map(p => ({
    class: p.doc_class.replace(/_/g, " ").slice(0, 18),
    years: p.retention_years,
  }));
}

/* ─── Hold Card ─────────────────────────────────────────────── */
function HoldCard({ hold, onRelease, canRelease }: {
  hold: LegalHold;
  onRelease: (ref: string) => void;
  canRelease: boolean;
}) {
  const isActive = hold.status === "Active";
  const bg = isActive ? "rgba(240,160,48,.07)" : "rgba(46,204,138,.05)";
  const border = isActive ? "rgba(240,160,48,.25)" : "rgba(46,204,138,.2)";
  const textColor = isActive ? "var(--W)" : "var(--G)";

  return (
    <div style={{ padding: 10, background: bg, border: `1px solid ${border}`, borderRadius: 7 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3, alignItems: "flex-start" }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: textColor }}>
          Hold #{hold.ref}
        </span>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <Tag variant={isActive ? "amber" : "green"}>{hold.status}</Tag>
          {canRelease && isActive && (
            <button
              className="btn bs xs"
              style={{ fontSize: 10 }}
              onClick={() => onRelease(hold.ref)}
            >
              Release
            </button>
          )}
        </div>
      </div>
      <div style={{ fontSize: 11, color: "var(--sil)" }}>
        {hold.doc_count.toLocaleString()} docs frozen · Scope: {hold.scope}
        {hold.placed_at && ` · Since ${String(hold.placed_at).slice(0, 10)}`}
        {hold.placed_by && ` · ${hold.placed_by}`}
      </div>
      {hold.released_at && (
        <div style={{ fontSize: 10, color: "var(--sil)", marginTop: 2 }}>
          Released: {String(hold.released_at).slice(0, 10)}
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════
   RecordsManagement Page
═══════════════════════════════════════════════════════════════════════ */
export default function RecordsManagement() {
  const { user } = useAuth();
  const canRead    = user?.permissions.includes("compliance:read") ?? false;
  const canHold    = user?.permissions.includes("legal_hold:place") ?? false;
  const canDispose = user?.permissions.includes("document:delete") ?? false;
  const canAdmin   = user?.permissions.includes("admin:access") ?? false;

  const [plan,       setPlan]       = useState<RetentionPolicy[]>([]);
  const [holds,      setHolds]      = useState<LegalHold[]>([]);
  const [candidates, setCandidates] = useState<DisposalCandidate[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);
  const [tab,        setTab]        = useState("file-plan");

  /* Modals */
  const [holdOpen,    setHoldOpen]    = useState(false);
  const [certConfirm, setCertConfirm] = useState<string | null>(null);

  /* Hold form */
  const [holdForm, setHoldForm] = useState({ ref: "", scope: "branch:", });

  /* SC-06 retention-rule form (create/edit by doc_class) */
  const [ruleForm, setRuleForm] = useState({ doc_class: "", retention_years: "7", trigger: "ingest", regulation: "" });
  const [ruleErr, setRuleErr] = useState<string | null>(null);
  async function saveRule(e: FormEvent) {
    e.preventDefault();
    setRuleErr(null);
    try {
      await saveRetentionRule({
        doc_class: ruleForm.doc_class.trim(),
        retention_years: Number(ruleForm.retention_years),
        trigger: ruleForm.trigger.trim() || undefined,
        regulation: ruleForm.regulation.trim() || undefined,
      });
      setRuleForm({ doc_class: "", retention_years: "7", trigger: "ingest", regulation: "" });
      await load();
    } catch (e: any) { setRuleErr(String(e?.message ?? e)); }
  }

  async function load() {
    setLoading(true); setError(null);
    try {
      const [p, h, c] = await Promise.all([
        fetchFilePlan(),
        fetchLegalHolds(),
        fetchDisposalCandidates(),
      ]);
      setPlan(p); setHolds(h); setCandidates(c);
    } catch {
      setError("Failed to load records management data.");
    } finally { setLoading(false); }
  }

  useEffect(() => { if (canRead) load(); }, [canRead]);

  if (!canRead) return (
    <div className="fade-up" style={{ padding: 40 }}>
      <div className="page-header"><div><h2 className="serif">Records Management</h2></div></div>
      <p style={{ color: "var(--sil)" }}>You don't have permission to view records management data.</p>
    </div>
  );

  const activeHolds  = holds.filter(h => h.status === "Active");
  const eligibleFree = candidates.filter(c => !c.on_hold);

  async function handlePlaceHold(e: FormEvent) {
    e.preventDefault();
    if (!holdForm.ref || !holdForm.scope) return;
    try {
      await placeLegalHold(holdForm);
      setHoldForm({ ref: "", scope: "branch:" });
      setHoldOpen(false);
      await load();
    } catch {
      setError("Failed to place legal hold. Please check your input and try again.");
    }
  }

  async function handleReleaseHold(ref: string) {
    try {
      await releaseLegalHold(ref);
      await load();
    } catch {
      setError("Failed to release legal hold. Please try again.");
    }
  }

  async function handleCertifyDisposal(docId: string) {
    try {
      await certifyDisposal(docId);
      setCertConfirm(null);
      await load();
    } catch {
      alert("Disposal refused — document may be on an active legal hold.");
    }
  }

  const disposalColumns = buildDisposalColumns(canDispose, (id) => setCertConfirm(id));

  return (
    <div className="fade-up">
      {/* ─── Page Header ──────────────────────── */}
      <div className="page-header">
        <div>
          <h2 className="serif">Records Management</h2>
          <p>Retention schedules · Legal holds · Disposal authority · CBE / Basel III / GDPR compliance</p>
        </div>
        <div className="phr">
          {canHold && (
            <button className="btn bw sm" onClick={() => setHoldOpen(true)}>Place Legal Hold</button>
          )}
          {canAdmin && (
            <button className="btn bg sm" disabled title="Retention rule creation coming soon">New Retention Rule</button>
          )}
        </div>
      </div>

      {error && (
        <div style={{ background: "rgba(224,82,82,.1)", border: "1px solid rgba(224,82,82,.3)", borderRadius: 8, padding: "10px 16px", marginBottom: 14, color: "var(--R)", fontSize: 13 }}>
          {error} <button className="btn bs xs" style={{ marginLeft: 10 }} onClick={load}>Retry</button>
        </div>
      )}

      {/* ─── KPI Row ──────────────────────────── */}
      <div className="g4" style={{ marginBottom: 16 }}>
        <KpiCard label="Managed Records"    value="—"    sub="Under retention schedule" variant="green" />
        <KpiCard label="Legal Holds Active" value={loading ? "—" : activeHolds.length} sub={`${holds.length} total holds`}           variant="amber" />
        <KpiCard label="Eligible for Disposal" value={loading ? "—" : candidates.length} sub={`${eligibleFree.length} free to dispose`} variant="red" />
        <KpiCard label="Retention Policies" value={loading ? "—" : plan.length}         sub="Document classes"                        variant="blue" />
      </div>

      {/* ─── Tabs ───────────────────────────────── */}
      <Tabs
        items={[
          { key: "file-plan",  label: "Retention File Plan" },
          { key: "holds",      label: `Legal Holds (${activeHolds.length} active)` },
          { key: "disposal",   label: `Disposal Queue (${candidates.length})` },
          { key: "analytics",  label: "Analytics" },
        ]}
        active={tab}
        onChange={setTab}
      />

      {/* ══════════════════
          TAB: FILE PLAN
      ══════════════════ */}
      {tab === "file-plan" && (
        <Card
          title={<span>Retention Schedule (File Plan) · CBE / Basel / GDPR</span>}
          action={
            <div style={{ display: "flex", gap: 6 }}>
              <Tag variant="green">{plan.length} Classes</Tag>
            </div>
          }
          style={{ marginTop: 14 }}
        >
          {loading ? (
            <div style={{ color: "var(--sil)", padding: 24, textAlign: "center" }}>Loading retention schedule…</div>
          ) : (
            <DataTable<RetentionPolicy & Record<string, unknown>>
              columns={filePlanColumns}
              rows={plan as Array<RetentionPolicy & Record<string, unknown>>}
              rowKey={(r) => r.id}
              emptyMessage="No retention policies configured."
            />
          )}
          {canAdmin && (
            <form onSubmit={saveRule} style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {ruleErr && <div role="alert" style={{ color: "var(--R, #c0392b)", width: "100%" }}>{ruleErr}</div>}
              <input className="field" style={{ width: 180 }} placeholder="doc class" value={ruleForm.doc_class} onChange={(e) => setRuleForm({ ...ruleForm, doc_class: e.target.value })} aria-label="doc class" required />
              <input className="field" style={{ width: 110 }} type="number" placeholder="years" value={ruleForm.retention_years} onChange={(e) => setRuleForm({ ...ruleForm, retention_years: e.target.value })} aria-label="retention years" required />
              <input className="field" style={{ width: 120 }} placeholder="trigger" value={ruleForm.trigger} onChange={(e) => setRuleForm({ ...ruleForm, trigger: e.target.value })} aria-label="trigger" />
              <input className="field" style={{ width: 200 }} placeholder="regulation (optional)" value={ruleForm.regulation} onChange={(e) => setRuleForm({ ...ruleForm, regulation: e.target.value })} aria-label="regulation" />
              <button className="btn-primary" style={{ width: 150 }} aria-label="save retention rule">Save rule</button>
            </form>
          )}
        </Card>
      )}

      {/* ══════════════════
          TAB: LEGAL HOLDS
      ══════════════════ */}
      {tab === "holds" && (
        <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          {/* Active holds */}
          <Card
            title={<span>Active Legal Holds <Tag variant="amber">{activeHolds.length} Active</Tag></span>}
            action={canHold && <button className="btn bw xs" onClick={() => setHoldOpen(true)}>+ Place Hold</button>}
          >
            {loading ? (
              <div style={{ color: "var(--sil)", padding: 24, textAlign: "center" }}>Loading…</div>
            ) : activeHolds.length === 0 ? (
              <div style={{ color: "var(--sil)", fontSize: 12, padding: "8px 0" }}>No active legal holds.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {activeHolds.map(h => (
                  <HoldCard key={h.id} hold={h} canRelease={canHold} onRelease={handleReleaseHold} />
                ))}
              </div>
            )}
          </Card>

          {/* All holds history table */}
          <Card title="All Holds History">
            {loading ? (
              <div style={{ color: "var(--sil)", padding: 24, textAlign: "center" }}>Loading…</div>
            ) : (
              <DataTable<LegalHold & Record<string, unknown>>
                columns={[
                  { key: "ref",    header: "Ref",   sortable: true, render: (r) => <span style={{ fontFamily: "monospace", fontSize: 11 }}>{String(r.ref)}</span> },
                  { key: "scope",  header: "Scope", render: (r) => <span style={{ fontSize: 11 }}>{String(r.scope)}</span> },
                  { key: "status", header: "Status", render: (r) => <Tag variant={r.status === "Active" ? "amber" : "green"}>{String(r.status)}</Tag>, sortable: true },
                  { key: "doc_count", header: "Docs", sortable: true, render: (r) => Number(r.doc_count).toLocaleString() },
                ]}
                rows={holds as Array<LegalHold & Record<string, unknown>>}
                rowKey={(r) => r.id}
                emptyMessage="No legal holds on record."
              />
            )}
          </Card>
        </div>
      )}

      {/* ══════════════════
          TAB: DISPOSAL
      ══════════════════ */}
      {tab === "disposal" && (
        <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 320px", gap: 14 }}>
          <Card
            title={<span>Disposal Queue <Tag variant="red">{candidates.length} eligible</Tag></span>}
            action={<Tag variant={eligibleFree.length > 0 ? "red" : "green"}>{eligibleFree.length} free to dispose</Tag>}
          >
            {loading ? (
              <div style={{ color: "var(--sil)", padding: 24, textAlign: "center" }}>Loading disposal candidates…</div>
            ) : (
              <>
                <div style={{ fontSize: 11, color: "var(--sil)", marginBottom: 10 }}>
                  These documents passed their retention period. Legal hold check is applied before certified disposal.
                </div>
                <DataTable<DisposalCandidate & Record<string, unknown>>
                  columns={disposalColumns}
                  rows={candidates as Array<DisposalCandidate & Record<string, unknown>>}
                  rowKey={(r) => r.document_id}
                  emptyMessage="No documents eligible for disposal."
                />
              </>
            )}
          </Card>

          {/* Sidebar summary */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Card title="Disposal Summary">
              <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 12 }}>
                <div className="sr">
                  <span style={{ color: "var(--sil)" }}>Total eligible</span>
                  <span style={{ color: "var(--R)", fontWeight: 600 }}>{candidates.length.toLocaleString()}</span>
                </div>
                <div className="sr">
                  <span style={{ color: "var(--sil)" }}>On legal hold</span>
                  <span style={{ color: "var(--W)", fontWeight: 600 }}>{candidates.filter(c => c.on_hold).length.toLocaleString()}</span>
                </div>
                <div className="sr">
                  <span style={{ color: "var(--sil)" }}>Free to dispose</span>
                  <span style={{ color: "var(--G)", fontWeight: 600 }}>{eligibleFree.length.toLocaleString()}</span>
                </div>
              </div>
              {canDispose && eligibleFree.length > 0 && (
                <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                  <button
                    className="btn bx"
                    style={{ flex: 1, fontSize: 11 }}
                    disabled
                    title="Bulk disposal not yet implemented — certify documents individually"
                  >
                    Run Hold Check &amp; Dispose All
                  </button>
                  <button
                    className="btn bs"
                    style={{ fontSize: 11 }}
                    disabled
                    title="Scheduled disposal not yet implemented"
                  >
                    Schedule 03:00
                  </button>
                </div>
              )}
            </Card>

            <Card title="Disposal by Document Type">
              {(() => {
                const byType = candidates.reduce<Record<string, number>>((acc, c) => {
                  acc[c.doc_type] = (acc[c.doc_type] ?? 0) + 1; return acc;
                }, {});
                return Object.entries(byType).map(([type, count]) => (
                  <div key={type} className="sr" style={{ fontSize: 11 }}>
                    <span style={{ color: "var(--sil)" }}>{type}</span>
                    <span style={{ color: "var(--R)", fontWeight: 600 }}>{count.toLocaleString()}</span>
                  </div>
                ));
              })()}
              {candidates.length === 0 && <div style={{ color: "var(--sil)", fontSize: 12 }}>No candidates.</div>}
            </Card>
          </div>
        </div>
      )}

      {/* ══════════════════
          TAB: ANALYTICS
      ══════════════════ */}
      {tab === "analytics" && (
        <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <BarChartCard
            title="Retention Period by Document Class"
            data={buildRetentionChart(plan)}
            xKey="class"
            bars={[{ key: "years", color: "var(--gold2)", name: "Years" }]}
            height={260}
          />
          <Card title="Compliance Coverage">
            <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 12 }}>
              {[
                { label: "CBE Regulations",  count: plan.filter(p => p.regulation?.includes("CBE")).length,  total: plan.length, color: "var(--gold2)" },
                { label: "Basel III",         count: plan.filter(p => p.regulation?.includes("Basel")).length, total: plan.length, color: "var(--B)" },
                { label: "FATF / AML",        count: plan.filter(p => p.regulation?.includes("FATF")).length,  total: plan.length, color: "var(--R)" },
                { label: "GDPR",              count: plan.filter(p => p.regulation?.includes("GDPR")).length,  total: plan.length, color: "var(--P)" },
              ].map(item => (
                <div key={item.label}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ color: "var(--sil)" }}>{item.label}</span>
                    <span style={{ color: item.color, fontWeight: 600 }}>{item.count} / {item.total}</span>
                  </div>
                  <div className="bw2">
                    <div
                      className="bf"
                      style={{
                        width: item.total ? `${(item.count / item.total) * 100}%` : "0%",
                        background: item.color,
                        height: 6,
                        borderRadius: 3,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 16, padding: "10px 12px", background: "rgba(184,145,42,.05)", border: "1px solid rgba(184,145,42,.15)", borderRadius: 7, fontSize: 11, color: "var(--sil)" }}>
              Retention policies cover {plan.length} document classes across CBE, Basel III, GDPR and AML regulations.
            </div>
          </Card>
        </div>
      )}

      {/* ─── Place Legal Hold Modal ────────────────── */}
      <Modal open={holdOpen} onClose={() => setHoldOpen(false)} title="Place Legal Hold" width={480}>
        <form onSubmit={handlePlaceHold} style={{ display: "flex", flexDirection: "column", gap: 12, padding: "8px 0" }}>
          <FormField
            label="Hold Reference *"
            placeholder="LH-2026-01"
            value={holdForm.ref}
            onChange={(e) => setHoldForm({ ...holdForm, ref: (e.target as HTMLInputElement).value })}
            hint="Use a unique identifier, e.g. LH-2026-CBE-001"
          />
          <FormField
            label="Scope *"
            placeholder="branch:THI001 or doc_type:SAR_REPORT or cid:10112345"
            value={holdForm.scope}
            onChange={(e) => setHoldForm({ ...holdForm, scope: (e.target as HTMLInputElement).value })}
            hint="Format: branch:<code> | doc_type:<type> | cid:<cid>"
          />
          <div style={{ padding: "8px 10px", background: "rgba(240,160,48,.07)", border: "1px solid rgba(240,160,48,.2)", borderRadius: 6, fontSize: 11, color: "var(--sil)" }}>
            A legal hold will freeze all matching documents and prevent certified disposal until released.
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button type="submit" className="btn bw" style={{ flex: 1 }}>Place Hold</button>
            <button type="button" className="btn bs" onClick={() => setHoldOpen(false)}>Cancel</button>
          </div>
        </form>
      </Modal>

      {/* ─── Certify Disposal Confirm Modal ───────── */}
      <Modal
        open={certConfirm !== null}
        onClose={() => setCertConfirm(null)}
        title="Confirm Certified Disposal"
        width={420}
      >
        <div style={{ padding: "8px 0" }}>
          <div style={{ padding: "10px 12px", background: "rgba(224,82,82,.07)", border: "1px solid rgba(224,82,82,.2)", borderRadius: 6, fontSize: 12, color: "var(--R)", marginBottom: 14 }}>
            This action permanently destroys document <RefId value={certConfirm} />. A certified destruction record will be issued. This cannot be undone.
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="btn bx"
              style={{ flex: 1 }}
              onClick={() => certConfirm !== null && handleCertifyDisposal(certConfirm)}
            >
              Confirm Certified Disposal
            </button>
            <button className="btn bs" onClick={() => setCertConfirm(null)}>Cancel</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
