/**
 * ZorDMS v4.2 — Workflow Engine screen
 *
 * Maker-Checker approval workflows: active workflow table, BPMN-style
 * visual builder, SLA countdown, and approve/reject/escalate/hold actions.
 * RBAC-gated: each action button requires its own specific permission:
 *   approve  → document:approve
 *   reject   → document:reject
 *   escalate → workflow:escalate
 *   hold     → workflow:hold
 * (enforced also on the backend by the authority client calling the Gateway /authz/check).
 */
import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthContext.js";
import {
  KpiCard,
  Card,
  DataTable,
  Tag,
  StatusDot,
  Tabs,
  Modal,
  FormField,
  BarChartCard,
} from "../components/ui/index.js";
import type { Column } from "../components/ui/index.js";
import {
  listWorkflows,
  getWorkflow,
  actOnWorkflow,
  listTemplates,
  createWorkflow,
  type WorkflowRow,
  type WorkflowStepRow,
  type WorkflowAction,
  type TemplateRow,
} from "../api/workflowEngine.js";
import { WorkflowBuilder } from "../components/WorkflowEngine/WorkflowBuilder.js";

/* ── helpers ── */

function slaText(row: WorkflowRow): { text: string; color: string } {
  if (!row.sla_due_at) return { text: "No SLA", color: "var(--sil)" };
  const diff = new Date(row.sla_due_at).getTime() - Date.now();
  if (diff < 0) return { text: "Overdue", color: "var(--R)" };
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  if (h < 1) return { text: `${m}m left`, color: "var(--R)" };
  if (h < 6) return { text: `${h}h ${m}m left`, color: "var(--W)" };
  return { text: `${h}h left`, color: "var(--G)" };
}

function priorityVariant(p: string): "red" | "amber" | "blue" | "green" | "gold" | "purple" {
  switch (p) {
    case "Urgent": return "red";
    case "High":   return "amber";
    case "Low":    return "blue";
    default:       return "gold";
  }
}

function statusVariant(s: string): "green" | "red" | "amber" | "blue" | "purple" | "gold" {
  switch (s) {
    case "Approved":  return "green";
    case "Rejected":  return "red";
    case "OnHold":    return "amber";
    case "Escalated": return "purple";
    case "Active":    return "blue";
    default:          return "gold";
  }
}

/* ── KPI computation ── */
function computeKpis(rows: WorkflowRow[]) {
  const active    = rows.filter((r) => r.status === "Active").length;
  const approved  = rows.filter((r) => r.status === "Approved").length;
  const escalated = rows.filter((r) => r.status === "Escalated").length;
  const overdue   = rows.filter((r) => {
    if (!r.sla_due_at) return false;
    return new Date(r.sla_due_at).getTime() < Date.now() && r.status === "Active";
  }).length;
  return { active, approved, escalated, overdue };
}

/* ── chart data from workflow rows ── */
function buildStageChart(rows: WorkflowRow[]) {
  const counts: Record<string, number> = {};
  for (const r of rows) {
    if (r.status !== "Active") continue;
    counts[r.stage] = (counts[r.stage] ?? 0) + 1;
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 7)
    .map(([stage, count]) => ({ stage, count }));
}

/* ── New Workflow modal ── */
interface NewWorkflowForm {
  title: string;
  template_id: string;
  priority: string;
  assigned_to: string;
  doc_id: string;
}

