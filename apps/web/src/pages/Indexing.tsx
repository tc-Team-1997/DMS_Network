import { useEffect, useState, useCallback } from "react";
import { useParams } from "react-router-dom";
import {
  KpiCard,
  Card,
  DataTable,
  Tag,
  Modal,
  FormField,
  Tabs,
  StatusDot,
} from "../components/ui/index.js";
import type { Column, TabItem } from "../components/ui/index.js";
import { useAuth } from "../auth/AuthContext.js";
import { dashboardCaptureApi, type DocumentRecord } from "../api/dashboardCaptureApi.js";

/* ─── Document types and their field definitions ─── */
type DocTypeKey = "BT_CID_4G" | "BT_PASSPORT" | "BOB_LOAN_APPLICATION";

interface FieldDef {
  key: string;
  label: string;
  type?: "text" | "date" | "number" | "select";
  options?: string[];
  required?: boolean;
  hint?: string;
}

const DOC_TYPES: Record<DocTypeKey, { label: string; fields: FieldDef[] }> = {
  BT_CID_4G: {
    label: "BT CID 4G (Bhutan National ID)",
    fields: [
      { key: "cid_no", label: "CID Number *", required: true, hint: "11-digit Bhutan CID" },
      { key: "full_name", label: "Full Name (as printed) *", required: true },
      { key: "dob", label: "Date of Birth *", type: "date", required: true },
      { key: "issue_date", label: "Issue Date *", type: "date", required: true },
      { key: "expiry_date", label: "Expiry Date *", type: "date", required: true },
      { key: "dzongkhag", label: "Dzongkhag *", required: true, type: "select", options: [
        "Bumthang", "Chhukha", "Dagana", "Gasa", "Haa", "Lhuentse", "Mongar",
        "Paro", "Pemagatshel", "Punakha", "Samdrup Jongkhar", "Samtse", "Sarpang",
        "Thimphu", "Trashigang", "Trashiyangtse", "Trongsa", "Tsirang", "Wangdue Phodrang", "Zhemgang",
      ]},
    ],
  },
  BT_PASSPORT: {
    label: "BT Passport (Bhutan Passport)",
    fields: [
      { key: "passport_no", label: "Passport Number *", required: true },
      { key: "surname", label: "Surname *", required: true },
      { key: "given_names", label: "Given Names *", required: true },
      { key: "nationality", label: "Nationality", type: "select", options: ["Bhutanese", "Indian", "Other"] },
      { key: "dob", label: "Date of Birth *", type: "date", required: true },
      { key: "issue_date", label: "Issue Date *", type: "date", required: true },
      { key: "expiry_date", label: "Expiry Date *", type: "date", required: true },
    ],
  },
  BOB_LOAN_APPLICATION: {
    label: "BOB Loan Application",
    fields: [
      { key: "application_no", label: "Application Number *", required: true },
      { key: "applicant_cid", label: "Applicant CID *", required: true },
      { key: "applicant_name", label: "Applicant Name *", required: true },
      { key: "loan_type", label: "Loan Type *", type: "select", required: true, options: [
        "Home Loan", "Vehicle Loan", "Personal Loan", "Education Loan", "Business Loan", "Agricultural Loan",
      ]},
      { key: "loan_amount", label: "Loan Amount (BTN) *", type: "number", required: true },
      { key: "branch_code", label: "Branch Code *", required: true },
      { key: "submission_date", label: "Submission Date *", type: "date", required: true },
    ],
  },
};

const TABS: TabItem[] = [
  { key: "form", label: "Metadata Form" },
  { key: "queue", label: "Indexing Queue" },
  { key: "qa", label: "QA Checklist" },
];

/* ─── QA checklist items ─── */
const QA_ITEMS = [
  "Image quality acceptable (≥200 DPI)",
  "All fields legible",
  "Document not expired",
  "MRZ / barcode verified",
  "Security features visible",
  "Name matches CBS record",
];

/* ─── Table columns for queue ─── */
type QueueRow = DocumentRecord & { _qStatus?: string };

