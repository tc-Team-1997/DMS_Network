import { useEffect, useState, useCallback } from "react";
import { useAuth } from "../auth/AuthContext.js";
import {
  KpiCard, Card, DataTable, Tag, Tabs, DonutChartCard, BarChartCard,
} from "../components/ui/index.js";
import type { Column } from "../components/ui/index.js";
import { complianceAuditApi } from "../api/complianceAudit.js";
import type {
  ComplianceScorecard,
  FrameworkRow,
  ChainVerification,
  AuditRow,
} from "../api/complianceAudit.js";

/* ─── helpers ─── */
function statusTagVariant(s: string): "green" | "amber" | "red" | "blue" | "purple" | "gold" {
  if (s === "Met") return "green";
  if (s === "Partial") return "amber";
  if (s === "Gap") return "red";
  return "gold";
}

function actionTagVariant(a: string): "green" | "amber" | "red" | "blue" | "purple" | "gold" {
  const upper = a.toUpperCase();
  if (upper.includes("DELETE") || upper.includes("DISPOSAL") || upper.includes("BREACH")) return "red";
  if (upper.includes("HOLD")) return "amber";
  if (upper.includes("APPROVE") || upper.includes("CERTIFIED") || upper.includes("LOGIN")) return "green";
  if (upper.includes("ESCALAT")) return "amber";
  if (upper.includes("CREATE") || upper.includes("INDEX")) return "blue";
  return "gold";
}

const TABS = [
  { key: "scorecard", label: "Scorecard" },
  { key: "matrix", label: "Regulatory Matrix" },
  { key: "audit", label: "Audit Trail" },
  { key: "chain", label: "Hash-Chain Verify" },
];

type MatrixRow = FrameworkRow & { id: string };
type AuditTableRow = AuditRow & { _key: string };

