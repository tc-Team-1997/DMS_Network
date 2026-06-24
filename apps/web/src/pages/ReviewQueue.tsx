/**
 * ReviewQueue — ZorDMS v4.2 Human-Review Queue screen.
 *
 * Shows:
 *  - KPI row: pending, claimed, SLA breached, resolved today
 *  - Tabs: Pending | Claimed | Resolved | SLA Breached
 *  - Rich DataTable with confidence badges, band pills, SLA countdown, Claim/Approve/Reject
 *  - Side panel: detail view of selected review item
 *  - Modal for confirming resolution
 *  - RBAC: claim/resolve gated on "review:write" permission
 *
 * Note: The SLA Breached tab shows items where sla_deadline has already passed
 * (status PENDING or CLAIMED items that have breached their SLA window).
 */
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext.js";
import {
  listAllReviews,
  claimReview,
  resolveReview,
  type ReviewRow,
} from "../api/aiEngine.js";
import { ConfidenceBadge } from "../components/ai/ConfidenceBadge.js";
import {
  KpiCard,
  Card,
  DataTable,
  Tag,
  StatusDot,
  Tabs,
  Modal,
  type Column,
} from "../components/ui/index.js";

/* ─── Types ─── */

type StatusFilter = "PENDING" | "CLAIMED" | "RESOLVED" | "SLA_BREACHED";

interface ReviewDetail extends ReviewRow {
  claimed_by?: string | null;
  resolution?: string | null;
}

const DOC_TYPE_LABELS: Record<string, string> = {
  BT_CID_4G:            "BT CID 4G",
  BT_CITIZENSHIP:       "BT Citizenship",
  BT_PASSPORT:          "BT Passport",
  FOREIGN_PASSPORT:     "Foreign Passport",
  IN_PAN:               "IN PAN Card",
  IN_AADHAAR:           "IN Aadhaar",
  BOB_ACCOUNT_FORM:     "BoB Account Form",
  BOB_LOAN_APPLICATION: "BoB Loan App",
  BOB_INVOICE:          "BoB Invoice",
  PURCHASE_ORDER:       "Purchase Order",
  SAR_REPORT:           "SAR",
  CTR:                  "Cash Txn Report",
  EMPLOYMENT_CONTRACT:  "Employment Contract",
  BOARD_RESOLUTION:     "Board Resolution",
  RMA_INSPECTION:       "RMA Inspection",
  RAA_AUDIT_REPORT:     "RAA Audit Report",
  GENERAL_LETTER:       "General Letter",
  UNKNOWN:              "Unknown",
};

function slaDue(deadline: string | null): { text: string; urgent: boolean } {
  if (!deadline) return { text: "—", urgent: false };
  const diff = new Date(deadline).getTime() - Date.now();
  const hours = diff / 3_600_000;
  if (hours < 0) return { text: "BREACHED", urgent: true };
  if (hours < 2)  return { text: `${Math.round(hours * 60)} min`, urgent: true };
  if (hours < 24) return { text: `${hours.toFixed(1)} h`, urgent: true };
  return { text: `${Math.ceil(hours / 24)} d`, urgent: false };
}

function statusTag(status: string) {
  if (status === "PENDING")  return <Tag variant="amber">Pending</Tag>;
  if (status === "CLAIMED")  return <Tag variant="blue">Claimed</Tag>;
  if (status === "RESOLVED") return <Tag variant="green">Resolved</Tag>;
  return <Tag variant="gold">{status}</Tag>;
}

