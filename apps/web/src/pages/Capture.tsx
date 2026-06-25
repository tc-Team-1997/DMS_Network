import { useState, useRef, useEffect, useCallback, useMemo, type DragEvent } from "react";
import { useNavigate } from "react-router-dom";
import {
  KpiCard,
  Card,
  Tag,
  Modal,
  FormField,
  Tabs,
  BarChartCard,
} from "../components/ui/index.js";
import type { Column, TabItem } from "../components/ui/index.js";
import { useAuth } from "../auth/AuthContext.js";
import { dashboardCaptureApi, type DocumentRecord } from "../api/dashboardCaptureApi.js";

/* ─── Capture queue item (pre-upload) ─── */
interface QueueFile {
  id: string;
  file: File;
  title: string;
  branch: string;
  status: "ready" | "uploading" | "done" | "error";
  docId?: number;
  confidence?: number;
  previewClass?: string;
}

const STATUS_TAG: Record<QueueFile["status"], { label: string; variant: "green" | "amber" | "blue" | "red" }> = {
  ready: { label: "Ready", variant: "green" },
  uploading: { label: "Processing", variant: "amber" },
  done: { label: "Captured", variant: "blue" },
  error: { label: "Error", variant: "red" },
};

/* ─── Map source_channel DB values to human-readable labels ─── */
const CHANNEL_LABELS: Record<string, string> = {
  SCAN: "Branch Scanners",
  UPLOAD: "Portal Upload",
  EMAIL: "Email (SMTP)",
  API: "API Push",
  BULK: "Bulk Import",
};

function channelLabel(ch: string): string {
  return CHANNEL_LABELS[ch] ?? ch;
}

const TABS: TabItem[] = [
  { key: "scanner", label: "Scanner (WIA/TWAIN)" },
  { key: "upload", label: "File Upload" },
  { key: "email", label: "Email Ingestion" },
  { key: "portal", label: "Customer Portal" },
  { key: "api", label: "API Push" },
  { key: "bulk", label: "Bulk Import" },
];

const QUEUE_COLS: Column<QueueFile>[] = [
  {
    key: "file",
    header: "File",
    render: (r) => (
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--mist)" }}>{r.title || r.file.name}</div>
        <div style={{ fontSize: 10, color: "var(--sil)", marginTop: 1 }}>
          {(r.file.size / 1024).toFixed(0)} KB · {r.file.type || "unknown"}
        </div>
      </div>
    ),
  },
  { key: "branch", header: "Branch", render: (r) => r.branch || "—" },
  {
    key: "status",
    header: "Status",
    render: (r) => {
      const s = STATUS_TAG[r.status];
      return <Tag variant={s.variant}>{s.label}</Tag>;
    },
  },
  {
    key: "confidence",
    header: "AI Class",
    render: (r) =>
      r.confidence != null
        ? <span style={{ color: "var(--gold3)", fontWeight: 600 }}>{(r.confidence * 100).toFixed(0)}%</span>
        : <span style={{ color: "var(--sil)" }}>—</span>,
  },
];