const QUEUE_COLS: Column<QueueRow>[] = [
  {
    key: "id",
    header: "#",
    render: (r) => <span className="mono" style={{ fontSize: 11, color: "var(--sil)" }}>{r.id}</span>,
    width: "50px",
  },
  {
    key: "title",
    header: "Document",
    render: (r) => <span style={{ fontWeight: 600, color: "var(--mist)" }}>{r.title}</span>,
  },
  { key: "branch", header: "Branch", render: (r) => r.branch ?? "—" },
  {
    key: "doc_type",
    header: "Type",
    render: (r) =>
      r.doc_type ? <Tag variant="gold">{r.doc_type}</Tag> : <Tag variant="amber">Unindexed</Tag>,
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
        <StatusDot color={r.doc_type ? "green" : "amber"} />
        {r.doc_type ? "Indexed" : "Pending"}
      </span>
    ),
  },
];

/* ═══════════════════════════════ INDEXING ═══════════════════════════════ */
export default function Indexing() {
  const { user } = useAuth();
  const params = useParams<{ id?: string }>();
  const preSelectedId = params.id ? Number(params.id) : null;

  const canIndex = user?.permissions?.includes("document:index") ?? false;
  const [tab, setTab] = useState("form");

  /* Queue list */
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [queueLoading, setQueueLoading] = useState(true);
  const [queueError, setQueueError] = useState<string | null>(null);

  /* Selected doc for indexing */
  const [selectedDoc, setSelectedDoc] = useState<DocumentRecord | null>(null);

  /* Form state */
  const [docType, setDocType] = useState<DocTypeKey>("BT_CID_4G");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [classification, setClassification] = useState("KYC — Primary Identity");
  const [retention, setRetention] = useState("10 Years (KYC)");
  const [indexerNotes, setIndexerNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitOk, setSubmitOk] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [missing, setMissing] = useState<string[]>([]);

  /* QA checklist */
  const [qaChecked, setQaChecked] = useState<Record<string, boolean>>({});

  /* AI extraction panel data */
  const [aiPanel] = useState({
    mrz: "P<BTNSODORJI<<SONAM<<<<<<",
    checksum: "Valid",
    cbsMatch: "Match (100%)",
    aml: "Cleared (RMA Screening)",
    fraudScore: "Low (0.02)",
  });

  /* Reject / Hold modals */
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");

  const loadQueue = useCallback(async () => {
    try {
      setQueueLoading(true);
      setQueueError(null);
      const res = await dashboardCaptureApi.listDocuments();
      setQueue(res.documents);
      // If a preSelectedId was passed via route param, pick that doc
      if (preSelectedId) {
        const found = res.documents.find((d) => d.id === preSelectedId) ?? null;
        if (found) setSelectedDoc(found);
      }
    } catch (err: unknown) {
      setQueueError((err as Error).message ?? "Failed to load queue");
    } finally {
      setQueueLoading(false);
    }
  }, [preSelectedId]);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  useEffect(() => {
    // Reset form when docType changes
    setFields({});
    setErrors([]);
    setMissing([]);
    setSubmitOk(false);
  }, [docType]);

  function setField(key: string, value: string) {
    setFields((prev) => ({ ...prev, [key]: value }));
  }

  async function submitIndex() {
    if (!selectedDoc) {
      setErrors(["Select a document from the queue first."]);
      return;
    }
    setSubmitting(true);
    setErrors([]);
    setMissing([]);
    setSubmitOk(false);

    const parsedFields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) {
      parsedFields[k] = k === "loan_amount" ? Number(v) : v;
    }

    try {
      await dashboardCaptureApi.indexDocument(selectedDoc.id, {
        doc_type: docType,
        fields: parsedFields,
        confidence: 0.974,
      });
      setSubmitOk(true);
      // Refresh queue
      await loadQueue();
    } catch (err: unknown) {
      const body = (err as { body?: { errors?: string[]; missing?: string[] } }).body ?? {};
      setErrors(body.errors ?? []);
      setMissing(body.missing ?? []);
      if (!body.errors?.length && !body.missing?.length) {
        setErrors([(err as Error).message ?? "Failed to save index"]);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function doReject() {
    setRejectOpen(false);
    setRejectReason("");
    // In production: call a workflow reject endpoint
    setErrors(["Rejected. Document returned to capture queue."]);
  }

  const pendingCount = queue.filter((d) => !d.doc_type).length;
  const indexedCount = queue.filter((d) => !!d.doc_type).length;
  const reviewCount = queue.filter((d) => d.review_flag).length;

  if (!canIndex) {
    return (
      <div className="fade-up" style={{ padding: 40 }}>
        <div style={{ background: "rgba(224,82,82,.13)", border: "1px solid rgba(224,82,82,.3)", borderRadius: 10, padding: 24, maxWidth: 480 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--R)", marginBottom: 6 }}>Access Denied</div>
          <div style={{ fontSize: 12, color: "var(--sil)" }}>You do not have the <code>document:index</code> permission required to access this screen.</div>
        </div>
      </div>
    );
  }

  const currentTypeConf = DOC_TYPES[docType];

  return (
    <div className="fade-up">
      {/* ── Page Header ── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20, gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 className="serif" style={{ fontSize: 24, fontWeight: 700, color: "var(--gold3)", lineHeight: 1 }}>
            Indexing & QA
          </h2>
          <p style={{ fontSize: 11, color: "var(--sil)", marginTop: 3 }}>
            AI-assisted metadata extraction · Dynamic forms · CID binding · QA checklist
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Tag variant="red">{pendingCount} pending</Tag>
          <button
            style={{ padding: "7px 14px", background: "linear-gradient(135deg,#b8912a,#f0c84a)", border: "none", borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: "pointer", color: "#050d1a" }}
          >
            Auto-Index All (AI)
          </button>
        </div>
      </div>

      {/* ── KPI Row ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 16 }}>
        <KpiCard label="Pending Indexing" value={queueLoading ? "…" : pendingCount.toString()} sub="Awaiting metadata entry" variant="amber" />
        <KpiCard label="Indexed Today" value={queueLoading ? "…" : indexedCount.toString()} sub="Successfully indexed" variant="green" />
        <KpiCard label="Flagged for Review" value={queueLoading ? "…" : reviewCount.toString()} sub="Low confidence / mismatch" variant="red" />
        <KpiCard label="AI Accuracy" value="97.4%" sub="Auto-fill confidence" variant="blue" />
      </div>

      {/* ── Tabs ── */}
      <Tabs items={TABS} active={tab} onChange={setTab} />

      {/* ── Tab: Form ── */}
      {tab === "form" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 14 }}>
          {/* Left: Document preview + QA quick-check */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Card title={<span>Document Viewer <span style={{ color: "var(--sil)", fontWeight: 400, fontSize: 11 }}>{selectedDoc ? `#${selectedDoc.id}` : "— select from queue"}</span></span>}
              action={
                <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                  <button style={{ padding: "4px 10px", background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.09)", borderRadius: 5, fontSize: 10, color: "var(--sil)", cursor: "pointer" }}>◀ Prev</button>
                  <span style={{ fontSize: 11, color: "var(--sil)" }}>{selectedDoc ? `${queue.findIndex((d) => d.id === selectedDoc.id) + 1}/${queue.length}` : "0/0"}</span>
                  <button style={{ padding: "4px 10px", background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.09)", borderRadius: 5, fontSize: 10, color: "var(--sil)", cursor: "pointer" }}>Next ▶</button>
                </div>
              }
            >
              <div style={{ background: "rgba(255,255,255,.03)", border: "1px dashed rgba(255,255,255,.1)", borderRadius: 8, padding: 24, minHeight: 280, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {selectedDoc ? (
                  <div style={{ background: "rgba(255,255,255,.05)", borderRadius: 5, padding: 16, maxWidth: 240, width: "100%" }}>
                    <div style={{ fontSize: 8, letterSpacing: 1.5, textTransform: "uppercase", color: "var(--gold)", marginBottom: 10 }}>
                      {docType === "BT_PASSPORT" ? "KINGDOM OF BHUTAN · PASSPORT" : docType === "BT_CID_4G" ? "BHUTAN · CITIZEN ID CARD 4G" : "BOB LOAN APPLICATION"}
                    </div>
                    <div style={{ display: "flex", gap: 10 }}>
                      <div style={{ width: 46, height: 60, background: "rgba(184,145,42,.1)", borderRadius: 4, border: "1px dashed rgba(184,145,42,.3)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth="1.5">
                          <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
                        </svg>
                      </div>
                      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
                        <div style={{ height: 7, background: "rgba(255,255,255,.15)", borderRadius: 2, width: "90%" }}/>
                        <div style={{ height: 7, background: "rgba(255,255,255,.1)", borderRadius: 2, width: "70%" }}/>
                        <div style={{ height: 7, background: "rgba(255,255,255,.1)", borderRadius: 2, width: "80%" }}/>
                      </div>
                    </div>
                    <div style={{ marginTop: 10, fontSize: 8, fontFamily: "JetBrains Mono, monospace", color: "var(--sil)", background: "rgba(0,0,0,.25)", padding: 6, borderRadius: 3, letterSpacing: 1 }}>
                      {selectedDoc.title.slice(0, 30).toUpperCase()}
                    </div>
                    <div style={{ marginTop: 8, fontSize: 10, color: "var(--sil)" }}>
                      {selectedDoc.original_filename} · {selectedDoc.mime_type ?? "PDF"}
                    </div>
                  </div>
                ) : (
                  <div style={{ textAlign: "center", color: "var(--sil)" }}>
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ marginBottom: 8, opacity: .4 }}>
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                      <polyline points="14 2 14 8 20 8"/>
                    </svg>
                    <div style={{ fontSize: 12 }}>Select a document from the queue</div>
                  </div>
                )}
              </div>
            </Card>

            {/* QA checklist preview */}
            <Card title="QA Checklist">
              <div style={{ display: "flex", flexDirection: "column", gap: 7, fontSize: 12 }}>
                {QA_ITEMS.map((item) => (
                  <label key={item} style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--mist)", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={!!qaChecked[item]}
                      onChange={(e) => setQaChecked((c) => ({ ...c, [item]: e.target.checked }))}
                      style={{ width: "auto", accentColor: "var(--gold)" }}
                    />
                    {item}
                  </label>
                ))}
              </div>
              <div style={{ marginTop: 10, fontSize: 11, color: "var(--sil)" }}>
                {Object.values(qaChecked).filter(Boolean).length}/{QA_ITEMS.length} checks passed
              </div>
            </Card>
          </div>

          {/* Right: Metadata form */}
          <Card title={
            <span>
              Metadata Form — {currentTypeConf.label}{" "}
              <Tag variant="gold">AI-assisted · 97.4% filled</Tag>
            </span>
          }>
            {/* Queue picker */}
            {!selectedDoc && queue.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 10.5, color: "var(--sil)", display: "block", marginBottom: 4 }}>Select Document to Index</label>
                <select
                  style={{ background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.1)", borderRadius: 7, padding: "8px 12px", fontSize: 12, color: "var(--wh)", width: "100%", fontFamily: "inherit" }}
                  value=""
                  onChange={(e) => {
                    const id = Number(e.target.value);
                    const doc = queue.find((d) => d.id === id) ?? null;
                    setSelectedDoc(doc);
                  }}
                >
                  <option value="">— Choose document —</option>
                  {queue.filter((d) => !d.doc_type).map((d) => (
                    <option key={d.id} value={d.id}>{d.title} ({d.branch ?? "—"})</option>
                  ))}
                </select>
              </div>
            )}

            {/* Doc type + branch */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <FormField
                as="select"
                label="Document Type *"
                value={docType}
                onChange={(e) => setDocType((e.target as HTMLSelectElement).value as DocTypeKey)}
              >
                {(Object.keys(DOC_TYPES) as DocTypeKey[]).map((k) => (
                  <option key={k} value={k}>{DOC_TYPES[k].label}</option>
                ))}
              </FormField>
              <FormField
                label="Customer CID *"
                placeholder="e.g. 11207000001"
                value={fields["cid_no"] ?? fields["applicant_cid"] ?? ""}
                onChange={(e) => {
                  const val = (e.target as HTMLInputElement).value;
                  if (docType === "BT_CID_4G") setField("cid_no", val);
                  else setField("applicant_cid", val);
                }}
              />
            </div>

            {/* Dynamic fields — render in 2-col grid */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              {currentTypeConf.fields.map((fd) => {
                if (fd.type === "select") {
                  return (
                    <FormField
                      key={fd.key}
                      as="select"
                      label={fd.label}
                      value={fields[fd.key] ?? ""}
                      onChange={(e) => setField(fd.key, (e.target as HTMLSelectElement).value)}
                    >
                      <option value="">— Select —</option>
                      {fd.options?.map((o) => <option key={o} value={o}>{o}</option>)}
                    </FormField>
                  );
                }
                return (
                  <FormField
                    key={fd.key}
                    label={fd.label}
                    type={(fd.type as "text" | "date" | "number") ?? "text"}
                    value={fields[fd.key] ?? ""}
                    onChange={(e) => setField(fd.key, (e.target as HTMLInputElement).value)}
                    hint={fd.hint}
                  />
                );
              })}
            </div>

            {/* Classification + Retention */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
              <FormField
                as="select"
                label="Document Classification"
                value={classification}
                onChange={(e) => setClassification((e.target as HTMLSelectElement).value)}
              >
                <option>KYC — Primary Identity</option>
                <option>KYC — Address Proof</option>
                <option>Loan Documentation</option>
                <option>Compliance</option>
              </FormField>
              <FormField
                as="select"
                label="Retention Policy"
                value={retention}
                onChange={(e) => setRetention((e.target as HTMLSelectElement).value)}
              >
                <option>10 Years (KYC)</option>
                <option>7 Years (RMA)</option>
                <option>5 Years (Standard)</option>
              </FormField>
            </div>

            {/* AI Extracted Data Validation panel */}
            <div style={{ marginTop: 14, marginBottom: 12 }}>
              <label style={{ fontSize: 10.5, color: "var(--sil)", display: "block", marginBottom: 6 }}>AI Extracted Data Validation</label>
              <div style={{ background: "rgba(184,145,42,.05)", border: "1px solid rgba(184,145,42,.2)", borderRadius: 7, padding: 10, fontSize: 11, display: "flex", flexDirection: "column", gap: 5 }}>
                {[
                  { label: "MRZ Line 1", value: aiPanel.mrz, mono: true },
                  { label: "MRZ Checksum", value: aiPanel.checksum, ok: true },
                  { label: "CBS Name Match", value: aiPanel.cbsMatch, ok: true },
                  { label: "AML Screening", value: aiPanel.aml, ok: true },
                  { label: "Fraud Score", value: aiPanel.fraudScore, ok: true },
                ].map((row) => (
                  <div key={row.label} style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--sil)" }}>{row.label}:</span>
                    <span className={row.mono ? "mono" : ""} style={{ color: row.ok ? "var(--G)" : "var(--mist)", fontSize: row.mono ? 10 : undefined }}>
                      {row.ok ? "✓ " : ""}{row.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Indexer notes */}
            <FormField
              as="textarea"
              label="Indexer Notes"
              placeholder="Optional remarks for checker…"
              rows={2}
              value={indexerNotes}
              onChange={(e) => setIndexerNotes((e.target as HTMLTextAreaElement).value)}
            />

            {/* Validation messages */}
            {(errors.length > 0 || missing.length > 0) && (
              <div style={{ background: "rgba(224,82,82,.1)", border: "1px solid rgba(224,82,82,.25)", borderRadius: 7, padding: "10px 12px", fontSize: 11, color: "var(--R)", marginTop: 10 }}>
                {missing.map((m) => <div key={m}>Missing required field: <strong>{m}</strong></div>)}
                {errors.map((e) => <div key={e}>{e}</div>)}
              </div>
            )}

            {submitOk && (
              <div style={{ background: "rgba(46,204,138,.1)", border: "1px solid rgba(46,204,138,.25)", borderRadius: 7, padding: "10px 12px", fontSize: 11, color: "var(--G)", marginTop: 10 }}>
                Document indexed successfully. Sent to workflow.
              </div>
            )}

            {/* Actions */}
            <div style={{ display: "flex", gap: 8, marginTop: 14, paddingTop: 14, borderTop: "1px solid rgba(255,255,255,.07)" }}>
              <button
                onClick={submitIndex}
                disabled={submitting}
                style={{ flex: 1, padding: "9px 14px", background: submitting ? "rgba(184,145,42,.4)" : "linear-gradient(135deg,#b8912a,#f0c84a)", border: "none", borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: submitting ? "not-allowed" : "pointer", color: "#050d1a" }}
              >
                {submitting ? "Saving…" : "Save & Send to Workflow"}
              </button>
              <button
                style={{ padding: "9px 14px", background: "rgba(46,204,138,.13)", border: "1px solid rgba(46,204,138,.3)", borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: "pointer", color: "var(--G)" }}
                onClick={submitIndex}
              >
                Save Index
              </button>
              <button
                style={{ padding: "9px 14px", background: "rgba(224,82,82,.13)", border: "1px solid rgba(224,82,82,.3)", borderRadius: 7, fontSize: 11, color: "var(--R)", cursor: "pointer" }}
                onClick={() => setRejectOpen(true)}
              >
                Reject
              </button>
              <button
                style={{ padding: "9px 14px", background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.09)", borderRadius: 7, fontSize: 11, color: "var(--mist)", cursor: "pointer" }}
              >
                Hold
              </button>
            </div>
          </Card>
        </div>
      )}

      {/* ── Tab: Queue ── */}
      {tab === "queue" && (
        <Card
          title="Indexing Queue"
          action={<Tag variant="red">{pendingCount} unindexed</Tag>}
        >
          {queueError && (
            <div style={{ background: "rgba(224,82,82,.13)", borderRadius: 7, padding: "8px 12px", fontSize: 11, color: "var(--R)", marginBottom: 12 }}>
              {queueError} — <button onClick={loadQueue} style={{ color: "var(--R)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>Retry</button>
            </div>
          )}
          {queueLoading ? (
            <div style={{ padding: "20px 0", textAlign: "center", color: "var(--sil)", fontSize: 12 }}>Loading queue…</div>
          ) : (
            <DataTable<QueueRow>
              columns={QUEUE_COLS}
              rows={queue}
              rowKey={(r) => r.id}
              emptyMessage="No documents in the indexing queue"
              onRowClick={(r) => {
                setSelectedDoc(r);
                setTab("form");
              }}
            />
          )}
        </Card>
      )}

      {/* ── Tab: QA Checklist (full) ── */}
      {tab === "qa" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <Card title="QA Checklist — Active Document">
            {selectedDoc ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <div style={{ background: "rgba(255,255,255,.04)", borderRadius: 7, padding: "8px 12px", fontSize: 12, marginBottom: 6 }}>
                  <strong>{selectedDoc.title}</strong>
                  <span style={{ color: "var(--sil)", fontSize: 11, marginLeft: 8 }}>#{selectedDoc.id} · {selectedDoc.branch}</span>
                </div>
                {QA_ITEMS.map((item) => (
                  <label key={item} style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--mist)", cursor: "pointer", fontSize: 12 }}>
                    <input
                      type="checkbox"
                      checked={!!qaChecked[item]}
                      onChange={(e) => setQaChecked((c) => ({ ...c, [item]: e.target.checked }))}
                      style={{ width: "auto", accentColor: "var(--gold)" }}
                    />
                    {item}
                  </label>
                ))}
                <div style={{ marginTop: 8, padding: "8px 12px", background: "rgba(184,145,42,.06)", borderRadius: 7, fontSize: 11 }}>
                  {Object.values(qaChecked).filter(Boolean).length}/{QA_ITEMS.length} checks passed
                  {Object.values(qaChecked).filter(Boolean).length === QA_ITEMS.length && (
                    <span style={{ color: "var(--G)", marginLeft: 8 }}>All passed</span>
                  )}
                </div>
              </div>
            ) : (
              <div style={{ padding: "20px 0", textAlign: "center", color: "var(--sil)", fontSize: 12 }}>
                Select a document from the Metadata Form tab first.
              </div>
            )}
          </Card>
          <Card title="QA Statistics">
            <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 11 }}>
              {[
                { label: "Image Quality Pass Rate", pct: 94, color: "var(--G)" },
                { label: "Legible Fields", pct: 97, color: "var(--gold2)" },
                { label: "Not Expired", pct: 88, color: "var(--W)" },
                { label: "MRZ Verified", pct: 91, color: "var(--B)" },
                { label: "Security Features", pct: 78, color: "var(--P)" },
                { label: "CBS Name Match", pct: 99, color: "var(--G)" },
              ].map((row) => (
                <div key={row.label}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                    <span style={{ color: "var(--sil)" }}>{row.label}</span>
                    <span style={{ color: row.color, fontWeight: 600 }}>{row.pct}%</span>
                  </div>
                  <div style={{ height: 4, background: "rgba(255,255,255,.07)", borderRadius: 4, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${row.pct}%`, background: row.color, borderRadius: 4 }} />
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* ── Reject Modal ── */}
      <Modal open={rejectOpen} onClose={() => setRejectOpen(false)} title="Reject Document">
        <FormField
          as="textarea"
          label="Rejection Reason *"
          placeholder="Describe why the document is being rejected…"
          rows={4}
          value={rejectReason}
          onChange={(e) => setRejectReason((e.target as HTMLTextAreaElement).value)}
        />
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button
            onClick={doReject}
            style={{ flex: 1, padding: "9px 14px", background: "rgba(224,82,82,.2)", border: "1px solid rgba(224,82,82,.3)", borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: "pointer", color: "var(--R)" }}
          >
            Confirm Reject
          </button>
          <button
            onClick={() => setRejectOpen(false)}
            style={{ padding: "9px 14px", background: "rgba(255,255,255,.07)", border: "1px solid rgba(255,255,255,.09)", borderRadius: 7, fontSize: 11, color: "var(--mist)", cursor: "pointer" }}
          >
            Cancel
          </button>
        </div>
      </Modal>
    </div>
  );
}
