import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import {
  KpiCard,
  Card,
  DataTable,
  Tag,
  Modal,
  FormField,
  Tabs,
  StatusDot,
  RefId,
} from "../components/ui/index.js";
import type { Column, TabItem } from "../components/ui/index.js";
import { useAuth } from "../auth/AuthContext.js";
import { dashboardCaptureApi, type DocumentRecord } from "../api/dashboardCaptureApi.js";
import { docTypesApi, type DocType } from "../api/docTypesApi.js";
import { repositoryViewerApi } from "../api/repositoryViewerApi.js";

/* ─── Document types and their field definitions ─── */
type DocTypeKey = "BT_CID_4G" | "BT_PASSPORT" | "BOB_LOAN_APPLICATION";

interface FieldDef {
  key: string;
  label: string;
  type?: "text" | "date" | "number" | "select";
  options?: string[];
  optionLabels?: Record<string, string>;
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
        "HOME", "AUTO", "AGRI", "BUSINESS", "PERSONAL",
      ], optionLabels: {
        HOME: "Home Loan", AUTO: "Vehicle Loan", AGRI: "Agricultural Loan",
        BUSINESS: "Business Loan", PERSONAL: "Personal Loan",
      }},
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
    render: (r) => <RefId value={r.id} className="mono" style={{ fontSize: 11, color: "var(--sil)" }} />,
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
  const [searchParams] = useSearchParams();
  // Support both /indexing/:id (router param) and /indexing?id=X (query param)
  const preSelectedId = params.id ?? searchParams.get("id") ?? null;

  const canIndex = user?.permissions?.includes("document:index") ?? false;
  const canRead = user?.permissions?.includes("document:read") ?? false;
  const [tab, setTab] = useState("form");

  /* Queue list */
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [queueLoading, setQueueLoading] = useState(true);
  const [queueError, setQueueError] = useState<string | null>(null);

  /* Selected doc for indexing */
  const [selectedDoc, setSelectedDoc] = useState<DocumentRecord | null>(null);

  /* Registry doc types (admin-managed) + AI summary */
  const [registry, setRegistry] = useState<DocType[]>([]);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);

  /* Form state */
  const [docType, setDocType] = useState<string>("BT_CID_4G");
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
    if (!canRead) {
      setQueueError("You need document:read permission to load the indexing queue.");
      setQueueLoading(false);
      return;
    }
    try {
      setQueueLoading(true);
      setQueueError(null);
      const res = await dashboardCaptureApi.listDocuments();
      setQueue(res.documents);
      // If a preSelectedId was passed via route param or query param, pick that doc
      if (preSelectedId) {
        const found = res.documents.find((d) => d.id === preSelectedId) ?? null;
        if (found) setSelectedDoc(found);
      }
    } catch (err: unknown) {
      setQueueError((err as Error).message ?? "Failed to load queue");
    } finally {
      setQueueLoading(false);
    }
  }, [preSelectedId, canRead]);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  // Load the admin-managed doc-type registry (best-effort).
  useEffect(() => {
    if (!canRead) return;
    docTypesApi.list().then((r) => setRegistry(r?.docTypes ?? [])).catch(() => setRegistry([]));
  }, [canRead]);

  // Reset the form only on a MANUAL doc-type change (not when a doc is selected,
  // which sets the type + auto-fills below).
  const manualTypeChange = useRef(false);
  useEffect(() => {
    if (manualTypeChange.current) {
      setFields({});
      setErrors([]);
      setMissing([]);
      setSubmitOk(false);
      manualTypeChange.current = false;
    }
  }, [docType]);

  // When a queued document is selected: adopt its AI-classified type, auto-fill
  // the form from its extracted metadata, and (re)generate the AI summary.
  useEffect(() => {
    if (!selectedDoc) { setAiSummary(null); return; }
    const sd = selectedDoc as DocumentRecord & { metadata?: unknown; summary?: string };
    if (sd.doc_type) setDocType(sd.doc_type);
    let meta: Record<string, unknown> = {};
    try {
      meta = typeof sd.metadata === "string"
        ? JSON.parse(sd.metadata)
        : (sd.metadata as Record<string, unknown>) ?? {};
    } catch { meta = {}; }
    const filled: Record<string, string> = {};
    for (const [k, v] of Object.entries(meta)) {
      if (v != null && typeof v !== "object") filled[k] = String(v);
    }
    setFields(filled);
    setErrors([]); setMissing([]); setSubmitOk(false);

    // AI summary — use the stored one, else (re)generate via the summarize endpoint.
    const existing = sd.summary;
    if (existing) { setAiSummary(existing); }
    else {
      setSummaryLoading(true);
      repositoryViewerApi
        .summarize(selectedDoc.id)
        .then((s) => setAiSummary(s.summary))
        .catch(() => setAiSummary(null))
        .finally(() => setSummaryLoading(false));
    }
  }, [selectedDoc]);

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
    if (!rejectReason.trim()) return;
    if (!selectedDoc) {
      setErrors(["Select a document to reject."]);
      return;
    }
    try {
      await dashboardCaptureApi.rejectDocument(selectedDoc.id, rejectReason.trim());
      setRejectOpen(false);
      setRejectReason("");
      setErrors(["Document rejected and returned to capture queue."]);
      // Refresh queue to reflect new status
      await loadQueue();
    } catch (err: unknown) {
      setRejectOpen(false);
      setRejectReason("");
      setErrors([(err as Error).message ?? "Failed to reject document."]);
    }
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

  // Doc-type options: union of admin-managed registry types + the seeded ones.
  const docTypeOptions: { code: string; label: string }[] = (() => {
    const seen = new Set<string>();
    const out: { code: string; label: string }[] = [];
    for (const rt of registry) {
      if (seen.has(rt.code)) continue;
      seen.add(rt.code);
      out.push({ code: rt.code, label: rt.description ? `${rt.code} — ${rt.description}` : rt.code });
    }
    for (const k of Object.keys(DOC_TYPES) as DocTypeKey[]) {
      if (!seen.has(k)) { seen.add(k); out.push({ code: k, label: DOC_TYPES[k].label }); }
    }
    return out;
  })();

  // Field defs for the selected type: prefer the admin registry schema (mandatory
  // + optional), falling back to the hardcoded seed definitions.
  const registryType = registry.find((r) => r.code === docType);
  const currentTypeConf: { fields: FieldDef[] } = (() => {
    if (registryType && (registryType.mandatoryFields.length || registryType.optionalFields.length)) {
      const toDef = (f: { name: string; type?: string; mandatory?: boolean }): FieldDef => ({
        key: f.name,
        label: `${f.name.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}${f.mandatory ? " *" : ""}`,
        type: (f.type === "date" || f.type === "number" ? f.type : "text"),
        required: Boolean(f.mandatory),
      });
      return {
        fields: [
          ...registryType.mandatoryFields.map(toDef),
          ...registryType.optionalFields.map(toDef),
        ],
      };
    }
    return DOC_TYPES[docType as DocTypeKey] ?? { fields: [] };
  })();
  const docTypeLabel = docTypeOptions.find((o) => o.code === docType)?.label ?? docType;

  return (
    <div className="fade-up">
      {/* ── Page Header — title hidden (shell renders the section title); keeps actions ── */}
      <div className="page-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20, gap: 12, flexWrap: "wrap" }}>
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
            disabled
            title="AI bulk indexing is not yet available — contact your system administrator."
            style={{ padding: "7px 14px", background: "rgba(184,145,42,.3)", border: "none", borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: "not-allowed", color: "#050d1a", opacity: 0.6 }}
            aria-label="Auto-Index All (AI) — coming soon"
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
            <Card title={<span>Document Viewer <span style={{ color: "var(--sil)", fontWeight: 400, fontSize: 11 }}>{selectedDoc ? <RefId value={selectedDoc.id} /> : "— select from queue"}</span></span>}
              action={(() => {
                const currentIdx = selectedDoc ? queue.findIndex((d) => d.id === selectedDoc.id) : -1;
                const hasPrev = currentIdx > 0;
                const hasNext = currentIdx >= 0 && currentIdx < queue.length - 1;
                return (
                  <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
                    <button
                      disabled={!hasPrev}
                      onClick={() => hasPrev && setSelectedDoc(queue[currentIdx - 1])}
                      style={{ padding: "4px 10px", background: "var(--ink3)", border: "1px solid var(--bd)", borderRadius: 5, fontSize: 10, color: hasPrev ? "var(--mist)" : "var(--sil)", cursor: hasPrev ? "pointer" : "not-allowed", opacity: hasPrev ? 1 : 0.5 }}
                      aria-label="Previous document"
                    >◀ Prev</button>
                    <span style={{ fontSize: 11, color: "var(--sil)" }}>{selectedDoc ? `${currentIdx + 1}/${queue.length}` : "0/0"}</span>
                    <button
                      disabled={!hasNext}
                      onClick={() => hasNext && setSelectedDoc(queue[currentIdx + 1])}
                      style={{ padding: "4px 10px", background: "var(--ink3)", border: "1px solid var(--bd)", borderRadius: 5, fontSize: 10, color: hasNext ? "var(--mist)" : "var(--sil)", cursor: hasNext ? "pointer" : "not-allowed", opacity: hasNext ? 1 : 0.5 }}
                      aria-label="Next document"
                    >Next ▶</button>
                  </div>
                );
              })()}
            >
              <div style={{ background: "var(--ink3)", border: "1px dashed var(--bd)", borderRadius: 8, padding: 24, minHeight: 280, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {selectedDoc ? (
                  <div style={{ background: "var(--ink4)", borderRadius: 5, padding: 16, maxWidth: 240, width: "100%" }}>
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
                        <div style={{ height: 7, background: "rgba(15,23,42,.15)", borderRadius: 2, width: "90%" }}/>
                        <div style={{ height: 7, background: "rgba(15,23,42,.10)", borderRadius: 2, width: "70%" }}/>
                        <div style={{ height: 7, background: "rgba(15,23,42,.10)", borderRadius: 2, width: "80%" }}/>
                      </div>
                    </div>
                    <div style={{ marginTop: 10, fontSize: 8, fontFamily: "JetBrains Mono, monospace", color: "var(--sil)", background: "rgba(15,23,42,.06)", padding: 6, borderRadius: 3, letterSpacing: 1 }}>
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
              Metadata Form — {docTypeLabel}{" "}
              <Tag variant="gold">AI-assisted</Tag>
            </span>
          }>
            {/* Queue load error — visible on form tab so user knows why the picker is empty (I5) */}
            {queueError && (
              <div style={{ background: "rgba(224,82,82,.13)", border: "1px solid rgba(224,82,82,.3)", borderRadius: 7, padding: "8px 12px", fontSize: 11, color: "var(--R)", marginBottom: 12 }}>
                Could not load indexing queue: {queueError} —{" "}
                <button onClick={loadQueue} style={{ color: "var(--R)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>
                  Retry
                </button>
              </div>
            )}
            {/* Queue picker */}
            {!selectedDoc && queue.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 10.5, color: "var(--sil)", display: "block", marginBottom: 4 }}>Select Document to Index</label>
                <select
                  style={{ background: "var(--ink3)", border: "1px solid var(--bd)", borderRadius: 7, padding: "8px 12px", fontSize: 12, color: "var(--wh)", width: "100%", fontFamily: "inherit" }}
                  value=""
                  onChange={(e) => {
                    const id = e.target.value;
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

            {/* AI Summary — derived from the document's metadata */}
            {selectedDoc && (
              <div
                style={{
                  marginBottom: 12, padding: "10px 12px", borderRadius: 8,
                  background: "var(--PT, rgba(155,111,224,.08))", border: "1px solid rgba(155,111,224,.3)",
                }}
              >
                <div style={{ fontSize: 10, letterSpacing: 1, textTransform: "uppercase", color: "var(--Ptx, #6f42c1)", fontWeight: 700, marginBottom: 4 }}>
                  AI Summary
                </div>
                <div style={{ fontSize: 12, color: "var(--mist)", lineHeight: 1.5 }}>
                  {summaryLoading ? "Generating summary…" : (aiSummary ?? "No summary available for this document.")}
                </div>
              </div>
            )}

            {/* Doc type + branch */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <FormField
                as="select"
                label="Document Type *"
                value={docType}
                onChange={(e) => { manualTypeChange.current = true; setDocType((e.target as HTMLSelectElement).value); }}
              >
                {docTypeOptions.map((o) => (
                  <option key={o.code} value={o.code}>{o.label}</option>
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
                      {fd.options?.map((o) => (
                        <option key={o} value={o}>
                          {fd.optionLabels?.[o] ?? o}
                        </option>
                      ))}
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
            <div style={{ display: "flex", gap: 8, marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--bd)" }}>
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
                disabled
                title="Legal hold placement is not yet available — contact your compliance officer."
                style={{ padding: "9px 14px", background: "var(--ink3)", border: "1px solid var(--bd)", borderRadius: 7, fontSize: 11, color: "var(--sil)", cursor: "not-allowed", opacity: 0.6 }}
                aria-label="Hold — coming soon"
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
                <div style={{ background: "var(--ink3)", borderRadius: 7, padding: "8px 12px", fontSize: 12, marginBottom: 6 }}>
                  <strong>{selectedDoc.title}</strong>
                  <span style={{ color: "var(--sil)", fontSize: 11, marginLeft: 8 }}><RefId value={selectedDoc.id} /> · {selectedDoc.branch}</span>
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
            {queue.length === 0 ? (
              <div style={{ color: "var(--sil)", fontSize: 12, padding: "12px 0" }}>
                {queueLoading ? "Loading…" : "No queue data yet"}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 11 }}>
                {(() => {
                  const total = queue.length;
                  const highConf = queue.filter((d) => (d.confidence ?? 0) >= 0.9).length;
                  const indexed = queue.filter((d) => !!d.doc_type).length;
                  const noFlag = queue.filter((d) => !d.review_flag).length;
                  const rows = [
                    { label: "AI Confidence ≥90%", pct: Math.round((highConf / total) * 100), color: "var(--G)" },
                    { label: "Indexed", pct: Math.round((indexed / total) * 100), color: "var(--gold2)" },
                    { label: "No Review Flag", pct: Math.round((noFlag / total) * 100), color: "var(--B)" },
                  ];
                  return rows.map((row) => (
                    <div key={row.label}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                        <span style={{ color: "var(--sil)" }}>{row.label}</span>
                        <span style={{ color: row.color, fontWeight: 600 }}>{row.pct}%</span>
                      </div>
                      <div style={{ height: 4, background: "var(--bd)", borderRadius: 4, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${row.pct}%`, background: row.color, borderRadius: 4 }} />
                      </div>
                    </div>
                  ));
                })()}
              </div>
            )}
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
            disabled={!rejectReason.trim()}
            style={{ flex: 1, padding: "9px 14px", background: rejectReason.trim() ? "rgba(224,82,82,.2)" : "rgba(224,82,82,.08)", border: "1px solid rgba(224,82,82,.3)", borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: rejectReason.trim() ? "pointer" : "not-allowed", color: "var(--R)", opacity: rejectReason.trim() ? 1 : 0.5 }}
            aria-disabled={!rejectReason.trim()}
          >
            Confirm Reject
          </button>
          <button
            onClick={() => setRejectOpen(false)}
            style={{ padding: "9px 14px", background: "var(--ink3)", border: "1px solid var(--bd)", borderRadius: 7, fontSize: 11, color: "var(--mist)", cursor: "pointer" }}
          >
            Cancel
          </button>
        </div>
      </Modal>
    </div>
  );
}
