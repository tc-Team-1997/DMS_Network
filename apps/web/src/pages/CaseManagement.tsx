/**
 * ZorDMS v4.2 — Case Management screen
 *
 * End-to-end document cases: KYC, Loan Origination, Account Opening, AML/Compliance.
 * Features: KPI tiles, tabbed case list with status badges, case detail side-panel
 * (stage chain + attached documents), create-case modal with embedded workflow
 * selection, and resolve/reject actions.
 *
 * RBAC: case:read required for viewing, case:create required for creation,
 * case:manage required for resolution and attaching documents.
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
  DonutChartCard,
  RefId,
} from "../components/ui/index.js";
import type { Column } from "../components/ui/index.js";
import {
  listCases,
  getCaseMetrics,
  createCase,
  getCase,
  resolveCase,
  attachDocument,
  type CaseRow,
  type CaseMetrics,
  type CaseDocument,
} from "../api/caseManagement.js";
import { listTemplates, type TemplateRow } from "../api/workflowEngine.js";
import { WorkflowBuilder } from "../components/WorkflowEngine/WorkflowBuilder.js";
import type { WorkflowStepRow } from "../api/workflowEngine.js";

/* ── constants ── */
const CASE_TYPES = ["KYC", "Loan", "Account", "AML"];

const TYPE_TABS = [
  { key: "all",     label: "All Cases" },
  { key: "KYC",     label: "KYC Onboarding" },
  { key: "Loan",    label: "Loan Applications" },
  { key: "Account", label: "Account Opening" },
  { key: "AML",     label: "AML/Compliance" },
];

const STATUS_COLORS: Record<string, string> = {
  Open:     "rgba(184,145,42,.5)",
  InReview: "rgba(58,159,208,.5)",
  Resolved: "rgba(46,204,138,.5)",
  Rejected: "rgba(224,82,82,.5)",
};

/* ── helpers ── */
function caseTypeVariant(t: string): "gold" | "blue" | "green" | "red" | "purple" | "amber" {
  switch (t) {
    case "KYC":     return "gold";
    case "Loan":    return "blue";
    case "Account": return "green";
    case "AML":     return "red";
    default:        return "purple";
  }
}

function statusVariant(s: string): "green" | "red" | "amber" | "blue" | "purple" | "gold" {
  switch (s) {
    case "Resolved": return "green";
    case "Rejected": return "red";
    case "InReview": return "blue";
    case "Open":     return "amber";
    default:         return "gold";
  }
}

function slaText(dueAt?: string | null): { text: string; color: string } {
  if (!dueAt) return { text: "No due date", color: "var(--sil)" };
  const diff = new Date(dueAt).getTime() - Date.now();
  if (diff < 0) return { text: "Overdue", color: "var(--R)" };
  const d = Math.floor(diff / 86_400_000);
  const h = Math.floor((diff % 86_400_000) / 3_600_000);
  if (d > 0) return { text: `${d}d ${h}h`, color: d < 2 ? "var(--W)" : "var(--G)" };
  return { text: `${h}h left`, color: "var(--R)" };
}

