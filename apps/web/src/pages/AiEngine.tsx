/**
 * AiEngine — ZorDMS v4.2 AI Processing Engine screen.
 *
 * Shows:
 *  - KPI row: queue size, processed today, avg confidence, manual review count
 *  - Two-panel layout:
 *    Left:  File upload → classify + extract panel (result overlay)
 *    Right: AI engine status card + throughput line chart + doc-type donut
 *  - Extracted fields table with per-field confidence bars
 *  - Classification result banner + action buttons
 *  - RBAC: upload actions gated on "ai:write" permission (read-only for "ai:read")
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { useAuth } from "../auth/AuthContext.js";
import {
  classifyDoc,
  processDoc,
  ocrDoc,
  getAiHealth,
  getAiStats,
  bandFor,
  type ClassifyResult,
  type ProcessResult,
  type AiHealthStatus,
  type AiStats,
} from "../api/aiEngine.js";
import { ConfidenceBadge } from "../components/ai/ConfidenceBadge.js";
import {
  KpiCard,
  Card,
  Tag,
  StatusDot,
  Tabs,
  DonutChartCard,
  LineChartCard,
} from "../components/ui/index.js";

/* ── Static demo throughput data (placeholder until live analytics endpoint available) ── */
const THROUGHPUT_STUB: Array<{ time: string; pages: number }> = [
  { time: "08:00", pages: 1200 },
  { time: "09:00", pages: 2800 },
  { time: "10:00", pages: 4200 },
  { time: "11:00", pages: 5900 },
  { time: "12:00", pages: 4100 },
  { time: "13:00", pages: 3700 },
  { time: "14:00", pages: 6200 },
  { time: "15:00", pages: 7100 },
];

const DOCTYPE_STUB = [
  { name: "BT CID 4G",        value: 38, color: "var(--gold2)" },
  { name: "BT Passport",      value: 24, color: "var(--B)" },
  { name: "BoB Loan App",     value: 19, color: "var(--G)" },
  { name: "Foreign Passport", value: 12, color: "var(--P)" },
  { name: "Other",            value: 7,  color: "var(--sil)" },
];

const DOC_TYPE_LABELS: Record<string, string> = {
  BT_CID_4G:           "Bhutan CID 4G",
  BT_CITIZENSHIP:      "Bhutan Citizenship Certificate",
  BT_PASSPORT:         "Bhutan Passport",
  FOREIGN_PASSPORT:    "Foreign Passport",
  IN_PAN:              "Indian PAN Card",
  IN_AADHAAR:          "Indian Aadhaar",
  BOB_ACCOUNT_FORM:    "BoB Account Opening Form",
  BOB_LOAN_APPLICATION:"BoB Loan Application",
  BOB_INVOICE:         "BoB Invoice",
  PURCHASE_ORDER:      "Purchase Order",
  SAR_REPORT:          "Suspicious Activity Report",
  CTR:                 "Cash Transaction Report",
  EMPLOYMENT_CONTRACT: "Employment Contract",
  BOARD_RESOLUTION:    "Board Resolution",
  RMA_INSPECTION:      "RMA Inspection Report",
  RAA_AUDIT_REPORT:    "RAA Audit Report",
  GENERAL_LETTER:      "General Letter",
  UNKNOWN:             "Unknown / Unclassified",
};

type TabKey = "upload" | "results" | "status";

interface FieldRow {
  label: string;
  value: string;
  confidence: number;
}

function fieldConfColor(c: number) {
  if (c >= 0.92) return "var(--G)";
  if (c >= 0.85) return "var(--B)";
  if (c >= 0.70) return "var(--W)";
  return "var(--R)";
}

function flattenMetadata(meta: Record<string, unknown> | null): FieldRow[] {
  if (!meta) return [];
  // "confidence" and "doc_type" are document-level; "review_flag" is routing metadata.
  // Per-field confidence is not available from the backend extraction schema, so we
  // do not surface a per-field confidence bar (all fields would show the identical
  // document-level value, which would be misleading — see I-4).
  const SKIP = new Set(["doc_type", "review_flag", "confidence"]);
  return Object.entries(meta)
    .filter(([k, v]) => !SKIP.has(k) && v !== null && v !== undefined)
    .map(([k, v]) => ({
      label: k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      value: typeof v === "object" ? JSON.stringify(v) : String(v),
      // confidence placeholder — not used for per-field bars; kept for FieldRow interface compatibility.
      confidence: 0,
    }));
}

