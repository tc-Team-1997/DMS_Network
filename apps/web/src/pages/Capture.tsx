/**
 * Capture.tsx — ZorDMS Multi-Channel Document Capture (Enterprise)
 *
 * Three tabs: Scanner | File Upload | Bulk Upload
 * Front + Back side capture slots per tab (except Bulk = many files).
 * Real-time file preview with zoom, rotate controls.
 * Proceed → POST /documents → POST /documents/:id/extract → result.
 * Capture queue with drawer (FAB bottom-right, uiStore.captureDrawerOpen).
 * RBAC gate: document:capture.
 */
import { useState, useCallback } from "react";
import { Card, Tag, Tabs, Modal, FormField } from "../components/ui/index.js";
import type { TabItem } from "../components/ui/index.js";
import { useAuth } from "../auth/AuthContext.js";
import { useUiStore } from "../store/uiStore.js";
import { uploadDocument, extractDocument } from "../api/captureApi.js";
import type { ExtractionResult } from "../api/captureApi.js";
import { CaptureDropZone } from "../components/capture/CaptureDropZone.js";
import { FilePreview } from "../components/capture/FilePreview.js";
import { ExtractionResult as ExtractionResultPanel } from "../components/capture/ExtractionResult.js";
import { CaptureQueueDrawer } from "../components/capture/CaptureQueueDrawer.js";

// ─── Types (exported so drawer can reference) ─────────────────────────────────