/* ── New Case modal ── */
function NewCaseModal({
  open, onClose, templates, onCreated,
}: {
  open: boolean;
  onClose: () => void;
  templates: TemplateRow[];
  onCreated: () => void;
}) {
  const { user } = useAuth();
  const [form, setForm] = useState({
    case_type: "KYC", title: "", assigned_to: "", due_at: "", template_id: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy]   = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!form.title) { setError("Title is required."); return; }
    setBusy(true); setError(null);
    try {
      await createCase({
        case_type: form.case_type,
        title: form.title,
        assigned_to: form.assigned_to || undefined,
        due_at: form.due_at || undefined,
        template_id: form.template_id || undefined,
      });
      setForm({ case_type: "KYC", title: "", assigned_to: "", due_at: "", template_id: "" });
      onCreated(); onClose();
    } catch (err) {
      setError((err as Error).message ?? "Failed to create case");
    } finally {
      setBusy(false);
    }
  }

  void user; // user identity is sent via JWT from http helper

  return (
    <Modal open={open} onClose={onClose} title="New Case" width={520}>
      <form onSubmit={submit} style={{ padding: "0 0 4px" }}>
        <FormField
          as="select"
          label="Case Type"
          value={form.case_type}
          onChange={(e) => setForm({ ...form, case_type: (e.target as HTMLSelectElement).value })}
        >
          {CASE_TYPES.map((t) => <option key={t}>{t}</option>)}
        </FormField>
        <FormField
          label="Title / Subject"
          placeholder="e.g. KYC Annual Review — Ahmed H. Ibrahim"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: (e.target as HTMLInputElement).value })}
        />
        <FormField
          label="Assign To (username)"
          placeholder="e.g. checker1"
          value={form.assigned_to}
          onChange={(e) => setForm({ ...form, assigned_to: (e.target as HTMLInputElement).value })}
        />
        <FormField
          label="Due Date (optional)"
          type="date"
          value={form.due_at}
          onChange={(e) => setForm({ ...form, due_at: (e.target as HTMLInputElement).value })}
        />
        <FormField
          as="select"
          label="Attach Workflow Template (optional)"
          value={form.template_id}
          onChange={(e) => setForm({ ...form, template_id: (e.target as HTMLSelectElement).value })}
        >
          <option value="">— No embedded workflow —</option>
          {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </FormField>
        {error && <div style={{ fontSize: 11, color: "var(--R)", marginBottom: 10 }}>{error}</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
          <button type="button" className="btn bs" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn bg" disabled={busy}>
            {busy ? "Creating…" : "Create Case"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ── Case Detail panel ── */
interface CaseBundle {
  case: CaseRow;
  documents: CaseDocument[];
  workflow?: {
    id: number; ref_code: string; title: string; stage: string;
    status: string; steps?: WorkflowStepRow[];
  } | null;
}

function CaseDetailPanel({
  caseId, onUpdated, canManage,
}: {
  caseId: string;
  onUpdated: () => void;
  canManage: boolean;
}) {
  const [bundle, setBundle]   = useState<CaseBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolution, setResolution]   = useState("");
  const [resolveStatus, setResolveStatus] = useState<"Resolved" | "Rejected">("Resolved");
  const [resolveBusy, setResolveBusy]     = useState(false);
  const [attachDocId, setAttachDocId] = useState("");
  const [attachLabel, setAttachLabel] = useState("");
  const [attachBusy, setAttachBusy]   = useState(false);

  async function load() {
    setLoading(true); setError(null);
    try {
      const data = await getCase(caseId);
      setBundle(data as CaseBundle);
    } catch (e) {
      setError((e as Error).message ?? "Failed to load case");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [caseId]);

  async function submitResolve(e: FormEvent) {
    e.preventDefault();
    if (!resolution) return;
    setResolveBusy(true);
    try {
      await resolveCase(caseId, { status: resolveStatus, resolution });
      await load(); onUpdated();
      setResolveOpen(false); setResolution("");
    } catch (err) {
      setError((err as Error).message ?? "Failed to resolve");
    } finally {
      setResolveBusy(false);
    }
  }

  async function submitAttach(e: FormEvent) {
    e.preventDefault();
    if (!attachDocId) return;
    setAttachBusy(true);
    try {
      await attachDocument(caseId, { doc_id: attachDocId, label: attachLabel || undefined });
      await load();
      setAttachDocId(""); setAttachLabel("");
    } catch (err) {
      setError((err as Error).message ?? "Failed to attach");
    } finally {
      setAttachBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="card" style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 180 }}>
        <StatusDot color="amber" pulse />
        <span style={{ marginLeft: 8, fontSize: 12, color: "var(--sil)" }}>Loading…</span>
      </div>
    );
  }

  if (error || !bundle) {
    return (
      <div className="card" style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 100 }}>
        <span style={{ fontSize: 12, color: "var(--R)" }}>{error ?? "Not found"}</span>
      </div>
    );
  }

  const { case: c, documents, workflow } = bundle;
  const isOpen = c.status === "Open" || c.status === "InReview";
  const { text: slaStr, color: slaColor } = slaText(c.due_at);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Case header card */}
      <Card
        title={
          <div>
            <span className="mono" style={{ fontSize: 10, color: "var(--sil)" }}>{c.case_ref}</span>
            <div style={{ fontSize: 14, fontWeight: 700, color: "var(--mist)", marginTop: 2 }}>
              {c.title}
            </div>
          </div>
        }
        action={<Tag variant={statusVariant(c.status)}>{c.status}</Tag>}
      >
        <div style={{ display: "flex", gap: 14, fontSize: 11, color: "var(--sil)", marginBottom: 10 }}>
          <Tag variant={caseTypeVariant(c.case_type)}>{c.case_type}</Tag>
          {c.assigned_to && <span>Assigned: {c.assigned_to}</span>}
          <span style={{ color: slaColor }}>Due: {slaStr}</span>
          {c.created_by && <span>Created by: {c.created_by}</span>}
        </div>

        {/* Embedded workflow stage chain */}
        {workflow && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 10.5, color: "var(--sil)", marginBottom: 4 }}>
              Workflow: <span className="mono" style={{ color: "var(--gold2)" }}>{workflow.ref_code}</span>
              {" · "}Stage: <strong style={{ color: "var(--mist)" }}>{workflow.stage}</strong>
              <Tag variant={statusVariant(workflow.status)} style={{ marginLeft: 6, fontSize: 9 }}>{workflow.status}</Tag>
            </div>
            {Array.isArray((workflow as any).steps) && (
              <WorkflowBuilder steps={(workflow as any).steps as WorkflowStepRow[]} compact />
            )}
          </div>
        )}

        {/* Action buttons — C2: Escalate button removed (no backend route, was silently resolving);
            C3: Hold button removed (no backend route, was a no-op with no feedback) */}
        {canManage && isOpen && (
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button
              className="btn bok"
              style={{ flex: 1 }}
              onClick={() => { setResolveStatus("Resolved"); setResolveOpen(true); }}
            >
              ✓ Approve &amp; Resolve
            </button>
            <button
              className="btn bx"
              onClick={() => { setResolveStatus("Rejected"); setResolveOpen(true); }}
            >
              ✗ Reject
            </button>
          </div>
        )}
        {c.resolution && (
          <div style={{
            marginTop: 10, padding: "8px 10px",
            background: c.status === "Resolved" ? "rgba(46,204,138,.06)" : "rgba(224,82,82,.06)",
            border: `1px solid ${c.status === "Resolved" ? "rgba(46,204,138,.2)" : "rgba(224,82,82,.2)"}`,
            borderRadius: 6, fontSize: 11, color: c.status === "Resolved" ? "var(--G)" : "var(--R)",
          }}>
            Resolution: {c.resolution}
          </div>
        )}
      </Card>

      {/* Case Documents */}
      <Card title="Case Documents">
        <table style={{ width: "100%", fontSize: 11, marginBottom: 12 }}>
          <thead>
            <tr>
              {["Document ID", "Label", "Attached"].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: "6px 8px", fontSize: 9.5, textTransform: "uppercase", letterSpacing: "1px", color: "var(--sil)", borderBottom: "1px solid var(--bd)" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {documents.length === 0 ? (
              <tr>
                <td colSpan={3} style={{ padding: "16px 8px", color: "var(--sil)", fontSize: 11, textAlign: "center" }}>
                  No documents attached yet
                </td>
              </tr>
            ) : documents.map((d) => (
              <tr key={d.id} style={{ borderBottom: "1px solid var(--bd)" }}>
                <td style={{ padding: "7px 8px" }}>
                  <RefId value={d.doc_id} className="mono" style={{ fontSize: 11, color: "var(--gold3)" }} />
                </td>
                <td style={{ padding: "7px 8px", color: "var(--sil)" }}>{d.label ?? "—"}</td>
                <td style={{ padding: "7px 8px", color: "var(--sil)" }}>
                  {d.attached_at ? new Date(d.attached_at).toLocaleDateString() : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {canManage && (
          <form onSubmit={submitAttach} style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              className="field"
              placeholder="Document ID"
              value={attachDocId}
              onChange={(e) => setAttachDocId(e.target.value)}
              style={{ fontSize: 11, width: 160 }}
            />
            <input
              className="field"
              placeholder="Label (optional)"
              value={attachLabel}
              onChange={(e) => setAttachLabel(e.target.value)}
              style={{ fontSize: 11, flex: 1 }}
            />
            <button type="submit" className="btn bg xs" disabled={attachBusy || !attachDocId}>
              {attachBusy ? "…" : "Attach"}
            </button>
          </form>
        )}
      </Card>

      {/* Resolve modal — M2 fix: dynamic title reflects actual action */}
      <Modal open={resolveOpen} onClose={() => setResolveOpen(false)} title={resolveStatus === "Resolved" ? "Resolve Case" : "Reject Case"} width={420}>
        <form onSubmit={submitResolve} style={{ padding: "0 0 4px" }}>
          <FormField
            as="select"
            label="Resolution Status"
            value={resolveStatus}
            onChange={(e) => setResolveStatus((e.target as HTMLSelectElement).value as "Resolved" | "Rejected")}
          >
            <option value="Resolved">Resolved</option>
            <option value="Rejected">Rejected</option>
          </FormField>
          <FormField
            as="textarea"
            label="Resolution Notes"
            placeholder="Describe the outcome…"
            rows={3}
            value={resolution}
            onChange={(e) => setResolution((e.target as HTMLTextAreaElement).value)}
          />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
            <button type="button" className="btn bs" onClick={() => setResolveOpen(false)}>Cancel</button>
            <button
              type="submit"
              className={resolveStatus === "Resolved" ? "btn bok" : "btn bx"}
              disabled={resolveBusy || !resolution}
            >
              {resolveBusy ? "Saving…" : resolveStatus === "Resolved" ? "Resolve" : "Reject"}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

/* ── Main Screen ── */

export default function CaseManagement() {
  const { user } = useAuth();
  // I1: enforce case:read permission on list/detail views (as stated in JSDoc RBAC contract)
  const canRead   = !!user?.permissions?.includes("case:read");
  const canCreate = !!user?.permissions?.includes("case:create");
  const canManage = !!user?.permissions?.includes("case:manage");

  const [cases,     setCases]     = useState<CaseRow[]>([]);
  const [metrics,   setMetrics]   = useState<CaseMetrics | null>(null);
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [tab,       setTab]       = useState("all");
  const [selected,  setSelected]  = useState<CaseRow | null>(null);
  const [newOpen,   setNewOpen]   = useState(false);

  async function refresh() {
    setLoading(true); setError(null);
    try {
      const [casesRes, metricsRes, tplRes] = await Promise.all([
        listCases(), getCaseMetrics(), listTemplates(),
      ]);
      setCases(casesRes.cases);
      setMetrics(metricsRes);
      setTemplates(tplRes.templates);
    } catch (e) {
      setError((e as Error).message ?? "Failed to load cases");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  const filtered = cases.filter((c) =>
    tab === "all" ? true : c.case_type === tab
  );

  /* KPIs from metrics */
  const totalCases  = metrics?.total ?? 0;
  const openCases   = metrics?.open ?? 0;
  const resolvedCases = metrics?.resolved ?? 0;
  const overdueCases  = cases.filter((c) => {
    if (!c.due_at) return false;
    return new Date(c.due_at).getTime() < Date.now() && (c.status === "Open" || c.status === "InReview");
  }).length;

  /* Donut chart data from by_type */
  const donutData = metrics?.by_type
    ? Object.entries(metrics.by_type).map(([name, value], i) => ({
        name,
        value,
        color: ["var(--gold2)", "var(--B)", "var(--R)", "var(--P)"][i % 4],
      }))
    : [];

  /* Avg resolution */
  const avgDays = metrics
    ? (metrics.avg_resolution_minutes / 1440).toFixed(1)
    : "—";

  /* Table columns */
  const columns: Column<CaseRow>[] = [
    {
      key: "case_ref", header: "Case Ref",
      render: (c) => (
        <span
          className="mono"
          style={{ fontSize: 10, color: "var(--gold3)", cursor: "pointer" }}
          onClick={() => setSelected(c)}
        >
          {c.case_ref}
        </span>
      ),
      sortable: true,
    },
    {
      key: "case_type", header: "Type",
      render: (c) => <Tag variant={caseTypeVariant(c.case_type)}>{c.case_type}</Tag>,
    },
    {
      key: "title", header: "Title / Subject",
      render: (c) => (
        <span style={{ fontSize: 12, color: "var(--mist)" }}>{c.title}</span>
      ),
      sortable: true,
    },
    {
      key: "status", header: "Status",
      render: (c) => (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <StatusDot
            color={c.status === "Resolved" ? "green" : c.status === "Rejected" ? "red" : c.status === "InReview" ? "blue" : "amber"}
          />
          <Tag variant={statusVariant(c.status)} style={{ fontSize: 10 }}>{c.status}</Tag>
        </div>
      ),
    },
    {
      key: "assigned_to", header: "Assigned",
      render: (c) => <span style={{ fontSize: 11, color: "var(--sil)" }}>{c.assigned_to ?? "—"}</span>,
    },
    {
      key: "due_at", header: "Due",
      render: (c) => {
        const { text, color } = slaText(c.due_at);
        return <span style={{ fontSize: 11, color }}>{text}</span>;
      },
    },
    {
      key: "id", header: "",
      render: (c) => (
        <button className="btn bg xs" onClick={(e) => { e.stopPropagation(); setSelected(c); }}>
          Open
        </button>
      ),
    },
  ];

  // I1: enforce case:read permission — show access-denied if missing
  if (!canRead) {
    return (
      <div className="fade-up" style={{ padding: 40, textAlign: "center" }}>
        <div style={{ fontSize: 32, opacity: 0.3, marginBottom: 12 }}>🔒</div>
        <div style={{ fontSize: 14, fontWeight: 700, color: "var(--mist)", marginBottom: 6 }}>
          Access Denied
        </div>
        <div style={{ fontSize: 12, color: "var(--sil)" }}>
          You do not have permission to view cases. The <code>case:read</code> permission is required.
        </div>
      </div>
    );
  }

  return (
    <div className="fade-up">
      {/* Page header */}
      <div className="page-header">
        <div>
          <h2 className="serif">Case Management</h2>
          <p>End-to-end document cases · KYC · Loan Origination · Account Opening · Compliance</p>
        </div>
        <div className="phr">
          {canCreate && (
            <button className="btn bg sm" onClick={() => setNewOpen(true)}>
              + New Case
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
          label="Active Cases"
          value={openCases.toLocaleString()}
          sub={`${totalCases} total`}
          variant="blue"
        />
        {/* I2 fix: renamed to "Total Closed" (all-time count) and corrected sub-text (Resolved only) */}
        <KpiCard
          label="Total Closed"
          value={resolvedCases.toLocaleString()}
          sub="Resolved only"
          variant="green"
        />
        <KpiCard
          label="Overdue Cases"
          value={overdueCases.toLocaleString()}
          sub="SLA breach"
          variant="red"
        />
        <KpiCard
          label="Avg Resolution"
          value={`${avgDays}d`}
          sub="From open to close"
          variant="amber"
        />
      </div>

      {/* Error banner */}
      {error && (
        <div style={{
          background: "rgba(224,82,82,.1)", border: "1px solid rgba(224,82,82,.3)",
          borderRadius: 8, padding: "10px 14px", marginBottom: 14,
          color: "var(--R)", fontSize: 12,
        }}>
          {error}
        </div>
      )}

      {/* Main layout: case list + detail */}
      <div className="g2" style={{ marginBottom: 14 }}>
        {/* Case list */}
        <div>
          <Tabs items={TYPE_TABS} active={tab} onChange={(k) => { setTab(k); setSelected(null); }} />
          {loading ? (
            <Card>
              <div style={{ padding: 32, textAlign: "center" }}>
                <StatusDot color="amber" pulse />
                <span style={{ fontSize: 12, color: "var(--sil)", marginLeft: 8 }}>Loading cases…</span>
              </div>
            </Card>
          ) : (
            <Card>
              <DataTable<CaseRow>
                columns={columns}
                rows={filtered as CaseRow[]}
                rowKey={(c) => c.id}
                onRowClick={(c) => setSelected(c)}
                emptyMessage="No cases match this filter"
              />
            </Card>
          )}
        </div>

        {/* Detail panel */}
        {selected ? (
          <CaseDetailPanel
            key={selected.id}
            caseId={selected.id}
            onUpdated={refresh}
            canManage={canManage}
          />
        ) : (
          <Card>
            <div style={{
              height: 220, display: "flex", flexDirection: "column",
              alignItems: "center", justifyContent: "center", gap: 10,
            }}>
              <div style={{ fontSize: 36, opacity: 0.2 }}>📋</div>
              <div style={{ fontSize: 12, color: "var(--sil)" }}>
                Select a case to view documents, workflow stage, and take action.
              </div>
              {canCreate && (
                <button className="btn bg sm" onClick={() => setNewOpen(true)}>
                  + New Case
                </button>
              )}
            </div>
          </Card>
        )}
      </div>

      {/* Bottom row: type donut + type breakdown table */}
      <div className="g2">
        {donutData.length > 0 && (
          <DonutChartCard
            title="Cases by Type"
            data={donutData}
            height={220}
          />
        )}
        <Card title="Case Type Breakdown">
          {metrics?.by_type ? (
            <table style={{ width: "100%", fontSize: 11 }}>
              <thead>
                <tr>
                  {["Type", "Count", "% Share"].map((h) => (
                    <th key={h} style={{ textAlign: "left", padding: "6px 8px", fontSize: 9.5, textTransform: "uppercase", letterSpacing: "1px", color: "var(--sil)", borderBottom: "1px solid var(--bd)" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Object.entries(metrics.by_type)
                  .sort((a, b) => b[1] - a[1])
                  .map(([type, count]) => {
                    const pct = totalCases > 0 ? ((count / totalCases) * 100).toFixed(1) : "0";
                    return (
                      <tr key={type} style={{ borderBottom: "1px solid var(--bd)" }}>
                        <td style={{ padding: "8px 8px" }}>
                          <Tag variant={caseTypeVariant(type)}>{type}</Tag>
                        </td>
                        <td style={{ padding: "8px 8px", fontWeight: 700, color: "var(--mist)" }}>
                          {count.toLocaleString()}
                        </td>
                        <td style={{ padding: "8px 8px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ flex: 1, height: 4, background: "var(--bd)", borderRadius: 2, overflow: "hidden" }}>
                              <div style={{
                                width: `${pct}%`, height: "100%",
                                background: "var(--gold2)", borderRadius: 2,
                              }} />
                            </div>
                            <span style={{ fontSize: 10, color: "var(--sil)", minWidth: 36 }}>{pct}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          ) : (
            <div style={{ fontSize: 12, color: "var(--sil)", padding: 16 }}>No data</div>
          )}
        </Card>
      </div>

      {/* New Case modal */}
      {canCreate && (
        <NewCaseModal
          open={newOpen}
          onClose={() => setNewOpen(false)}
          templates={templates}
          onCreated={refresh}
        />
      )}
    </div>
  );
}
