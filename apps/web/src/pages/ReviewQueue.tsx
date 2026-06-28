/**
 * ReviewQueue — ZorDMS Human-Review Queue, backed by the WORKFLOW service.
 *
 * The WORKFLOW service is the source of truth for the maker-checker review
 * queue. This screen is a thin, RBAC-gated client over it:
 *
 *  - KPI row: pending, claimed, escalated, SLA breached
 *  - Tabs:    Pending | Claimed | Resolved (Approved+Rejected) | Escalated | SLA Breached
 *             — driven by useUrlState so the active tab is sharable / refresh-safe
 *  - DataTable (paginated) with priority, SLA countdown, assignee + semantic
 *    action buttons (.bok approve, .bx reject, .bw escalate/hold)
 *  - Actions wired to the real endpoints:
 *      Claim                 → POST /workflows/:id/claim
 *      Approve/Reject/...    → POST /workflows/:id/act
 *    After any action the list reloads and the row reflects the new status.
 *  - Every row deep-links into the viewer (/viewer?doc=<documentId>) — this is
 *    the P4 "approve-from-viewer" entry point.
 *  - Resilient: loading / empty / error states, retry, branch-scoped server-side.
 *
 * RBAC: claim/act require "review:write". Individual act actions are also
 * authority-gated server-side (approve→document:approve, reject→document:reject,
 * escalate→workflow:escalate, hold→workflow:hold), so a 403 surfaces as an error.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.js";
import { useUrlState } from "../hooks/useUrlState.js";
import { usePeriod, inPeriod } from "../hooks/usePeriod.js";
import { PeriodFilterBanner } from "../components/PeriodFilterBanner.js";
import {
  listAllReviewQueue,
  claimWorkflow,
  actOnWorkflow,
  type ReviewQueueItem,
  type QueueAction,
} from "../api/reviewQueueApi.js";
import {
  KpiCard,
  Card,
  DataTable,
  Tag,
  StatusDot,
  Tabs,
  Modal,
  RefId,
  type Column,
  type TagVariant,
} from "../components/ui/index.js";

/* ─── Tab model ─── */

type TabKey = "PENDING" | "CLAIMED" | "RESOLVED" | "ESCALATED" | "SLA_BREACHED";

const TAB_KEYS: TabKey[] = ["PENDING", "CLAIMED", "RESOLVED", "ESCALATED", "SLA_BREACHED"];

/* ─── Helpers ─── */

function slaDue(deadline: string | null): { text: string; urgent: boolean; breached: boolean } {
  if (!deadline) return { text: "—", urgent: false, breached: false };
  const diff = new Date(deadline).getTime() - Date.now();
  const hours = diff / 3_600_000;
  if (hours < 0) return { text: "BREACHED", urgent: true, breached: true };
  if (hours < 2)  return { text: `${Math.round(hours * 60)} min`, urgent: true, breached: false };
  if (hours < 24) return { text: `${hours.toFixed(1)} h`, urgent: true, breached: false };
  return { text: `${Math.ceil(hours / 24)} d`, urgent: false, breached: false };
}

function isBreached(item: ReviewQueueItem): boolean {
  // Only open (non-terminal) items can breach their SLA.
  if (item.queue_status === "Approved" || item.queue_status === "Rejected") return false;
  return slaDue(item.sla_due_at).breached;
}

const STATUS_TAG: Record<string, { variant: TagVariant; label: string }> = {
  Pending:   { variant: "amber",  label: "Pending" },
  Claimed:   { variant: "blue",   label: "Claimed" },
  Approved:  { variant: "green",  label: "Approved" },
  Rejected:  { variant: "red",    label: "Rejected" },
  Escalated: { variant: "purple", label: "Escalated" },
  OnHold:    { variant: "gold",   label: "On Hold" },
};

function statusTag(status: string) {
  const t = STATUS_TAG[status] ?? { variant: "gold" as TagVariant, label: status };
  return <Tag variant={t.variant}>{t.label}</Tag>;
}

const PRIORITY_TAG: Record<string, TagVariant> = {
  Urgent: "red",
  High:   "amber",
  Normal: "blue",
  Low:    "gold",
};