function NewWorkflowModal({
  open, onClose, templates, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  templates: TemplateRow[];
  onCreated: () => void;
}) {
  const [form, setForm] = useState<NewWorkflowForm>({
    title: "", template_id: "", priority: "Normal", assigned_to: "", doc_id: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form.title || !form.template_id) { setError("Title and template are required."); return; }
    setBusy(true); setError(null);
    try {
      await createWorkflow({
        title: form.title,
        template_id: Number(form.template_id),
        priority: form.priority,
        assigned_to: form.assigned_to || undefined,
        doc_id: form.doc_id || undefined,
      });
      setForm({ title: "", template_id: "", priority: "Normal", assigned_to: "", doc_id: "" });
      onCreated();
      onClose();
    } catch (err) {
      setError((err as Error).message ?? "Failed to create workflow");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="New Workflow" width={520}>
      <form onSubmit={submit} style={{ padding: "0 0 4px" }}>
        <FormField
          label="Title"
          placeholder="e.g. KYC Review — Ahmed H. Ibrahim"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: (e.target as HTMLInputElement).value })}
        />
        <FormField
          as="select"
          label="Template"
          value={form.template_id}
          onChange={(e) => setForm({ ...form, template_id: (e.target as HTMLSelectElement).value })}
        >
          <option value="">— Select template —</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>{t.name}{t.doc_type ? ` (${t.doc_type})` : ""}</option>
          ))}
        </FormField>
        <FormField
          as="select"
          label="Priority"
          value={form.priority}
          onChange={(e) => setForm({ ...form, priority: (e.target as HTMLSelectElement).value })}
        >
          {["Low", "Normal", "High", "Urgent"].map((p) => <option key={p}>{p}</option>)}
        </FormField>
        <FormField
          label="Assign To (username)"
          placeholder="e.g. checker1"
          value={form.assigned_to}
          onChange={(e) => setForm({ ...form, assigned_to: (e.target as HTMLInputElement).value })}
        />
        <FormField
          label="Document ID (optional)"
          placeholder="e.g. DOC-20240429-001"
          value={form.doc_id}
          onChange={(e) => setForm({ ...form, doc_id: (e.target as HTMLInputElement).value })}
        />
        {error && <div style={{ fontSize: 11, color: "var(--R)", marginBottom: 10 }}>{error}</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
          <button type="button" className="btn bs" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn bg" disabled={busy}>
            {busy ? "Creating…" : "Create Workflow"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ── Workflow detail side panel ── */
interface WorkflowDetailPanelPermissions {
  canApprove: boolean;
  canReject: boolean;
  canEscalate: boolean;
  canHold: boolean;
}

function WorkflowDetailPanel({
  workflowId, onAct, permissions,
}: {
  workflowId: number;
  onAct: (id: number, action: WorkflowAction, comment?: string) => Promise<void>;
  permissions: WorkflowDetailPanelPermissions;
}) {
  const { canApprove, canReject, canEscalate, canHold } = permissions;
  const [detail, setDetail] = useState<{ workflow: WorkflowRow; steps: WorkflowStepRow[] } | null>(null);
  const [busy, setBusy] = useState<WorkflowAction | null>(null);
  const [comment, setComment] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setDetail(null); setErr(null);
    getWorkflow(workflowId)
      .then(setDetail)
      .catch((e) => setErr((e as Error).message ?? "Failed to load"));
  }, [workflowId]);

  async function act(action: WorkflowAction) {
    setBusy(action); setErr(null);
    try {
      await onAct(workflowId, action, comment || undefined);
      const updated = await getWorkflow(workflowId);
      setDetail(updated);
    } catch (e) {
      setErr((e as Error).message ?? "Action failed");
    } finally {
      setBusy(null);
    }
  }

  if (!detail) {
    return (
      <div className="card" style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {err ? (
          <span style={{ color: "var(--R)", fontSize: 12 }}>{err}</span>
        ) : (
          <StatusDot color="amber" pulse />
        )}
      </div>
    );
  }

  const { workflow, steps } = detail;
  const isTerminal = ["Approved", "Rejected"].includes(workflow.status);
  const isInactive = ["OnHold", "Escalated"].includes(workflow.status);
  const activeStep = steps.find((s) => s.status === "Pending");
  const { text: slaStr, color: slaColor } = slaText(workflow);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Card
        title={
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="mono" style={{ fontSize: 11, color: "var(--sil)" }}>{workflow.ref_code}</span>
            <span style={{ fontSize: 12, color: "var(--mist)", fontWeight: 700 }}>·</span>
            <span style={{ fontSize: 12 }}>Active: {workflow.stage}</span>
          </span>
        }
        action={<Tag variant={statusVariant(workflow.status)}>{workflow.status}</Tag>}
      >
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "var(--mist)", marginBottom: 4 }}>
            {workflow.title}
          </div>
          <div style={{ display: "flex", gap: 16, fontSize: 11, color: "var(--sil)" }}>
            {workflow.assigned_to && <span>Assigned: {workflow.assigned_to}</span>}
            <span style={{ color: slaColor }}>SLA: {slaStr}</span>
            <Tag variant={priorityVariant(workflow.priority)} style={{ fontSize: 9 }}>
              {workflow.priority}
            </Tag>
          </div>
        </div>

        {/* Visual step chain */}
        <WorkflowBuilder steps={steps} compact />

        {/* Action row — each button is gated on its own permission (C1 fix) */}
        {!isTerminal && !isInactive && activeStep && (canApprove || canReject || canEscalate || canHold) && (
          <div style={{ marginTop: 12, borderTop: "1px solid var(--bd)", paddingTop: 12 }}>
            <div style={{ marginBottom: 8 }}>
              <input
                className="field"
                placeholder="Optional comment…"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                style={{ fontSize: 11 }}
              />
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              {canApprove && (
                <button
                  className="btn bok"
                  style={{ flex: 1, fontSize: 12 }}
                  disabled={busy !== null}
                  onClick={() => act("approve")}
                >
                  {busy === "approve" ? "…" : "✓ Approve & Forward"}
                </button>
              )}
              {canReject && (
                <button
                  className="btn bx"
                  disabled={busy !== null}
                  onClick={() => act("reject")}
                >
                  {busy === "reject" ? "…" : "✗ Reject"}
                </button>
              )}
              {canEscalate && (
                <button
                  className="btn bw"
                  disabled={busy !== null}
                  onClick={() => act("escalate")}
                >
                  {busy === "escalate" ? "…" : "⇧ Escalate"}
                </button>
              )}
              {canHold && (
                <button
                  className="btn bs"
                  disabled={busy !== null}
                  onClick={() => act("hold")}
                >
                  {busy === "hold" ? "…" : "Hold"}
                </button>
              )}
            </div>
            {err && <div style={{ fontSize: 11, color: "var(--R)", marginTop: 6 }}>{err}</div>}
          </div>
        )}
        {(isTerminal || isInactive) && (
          <div style={{
            marginTop: 10, padding: "8px 12px",
            background: isTerminal ? "rgba(46,204,138,.06)" : "rgba(240,160,48,.06)",
            border: `1px solid ${isTerminal ? "rgba(46,204,138,.2)" : "rgba(240,160,48,.2)"}`,
            borderRadius: 6, fontSize: 11, color: isTerminal ? "var(--G)" : "var(--W)",
          }}>
            {isTerminal ? "This workflow is closed — no further actions available." : `Workflow is ${workflow.status} — cannot accept new actions.`}
          </div>
        )}
      </Card>

      {/* Full step list */}
      <Card title="Step Details">
        <table style={{ width: "100%", fontSize: 11 }}>
          <thead>
            <tr>
              {["#", "Step", "Status", "Actor"].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: "6px 8px", fontSize: 9.5, textTransform: "uppercase", letterSpacing: "1px", color: "var(--sil)", borderBottom: "1px solid var(--bd)" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {steps.map((s) => (
              <tr key={s.id} style={{ borderBottom: "1px solid var(--bd)" }}>
                <td style={{ padding: "7px 8px", color: "var(--sil)" }}>{s.seq}</td>
                <td style={{ padding: "7px 8px", fontWeight: 600, color: "var(--mist)" }}>{s.name}</td>
                <td style={{ padding: "7px 8px" }}>
                  <Tag variant={s.status === "Approved" ? "green" : s.status === "Rejected" ? "red" : s.status === "Pending" ? "amber" : "gold"}>
                    {s.status}
                  </Tag>
                </td>
                <td style={{ padding: "7px 8px", color: "var(--sil)" }}>
                  {s.actor_id ? `User #${s.actor_id}` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

/* ── Main screen ── */

const TABS = [
  { key: "all",       label: "All Workflows" },
  { key: "active",    label: "Active" },
  { key: "escalated", label: "Escalated" },
  { key: "approved",  label: "Approved" },
  { key: "rejected",  label: "Rejected" },
];

export default function WorkflowEngine() {
  const { user } = useAuth();
  // C1: per-action permissions aligned with backend ACTION_PERMISSION map
  const canApprove  = !!user?.permissions?.includes("document:approve");
  const canReject   = !!user?.permissions?.includes("document:reject");
  const canEscalate = !!user?.permissions?.includes("workflow:escalate");
  const canHold     = !!user?.permissions?.includes("workflow:hold");
  const canCreate   = canApprove || canReject || canEscalate || canHold;

  const [rows,      setRows]      = useState<WorkflowRow[]>([]);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [tab,       setTab]       = useState("all");
  const [selected,  setSelected]  = useState<WorkflowRow | null>(null);
  const [newWfOpen, setNewWfOpen] = useState(false);
  // I4: actErr removed — errors from actOnWorkflow are surfaced in WorkflowDetailPanel.err

  /* data load */
  async function refresh() {
    setLoading(true); setError(null);
    try {
      const [wfRes, tplRes] = await Promise.all([listWorkflows(), listTemplates()]);
      setRows(wfRes.workflows);
      setTemplates(tplRes.templates);
      if (selected) {
        const updated = wfRes.workflows.find((w) => w.id === selected.id);
        if (updated) setSelected(updated);
      }
    } catch (e) {
      setError((e as Error).message ?? "Failed to load workflows");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  /* filter by tab */
  const filtered = rows.filter((r) => {
    switch (tab) {
      case "active":    return r.status === "Active";
      case "escalated": return r.status === "Escalated";
      case "approved":  return r.status === "Approved";
      case "rejected":  return r.status === "Rejected";
      default:          return true;
    }
  });

  /* KPIs */
  const kpis = computeKpis(rows);
  const stageChart = buildStageChart(rows);

  /* act handler — errors propagate to WorkflowDetailPanel.err (I4: actErr removed) */
  async function handleAct(id: number, action: WorkflowAction, comment?: string) {
    await actOnWorkflow(id, { action, comment });
    await refresh();
  }

  /* table columns */
  const columns: Column<WorkflowRow>[] = [
    {
      key: "ref_code", header: "Workflow",
      render: (r) => (
        <span className="mono" style={{ fontSize: 11, color: "var(--gold3)", cursor: "pointer" }}
          onClick={() => setSelected(r)}>
          {r.ref_code}
        </span>
      ),
      sortable: true,
    },
    {
      key: "title", header: "Title",
      render: (r) => (
        <span style={{ fontSize: 12, color: "var(--mist)" }}>{r.title}</span>
      ),
      sortable: true,
    },
    {
      key: "stage", header: "Stage",
      render: (r) => (
        <Tag variant={r.status === "Approved" ? "green" : r.status === "Rejected" ? "red" : "amber"}>
          {r.stage}
        </Tag>
      ),
    },
    {
      key: "priority", header: "Priority",
      render: (r) => <Tag variant={priorityVariant(r.priority)}>{r.priority}</Tag>,
    },
    {
      key: "status", header: "Status",
      render: (r) => (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <StatusDot
            color={r.status === "Active" ? "green" : r.status === "Escalated" ? "amber" : r.status === "Rejected" ? "red" : "blue"}
            pulse={r.status === "Active"}
          />
          <span style={{ fontSize: 11 }}>{r.status}</span>
        </div>
      ),
    },
    {
      key: "assigned_to", header: "Assigned",
      render: (r) => <span style={{ fontSize: 11, color: "var(--sil)" }}>{r.assigned_to ?? "—"}</span>,
    },
    {
      key: "sla_due_at", header: "SLA",
      render: (r) => {
        const { text, color } = slaText(r);
        return <span style={{ fontSize: 11, color }}>{text}</span>;
      },
    },
    {
      key: "id", header: "",
      render: (r) => (
        <button
          className="btn bg xs"
          onClick={(e) => { e.stopPropagation(); setSelected(r); }}
        >
          Review
        </button>
      ),
    },
  ];

  /* requiring-action count */
  const requiring = rows.filter((r) => r.status === "Active").length;

  return (
    <div className="fade-up">
      {/* Page header */}
      <div className="page-header">
        <div>
          <h2 className="serif">Workflow Engine</h2>
          <p>Maker-Checker · Parallel flows · Escalation · BPMN 2.0 builder · SLA monitoring</p>
        </div>
        <div className="phr">
          {canCreate && (
            <button className="btn bg sm" onClick={() => setNewWfOpen(true)}>
              + New Workflow
            </button>
          )}
          <button className="btn bs sm" onClick={() => void refresh()}>
            ↻ Refresh
          </button>
        </div>
      </div>

      {/* KPI row */}
      <div className="g4" style={{ marginBottom: 14 }}>
        <KpiCard
          label="Active Workflows"
          value={kpis.active.toLocaleString()}
          sub={`${requiring} requiring action`}
          variant="blue"
        />
        <KpiCard
          label="Total Approved"
          value={kpis.approved.toLocaleString()}
          sub="All-time approved"
          variant="green"
        />
        <KpiCard
          label="Escalated"
          value={kpis.escalated.toLocaleString()}
          sub="Require supervisor review"
          variant="amber"
        />
        <KpiCard
          label="SLA Overdue"
          value={kpis.overdue.toLocaleString()}
          sub="Breach detected"
          variant="red"
        />
      </div>

      {/* Error banner */}
      {error && (
        <div style={{ background: "rgba(224,82,82,.1)", border: "1px solid rgba(224,82,82,.3)", borderRadius: 8, padding: "10px 14px", marginBottom: 14, color: "var(--R)", fontSize: 12 }}>
          {error}
        </div>
      )}

      {/* Main content: table + side panel */}
      <div className="g2" style={{ marginBottom: 14 }}>
        {/* Left: workflow table */}
        <Card
          title={
            <span>
              Active Workflows{" "}
              {requiring > 0 && (
                <Tag variant="amber" style={{ marginLeft: 6, fontSize: 10 }}>
                  {requiring} requiring action
                </Tag>
              )}
            </span>
          }
        >
          <Tabs items={TABS} active={tab} onChange={setTab} />
          {loading ? (
            <div style={{ padding: 24, textAlign: "center" }}>
              <StatusDot color="amber" pulse />
              <span style={{ fontSize: 12, color: "var(--sil)", marginLeft: 8 }}>Loading workflows…</span>
            </div>
          ) : (
            <DataTable<WorkflowRow>
              columns={columns}
              rows={filtered as WorkflowRow[]}
              rowKey={(r) => r.id}
              onRowClick={(r) => setSelected(r)}
              emptyMessage="No workflows match this filter"
            />
          )}
        </Card>

        {/* Right: detail panel */}
        {selected ? (
          <WorkflowDetailPanel
            key={selected.id}
            workflowId={selected.id}
            onAct={handleAct}
            permissions={{ canApprove, canReject, canEscalate, canHold }}
          />
        ) : (
          <Card>
            <div style={{
              height: 200, display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", gap: 8,
            }}>
              <div style={{ fontSize: 32, opacity: 0.3 }}>⚙</div>
              <div style={{ fontSize: 12, color: "var(--sil)" }}>
                Select a workflow to view its steps and take action.
              </div>
            </div>
          </Card>
        )}
      </div>

      {/* Visual Workflow Builder */}
      {selected && (
        <Card
          title={
            <span>
              Visual Workflow Builder
              <Tag variant="blue" style={{ marginLeft: 8, fontSize: 10 }}>BPMN 2.0 Compatible</Tag>
            </span>
          }
          style={{ marginBottom: 14 }}
        >
          <div style={{
            background: "rgba(255,255,255,.02)",
            border: "1px dashed rgba(255,255,255,.08)",
            borderRadius: 8, padding: 20,
          }}>
            <SelectedWorkflowBuilder workflowId={selected.id} />
          </div>
        </Card>
      )}

      {/* Stage distribution chart */}
      {stageChart.length > 0 && (
        <BarChartCard
          title="Active Workflow Stages"
          data={stageChart}
          xKey="stage"
          bars={[{ key: "count", color: "var(--gold2)", name: "Workflows" }]}
          height={180}
        />
      )}

      {/* New Workflow modal */}
      <NewWorkflowModal
        open={newWfOpen}
        onClose={() => setNewWfOpen(false)}
        templates={templates}
        onCreated={refresh}
      />
    </div>
  );
}

/* Fetches and renders the full builder for the selected workflow.
 * I3 fix: surfaces fetch errors and shows a loading indicator instead of
 * silently falling back to an empty step list. */
function SelectedWorkflowBuilder({ workflowId }: { workflowId: number }) {
  const [steps, setSteps]     = useState<WorkflowStepRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    setLoading(true); setError(null);
    getWorkflow(workflowId)
      .then((d) => { setSteps(d.steps); })
      .catch((e) => { setError((e as Error).message ?? "Failed to load workflow steps"); })
      .finally(() => { setLoading(false); });
  }, [workflowId]);

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 0" }}>
        <StatusDot color="amber" pulse />
        <span style={{ fontSize: 11, color: "var(--sil)" }}>Loading workflow steps…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ fontSize: 12, color: "var(--R)", padding: "12px 0" }}>
        Failed to load workflow steps: {error}
      </div>
    );
  }

  return <WorkflowBuilder steps={steps} />;
}