export function ComplianceAudit() {
  const { user } = useAuth();
  const canRead = Boolean(user?.permissions.includes("compliance:read"));

  const [tab, setTab] = useState("scorecard");
  const [scorecard, setScorecard] = useState<ComplianceScorecard | null>(null);
  const [matrix, setMatrix] = useState<MatrixRow[]>([]);
  const [verification, setVerification] = useState<ChainVerification | null>(null);
  const [auditRows, setAuditRows] = useState<AuditTableRow[]>([]);
  const [auditFilter, setAuditFilter] = useState<{
    action: string; entity: string; actor: string;
  }>({ action: "", entity: "", actor: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    if (!canRead) return;
    setLoading(true);
    setError(null);
    try {
      const [sc, mx, vf, at] = await Promise.all([
        complianceAuditApi.getScorecard(),
        complianceAuditApi.getMatrix(),
        complianceAuditApi.getVerification(),
        complianceAuditApi.getAuditTrail({ limit: 50 }),
      ]);
      setScorecard(sc.scorecard);
      setMatrix(mx.matrix.map((r, i) => ({ ...r, id: `${r.framework}-${i}` })));
      setVerification(vf.verification);
      setAuditRows(at.rows.map((r) => ({ ...r, _key: String(r.id ?? Math.random()) })));
    } catch (e: any) {
      setError(String(e?.message ?? "Failed to load compliance data"));
    } finally {
      setLoading(false);
    }
  }, [canRead]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const loadAuditFiltered = useCallback(async () => {
    if (!canRead) return;
    setError(null);
    try {
      const at = await complianceAuditApi.getAuditTrail({
        action: auditFilter.action || undefined,
        entity: auditFilter.entity || undefined,
        actor: auditFilter.actor || undefined,
        limit: 100,
      });
      setAuditRows(at.rows.map((r) => ({ ...r, _key: String(r.id ?? Math.random()) })));
    } catch (e: any) {
      setError(String(e?.message ?? "Failed to apply audit filter"));
    }
  }, [canRead, auditFilter]);

  if (!canRead) {
    return (
      <div className="fade-up">
        <div className="page-header">
          <div>
            <h2 className="serif">Compliance &amp; Audit</h2>
            <p>You do not have permission to view this page.</p>
          </div>
        </div>
      </div>
    );
  }

  /* ─── Donut data for scorecard ─── */
  const donutData = scorecard
    ? [
        { name: "Compliant", value: scorecard.score, color: "var(--G)" },
        { name: "Gap", value: 100 - scorecard.score, color: "rgba(255,255,255,0.07)" },
      ]
    : [];

  const frameworkBarData = scorecard?.frameworks.map((f) => ({
    framework: f.framework.replace(/\s.+$/, ""),
    Met: f.met,
    Total: f.total,
    Gap: f.total - f.met,
  })) ?? [];

  /* ─── Table columns ─── */
  const matrixCols: Column<MatrixRow>[] = [
    { key: "framework", header: "Framework", sortable: true, width: 200 },
    { key: "control", header: "Control", sortable: true },
    {
      key: "status", header: "Status", width: 110,
      render: (r) => <Tag variant={statusTagVariant(r.status)}>{r.status}</Tag>,
    },
    { key: "evidence", header: "Evidence", render: (r) => <span style={{ color: "var(--sil)", fontSize: 11 }}>{r.evidence ?? "—"}</span> },
  ];

  const auditCols: Column<AuditTableRow>[] = [
    {
      key: "actor_username", header: "Actor", width: 120,
      render: (r) => (
        <span style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{
            width: 24, height: 24, borderRadius: "50%",
            background: "linear-gradient(135deg,var(--navy),var(--gold2))",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 9, fontWeight: 700, flexShrink: 0,
          }}>
            {(r.actor_username ?? "SY").slice(0, 2).toUpperCase()}
          </span>
          <span style={{ fontSize: 11 }}>{r.actor_username ?? "System"}</span>
        </span>
      ),
    },
    {
      key: "action", header: "Action", width: 140,
      render: (r) => <Tag variant={actionTagVariant(r.action)}>{r.action}</Tag>,
    },
    { key: "entity", header: "Entity", width: 100, render: (r) => <span style={{ fontSize: 11, color: "var(--sil)" }}>{r.entity ?? "—"}</span> },
    { key: "entity_id", header: "Entity ID", width: 100, render: (r) => <span className="mono" style={{ fontSize: 10, color: "var(--gold3)" }}>{r.entity_id ?? "—"}</span> },
    { key: "details", header: "Details", render: (r) => <span style={{ fontSize: 11, color: "var(--sil)" }}>{r.details ?? "—"}</span> },
    { key: "created_at", header: "Time", width: 140, sortable: true, render: (r) => <span style={{ fontSize: 11, color: "var(--sil)" }}>{r.created_at ? new Date(r.created_at).toLocaleString() : "—"}</span> },
  ];

  return (
    <div className="fade-up">
      {/* ── page header ── */}
      <div className="page-header">
        <div>
          <h2 className="serif">Compliance &amp; Audit</h2>
          <p>RMA · RAA · FATF/AML · ISO 27001 · Tamper-evident audit trail · Hash-chain verification</p>
        </div>
        <div className="phr">
          <button className="btn bg sm" onClick={loadAll} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: "10px 14px", background: "var(--RT)", border: "1px solid rgba(224,82,82,.3)", borderRadius: 8, marginBottom: 14, fontSize: 12, color: "var(--R)" }}>
          {error}
        </div>
      )}

      {/* ── KPI row ── */}
      <div className="g4" style={{ marginBottom: 18 }}>
        <KpiCard
          label="Compliance Score"
          value={scorecard ? `${scorecard.score}%` : "—"}
          sub={<span style={{ color: scorecard && scorecard.score >= 80 ? "var(--G)" : "var(--R)" }}>
            {scorecard && scorecard.score >= 80 ? "Satisfactory" : "Action required"}
          </span>}
          variant="green"
        />
        <KpiCard
          label="Frameworks Monitored"
          value={scorecard ? scorecard.frameworks.length : "—"}
          sub="RMA · RAA · FATF · ISO 27001"
          variant="blue"
        />
        <KpiCard
          label="Audit Entries"
          value={verification ? verification.checked.toLocaleString() : "—"}
          sub="Sequence-verified · SHA-256"
          variant="gold"
        />
        <KpiCard
          label="Sequence Integrity"
          value={verification ? (verification.ok ? "Intact" : "Gap Detected") : "—"}
          sub={verification?.ok
            ? <Tag variant="green">No sequence gaps</Tag>
            : verification
              ? <Tag variant="red">Gap at entry #{verification.brokenAt}</Tag>
              : "Checking…"}
          variant={verification?.ok ? "green" : "red"}
        />
      </div>

      {/* ── Tabs ── */}
      <Tabs items={TABS} active={tab} onChange={setTab} />

      {/* ═══ SCORECARD TAB ═══ */}
      {tab === "scorecard" && (
        <div style={{ marginTop: 14 }}>
          {loading && (
            <div style={{ padding: 32, textAlign: "center", color: "var(--sil)" }}>Loading scorecard…</div>
          )}
          {!loading && !scorecard && (
            <div style={{ padding: 32, textAlign: "center", color: "var(--sil)" }}>No scorecard data available</div>
          )}
          {!loading && scorecard && (
            <div className="g2">
              <DonutChartCard
                title="Overall Compliance Score"
                data={donutData}
                height={240}
              />
              <BarChartCard
                title="Framework Breakdown"
                data={frameworkBarData}
                xKey="framework"
                bars={[
                  { key: "Met", color: "var(--G)", name: "Controls Met" },
                  { key: "Gap", color: "var(--R)", name: "Gap" },
                ]}
                height={240}
              />
            </div>
          )}
        </div>
      )}

      {/* ═══ MATRIX TAB ═══ */}
      {tab === "matrix" && (
        <Card title="Regulatory Compliance Matrix" style={{ marginTop: 14 }}>
          {loading ? (
            <div style={{ padding: 32, textAlign: "center", color: "var(--sil)" }}>Loading matrix…</div>
          ) : (
            <DataTable<MatrixRow>
              columns={matrixCols}
              rows={matrix}
              rowKey={(r) => r.id}
              emptyMessage="No regulatory controls found"
            />
          )}
        </Card>
      )}

      {/* ═══ AUDIT TRAIL TAB ═══ */}
      {tab === "audit" && (
        <div style={{ marginTop: 14 }}>
          {/* filter bar */}
          <Card title="Audit Trail Filters" style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
              <div className="field" style={{ minWidth: 160, margin: 0 }}>
                <label>Action</label>
                <input
                  type="text"
                  value={auditFilter.action}
                  placeholder="e.g. LOGIN"
                  onChange={(e) => setAuditFilter((f) => ({ ...f, action: e.target.value }))}
                />
              </div>
              <div className="field" style={{ minWidth: 140, margin: 0 }}>
                <label>Entity</label>
                <input
                  type="text"
                  value={auditFilter.entity}
                  placeholder="e.g. document"
                  onChange={(e) => setAuditFilter((f) => ({ ...f, entity: e.target.value }))}
                />
              </div>
              <div className="field" style={{ minWidth: 140, margin: 0 }}>
                <label>Actor</label>
                <input
                  type="text"
                  value={auditFilter.actor}
                  placeholder="e.g. admin"
                  onChange={(e) => setAuditFilter((f) => ({ ...f, actor: e.target.value }))}
                />
              </div>
              <button className="btn bg sm" onClick={loadAuditFiltered}>
                Apply Filter
              </button>
              <button className="btn bs sm" onClick={() => {
                setAuditFilter({ action: "", entity: "", actor: "" });
                loadAll();
              }}>
                Clear
              </button>
            </div>
          </Card>

          <Card
            title={<span>Audit Trail — Recent Events <span style={{ fontSize: 11, color: "var(--sil)", fontWeight: 400 }}>({auditRows.length} entries)</span></span>}
          >
            <DataTable<AuditTableRow>
              columns={auditCols}
              rows={auditRows}
              rowKey={(r) => r._key}
              emptyMessage="No audit events found"
            />
          </Card>
        </div>
      )}

      {/* ═══ HASH-CHAIN TAB ═══ */}
      {tab === "chain" && (
        <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 14 }}>
          <Card title="Audit Log Sequence Verification">
            {verification ? (
              <div>
                <div style={{
                  padding: "16px 20px",
                  borderRadius: 10,
                  border: `1px solid ${verification.ok ? "rgba(46,204,138,.3)" : "rgba(224,82,82,.3)"}`,
                  background: verification.ok ? "var(--GT)" : "var(--RT)",
                  display: "flex", gap: 14, alignItems: "center",
                  marginBottom: 18,
                }}>
                  <span style={{ fontSize: 28 }}>{verification.ok ? "✓" : "⚠"}</span>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14, color: verification.ok ? "var(--G)" : "var(--R)" }}>
                      {verification.ok
                        ? "Sequence Integrity Verified"
                        : `Sequence Gap Detected at Entry #${verification.brokenAt}`}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--sil)", marginTop: 4 }}>
                      {verification.checked.toLocaleString()} audit log entries checked via SHA-256 rolling digest.
                      {verification.ok
                        ? " No sequence gaps detected. Note: in-place row edits are not detected by the current check."
                        : " Immediate investigation required — one or more entries may be missing."}
                    </div>
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
                  {[
                    { label: "Entries Checked", value: verification.checked.toLocaleString() },
                    { label: "Algorithm", value: "SHA-256" },
                    { label: "Status", value: verification.ok ? "Sequence Intact" : "Gap Found" },
                    { label: "Gap At", value: verification.brokenAt != null ? `#${verification.brokenAt}` : "—" },
                  ].map((kv) => (
                    <div key={kv.label} style={{ background: "var(--ink3)", border: "1px solid var(--bd)", borderRadius: 9, padding: "10px 14px" }}>
                      <div style={{ fontSize: 10, color: "var(--sil)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.5px" }}>{kv.label}</div>
                      <div style={{ fontWeight: 700, fontSize: 16 }} className="mono">{kv.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div style={{ padding: 32, textAlign: "center", color: "var(--sil)" }}>
                {loading ? "Checking audit log sequence…" : "No verification data available"}
              </div>
            )}
          </Card>

          <Card title="About Audit Log Verification">
            <div style={{ fontSize: 12, color: "var(--sil)", lineHeight: 1.7 }}>
              <p>
                The verifier replays the audit log in ascending entry order and computes a rolling SHA-256 digest
                across all rows to confirm the sequence is complete and uninterrupted:
              </p>
              <pre style={{ background: "var(--ink3)", padding: "10px 14px", borderRadius: 8, fontSize: 11, color: "var(--gold3)", overflow: "auto", margin: "8px 0" }}>
{`digest[n] = SHA-256(digest[n-1] + "|" + actor|action|entity|entity_id|details)`}
              </pre>
              <p>
                <strong style={{ color: "var(--W)" }}>Current guarantee:</strong>{" "}
                The check confirms that no entry IDs are missing (i.e. rows have not been deleted) and that the
                sequence is intact. It does <em>not</em> detect silent in-place edits to existing rows, because
                each row&apos;s recomputed digest is not compared against a stored <code>prev_hash</code> value.
                A full tamper-evident chain requires a <code>prev_hash</code> column populated on every write.
              </p>
              <p>
                The check covers all privileged actions: logins, approvals, legal holds, and document disposals.
              </p>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

export default ComplianceAudit;