export default function ReviewQueue() {
  const { user } = useAuth();
  const canWrite = user?.permissions.includes("review:write") ?? false;

  const [rows, setRows] = useState<ReviewDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<StatusFilter>("PENDING");
  const [selected, setSelected] = useState<ReviewDetail | null>(null);
  const [resolveModal, setResolveModal] = useState<{ item: ReviewDetail; resolution: "APPROVED" | "REJECTED" } | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  /* ── Data fetching ── */
  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listAllReviews();
      setRows(data as ReviewDetail[]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load review queue");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    // Refresh every 30 s — skip when the browser tab is hidden to avoid
    // unnecessary network traffic and token refreshes (M-4).
    const t = setInterval(() => {
      if (document.visibilityState === "visible") {
        void reload();
      }
    }, 30_000);
    return () => clearInterval(t);
  }, [reload]);

  /* ── Actions ── */
  const handleClaim = useCallback(
    async (item: ReviewDetail) => {
      if (!canWrite) return;
      setActionBusy(true);
      try {
        await claimReview(item.id, user?.username ?? "current_user");
        await reload();
        setSelected(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Claim failed");
      } finally {
        setActionBusy(false);
      }
    },
    [canWrite, user, reload],
  );

  const handleResolve = useCallback(
    async (item: ReviewDetail, resolution: string) => {
      if (!canWrite) return;
      setActionBusy(true);
      try {
        await resolveReview(item.id, resolution);
        await reload();
        setSelected(null);
        setResolveModal(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Resolve failed");
      } finally {
        setActionBusy(false);
      }
    },
    [canWrite, reload],
  );

  /* ── Derived stats ── */
  const pending  = rows.filter((r) => r.status === "PENDING").length;
  const claimed  = rows.filter((r) => r.status === "CLAIMED").length;
  const resolved = rows.filter((r) => r.status === "RESOLVED").length;
  const breached = rows.filter((r) => r.sla_deadline && new Date(r.sla_deadline) < new Date()).length;

  /* ── Filtered rows ── */
  const filtered = tab === "SLA_BREACHED"
    ? rows.filter((r) => slaDue(r.sla_deadline).urgent)
    : rows.filter((r) => r.status === tab);

  /* ── Table columns ── */
  const columns: Column<ReviewDetail>[] = [
    {
      key: "doc_id",
      header: "Doc ID",
      sortable: true,
      width: 130,
      render: (r) => (
        <span style={{ fontSize: 11, fontFamily: "monospace", color: "var(--gold3)" }}>
          {r.doc_id}
        </span>
      ),
    },
    {
      key: "doc_type",
      header: "Doc Type",
      sortable: true,
      render: (r) => (
        <Tag variant="gold">{DOC_TYPE_LABELS[r.doc_type] ?? r.doc_type}</Tag>
      ),
    },
    {
      key: "confidence",
      header: "Confidence",
      sortable: true,
      width: 160,
      render: (r) => <ConfidenceBadge confidence={r.confidence} />,
    },
    {
      key: "band",
      header: "Band",
      sortable: true,
      width: 120,
      render: (r) => (
        <span style={{ fontSize: 10, color: "var(--sil)", fontFamily: "monospace" }}>
          {r.band}
        </span>
      ),
    },
    {
      key: "sla_hours",
      header: "SLA",
      width: 80,
      render: (r) => {
        const sla = slaDue(r.sla_deadline);
        return (
          <span style={{ fontSize: 11, color: sla.urgent ? "var(--R)" : "var(--sil)", fontWeight: sla.urgent ? 700 : 400 }}>
            {sla.text}
          </span>
        );
      },
    },
    {
      key: "status",
      header: "Status",
      width: 100,
      render: (r) => statusTag(r.status),
    },
    {
      key: "_action",
      header: "Action",
      width: 160,
      render: (r) => (
        <div style={{ display: "flex", gap: 5 }}>
          {r.status === "PENDING" && (
            <button
              className="btn bs xs"
              onClick={(e) => { e.stopPropagation(); void handleClaim(r); }}
              disabled={!canWrite || actionBusy}
              aria-label="claim"
            >
              Claim
            </button>
          )}
          {r.status === "CLAIMED" && (
            <>
              <button
                className="btn bok xs"
                onClick={(e) => {
                  e.stopPropagation();
                  setResolveModal({ item: r, resolution: "APPROVED" });
                }}
                disabled={!canWrite || actionBusy}
                aria-label="approve"
              >
                Approve
              </button>
              <button
                className="btn bx xs"
                onClick={(e) => {
                  e.stopPropagation();
                  setResolveModal({ item: r, resolution: "REJECTED" });
                }}
                disabled={!canWrite || actionBusy}
                aria-label="reject"
              >
                Reject
              </button>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="fade-up">
      {/* ── Page header ── */}
      <div className="page-header">
        <div>
          <h2 className="serif">Human-Review Queue</h2>
          <p>
            IDP §6.4 confidence-band routing · SLA-sorted · Claim &amp; resolve low-confidence extractions
          </p>
        </div>
        <div className="phr" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Tag variant="gold">IDP §6.4</Tag>
          {loading && <StatusDot color="amber" pulse />}
          {!loading && <StatusDot color="green" />}
          <button
            className="btn bs sm"
            onClick={reload}
            disabled={loading}
          >
            Refresh
          </button>
        </div>
      </div>

      {/* ── KPI row ── */}
      <div className="g4" style={{ marginBottom: 16 }}>
        <KpiCard
          label="Pending Review"
          value={pending}
          sub="Awaiting first claim"
          variant="amber"
        />
        <KpiCard
          label="Claimed / In-Progress"
          value={claimed}
          sub="Being reviewed now"
          variant="blue"
        />
        <KpiCard
          label="SLA Breached"
          value={breached}
          sub="Requires escalation"
          variant="red"
        />
        <KpiCard
          label="Resolved (queue)"
          value={resolved}
          sub="From last fetch"
          variant="green"
        />
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div
          style={{
            marginBottom: 12,
            padding: "10px 14px",
            background: "rgba(224,82,82,.1)",
            border: "1px solid rgba(224,82,82,.25)",
            borderRadius: 8,
            fontSize: 12,
            color: "var(--R)",
          }}
        >
          {error}
          <button
            className="btn bs xs"
            style={{ marginLeft: 12 }}
            onClick={reload}
          >
            Retry
          </button>
        </div>
      )}

      {/* ── Confidence Band legend ── */}
      <Card style={{ marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 11, color: "var(--sil)", marginRight: 4 }}>Confidence bands (IDP §6.4):</span>
          {[
            { label: "≥ 92% Auto-Approve", color: "rgba(46,204,138,.18)", border: "rgba(46,204,138,.35)", text: "#2ecc8a" },
            { label: "85–91% Auto-Verified", color: "rgba(58,159,208,.18)", border: "rgba(58,159,208,.35)", text: "#3a9fd0" },
            { label: "70–84% Supervisor", color: "rgba(240,160,48,.18)", border: "rgba(240,160,48,.35)", text: "#f0a030" },
            { label: "50–69% Human Review", color: "rgba(224,120,48,.18)", border: "rgba(224,120,48,.35)", text: "#e07830" },
            { label: "< 50% Reject", color: "rgba(224,82,82,.18)", border: "rgba(224,82,82,.35)", text: "#e05252" },
          ].map((b) => (
            <span
              key={b.label}
              style={{
                fontSize: 10,
                padding: "2px 8px",
                borderRadius: 10,
                background: b.color,
                border: `1px solid ${b.border}`,
                color: b.text,
                fontWeight: 600,
              }}
            >
              {b.label}
            </span>
          ))}
        </div>
      </Card>

      {/* ── Tabs ── */}
      <Tabs
        items={[
          { key: "PENDING",     label: `Pending (${pending})` },
          { key: "CLAIMED",     label: `Claimed (${claimed})` },
          { key: "RESOLVED",    label: `Resolved (${resolved})` },
          { key: "SLA_BREACHED", label: `SLA Breached (${breached})` },
        ]}
        active={tab}
        onChange={(k) => { setTab(k as StatusFilter); setSelected(null); }}
      />

      {/* ── Main layout ── */}
      <div className={selected ? "g2" : ""} style={{ marginTop: 14 }}>
        {/* Table */}
        <div>
          <DataTable<ReviewDetail>
            columns={columns}
            rows={filtered}
            rowKey={(r) => r.id}
            onRowClick={(r) => setSelected(r)}
            emptyMessage={
              loading
                ? "Loading review queue…"
                : tab === "SLA_BREACHED"
                  ? "No SLA-breached items."
                  : `No ${tab.toLowerCase()} items.`
            }
          />
          <div style={{ fontSize: 11, color: "var(--sil)", marginTop: 8, paddingLeft: 4 }}>
            Showing {filtered.length} {tab === "SLA_BREACHED" ? "SLA-breached" : tab.toLowerCase()} item{filtered.length !== 1 ? "s" : ""}.
            Auto-refreshes every 30 s (when tab is visible).
          </div>
        </div>

        {/* Side panel */}
        {selected && (
          <Card
            title={
              <span>
                Review Detail — <span style={{ fontFamily: "monospace", color: "var(--gold3)", fontSize: 12 }}>{selected.doc_id}</span>
              </span>
            }
            action={
              <button
                className="ic"
                onClick={() => setSelected(null)}
                type="button"
                aria-label="Close panel"
              >
                ×
              </button>
            }
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {/* Status + confidence */}
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {statusTag(selected.status)}
                <ConfidenceBadge confidence={selected.confidence} />
              </div>

              {/* Fields */}
              {[
                { label: "Doc Type",   value: DOC_TYPE_LABELS[selected.doc_type] ?? selected.doc_type },
                { label: "Band",       value: selected.band },
                { label: "SLA Hours",  value: selected.sla_hours != null ? `${selected.sla_hours}h` : "—" },
                { label: "SLA Due",    value: slaDue(selected.sla_deadline).text },
                { label: "Claimed by", value: selected.claimed_by ?? "—" },
                { label: "Resolution", value: selected.resolution ?? "—" },
              ].map(({ label, value }) => (
                <div
                  key={label}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    padding: "6px 0",
                    borderBottom: "1px solid var(--bd)",
                    fontSize: 12,
                  }}
                >
                  <span style={{ color: "var(--sil)" }}>{label}</span>
                  <span style={{ color: "var(--mist)" }}>{value}</span>
                </div>
              ))}

              {/* SLA breach warning */}
              {slaDue(selected.sla_deadline).urgent && (
                <div
                  style={{
                    padding: "8px 12px",
                    background: "rgba(224,82,82,.1)",
                    border: "1px solid rgba(224,82,82,.25)",
                    borderRadius: 7,
                    fontSize: 11,
                    color: "var(--R)",
                  }}
                >
                  SLA breach risk — escalation recommended.
                </div>
              )}

              {/* Actions */}
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                {selected.status === "PENDING" && canWrite && (
                  <button
                    className="btn bok"
                    onClick={() => void handleClaim(selected)}
                    disabled={actionBusy}
                    aria-label="claim"
                  >
                    Claim This Item
                  </button>
                )}
                {selected.status === "CLAIMED" && canWrite && (
                  <>
                    <button
                      className="btn bok"
                      onClick={() => setResolveModal({ item: selected, resolution: "APPROVED" })}
                      disabled={actionBusy}
                      aria-label="approve"
                    >
                      Approve
                    </button>
                    <button
                      className="btn bx"
                      onClick={() => setResolveModal({ item: selected, resolution: "REJECTED" })}
                      disabled={actionBusy}
                      aria-label="reject"
                    >
                      Reject
                    </button>
                  </>
                )}
                {!canWrite && (
                  <div style={{ fontSize: 11, color: "var(--sil)" }}>
                    Read-only view — requires <code>review:write</code> permission.
                  </div>
                )}
              </div>
            </div>
          </Card>
        )}
      </div>

      {/* ── Resolve confirmation modal ── */}
      {resolveModal && (
        <Modal
          open
          onClose={() => setResolveModal(null)}
          title={`Confirm ${resolveModal.resolution === "APPROVED" ? "Approval" : "Rejection"}`}
          width={440}
        >
          <div style={{ padding: "8px 0" }}>
            <p style={{ fontSize: 13, color: "var(--mist)", marginBottom: 16 }}>
              {resolveModal.resolution === "APPROVED"
                ? "Approve this document extraction? It will be cataloged and forwarded to Core DMS."
                : "Reject this document? It will remain in the queue with REJECTED status for re-ingestion."}
            </p>

            <div
              style={{
                background: "var(--gr)",
                borderRadius: 8,
                padding: "10px 14px",
                marginBottom: 16,
                fontSize: 12,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ color: "var(--sil)" }}>Doc ID</span>
                <span style={{ fontFamily: "monospace", color: "var(--gold3)" }}>
                  {resolveModal.item.doc_id}
                </span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--sil)" }}>Type</span>
                <span>{DOC_TYPE_LABELS[resolveModal.item.doc_type] ?? resolveModal.item.doc_type}</span>
              </div>
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button
                className={resolveModal.resolution === "APPROVED" ? "btn bok" : "btn bx"}
                style={{ flex: 1 }}
                disabled={actionBusy}
                onClick={() => void handleResolve(resolveModal.item, resolveModal.resolution)}
              >
                {actionBusy ? "Processing…" : `Confirm ${resolveModal.resolution === "APPROVED" ? "Approve" : "Reject"}`}
              </button>
              <button className="btn bs" onClick={() => setResolveModal(null)} disabled={actionBusy}>
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