/* ═══════════════════════════════ CAPTURE ═══════════════════════════════ */
export default function Capture() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const canCapture = user?.permissions?.includes("document:capture") ?? false;
  const [tab, setTab] = useState("upload");
  const [queue, setQueue] = useState<QueueFile[]>([]);
  const [dragging, setDragging] = useState(false);

  /* API-driven ingestion stats */
  const [allDocs, setAllDocs] = useState<DocumentRecord[]>([]);
  const [statsLoading, setStatsLoading] = useState(true);

  const loadStats = useCallback(async () => {
    try {
      setStatsLoading(true);
      const res = await dashboardCaptureApi.listDocuments();
      setAllDocs(Array.isArray(res.documents) ? res.documents : []);
    } catch {
      // Stats are non-critical; silently fail, keep empty array
      setAllDocs([]);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  useEffect(() => { loadStats(); }, [loadStats]);

  /* Compute channel breakdown from document source_channel */
  const safeAllDocs = Array.isArray(allDocs) ? allDocs : [];
  const channelData = useMemo(() => {
    const docs = Array.isArray(allDocs) ? allDocs : [];
    const counts: Record<string, number> = {};
    for (const d of docs) {
      const ch = d.source_channel ?? "UPLOAD";
      counts[ch] = (counts[ch] ?? 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([ch, docCount]) => ({ channel: channelLabel(ch), docs: docCount }));
  }, [allDocs]);

  const totalIngested = safeAllDocs.length;
  const scannerCount = safeAllDocs.filter((d) => d.source_channel === "SCAN").length;
  const portalCount = safeAllDocs.filter((d) => d.source_channel === "UPLOAD" || d.source_channel === "PORTAL").length;

  /* single-file modal */
  const [showModal, setShowModal] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [modalTitle, setModalTitle] = useState("");
  const [modalBranch, setModalBranch] = useState(user?.branch ?? "Thimphu");

  /* scanner config */
  const [scanDevice, setScanDevice] = useState("FUJITSU fi-8170 (WIA)");
  const [scanResolution, setScanResolution] = useState("300 DPI");
  const [scanColor, setScanColor] = useState("Color (24-bit)");
  const [batchLabel, setBatchLabel] = useState("");

  /* email config */
  const [emailBox, setEmailBox] = useState("dms-ingest@zordms.org.bt");
  const [emailInterval, setEmailInterval] = useState("5 min");

  const fileInputRef = useRef<HTMLInputElement>(null);

  function addFilesToQueue(files: File[]) {
    const newItems: QueueFile[] = files.map((f) => ({
      id: `${Date.now()}-${f.name}`,
      file: f,
      title: f.name.replace(/\.[^.]+$/, ""),
      branch: user?.branch ?? "Thimphu",
      status: "ready",
    }));
    if (newItems.length === 1) {
      setPendingFile(newItems[0].file);
      setModalTitle(newItems[0].title);
      setModalBranch(newItems[0].branch);
      setShowModal(true);
    } else {
      setQueue((q) => [...q, ...newItems]);
    }
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    addFilesToQueue(Array.from(e.dataTransfer.files));
  }

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    if (e.target.files) addFilesToQueue(Array.from(e.target.files));
  }

  function confirmAddFromModal() {
    if (!pendingFile) return;
    const item: QueueFile = {
      id: `${Date.now()}-${pendingFile.name}`,
      file: pendingFile,
      title: modalTitle,
      branch: modalBranch,
      status: "ready",
    };
    setQueue((q) => [...q, item]);
    setShowModal(false);
    setPendingFile(null);
  }

  async function uploadSingle(item: QueueFile) {
    setQueue((q) => q.map((i) => i.id === item.id ? { ...i, status: "uploading" } : i));
    try {
      const form = new FormData();
      form.append("title", item.title);
      form.append("branch", item.branch);
      form.append("file", item.file);
      const res = await dashboardCaptureApi.uploadDocument(form);
      setQueue((q) => q.map((i) => i.id === item.id ? { ...i, status: "done", docId: res.document.id, confidence: res.document.confidence ?? undefined } : i));
    } catch {
      setQueue((q) => q.map((i) => i.id === item.id ? { ...i, status: "error" } : i));
    }
  }

  async function submitAll() {
    const toUpload = queue.filter((i) => i.status === "ready");
    await Promise.all(toUpload.map(uploadSingle));
  }

  function clearDone() {
    setQueue((q) => q.filter((i) => i.status !== "done" && i.status !== "error"));
  }

  function removeItem(id: string) {
    setQueue((q) => q.filter((i) => i.id !== id));
  }

  // Access control is enforced by ProtectedRoute (permission="document:capture") in router.tsx.
  // The canCapture variable is kept for any conditional rendering of permission-dependent UI.
  void canCapture;

  return (
    <div className="fade-up">
      {/* ── Page Header ── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20, gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 className="serif" style={{ fontSize: 24, fontWeight: 700, color: "var(--gold3)", lineHeight: 1 }}>
            Multi-Channel Capture
          </h2>
          <p style={{ fontSize: 11, color: "var(--sil)", marginTop: 3 }}>
            WIA · TWAIN · Email Ingestion · API Push · Customer Portal · Bulk Import
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Tag variant="green">{queue.filter((i) => i.status === "done").length} Captured</Tag>
          <Tag variant="amber">{queue.filter((i) => i.status === "ready").length} Ready</Tag>
        </div>
      </div>

      {/* ── KPI Row ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 16 }}>
        <KpiCard label="Today Total Ingested" value={statsLoading ? "…" : totalIngested.toLocaleString()} sub={<span style={{ color: "var(--G)" }}>Avg cycle 3.8s</span>} variant="gold" />
        <KpiCard label="Branch Scanners" value={statsLoading ? "…" : scannerCount.toLocaleString()} sub={totalIngested > 0 ? `${Math.round((scannerCount / totalIngested) * 100)}% of total` : "No data yet"} variant="blue" />
        <KpiCard label="Portal / Upload" value={statsLoading ? "…" : portalCount.toLocaleString()} sub="Online submissions" variant="green" />
        <KpiCard label="Queue Size" value={queue.length.toString()} sub={`${queue.filter((i) => i.status === "ready").length} ready to submit`} variant="amber" />
      </div>

      {/* ── Channel Tabs ── */}
      <Tabs items={TABS} active={tab} onChange={setTab} />

      {/* ── Tab: Upload ── */}
      {tab === "upload" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {/* Drop zone */}
            <div
              role="button"
              tabIndex={0}
              aria-label="Drop zone — click or drag to upload"
              style={{
                border: `2px dashed ${dragging ? "var(--gold2)" : "rgba(184,145,42,.3)"}`,
                borderRadius: 10,
                padding: "36px 20px",
                textAlign: "center",
                cursor: "pointer",
                background: dragging ? "rgba(184,145,42,.04)" : "rgba(184,145,42,.02)",
                transition: ".2s",
              }}
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(e) => e.key === "Enter" && fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              <div style={{ color: "var(--gold)", opacity: .7, marginBottom: 12 }}>
                <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--mist)", marginBottom: 5 }}>
                {dragging ? "Release to upload" : "Drop files or click to upload"}
              </div>
              <div style={{ fontSize: 11, color: "var(--sil)" }}>
                PDF, TIFF, JPEG, PNG, DOCX · Max 50 MB · Batch supported
              </div>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                style={{ display: "none" }}
                onChange={onPickFile}
                aria-label="File input"
                id="file-input"
              />
            </div>

            {/* Channel stats */}
            <Card title="Today's Ingestion by Channel">
              {statsLoading ? (
                <div style={{ padding: "20px 0", textAlign: "center", color: "var(--sil)", fontSize: 12 }}>Loading…</div>
              ) : channelData.length === 0 ? (
                <div style={{ padding: "20px 0", textAlign: "center", color: "var(--sil)", fontSize: 12 }}>No ingestion data yet</div>
              ) : (
                <BarChartCard
                  title=""
                  data={channelData}
                  xKey="channel"
                  bars={[{ key: "docs", color: "#b8912a", name: "Documents" }]}
                  height={140}
                />
              )}
            </Card>
          </div>

          {/* Queue Panel */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Card
              title={<span>Capture Queue <Tag variant="gold">{queue.length} items</Tag></span>}
              action={
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    onClick={clearDone}
                    style={{ padding: "5px 10px", background: "var(--ink3)", border: "1px solid var(--bd)", borderRadius: 6, fontSize: 10, color: "var(--sil)", cursor: "pointer" }}
                  >
                    Clear done
                  </button>
                </div>
              }
            >
              {queue.length === 0 ? (
                <div style={{ padding: "20px 0", textAlign: "center", color: "var(--sil)", fontSize: 12 }}>
                  No files queued — drop files or use the upload zone.
                </div>
              ) : (
                <>
                  {queue.map((item) => (
                    <div
                      key={item.id}
                      style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", background: "var(--ink3)", borderRadius: 7, marginBottom: 6 }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={item.status === "error" ? "var(--R)" : item.status === "done" ? "var(--G)" : "var(--sil)"} strokeWidth="2">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                        <polyline points="14 2 14 8 20 8"/>
                      </svg>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, color: "var(--mist)" }}>{item.title || item.file.name}</div>
                        <div style={{ fontSize: 10, color: "var(--sil)" }}>
                          {(item.file.size / 1024).toFixed(0)} KB · {item.branch}
                          {item.confidence != null && ` · AI: ${(item.confidence * 100).toFixed(0)}%`}
                        </div>
                      </div>
                      <Tag variant={STATUS_TAG[item.status].variant}>{STATUS_TAG[item.status].label}</Tag>
                      {item.status === "ready" && (
                        <button
                          onClick={() => uploadSingle(item)}
                          style={{ padding: "4px 8px", background: "rgba(184,145,42,.15)", border: "1px solid rgba(184,145,42,.3)", borderRadius: 5, fontSize: 10, color: "var(--gold3)", cursor: "pointer" }}
                        >
                          Upload
                        </button>
                      )}
                      {item.status === "done" && item.docId && (
                        <button
                          onClick={() => navigate(`/indexing?id=${item.docId}`)}
                          style={{ padding: "4px 8px", background: "rgba(58,159,208,.15)", border: "1px solid rgba(58,159,208,.3)", borderRadius: 5, fontSize: 10, color: "var(--B)", cursor: "pointer" }}
                        >
                          Index
                        </button>
                      )}
                      <button
                        onClick={() => removeItem(item.id)}
                        style={{ padding: "4px 6px", background: "none", border: "none", color: "var(--sil)", cursor: "pointer", fontSize: 12 }}
                        aria-label="Remove"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                    <button
                      onClick={submitAll}
                      style={{ flex: 1, padding: "9px 14px", background: "linear-gradient(135deg,#b8912a,#f0c84a)", border: "none", borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: "pointer", color: "#050d1a" }}
                    >
                      Submit All to Indexing
                    </button>
                    <button
                      onClick={clearDone}
                      style={{ padding: "9px 14px", background: "var(--ink3)", border: "1px solid var(--bd)", borderRadius: 7, fontSize: 11, color: "var(--mist)", cursor: "pointer" }}
                    >
                      Clear Queue
                    </button>
                  </div>
                </>
              )}
            </Card>
          </div>
        </div>
      )}

      {/* ── Tab: Scanner ── */}
      {tab === "scanner" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <Card title="Scanner Configuration">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <FormField as="select" label="Scanner Device" value={scanDevice} onChange={(e) => setScanDevice((e.target as HTMLSelectElement).value)}>
                <option>FUJITSU fi-8170 (WIA)</option>
                <option>Canon DR-G2110 (TWAIN)</option>
                <option>Kodak S3100 (ISIS)</option>
              </FormField>
              <FormField as="select" label="Protocol" value="WIA 2.0" onChange={() => {}}>
                <option>WIA 2.0</option>
                <option>TWAIN 2.4</option>
                <option>ISIS</option>
              </FormField>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <FormField as="select" label="Resolution" value={scanResolution} onChange={(e) => setScanResolution((e.target as HTMLSelectElement).value)}>
                <option>150 DPI</option>
                <option>200 DPI</option>
                <option>300 DPI</option>
                <option>600 DPI</option>
              </FormField>
              <FormField as="select" label="Color Profile" value={scanColor} onChange={(e) => setScanColor((e.target as HTMLSelectElement).value)}>
                <option>Color (24-bit)</option>
                <option>Greyscale (8-bit)</option>
                <option>B&W (1-bit)</option>
                <option>Auto</option>
              </FormField>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
              <FormField as="select" label="Paper Size" value="Auto-detect" onChange={() => {}}>
                <option>A4</option>
                <option>A3</option>
                <option>Auto-detect</option>
              </FormField>
              <FormField as="select" label="Duplex" value="Simplex" onChange={() => {}}>
                <option>Simplex</option>
                <option>Duplex (Both)</option>
              </FormField>
            </div>
            <FormField
              label="Batch Label / Reference"
              placeholder="KYC-THIMPHU-20260623-001"
              value={batchLabel}
              onChange={(e) => setBatchLabel((e.target as HTMLInputElement).value)}
            />
            <FormField as="select" label="Destination Folder" value="KYC Documents / Passports" onChange={() => {}}>
              <option>KYC Documents / Passports</option>
              <option>KYC Documents / National IDs (CID)</option>
              <option>Loan Applications</option>
              <option>Compliance</option>
            </FormField>
            <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <button style={{ flex: 1, padding: "9px 14px", background: "linear-gradient(135deg,#b8912a,#f0c84a)", border: "none", borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: "pointer", color: "#050d1a" }}>
                ▶ Start Scan
              </button>
              <button style={{ padding: "9px 12px", background: "var(--ink3)", border: "1px solid var(--bd)", borderRadius: 7, fontSize: 11, color: "var(--mist)", cursor: "pointer" }}>
                Test Scanner
              </button>
              <button style={{ padding: "9px 12px", background: "var(--ink3)", border: "1px solid var(--bd)", borderRadius: 7, fontSize: 11, color: "var(--mist)", cursor: "pointer" }}>
                Calibrate
              </button>
            </div>
          </Card>
          <Card title="Scanner Status">
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                { label: "Device", value: scanDevice, ok: true },
                { label: "Protocol", value: "WIA 2.0", ok: true },
                { label: "Resolution", value: scanResolution, ok: true },
                { label: "Color Mode", value: scanColor, ok: true },
                { label: "Paper Feeder", value: "Ready (50 sheets)", ok: true },
                { label: "Connection", value: "USB 3.0 · Online", ok: true },
              ].map((row) => (
                <div key={row.label} style={{ display: "flex", justifyContent: "space-between", padding: "8px 10px", background: "var(--ink3)", borderRadius: 7, fontSize: 11 }}>
                  <span style={{ color: "var(--sil)" }}>{row.label}</span>
                  <span style={{ color: row.ok ? "var(--mist)" : "var(--R)" }}>{row.value}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {/* ── Tab: Email ── */}
      {tab === "email" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <Card title="Email Ingestion Configuration">
            <FormField label="Monitored Mailbox" value={emailBox} onChange={(e) => setEmailBox((e.target as HTMLInputElement).value)} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <FormField as="select" label="Protocol" value="IMAP / SSL" onChange={() => {}}>
                <option>IMAP / SSL</option>
                <option>POP3</option>
                <option>Microsoft Graph API</option>
              </FormField>
              <FormField as="select" label="Check Interval" value={emailInterval} onChange={(e) => setEmailInterval((e.target as HTMLSelectElement).value)}>
                <option>1 min</option>
                <option>5 min</option>
                <option>15 min</option>
              </FormField>
            </div>
            <FormField as="select" label="Auto-Classification" value="AI-powered" onChange={() => {}}>
              <option>AI-powered · Route by attachment type</option>
              <option>Manual review all</option>
            </FormField>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button style={{ padding: "9px 14px", background: "linear-gradient(135deg,#b8912a,#f0c84a)", border: "none", borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: "pointer", color: "#050d1a" }}>
                Save & Test
              </button>
              <button style={{ padding: "9px 12px", background: "var(--ink3)", border: "1px solid var(--bd)", borderRadius: 7, fontSize: 11, color: "var(--mist)", cursor: "pointer" }}>
                Test Connection
              </button>
            </div>
          </Card>
          <Card title="Email Queue">
            <div style={{ color: "var(--sil)", fontSize: 12, padding: "20px 0", textAlign: "center" }}>
              No emails pending. Monitoring <code>{emailBox}</code>.
            </div>
          </Card>
        </div>
      )}

      {/* ── Tabs: Portal / API / Bulk — placeholder cards ── */}
      {(tab === "portal" || tab === "api" || tab === "bulk") && (
        <Card title={tab === "portal" ? "Customer Portal Upload" : tab === "api" ? "API Push Configuration" : "Bulk Import"}>
          <div style={{ padding: "40px 0", textAlign: "center", color: "var(--sil)", fontSize: 13 }}>
            {tab === "portal" && "Customer Portal upload endpoint is active at https://portal.zordms.org.bt/upload"}
            {tab === "api" && "API Push endpoint: POST /svc/core/documents — Bearer token required. See API documentation."}
            {tab === "bulk" && "Bulk import: drop a ZIP archive or CSV manifest file above to queue multiple documents simultaneously."}
          </div>
        </Card>
      )}

      {/* ── Add File Modal ── */}
      <Modal open={showModal} onClose={() => { setShowModal(false); setPendingFile(null); }} title="Configure Capture">
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ background: "var(--ink3)", border: "1px solid var(--bd)", borderRadius: 8, padding: "10px 12px", fontSize: 12 }}>
            <div style={{ color: "var(--mist)", fontWeight: 600 }}>{pendingFile?.name}</div>
            <div style={{ color: "var(--sil)", fontSize: 11, marginTop: 2 }}>
              {pendingFile ? `${(pendingFile.size / 1024).toFixed(0)} KB · ${pendingFile.type || "unknown"}` : ""}
            </div>
          </div>
          <FormField
            label="Document Title *"
            placeholder="e.g. Passport — Sonam Dorji"
            value={modalTitle}
            onChange={(e) => setModalTitle((e.target as HTMLInputElement).value)}
          />
          <FormField as="select" label="Branch" value={modalBranch} onChange={(e) => setModalBranch((e.target as HTMLSelectElement).value)}>
            <option>Thimphu</option>
            <option>Phuentsholing</option>
            <option>Gelephu</option>
            <option>Bumthang</option>
            <option>Mongar</option>
            <option>Trashigang</option>
          </FormField>
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button
              onClick={confirmAddFromModal}
              style={{ flex: 1, padding: "9px 14px", background: "linear-gradient(135deg,#b8912a,#f0c84a)", border: "none", borderRadius: 7, fontSize: 11, fontWeight: 700, cursor: "pointer", color: "#050d1a" }}
            >
              Add to Queue
            </button>
            <button
              onClick={() => { setShowModal(false); setPendingFile(null); }}
              style={{ padding: "9px 14px", background: "var(--ink3)", border: "1px solid var(--bd)", borderRadius: 7, fontSize: 11, color: "var(--mist)", cursor: "pointer" }}
            >
              Cancel
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