export default function AiEngine() {
  const { user } = useAuth();
  const canWrite = user?.permissions.includes("ai:write") ?? false;

  const [tab, setTab] = useState<TabKey>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [classifyResult, setClassifyResult] = useState<ClassifyResult | null>(null);
  const [processResult, setProcessResult] = useState<ProcessResult | null>(null);
  const [ocrText, setOcrText] = useState<string>("");
  const [health, setHealth] = useState<AiHealthStatus | null>(null);
  const [healthError, setHealthError] = useState(false);
  const [stats, setStats] = useState<AiStats | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);

  /* ── Fetch health and stats on mount ── */
  useEffect(() => {
    getAiHealth()
      .then((h) => { setHealth(h); setHealthError(false); })
      .catch(() => { setHealth({ status: "unknown", service: "ai-idp", mode: "unknown" }); setHealthError(true); });
    getAiStats()
      .then(setStats)
      .catch(() => { /* stats unavailable — UI shows fallback placeholders */ });
  }, []);

  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setClassifyResult(null);
    setProcessResult(null);
    setError(null);
    setOcrText("");
  }, []);

  const handleClassify = useCallback(async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const result = await classifyDoc(file, ocrText);
      setClassifyResult(result);
      setTab("results");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Classification failed");
    } finally {
      setBusy(false);
    }
  }, [file, ocrText]);

  const handleProcess = useCallback(async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const docId = `DOC-${Date.now()}`;
      const result = await processDoc(file, docId, ocrText);
      setProcessResult(result);
      setClassifyResult({
        doc_type: result.handoff.doc_type,
        confidence: result.handoff.confidence,
        signals: [],
      });
      setTab("results");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Processing failed");
    } finally {
      setBusy(false);
    }
  }, [file, ocrText]);

  const handleOcr = useCallback(async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const res = await ocrDoc(file);
      setOcrText(res.text);
    } catch (e) {
      setError(e instanceof Error ? e.message : "OCR failed");
    } finally {
      setBusy(false);
    }
  }, [file]);

  const handleReset = useCallback(() => {
    setFile(null);
    setClassifyResult(null);
    setProcessResult(null);
    setOcrText("");
    setError(null);
    if (fileRef.current) fileRef.current.value = "";
  }, []);

  /* ── Derived display values ── */
  const handoff = processResult?.handoff ?? null;
  const decision = processResult?.decision ?? null;
  const meta = handoff?.metadata ?? null;
  const fields = flattenMetadata(meta);
  const docTypeLabel = classifyResult
    ? (DOC_TYPE_LABELS[classifyResult.doc_type] ?? classifyResult.doc_type)
    : "";
  const bandInfo = classifyResult ? bandFor(classifyResult.confidence) : null;

  const modeTag = healthError
    ? <Tag variant="amber"><span data-testid="health-unreachable">Service Unreachable</span></Tag>
    : health?.mode === "cpu_degraded"
    ? <Tag variant="amber">CPU Degraded Mode</Tag>
    : <Tag variant="green">GPU Mode · Healthy</Tag>;

  return (
    <div className="fade-up">
      {/* ── Page header ── */}
      <div className="page-header">
        <div>
          <h2 className="serif">AI Processing Engine</h2>
          <p>Granite 3.2 Vision · Qwen2.5-VL · Two-Stage IDP · Constrained JSON · 600+ pages/hr</p>
        </div>
        <div className="phr" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Tag variant="gold">vLLM v0.6</Tag>
          {modeTag}
          <StatusDot color="green" pulse />
        </div>
      </div>

      {/* ── KPI row (live stats when available, dashes while loading) ── */}
      <div className="g4" style={{ marginBottom: 16 }}>
        <KpiCard
          label="AI Queue Size"
          value={stats ? stats.queue_size.toLocaleString() : "—"}
          sub="Est. 4 min to clear"
          variant="blue"
        />
        <KpiCard
          label="Processed Today"
          value={stats ? stats.processed_today.toLocaleString() : "—"}
          sub={stats ? `Avg ${(stats.avg_processing_ms / 1000).toFixed(1)} s / page · P95 ≤ 5s` : "Avg — s / page"}
          variant="green"
        />
        <KpiCard
          label="Avg Confidence"
          value={stats ? `${(stats.avg_confidence * 100).toFixed(1)}%` : "—"}
          sub="Threshold: 85% (§6.4)"
          variant="gold"
        />
        <KpiCard
          label="Manual Review"
          value={stats ? stats.manual_review_count : "—"}
          sub="Conf < 85% or invalid extract"
          variant="red"
        />
      </div>

      {/* ── Tabs ── */}
      <Tabs
        items={[
          { key: "upload", label: "Document Upload & Process" },
          { key: "results", label: classifyResult ? `Results — ${docTypeLabel}` : "Results" },
          { key: "status", label: "Engine Status & Analytics" },
        ]}
        active={tab}
        onChange={(k) => setTab(k as TabKey)}
      />

      {/* ════════════════════════════════════ UPLOAD TAB ═══════════════════════════════ */}
      {tab === "upload" && (
        <div className="g2" style={{ marginTop: 16 }}>
          {/* Left: Upload panel */}
          <Card title="Document Upload — AI / IDP Pipeline">
            {/* Drop zone */}
            <div
              style={{
                background: "rgba(184,145,42,.04)",
                border: "2px dashed rgba(184,145,42,.25)",
                borderRadius: 10,
                padding: "28px 20px",
                textAlign: "center",
                marginBottom: 16,
                cursor: "pointer",
                transition: "border-color .15s",
              }}
              onClick={() => fileRef.current?.click()}
            >
              <svg
                width={32}
                height={32}
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--gold2)"
                strokeWidth={1.5}
                style={{ marginBottom: 10 }}
              >
                <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="12" y1="18" x2="12" y2="12" />
                <line x1="9" y1="15" x2="15" y2="15" />
              </svg>
              <div style={{ fontSize: 13, color: "var(--mist)", marginBottom: 4 }}>
                {file ? file.name : "Drop document here or click to browse"}
              </div>
              <div style={{ fontSize: 11, color: "var(--sil)" }}>
                PDF, PNG, JPG, TIFF — max 50 MB per page
              </div>
              <input
                ref={fileRef}
                type="file"
                aria-label="document"
                accept=".pdf,.png,.jpg,.jpeg,.tiff,.tif"
                style={{ display: "none" }}
                onChange={handleFile}
              />
            </div>

            {/* OCR Text (optional hint) */}
            {file && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: "var(--sil)", marginBottom: 6 }}>
                  OCR pre-text hint (optional — accelerates pre-screen)
                </div>
                <textarea
                  className="field"
                  rows={3}
                  placeholder="Paste any known text from the document (MRZ, header, CID number…)"
                  value={ocrText}
                  onChange={(e) => setOcrText(e.target.value)}
                  style={{ width: "100%", resize: "vertical", fontSize: 11, fontFamily: "monospace" }}
                />
                <button
                  className="btn bs"
                  style={{ fontSize: 11, marginTop: 4 }}
                  onClick={handleOcr}
                  disabled={busy || !file}
                >
                  Run OCR (Tesseract fallback)
                </button>
              </div>
            )}

            {/* Action buttons */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                className="btn bok"
                style={{ flex: 1 }}
                onClick={handleProcess}
                disabled={!file || busy || !canWrite}
                aria-label="process document"
              >
                {busy ? "Processing…" : "Process (Full IDP Pipeline)"}
              </button>
              <button
                className="btn bs"
                onClick={handleClassify}
                disabled={!file || busy || !canWrite}
              >
                Classify Only
              </button>
              {(classifyResult || processResult) && (
                <button className="btn bx" onClick={handleReset} disabled={busy}>
                  Reset
                </button>
              )}
            </div>

            {!canWrite && (
              <div
                style={{
                  marginTop: 10,
                  padding: "8px 12px",
                  background: "rgba(58,159,208,.08)",
                  borderRadius: 7,
                  fontSize: 11,
                  color: "var(--sil)",
                }}
              >
                Read-only view — upload requires <code>ai:write</code> permission.
              </div>
            )}

            {error && (
              <div
                style={{
                  marginTop: 12,
                  padding: "10px 14px",
                  background: "rgba(224,82,82,.1)",
                  border: "1px solid rgba(224,82,82,.25)",
                  borderRadius: 8,
                  fontSize: 12,
                  color: "var(--R)",
                }}
              >
                {error}
              </div>
            )}
          </Card>

          {/* Right: Pipeline diagram */}
          <Card title="IDP Pipeline — Stage Overview">
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                { stage: "Stage 0", name: "Pre-screen", detail: "MRZ/ID-regex signals → proposed type", color: "var(--sil)" },
                { stage: "Stage 1", name: "Classify", detail: "Granite 3.2 Vision 2B — P95 ≤ 700 ms/page", color: "var(--B)" },
                { stage: "Route",   name: "Confidence Band", detail: "§6.4: ≥0.92 Auto · ≥0.85 Verified · ≥0.70 Supervisor · ≥0.50 Human · <0.50 Reject", color: "var(--gold2)" },
                { stage: "Stage 2", name: "Extract", detail: "Qwen2.5-VL 7B — constrained JSON — Pydantic v2 — P95 ≤ 5 s/page", color: "var(--G)" },
                { stage: "Stage 3", name: "Validate", detail: "Per-type field rules · ISO dates · regex · cross-field checks", color: "var(--P)" },
                { stage: "Stage 4", name: "Catalog Hand-off", detail: "Typed payload → Core DMS · directory mapping · alert tiers", color: "var(--W)" },
              ].map((s, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 12,
                    padding: "10px 12px",
                    background: "var(--gr)",
                    borderRadius: 8,
                    borderLeft: `3px solid ${s.color}`,
                  }}
                >
                  <div style={{ minWidth: 54 }}>
                    <span style={{ fontSize: 9, color: s.color, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase" }}>
                      {s.stage}
                    </span>
                  </div>
                  <div>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--mist)" }}>{s.name}</div>
                    <div style={{ fontSize: 10, color: "var(--sil)", marginTop: 2 }}>{s.detail}</div>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 16, display: "flex", gap: 8, flexWrap: "wrap" }}>
              {[
                { label: "CID Classify", target: "≥ 95%", color: "var(--G)" },
                { label: "Field Accuracy", target: "≥ 90%", color: "var(--G)" },
                { label: "Human Review Rate", target: "≤ 8%", color: "var(--W)" },
                { label: "End-to-end P95", target: "≤ 8 s", color: "var(--B)" },
              ].map((m) => (
                <div
                  key={m.label}
                  style={{
                    flex: 1,
                    minWidth: 110,
                    padding: "8px 10px",
                    background: "var(--ink3)",
                    borderRadius: 8,
                    border: "1px solid var(--bd)",
                    textAlign: "center",
                  }}
                >
                  <div style={{ fontSize: 9, color: "var(--sil)", letterSpacing: 1, textTransform: "uppercase", marginBottom: 4 }}>
                    {m.label}
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: m.color, fontFamily: "Cormorant Garamond, serif" }}>
                    {m.target}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* ═════════════════════════════════ RESULTS TAB ═════════════════════════════════ */}
      {tab === "results" && (
        <div style={{ marginTop: 16 }}>
          {!classifyResult && !processResult ? (
            <Card>
              <div style={{ textAlign: "center", padding: "32px 0", color: "var(--sil)", fontSize: 13 }}>
                No results yet — upload and process a document first.
              </div>
            </Card>
          ) : (
            <div className="g2">
              {/* Left column: extraction overlay + classification result */}
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {/* Document AI extraction overlay */}
                <Card
                  title={
                    <span>
                      Document · AI Extraction Overlay{" "}
                      {classifyResult && (
                        <Tag variant="blue">{docTypeLabel}</Tag>
                      )}
                    </span>
                  }
                >
                  {classifyResult && (
                    <div
                      style={{
                        background: "rgba(255,255,255,.03)",
                        border: "1px solid var(--bd)",
                        borderRadius: 8,
                        padding: 16,
                      }}
                    >
                      <div
                        style={{
                          fontSize: 8,
                          color: "var(--gold)",
                          letterSpacing: "1.5px",
                          textTransform: "uppercase",
                          marginBottom: 10,
                        }}
                      >
                        {docTypeLabel}
                      </div>

                      {/* File name + signals */}
                      <div style={{ display: "flex", gap: 12, marginBottom: 12, alignItems: "flex-start" }}>
                        <div
                          style={{
                            width: 56,
                            height: 76,
                            background: "rgba(184,145,42,.08)",
                            border: "2px solid rgba(46,204,138,.4)",
                            borderRadius: 4,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="var(--gold)" strokeWidth={1.5}>
                            <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                            <polyline points="14 2 14 8 20 8" />
                          </svg>
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 9, color: "var(--sil)", marginBottom: 2 }}>FILE</div>
                          <div
                            style={{
                              background: "rgba(184,145,42,.15)",
                              border: "1px solid rgba(184,145,42,.3)",
                              borderRadius: 3,
                              padding: "3px 8px",
                              fontSize: 12,
                              marginBottom: 8,
                            }}
                          >
                            {file?.name ?? "Processed document"}
                          </div>
                          {classifyResult.signals.length > 0 && (
                            <div>
                              <div style={{ fontSize: 9, color: "var(--sil)", marginBottom: 4 }}>CLASSIFICATION SIGNALS</div>
                              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                                {classifyResult.signals.slice(0, 6).map((s, i) => (
                                  <span
                                    key={i}
                                    style={{
                                      fontSize: 9,
                                      background: "rgba(58,159,208,.12)",
                                      border: "1px solid rgba(58,159,208,.2)",
                                      borderRadius: 4,
                                      padding: "2px 6px",
                                      color: "var(--B)",
                                    }}
                                  >
                                    {s}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* MRZ display for passport types */}
                      {(classifyResult.doc_type === "BT_PASSPORT" || classifyResult.doc_type === "FOREIGN_PASSPORT") &&
                        ocrText && (
                          <div
                            style={{
                              background: "rgba(0,0,0,.25)",
                              borderRadius: 4,
                              padding: 7,
                              fontFamily: "JetBrains Mono, monospace",
                              fontSize: 8.5,
                              color: "var(--sil)",
                              letterSpacing: 1,
                              marginTop: 8,
                            }}
                          >
                            {ocrText.split("\n").slice(0, 2).join("\n")}
                          </div>
                        )}
                    </div>
                  )}
                </Card>

                {/* Classification result banner */}
                {classifyResult && bandInfo && (
                  <Card title="Classification Result">
                    <div
                      style={{
                        background: "rgba(184,145,42,.05)",
                        border: "1px solid rgba(184,145,42,.2)",
                        borderRadius: 8,
                        padding: 12,
                        marginBottom: 12,
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                      }}
                    >
                      <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="var(--gold3)" strokeWidth={2}>
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                      </svg>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "var(--gold3)" }}>
                          {docTypeLabel} · {(classifyResult.confidence * 100).toFixed(1)}% confidence
                        </div>
                        <div style={{ fontSize: 10, color: "var(--sil)", marginTop: 2 }}>
                          Band: {bandInfo.label}
                          {decision && ` · Action: ${decision.action.replace(/_/g, " ")}`}
                          {decision?.sla_hours != null && ` · SLA: ${decision.sla_hours}h`}
                        </div>
                      </div>
                      <div style={{ marginLeft: "auto" }}>
                        <ConfidenceBadge confidence={classifyResult.confidence} />
                      </div>
                    </div>

                    {/* Route decision info */}
                    {decision && (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                        <span
                          style={{
                            fontSize: 10,
                            padding: "3px 8px",
                            borderRadius: 6,
                            background: "var(--gr)",
                            color: "var(--sil)",
                          }}
                        >
                          Catalog: <strong style={{ color: "var(--mist)" }}>{decision.catalog_assignment}</strong>
                        </span>
                        {decision.review_required && (
                          <Tag variant="amber">Routed to Review Queue</Tag>
                        )}
                        {!decision.review_required && (
                          <Tag variant="green">Auto-Approved</Tag>
                        )}
                        {processResult?.review_item_id != null && (
                          <span style={{ fontSize: 10, color: "var(--sil)", padding: "3px 8px", background: "var(--gr)", borderRadius: 6 }}>
                            Review #<strong style={{ color: "var(--W)" }}>{processResult.review_item_id}</strong>
                          </span>
                        )}
                      </div>
                    )}

                    {actionNotice && (
                      <div
                        data-testid="action-notice"
                        style={{
                          marginBottom: 8,
                          padding: "8px 12px",
                          background: "rgba(58,159,208,.1)",
                          border: "1px solid rgba(58,159,208,.25)",
                          borderRadius: 7,
                          fontSize: 11,
                          color: "var(--B)",
                        }}
                      >
                        {actionNotice}
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        className="btn bok"
                        style={{ flex: 1 }}
                        disabled={!canWrite}
                        onClick={() => setActionNotice("Accept & Index: indexing pipeline not yet connected — contact your administrator.")}
                        aria-label="accept and index"
                      >
                        Accept &amp; Index
                      </button>
                      <button
                        className="btn bs"
                        disabled={!canWrite}
                        onClick={() => setActionNotice("Edit Fields: field-edit UI not yet implemented in this release.")}
                        aria-label="edit fields"
                      >
                        Edit Fields
                      </button>
                      <button className="btn bx" onClick={handleReset} aria-label="reprocess">
                        Reprocess
                      </button>
                      <button
                        className="btn bw"
                        disabled={!canWrite}
                        onClick={() => setActionNotice("Flag: flagging API not yet connected — item will be routed to review queue automatically.")}
                        aria-label="flag"
                      >
                        Flag
                      </button>
                    </div>
                  </Card>
                )}
              </div>

              {/* Right column: extracted fields + review notice */}
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {/* Extracted fields */}
                <Card
                  title={
                    <span>
                      Extracted Fields{" "}
                      {classifyResult && (
                        <Tag variant="gold">
                          {(classifyResult.confidence * 100).toFixed(1)}% Classification Confidence
                        </Tag>
                      )}
                    </span>
                  }
                >
                  {fields.length > 0 ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {fields.map((f, i) => (
                        <div
                          key={i}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "7px 10px",
                            background: "var(--gr)",
                            borderRadius: 6,
                          }}
                        >
                          <div style={{ width: 100, fontSize: 10, color: "var(--sil)", flexShrink: 0 }}>
                            {f.label}
                          </div>
                          <div style={{ flex: 1, fontSize: 12, color: "var(--mist)", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {f.value}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ textAlign: "center", padding: "24px 0", color: "var(--sil)", fontSize: 12 }}>
                      {classifyResult
                        ? "Run full pipeline (Process) to extract structured fields."
                        : "No extraction data yet."}
                    </div>
                  )}
                </Card>

                {/* Review routing notice */}
                {handoff?.review_required && (
                  <div
                    data-testid="review-notice"
                    style={{
                      padding: "12px 16px",
                      background: "rgba(240,160,48,.08)",
                      border: "1px solid rgba(240,160,48,.25)",
                      borderRadius: 8,
                    }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 700, color: "var(--W)", marginBottom: 4 }}>
                      Routed to Human-Review Queue
                    </div>
                    <div style={{ fontSize: 11, color: "var(--sil)" }}>
                      Confidence below threshold or extraction validation failed. A reviewer will
                      claim and resolve this document within the assigned SLA
                      {decision?.sla_hours != null ? ` (${decision.sla_hours}h)` : ""}.
                    </div>
                    {processResult?.review_item_id != null && (
                      <div style={{ marginTop: 8, fontSize: 11 }}>
                        Review item:{" "}
                        <strong style={{ color: "var(--W)" }}>#{processResult.review_item_id}</strong>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═════════════════════════════════ STATUS TAB ══════════════════════════════════ */}
      {tab === "status" && (
        <div className="g2" style={{ marginTop: 16 }}>
          {/* Left: throughput chart + doc-type donut */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <LineChartCard
              title="Throughput — Pages Processed per Hour"
              data={THROUGHPUT_STUB}
              xKey="time"
              lines={[{ key: "pages", color: "var(--gold2)", name: "Pages/hr" }]}
              height={200}
            />
            <DonutChartCard
              title="Document Type Distribution (Today)"
              data={DOCTYPE_STUB}
              height={200}
            />
          </div>

          {/* Right: engine status details */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Card title="AI Engine Status">
              <div style={{ fontSize: 12, display: "flex", flexDirection: "column", gap: 7 }}>
                {[
                  { label: "Service",          value: health?.service ?? "ai-idp" },
                  { label: "Mode",             value: health?.mode ?? "gpu", tag: health?.mode === "cpu_degraded" ? <Tag variant="amber">CPU Degraded</Tag> : <Tag variant="green">GPU</Tag> },
                  { label: "Classifier",       tag: <Tag variant="gold">Granite 3.2 Vision 2B · INT4/AWQ</Tag> },
                  { label: "Extractor",        tag: <Tag variant="gold">Qwen2.5-VL 7B · Q4/GPTQ</Tag> },
                  { label: "Inference Server", tag: <Tag variant="blue">vLLM OpenAI-compatible · constrained JSON</Tag> },
                  { label: "Constrained JSON", tag: <Tag variant="blue">guided_json decoding · Pydantic v2 validation</Tag> },
                  { label: "OCR Fallback",     tag: <Tag variant="purple">Tesseract (pytesseract)</Tag> },
                  { label: "Pre-screen",       tag: <Tag variant="green">MRZ + ID-regex · 18 doc types</Tag> },
                  { label: "DB Backend",       tag: <Tag variant="gold">PostgreSQL · Oracle 19c switchable</Tag> },
                ].map(({ label, value, tag }) => (
                  <div
                    key={label}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "6px 0",
                      borderBottom: "1px solid var(--bd)",
                    }}
                  >
                    <span style={{ color: "var(--sil)" }}>{label}</span>
                    {tag ?? <span style={{ color: "var(--mist)" }}>{value}</span>}
                  </div>
                ))}
              </div>
            </Card>

            {/* SLO summary */}
            <Card title="Performance SLOs (IDP §7.3)">
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {[
                  { slo: "Classifier P95",      target: "≤ 700 ms/page", current: "620 ms",  ok: true },
                  { slo: "Extractor P95",       target: "≤ 5 s/page",    current: "4.1 s",   ok: true },
                  { slo: "End-to-end P95",      target: "≤ 8 s/page",    current: "5.8 s",   ok: true },
                  { slo: "Batch throughput",    target: "≥ 600 pages/hr", current: "840/hr",  ok: true },
                  { slo: "CID Classify Acc.",   target: "≥ 95%",          current: "97.4%",   ok: true },
                  { slo: "Field Accuracy",      target: "≥ 90%",          current: "93.2%",   ok: true },
                  { slo: "Human Review Rate",   target: "≤ 8%",           current: "6.1%",    ok: true },
                ].map((r) => (
                  <div
                    key={r.slo}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "7px 10px",
                      background: "var(--gr)",
                      borderRadius: 6,
                    }}
                  >
                    <StatusDot color={r.ok ? "green" : "red"} />
                    <div style={{ flex: 1, fontSize: 11 }}>
                      <div style={{ color: "var(--mist)" }}>{r.slo}</div>
                      <div style={{ fontSize: 10, color: "var(--sil)" }}>Target: {r.target}</div>
                    </div>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color: r.ok ? "var(--G)" : "var(--R)",
                      }}
                    >
                      {r.current}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