export interface CaptureQueueEntry {
  id: string;
  title: string;
  channel: "SCAN" | "UPLOAD" | "BULK";
  status: "ready" | "uploading" | "extracting" | "done" | "error";
  frontFile: File | null;
  backFile: File | null;
  docId?: number;
  confidence?: number;
  extraction?: ExtractionResult;
  errorMsg?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const TABS: TabItem[] = [
  { key: "scanner", label: "Scanner" },
  { key: "upload", label: "File Upload" },
  { key: "bulk", label: "Bulk Upload" },
];

const STATUS_TAG: Record<
  CaptureQueueEntry["status"],
  { label: string; variant: "green" | "amber" | "blue" | "red" | "gold" }
> = {
  ready: { label: "Ready", variant: "gold" },
  uploading: { label: "Uploading…", variant: "amber" },
  extracting: { label: "Extracting…", variant: "blue" },
  done: { label: "Captured", variant: "green" },
  error: { label: "Error", variant: "red" },
};

// ─── Scanner tab — WIA/TWAIN config ──────────────────────────────────────────

function ScannerTab({
  frontFile,
  backFile,
  onFront,
  onBack,
}: {
  frontFile: File | null;
  backFile: File | null;
  onFront: (f: File) => void;
  onBack: (f: File) => void;
}) {
  const [scanDevice, setScanDevice] = useState("FUJITSU fi-8170 (WIA)");
  const [scanResolution, setScanResolution] = useState("300 DPI");
  const [scanColor, setScanColor] = useState("Color (24-bit)");

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <Card title="Scanner Configuration">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
            <FormField
              as="select"
              label="Scanner Device"
              value={scanDevice}
              onChange={(e) => setScanDevice((e.target as HTMLSelectElement).value)}
            >
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
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
            <FormField
              as="select"
              label="Resolution"
              value={scanResolution}
              onChange={(e) => setScanResolution((e.target as HTMLSelectElement).value)}
            >
              <option>150 DPI</option>
              <option>200 DPI</option>
              <option>300 DPI</option>
              <option>600 DPI</option>
            </FormField>
            <FormField
              as="select"
              label="Color Profile"
              value={scanColor}
              onChange={(e) => setScanColor((e.target as HTMLSelectElement).value)}
            >
              <option>Color (24-bit)</option>
              <option>Greyscale (8-bit)</option>
              <option>B&amp;W (1-bit)</option>
              <option>Auto</option>
            </FormField>
          </div>
          <div style={{ fontSize: 10, color: "var(--sil)", marginTop: 2, marginBottom: 8 }}>
            {scanDevice} · {scanResolution} · {scanColor}
          </div>
        </Card>

        {/* Front side drop zone */}
        <Card title="Front Side Capture">
          <CaptureDropZone
            label="Front Side — Drop or scan"
            onFiles={([f]) => f && onFront(f)}
            data-testid="scanner-front-zone"
          />
          {frontFile && (
            <div style={{ marginTop: 10 }}>
              <FilePreview file={frontFile} data-testid="scanner-front-preview" />
            </div>
          )}
        </Card>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {/* Back side drop zone */}
        <Card title="Back Side Capture">
          <CaptureDropZone
            label="Back Side — Drop or scan (optional)"
            onFiles={([f]) => f && onBack(f)}
            data-testid="scanner-back-zone"
          />
          {backFile && (
            <div style={{ marginTop: 10 }}>
              <FilePreview file={backFile} data-testid="scanner-back-preview" />
            </div>
          )}
        </Card>

        {/* Scanner status */}
        <Card title="Scanner Status">
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[
              { label: "Device", value: scanDevice },
              { label: "Protocol", value: "WIA 2.0" },
              { label: "Resolution", value: scanResolution },
              { label: "Color Mode", value: scanColor },
              { label: "Paper Feeder", value: "Ready (50 sheets)" },
              { label: "Connection", value: "USB 3.0 · Online" },
            ].map((row) => (
              <div
                key={row.label}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  padding: "7px 10px",
                  background: "var(--ink3)",
                  borderRadius: 6,
                  fontSize: 11,
                }}
              >
                <span style={{ color: "var(--sil)" }}>{row.label}</span>
                <span style={{ color: "var(--mist)" }}>{row.value}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

// ─── File Upload tab ──────────────────────────────────────────────────────────

function FileUploadTab({
  frontFile,
  backFile,
  onFront,
  onBack,
}: {
  frontFile: File | null;
  backFile: File | null;
  onFront: (f: File) => void;
  onBack: (f: File) => void;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
      <Card title="Front Side">
        <CaptureDropZone
          label="Front Side — Drop or click to select"
          onFiles={([f]) => f && onFront(f)}
          data-testid="upload-front-zone"
        />
        {frontFile && (
          <div style={{ marginTop: 10 }}>
            <FilePreview file={frontFile} data-testid="upload-front-preview" />
          </div>
        )}
      </Card>

      <Card title="Back Side">
        <CaptureDropZone
          label="Back Side — Drop or click to select (optional)"
          onFiles={([f]) => f && onBack(f)}
          data-testid="upload-back-zone"
        />
        {backFile && (
          <div style={{ marginTop: 10 }}>
            <FilePreview file={backFile} data-testid="upload-back-preview" />
          </div>
        )}
      </Card>
    </div>
  );
}

// ─── Bulk Upload tab ──────────────────────────────────────────────────────────

function BulkUploadTab({
  bulkFiles,
  onFiles,
}: {
  bulkFiles: File[];
  onFiles: (files: File[]) => void;
}) {
  return (
    <Card title="Bulk Upload">
      <CaptureDropZone
        label="Drop multiple files or click to select (ZIP, PDFs, images)"
        multiple
        onFiles={onFiles}
        data-testid="bulk-zone"
      />
      {bulkFiles.length > 0 && (
        <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
          {bulkFiles.map((f, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "7px 10px",
                background: "var(--ink3)",
                borderRadius: 6,
                fontSize: 11,
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--sil)" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              <span style={{ flex: 1, color: "var(--mist)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {f.name}
              </span>
              <span style={{ color: "var(--sil)" }}>{(f.size / 1024).toFixed(0)} KB</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ═══════════════════════════════ MAIN COMPONENT ═══════════════════════════════

export default function Capture() {
  const { user } = useAuth();
  const canCapture = user?.permissions?.includes("document:capture") ?? false;

  const { captureDrawerOpen, setCaptureDrawerOpen, toggleCaptureDrawer } = useUiStore();

  // ── Tab state ──
  const [tab, setTab] = useState<"scanner" | "upload" | "bulk">("upload");

  // ── Front/Back file slots ──
  const [frontFile, setFrontFile] = useState<File | null>(null);
  const [backFile, setBackFile] = useState<File | null>(null);
  const [bulkFiles, setBulkFiles] = useState<File[]>([]);

  // ── Proceed/processing state ──
  const [processing, setProcessing] = useState(false);
  const [processingMsg, setProcessingMsg] = useState("");
  const [procError, setProcError] = useState<string | null>(null);
  const [currentExtraction, setCurrentExtraction] = useState<ExtractionResult | null>(null);

  // ── Capture queue ──
  const [queue, setQueue] = useState<CaptureQueueEntry[]>([]);
  const [selectedQueueId, setSelectedQueueId] = useState<string | null>(null);

  // ── Proceed modal (title / branch confirm) ──
  const [showProceedModal, setShowProceedModal] = useState(false);
  const [proceedTitle, setProceedTitle] = useState("");
  const [proceedBranch, setProceedBranch] = useState(user?.branch ?? "Thimphu");

  // ── Computed "has file" for Proceed button ──
  const hasFile = tab === "bulk" ? bulkFiles.length > 0 : frontFile !== null;

  // ── Clear per-tab slots when tab changes ──
  function handleTabChange(key: string) {
    setTab(key as "scanner" | "upload" | "bulk");
    setFrontFile(null);
    setBackFile(null);
    setBulkFiles([]);
    setCurrentExtraction(null);
    setProcError(null);
  }

  // ── Open modal to confirm title/branch before proceeding ──
  function openProceedModal() {
    const name = frontFile
      ? frontFile.name.replace(/\.[^.]+$/, "")
      : bulkFiles[0]?.name.replace(/\.[^.]+$/, "") ?? "Untitled";
    setProceedTitle(name);
    setProceedBranch(user?.branch ?? "Thimphu");
    setShowProceedModal(true);
  }

  // ── Core proceed flow ──
  const handleProceed = useCallback(async () => {
    setShowProceedModal(false);

    const channel: CaptureQueueEntry["channel"] =
      tab === "scanner" ? "SCAN" : tab === "bulk" ? "BULK" : "UPLOAD";

    if (tab === "bulk") {
      // Bulk: upload all files independently
      const entries: CaptureQueueEntry[] = bulkFiles.map((f) => ({
        id: `${Date.now()}-${f.name}`,
        title: f.name.replace(/\.[^.]+$/, ""),
        channel: "BULK",
        status: "uploading",
        frontFile: f,
        backFile: null,
      }));
      setQueue((q) => [...q, ...entries]);
      setProcessing(true);
      setProcessingMsg("Uploading bulk files…");

      await Promise.all(
        entries.map(async (entry) => {
          try {
            const { document: doc } = await uploadDocument(entry.frontFile!, {
              title: entry.title,
              branch: proceedBranch,
              source_channel: "BULK",
            });
            setQueue((q) =>
              q.map((i) =>
                i.id === entry.id ? { ...i, status: "extracting", docId: doc.id } : i
              )
            );
            const extraction = await extractDocument(doc.id);
            setQueue((q) =>
              q.map((i) =>
                i.id === entry.id
                  ? {
                      ...i,
                      status: "done",
                      extraction,
                      confidence: extraction.classification.confidence,
                    }
                  : i
              )
            );
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Upload failed";
            setQueue((q) =>
              q.map((i) => (i.id === entry.id ? { ...i, status: "error", errorMsg: msg } : i))
            );
          }
        })
      );
      setBulkFiles([]);
      setProcessing(false);
      setProcessingMsg("");
      return;
    }

    // Single (scanner / upload) — upload front, optionally back
    const queueId = `${Date.now()}-${proceedTitle}`;
    const entry: CaptureQueueEntry = {
      id: queueId,
      title: proceedTitle,
      channel,
      status: "uploading",
      frontFile,
      backFile,
    };
    setQueue((q) => [...q, entry]);
    setProcessing(true);
    setProcError(null);
    setCurrentExtraction(null);

    try {
      setProcessingMsg("Uploading document…");
      const { document: doc } = await uploadDocument(frontFile!, {
        title: proceedTitle,
        branch: proceedBranch,
        source_channel: channel,
      });

      setQueue((q) =>
        q.map((i) => (i.id === queueId ? { ...i, status: "extracting", docId: doc.id } : i))
      );
      setProcessingMsg("AI extraction in progress…");

      const extraction = await extractDocument(doc.id);

      setCurrentExtraction(extraction);
      setQueue((q) =>
        q.map((i) =>
          i.id === queueId
            ? {
                ...i,
                status: "done",
                extraction,
                confidence: extraction.classification.confidence,
              }
            : i
        )
      );

      // Auto-open drawer and select the new item
      setSelectedQueueId(queueId);
      setCaptureDrawerOpen(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Capture failed";
      setProcError(msg);
      setQueue((q) =>
        q.map((i) => (i.id === queueId ? { ...i, status: "error", errorMsg: msg } : i))
      );
    } finally {
      setProcessing(false);
      setProcessingMsg("");
    }
  }, [
    tab,
    frontFile,
    backFile,
    bulkFiles,
    proceedTitle,
    proceedBranch,
    setCaptureDrawerOpen,
  ]);

  // ── RBAC gate ──
  if (!canCapture) {
    return (
      <div className="fade-up">
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            minHeight: 300,
            gap: 12,
          }}
        >
          <div style={{ fontSize: 40, opacity: 0.4 }}>🔒</div>
          <h3 style={{ color: "var(--R)", margin: 0 }}>Access Denied</h3>
          <p style={{ color: "var(--sil)", fontSize: 13 }}>
            You do not have the <code>document:capture</code> permission.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="fade-up" style={{ paddingBottom: 80 }}>
      {/* ── Page Header ── */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          marginBottom: 20,
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h2
            className="serif"
            style={{ fontSize: 24, fontWeight: 700, color: "var(--gold3)", lineHeight: 1, margin: 0 }}
          >
            Document Capture
          </h2>
          <p style={{ fontSize: 11, color: "var(--sil)", marginTop: 4, marginBottom: 0 }}>
            Scanner · File Upload · Bulk Upload — AI auto-classification &amp; extraction
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Tag variant="green">{queue.filter((i) => i.status === "done").length} Captured</Tag>
          <Tag variant="amber">{queue.filter((i) => i.status === "ready" || i.status === "uploading" || i.status === "extracting").length} In Progress</Tag>
        </div>
      </div>

      {/* ── Channel Tabs ── */}
      <Tabs items={TABS} active={tab} onChange={handleTabChange} />

      {/* ── Tab Content ── */}
      <div style={{ marginTop: 14 }}>
        {tab === "scanner" && (
          <ScannerTab
            frontFile={frontFile}
            backFile={backFile}
            onFront={setFrontFile}
            onBack={setBackFile}
          />
        )}
        {tab === "upload" && (
          <FileUploadTab
            frontFile={frontFile}
            backFile={backFile}
            onFront={setFrontFile}
            onBack={setBackFile}
          />
        )}
        {tab === "bulk" && (
          <BulkUploadTab bulkFiles={bulkFiles} onFiles={setBulkFiles} />
        )}
      </div>

      {/* ── Proceed Button ── */}
      {hasFile && !processing && (
        <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            aria-label="Proceed to upload and extract"
            onClick={openProceedModal}
            style={{
              padding: "11px 28px",
              background: "linear-gradient(135deg,#b8912a,#f0c84a)",
              border: "none",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 700,
              cursor: "pointer",
              color: "#050d1a",
              boxShadow: "0 4px 16px rgba(184,145,42,.3)",
            }}
          >
            ▶ Proceed
          </button>
        </div>
      )}

      {/* ── Processing indicator ── */}
      {processing && (
        <div
          style={{
            marginTop: 16,
            display: "flex",
            alignItems: "center",
            gap: 12,
            background: "var(--ink3)",
            border: "1px solid var(--bd)",
            borderRadius: 10,
            padding: "14px 18px",
          }}
        >
          <div
            style={{
              width: 20,
              height: 20,
              border: "3px solid rgba(184,145,42,.3)",
              borderTopColor: "var(--gold3)",
              borderRadius: "50%",
              animation: "spin 1s linear infinite",
            }}
          />
          <div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--mist)" }}>Processing…</div>
            <div style={{ fontSize: 11, color: "var(--sil)", marginTop: 2 }}>{processingMsg}</div>
          </div>
        </div>
      )}

      {/* ── Error state ── */}
      {procError && (
        <div
          role="alert"
          style={{
            marginTop: 16,
            background: "rgba(255,80,80,.07)",
            border: "1px solid rgba(255,80,80,.3)",
            borderRadius: 10,
            padding: "12px 16px",
            fontSize: 12,
            color: "var(--R)",
          }}
        >
          <strong>Capture failed:</strong> {procError}
        </div>
      )}

      {/* ── Extraction result inline ── */}
      {currentExtraction && !processing && (
        <div style={{ marginTop: 20 }}>
          <ExtractionResultPanel result={currentExtraction} />
        </div>
      )}

      {/* ── Compact queue list ── */}
      {queue.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <Card
            title={<span>Capture Queue <Tag variant="gold">{queue.length} items</Tag></span>}
            action={
              <button
                type="button"
                onClick={() => setQueue((q) => q.filter((i) => i.status !== "done" && i.status !== "error"))}
                style={{
                  padding: "4px 10px",
                  background: "var(--ink3)",
                  border: "1px solid var(--bd)",
                  borderRadius: 5,
                  fontSize: 10,
                  color: "var(--sil)",
                  cursor: "pointer",
                }}
              >
                Clear done
              </button>
            }
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {queue.map((item) => {
                const s = STATUS_TAG[item.status];
                return (
                  <div
                    key={item.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`Queue item: ${item.title}`}
                    onClick={() => {
                      setSelectedQueueId(item.id);
                      setCaptureDrawerOpen(true);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        setSelectedQueueId(item.id);
                        setCaptureDrawerOpen(true);
                      }
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "8px 10px",
                      background: "var(--ink3)",
                      borderRadius: 7,
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 12, color: "var(--mist)", fontWeight: 600 }}>{item.title}</div>
                      <div style={{ fontSize: 10, color: "var(--sil)", marginTop: 1 }}>
                        {item.channel}
                        {item.confidence != null && ` · AI: ${Math.round(item.confidence * 100)}%`}
                      </div>
                    </div>
                    <Tag variant={s.variant} style={{ fontSize: 10 }}>{s.label}</Tag>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      )}

      {/* ── Proceed modal ── */}
      <Modal open={showProceedModal} onClose={() => setShowProceedModal(false)} title="Confirm Capture">
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 12, color: "var(--sil)" }}>
            {tab === "bulk"
              ? `${bulkFiles.length} file${bulkFiles.length !== 1 ? "s" : ""} will be uploaded and AI-extracted.`
              : `Uploading ${frontFile?.name ?? ""}${backFile ? ` + ${backFile.name}` : ""}`}
          </div>
          {tab !== "bulk" && (
            <FormField
              label="Document Title *"
              placeholder="e.g. Passport — Sonam Dorji"
              value={proceedTitle}
              onChange={(e) => setProceedTitle((e.target as HTMLInputElement).value)}
            />
          )}
          <FormField
            as="select"
            label="Branch"
            value={proceedBranch}
            onChange={(e) => setProceedBranch((e.target as HTMLSelectElement).value)}
          >
            <option>Thimphu</option>
            <option>Phuentsholing</option>
            <option>Gelephu</option>
            <option>Bumthang</option>
            <option>Mongar</option>
            <option>Trashigang</option>
          </FormField>
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button
              type="button"
              aria-label="Confirm and proceed"
              onClick={handleProceed}
              style={{
                flex: 1,
                padding: "10px 14px",
                background: "linear-gradient(135deg,#b8912a,#f0c84a)",
                border: "none",
                borderRadius: 7,
                fontSize: 12,
                fontWeight: 700,
                cursor: "pointer",
                color: "#050d1a",
              }}
            >
              Confirm &amp; Proceed
            </button>
            <button
              type="button"
              onClick={() => setShowProceedModal(false)}
              style={{
                padding: "10px 14px",
                background: "var(--ink3)",
                border: "1px solid var(--bd)",
                borderRadius: 7,
                fontSize: 12,
                color: "var(--mist)",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Capture Queue Drawer ── */}
      <CaptureQueueDrawer
        open={captureDrawerOpen}
        onClose={() => setCaptureDrawerOpen(false)}
        queue={queue}
        selectedId={selectedQueueId}
        onSelect={setSelectedQueueId}
      />

      {/* ── Floating Action Button ── */}
      <button
        type="button"
        aria-label="Toggle capture queue drawer"
        onClick={toggleCaptureDrawer}
        style={{
          position: "fixed",
          bottom: 28,
          right: 28,
          width: 52,
          height: 52,
          borderRadius: "50%",
          background: "linear-gradient(135deg,#b8912a,#f0c84a)",
          border: "none",
          cursor: "pointer",
          boxShadow: "0 4px 20px rgba(184,145,42,.4)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 150,
        }}
      >
        <span style={{ position: "relative", fontSize: 20, color: "#050d1a", lineHeight: 1 }}>
          ☰
          {queue.length > 0 && (
            <span
              style={{
                position: "absolute",
                top: -6,
                right: -8,
                background: "var(--R)",
                color: "#fff",
                borderRadius: "50%",
                width: 16,
                height: 16,
                fontSize: 9,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontWeight: 700,
              }}
            >
              {queue.length > 99 ? "99+" : queue.length}
            </span>
          )}
        </span>
      </button>
    </div>
  );
}