/* ─── Component ─── */

export default function ReviewQueue() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const canWrite = user?.permissions.includes("review:write") ?? false;

  // URL-backed UI state (tab) — consistent with the rest of the app. We keep a
  // local mirror so a tab click re-renders even where setSearchParams is a no-op
  // (e.g. tests), while still updating the URL for bookmarkability.
  const [urlState, setUrlState] = useUrlState<{ tab: string }>({ tab: "PENDING" });
  // Time period carried in from a Dashboard drill-down (?period=&from=&to=).
  const period = usePeriod();
  const initialTab: TabKey = (TAB_KEYS as string[]).includes(urlState.tab)
    ? (urlState.tab as TabKey)
    : "PENDING";
  const [tab, setTabLocal] = useState<TabKey>(initialTab);

  const [rows, setRows] = useState<ReviewQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReviewQueueItem | null>(null);
  const [confirm, setConfirm] = useState<{ item: ReviewQueueItem; action: QueueAction } | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  /* ── Data ── */
  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listAllReviewQueue();
      setRows(data);
    } catch (e) {
      setError(humanizeError(e, "Failed to load review queue"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    // Refresh every 30 s — skip when the tab is hidden to avoid needless
    // network traffic and token refreshes.
    const t = setInterval(() => {
      if (document.visibilityState === "visible") void reload();
    }, 30_000);
    return () => clearInterval(t);
  }, [reload]);

  /* ── Actions ── */
  const handleClaim = useCallback(
    async (item: ReviewQueueItem) => {
      if (!canWrite) return;
      setActionBusy(true);
      setError(null);
      try {
        await claimWorkflow(item.id);
        await reload();
        setSelected(null);
      } catch (e) {
        setError(humanizeError(e, "Claim failed"));
      } finally {
        setActionBusy(false);
      }
    },
    [canWrite, reload],
  );

  const handleAct = useCallback(
    async (item: ReviewQueueItem, action: QueueAction) => {
      if (!canWrite) return;
      setActionBusy(true);
      setError(null);
      try {
        await actOnWorkflow(item.id, action);
        await reload();
        setSelected(null);
        setConfirm(null);
      } catch (e) {
        setError(humanizeError(e, `${action} failed`));
      } finally {
        setActionBusy(false);
      }
    },
    [canWrite, reload],
  );

  const openInViewer = useCallback(
    (item: ReviewQueueItem) => {
      if (!item.doc_id) return;
      // Pass the workflow id so the Viewer shows the Approve/Reject decision card
      // and closes the review -> viewer -> approve -> back loop.
      navigate(`/viewer?doc=${encodeURIComponent(item.doc_id)}&workflow=${encodeURIComponent(item.id)}`);
    },
    [navigate],
  );

  /* ── Derived counts ── */
  const counts = useMemo(() => {
    const pending  = rows.filter((r) => r.queue_status === "Pending").length;
    const claimed  = rows.filter((r) => r.queue_status === "Claimed").length;
    const resolved = rows.filter(
      (r) => r.queue_status === "Approved" || r.queue_status === "Rejected",
    ).length;
    const escalated = rows.filter((r) => r.queue_status === "Escalated").length;
    const breached  = rows.filter(isBreached).length;
    return { pending, claimed, resolved, escalated, breached };
  }, [rows]);

  /* ── Filtered rows for the active tab (and time period, if one is active) ── */
  const filtered = useMemo(() => {
    const byPeriod = period.active
      ? rows.filter((r) => inPeriod(r.created_at, period))
      : rows;
    switch (tab) {
      case "PENDING":      return byPeriod.filter((r) => r.queue_status === "Pending");
      case "CLAIMED":      return byPeriod.filter((r) => r.queue_status === "Claimed");
      case "RESOLVED":     return byPeriod.filter((r) => r.queue_status === "Approved" || r.queue_status === "Rejected");
      case "ESCALATED":    return byPeriod.filter((r) => r.queue_status === "Escalated");
      case "SLA_BREACHED": return byPeriod.filter(isBreached);
      default:             return byPeriod;
    }
  }, [rows, tab, period]);

  const changeTab = useCallback(
    (k: string) => {
      setTabLocal(k as TabKey);
      setUrlState({ tab: k });
      setSelected(null);
    },
    [setUrlState],
  );

  /* ── Row action buttons (semantic) ── */
  function rowActions(r: ReviewQueueItem) {
    return (
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
        <button
          className="btn bs xs"
          onClick={(e) => { e.stopPropagation(); openInViewer(r); }}
          disabled={!r.doc_id}
          aria-label="open in viewer"
          title={r.doc_id ? "Open in Viewer" : "No linked document"}
        >
          Open
        </button>
        {r.queue_status === "Pending" && (
          <button
            className="btn bs xs"
            onClick={(e) => { e.stopPropagation(); void handleClaim(r); }}
            disabled={!canWrite || actionBusy}
            aria-label="claim"
          >
            Claim
          </button>
        )}
        {(r.queue_status === "Pending" || r.queue_status === "Claimed") && (
          <>
            <button
              className="btn bok xs"
              onClick={(e) => { e.stopPropagation(); setConfirm({ item: r, action: "approve" }); }}
              disabled={!canWrite || actionBusy}
              aria-label="approve"
            >
              Approve
            </button>
            <button
              className="btn bx xs"
              onClick={(e) => { e.stopPropagation(); setConfirm({ item: r, action: "reject" }); }}
              disabled={!canWrite || actionBusy}
              aria-label="reject"
            >
              Reject
            </button>
            <button
              className="btn bw xs"
              onClick={(e) => { e.stopPropagation(); setConfirm({ item: r, action: "escalate" }); }}
              disabled={!canWrite || actionBusy}
              aria-label="escalate"
            >
              Escalate
            </button>
            <button
              className="btn bw xs"
              onClick={(e) => { e.stopPropagation(); setConfirm({ item: r, action: "hold" }); }}
              disabled={!canWrite || actionBusy}
              aria-label="hold"
            >
              Hold
            </button>
          </>
        )}
      </div>
    );
  }

  /* ── Columns ── */
  const columns: Column<ReviewQueueItem>[] = [
    {
      key: "ref_code",
      header: "Ref",
      sortable: true,
      width: 110,
      render: (r) => (
        <span style={{ fontSize: 11, fontFamily: "monospace", color: "var(--gold3)" }}>
          {r.ref_code}
        </span>
      ),
    },
    {
      key: "title",
      header: "Title",
      sortable: true,
      render: (r) => <span style={{ fontSize: 12 }}>{r.title}</span>,
    },
    {
      key: "doc_id",
      header: "Document",
      width: 140,
      render: (r) => (
        <RefId value={r.doc_id} style={{ fontSize: 11, color: "var(--sil)" }} />
      ),
    },
    {
      key: "priority",
      header: "Priority",
      sortable: true,
      width: 90,
      render: (r) => <Tag variant={PRIORITY_TAG[r.priority] ?? "gold"}>{r.priority}</Tag>,
    },
    {
      key: "assignee",
      header: "Assignee",
      width: 120,
      render: (r) => (
        <span style={{ fontSize: 11, color: r.assignee ? "var(--mist)" : "var(--sil)" }}>
          {r.assignee ?? "Unassigned"}
        </span>
      ),
    },
    {
      key: "sla_due_at",
      header: "SLA",
      sortable: true,
      width: 90,
      render: (r) => {
        const sla = slaDue(r.sla_due_at);
        return (
          <span style={{ fontSize: 11, color: sla.urgent ? "var(--R)" : "var(--sil)", fontWeight: sla.urgent ? 700 : 400 }}>
            {sla.text}
          </span>
        );
      },
    },
    {
      key: "queue_status",
      header: "Status",
      width: 100,
      render: (r) => statusTag(r.queue_status),
    },
    {
      key: "_action",
      header: "Actions",
      width: 260,
      render: rowActions,
    },
  ];

  /* ── Tab labels ── */
  const tabItems = [
    { key: "PENDING",      label: `Pending (${counts.pending})` },
    { key: "CLAIMED",      label: `Claimed (${counts.claimed})` },
    { key: "RESOLVED",     label: `Resolved (${counts.resolved})` },
    { key: "ESCALATED",    label: `Escalated (${counts.escalated})` },
    { key: "SLA_BREACHED", label: `SLA Breached (${counts.breached})` },
  ];

  return (
    <div className="fade-up">
      {/* Header */}
      <div className="page-header">
        <div>
          <h2 className="serif">Human-Review Queue</h2>
          <p>
            Maker-checker review backed by the Workflow service · branch-scoped · claim, approve,
            reject, escalate &amp; hold
          </p>
        </div>
        <div className="phr" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Tag variant="gold">Workflow</Tag>
          {loading ? <StatusDot color="amber" pulse /> : <StatusDot color="green" />}
          <button className="btn bs sm" onClick={reload} disabled={loading}>
            Refresh
          </button>
        </div>
      </div>

      {period.active && (
        <PeriodFilterBanner from={period.from} to={period.to} onClear={period.clear} />
      )}

      {/* KPI row */}
      <div className="g4" style={{ marginBottom: 16 }}>
        <KpiCard label="Pending Review"        value={counts.pending}   sub="Awaiting first claim" variant="amber" />
        <KpiCard label="Claimed / In-Progress" value={counts.claimed}   sub="Being reviewed now"   variant="blue" />
        <KpiCard label="Escalated"             value={counts.escalated} sub="Raised for authority" variant="purple" />
        <KpiCard label="SLA Breached"          value={counts.breached}  sub="Requires escalation"  variant="red" />
      </div>

      {/* Error banner */}
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
          <button className="btn bs xs" style={{ marginLeft: 12 }} onClick={reload}>
            Retry
          </button>
        </div>
      )}

      {/* Tabs */}
      <Tabs items={tabItems} active={tab} onChange={changeTab} />

      {/* Main */}
      <div className={selected ? "g2" : ""} style={{ marginTop: 14 }}>
        <div>
          <DataTable<ReviewQueueItem>
            columns={columns}
            rows={filtered}
            rowKey={(r) => r.id}
            onRowClick={(r) => setSelected(r)}
            pageSize={10}
            emptyMessage={
              loading
                ? "Loading review queue…"
                : tab === "SLA_BREACHED"
                  ? "No SLA-breached items."
                  : tab === "RESOLVED"
                    ? "No resolved items."
                    : `No ${tab.toLowerCase()} items.`
            }
          />
          <div style={{ fontSize: 11, color: "var(--sil)", marginTop: 8, paddingLeft: 4 }}>
            Showing {filtered.length} item{filtered.length !== 1 ? "s" : ""}. Auto-refreshes every 30 s
            (when tab is visible).
          </div>
        </div>

        {/* Detail panel */}
        {selected && (
          <Card
            title={
              <span>
                Review Detail —{" "}
                <span style={{ fontFamily: "monospace", color: "var(--gold3)", fontSize: 12 }}>
                  {selected.ref_code}
                </span>
              </span>
            }
            action={
              <button className="ic" onClick={() => setSelected(null)} type="button" aria-label="Close panel">
                ×
              </button>
            }
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                {statusTag(selected.queue_status)}
                <Tag variant={PRIORITY_TAG[selected.priority] ?? "gold"}>{selected.priority}</Tag>
              </div>

              {[
                { label: "Title",      value: selected.title },
                { label: "Document",   value: <RefId value={selected.doc_id} /> },
                { label: "Branch",     value: selected.branch ?? "—" },
                { label: "Stage",      value: selected.stage },
                { label: "Assignee",   value: selected.assignee ?? "Unassigned" },
                { label: "SLA Due",    value: slaDue(selected.sla_due_at).text },
                { label: "Created by", value: selected.created_by ?? "—" },
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
                  <span style={{ color: "var(--mist)", textAlign: "right", maxWidth: "60%" }}>{value}</span>
                </div>
              ))}

              {isBreached(selected) && (
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
                  SLA breached — escalation recommended.
                </div>
              )}

              {/* Detail actions */}
              <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 8 }}>
                <button
                  className="btn bs"
                  onClick={() => openInViewer(selected)}
                  disabled={!selected.doc_id}
                  aria-label="open in viewer detail"
                >
                  Open in Viewer
                </button>
                {selected.queue_status === "Pending" && canWrite && (
                  <button
                    className="btn bs"
                    onClick={() => void handleClaim(selected)}
                    disabled={actionBusy}
                    aria-label="claim detail"
                  >
                    Claim This Item
                  </button>
                )}
                {(selected.queue_status === "Pending" || selected.queue_status === "Claimed") && canWrite && (
                  <>
                    <button
                      className="btn bok"
                      onClick={() => setConfirm({ item: selected, action: "approve" })}
                      disabled={actionBusy}
                      aria-label="approve detail"
                    >
                      Approve
                    </button>
                    <button
                      className="btn bx"
                      onClick={() => setConfirm({ item: selected, action: "reject" })}
                      disabled={actionBusy}
                      aria-label="reject detail"
                    >
                      Reject
                    </button>
                    <button
                      className="btn bw"
                      onClick={() => setConfirm({ item: selected, action: "escalate" })}
                      disabled={actionBusy}
                      aria-label="escalate detail"
                    >
                      Escalate
                    </button>
                    <button
                      className="btn bw"
                      onClick={() => setConfirm({ item: selected, action: "hold" })}
                      disabled={actionBusy}
                      aria-label="hold detail"
                    >
                      Hold
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

      {/* Confirm action modal */}
      {confirm && (
        <Modal
          open
          onClose={() => setConfirm(null)}
          title={`Confirm ${ACTION_LABEL[confirm.action]}`}
          width={440}
        >
          <div style={{ padding: "8px 0" }}>
            <p style={{ fontSize: 13, color: "var(--mist)", marginBottom: 16 }}>
              {ACTION_BLURB[confirm.action]}
            </p>

            <div style={{ background: "var(--gr)", borderRadius: 8, padding: "10px 14px", marginBottom: 16, fontSize: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ color: "var(--sil)" }}>Ref</span>
                <span style={{ fontFamily: "monospace", color: "var(--gold3)" }}>{confirm.item.ref_code}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--sil)" }}>Title</span>
                <span>{confirm.item.title}</span>
              </div>
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button
                className={`btn ${ACTION_BTN_CLASS[confirm.action]}`}
                style={{ flex: 1 }}
                disabled={actionBusy}
                onClick={() => void handleAct(confirm.item, confirm.action)}
              >
                {actionBusy ? "Processing…" : `Confirm ${ACTION_LABEL[confirm.action]}`}
              </button>
              <button className="btn bs" onClick={() => setConfirm(null)} disabled={actionBusy}>
                Cancel
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ─── Action presentation maps ─── */

const ACTION_LABEL: Record<QueueAction, string> = {
  approve: "Approve",
  reject: "Reject",
  escalate: "Escalate",
  hold: "Hold",
};

const ACTION_BTN_CLASS: Record<QueueAction, string> = {
  approve: "bok",
  reject: "bx",
  escalate: "bw",
  hold: "bw",
};

const ACTION_BLURB: Record<QueueAction, string> = {
  approve: "Approve this step? It advances the workflow (or completes it on the final step).",
  reject: "Reject this workflow? It is closed with a Rejected status.",
  escalate: "Escalate this workflow to a higher authority? It pauses pending re-assignment.",
  hold: "Put this workflow on hold? It is paused until resumed.",
};

/* ─── Error formatting ─── */

function humanizeError(e: unknown, fallback: string): string {
  if (e && typeof e === "object" && "status" in e) {
    const status = (e as { status?: number }).status;
    const body = (e as { body?: { error?: string } }).body;
    if (status === 403) return "You do not have permission to perform this action.";
    if (status === 409 && body?.error) return formatConflict(body.error);
    if (body?.error) return body.error;
  }
  return e instanceof Error ? e.message : fallback;
}

function formatConflict(code: string): string {
  switch (code) {
    case "already_claimed":   return "Already claimed by another reviewer.";
    case "workflow_closed":   return "This workflow is already closed.";
    case "workflow_inactive": return "This workflow is on hold or escalated and cannot be actioned.";
    case "no_pending_step":   return "There is no pending step to action.";
    default:                  return code;
  }
}
