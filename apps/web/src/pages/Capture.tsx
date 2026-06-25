/**
 * Capture.tsx — ZorDMS Multi-Channel Document Capture (Enterprise)
 *
 * Three tabs: Scanner | File Upload | Bulk Upload
 * Capture mode selector on Scanner + File Upload tabs: "Single Side" | "Front & Back".
 *   - Single Side: one file slot (front only).
 *   - Front & Back: two slots (Front + Back).
 * Default mode: Single Side. Bulk Upload is unchanged (multi-file only).
 * Proceed → POST /documents → POST /documents/:id/extract → editable result drawer.
 * Capture queue with drawer (FAB bottom-right, uiStore.captureDrawerOpen).
 * RBAC gate: document:capture.
 */
import { useState, useCallback, useEffect, useRef } from "react";
import { Card, Tag, Tabs, Modal, FormField } from "../components/ui/index.js";
import type { TabItem } from "../components/ui/index.js";
import { useAuth } from "../auth/AuthContext.js";
import { useUiStore } from "../store/uiStore.js";
import { uploadDocument, extractDocument, extractDocumentAsync } from "../api/captureApi.js";
import type { ExtractionResult } from "../api/captureApi.js";
import { getJob, isTerminalJobStatus } from "../api/jobsApi.js";
import type { JobStatus } from "../api/jobsApi.js";
import { CaptureDropZone } from "../components/capture/CaptureDropZone.js";
import { FilePreview } from "../components/capture/FilePreview.js";
import { ExtractionResult as ExtractionResultPanel } from "../components/capture/ExtractionResult.js";
import { CaptureQueueDrawer } from "../components/capture/CaptureQueueDrawer.js";

// ─── Types (exported so drawer can reference) ─────────────────────────────────

export interface CaptureQueueEntry {
  id: string;
  title: string;
  channel: "SCAN" | "UPLOAD" | "BULK";
  status:
    | "ready"
    | "uploading"
    | "extracting"
    | "queued"
    | "running"
    | "done"
    | "error"
    | "dead";
  frontFile: File | null;
  backFile: File | null;
  docId?: string;
  confidence?: number;
  extraction?: ExtractionResult;
  errorMsg?: string;
  /** P8 async: durable extraction job id (bulk / background path). */
  jobId?: string;
  /** P8 async: last polled job status (queued/running/succeeded/failed/dead). */
  jobStatus?: JobStatus;
  /** P8 async: retry attempts reported by the job. */
  attempts?: number;
}

/** Capture mode: single slot vs two-sided */
export type CaptureMode = "single" | "front-back";

// ─── Constants ────────────────────────────────────────────────────────────────

const TABS: TabItem[] = [
  { key: "scanner", label: "Scanner" },
  { key: "upload", label: "File Upload" },
  { key: "bulk", label: "Bulk Upload" },
];

const STATUS_TAG: Record<
  CaptureQueueEntry["status"],
  { label: string; variant: "green" | "amber" | "blue" | "red" | "gold" | "purple" }
> = {
  ready: { label: "Ready", variant: "gold" },
  uploading: { label: "Uploading…", variant: "amber" },
  extracting: { label: "Extracting…", variant: "blue" },
  queued: { label: "Queued", variant: "purple" },
  running: { label: "Running…", variant: "blue" },
  done: { label: "Captured", variant: "green" },
  error: { label: "Error", variant: "red" },
  dead: { label: "Dead-letter", variant: "red" },
};

/** Map a polled job status → capture queue entry status. */
function jobStatusToEntry(s: JobStatus): CaptureQueueEntry["status"] {
  switch (s) {
    case "queued":
      return "queued";
    case "running":
      return "running";
    case "succeeded":
      return "done";
    case "dead":
      return "dead";
    case "failed":
    default:
      return "error";
  }
}

/** Polling cadence + ceiling for background extraction jobs. */
const JOB_POLL_INTERVAL_MS = 1500;
const JOB_POLL_MAX_ATTEMPTS = 40; // ~60s safety ceiling

// ─── Mode Selector ────────────────────────────────────────────────────────────

function CaptureModeSelector({
  mode,
  onChange,
}: {
  mode: CaptureMode;
  onChange: (m: CaptureMode) => void;
}) {
  return (
    <div
      aria-label="Capture mode selector"
      style={{
        display: "flex",
        gap: 0,
        border: "1px solid var(--bd)",
        borderRadius: 8,
        overflow: "hidden",
        width: "fit-content",
        marginBottom: 14,
      }}
    >
      {(
        [
          { value: "single", label: "Single Side" },
          { value: "front-back", label: "Front & Back" },
        ] as const
      ).map(({ value, label }) => (
        <button
          key={value}
          type="button"
          aria-label={`${label} mode`}
          aria-pressed={mode === value}
          onClick={() => onChange(value)}
          style={{
            padding: "7px 18px",
            border: "none",
            borderRight: value === "single" ? "1px solid var(--bd)" : "none",
            background: mode === value ? "rgba(184,145,42,.15)" : "var(--ink3)",
            color: mode === value ? "var(--gold3)" : "var(--sil)",
            fontSize: 12,
            fontWeight: mode === value ? 700 : 400,
            cursor: "pointer",
            transition: "background .15s, color .15s",
          }}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// ─── Scanner tab — WIA/TWAIN config ──────────────────────────────────────────

function ScannerTab({
  mode,
  onModeChange,
  frontFile,
  backFile,
  onFront,
  onBack,
}: {
  mode: CaptureMode;
  onModeChange: (m: CaptureMode) => void;
  frontFile: File | null;
  backFile: File | null;
  onFront: (f: File) => void;
  onBack: (f: File) => void;
}) {
  const [scanDevice, setScanDevice] = useState("FUJITSU fi-8170 (WIA)");
  const [scanResolution, setScanResolution] = useState("300 DPI");
  const [scanColor, setScanColor] = useState("Color (24-bit)");

  return (
    <div>
      <CaptureModeSelector mode={mode} onChange={onModeChange} />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: mode === "front-back" ? "1fr 1fr" : "1fr",
          gap: 14,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Card title="Scanner Configuration">
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 10,
                marginBottom: 10,
              }}
            >
              <FormField
                as="select"
                label="Scanner Device"
                value={scanDevice}
                onChange={(e) =>
                  setScanDevice((e.target as HTMLSelectElement).value)
                }
              >
                <option>FUJITSU fi-8170 (WIA)</option>
                <option>Canon DR-G2110 (TWAIN)</option>
                <option>Kodak S3100 (ISIS)</option>
              </FormField>
              <FormField
                as="select"
                label="Protocol"
                value="WIA 2.0"
                onChange={() => {}}
              >
                <option>WIA 2.0</option>
                <option>TWAIN 2.4</option>
                <option>ISIS</option>
              </FormField>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 10,
                marginBottom: 10,
              }}
            >
              <FormField
                as="select"
                label="Resolution"
                value={scanResolution}
                onChange={(e) =>
                  setScanResolution((e.target as HTMLSelectElement).value)
                }
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
                onChange={(e) =>
                  setScanColor((e.target as HTMLSelectElement).value)
                }
              >
                <option>Color (24-bit)</option>
                <option>Greyscale (8-bit)</option>
                <option>B&amp;W (1-bit)</option>
                <option>Auto</option>
              </FormField>
            </div>
            <div
              style={{
                fontSize: 10,
                color: "var(--sil)",
                marginTop: 2,
                marginBottom: 8,
              }}
            >
              {scanDevice} · {scanResolution} · {scanColor}
            </div>
          </Card>

          {/* Front side drop zone — always visible */}
          <Card
            title={
              mode === "front-back" ? "Front Side Capture" : "Document Capture"
            }
          >
            <CaptureDropZone
              label={
                mode === "front-back"
                  ? "Front Side — Drop or scan"
                  : "Front Side — Drop or scan"
              }
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

        {/* Back side — only in Front & Back mode */}
        {mode === "front-back" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Card title="Back Side Capture">
              <CaptureDropZone
                label="Back Side — Drop or scan (optional)"
                onFiles={([f]) => f && onBack(f)}
                data-testid="scanner-back-zone"
              />
              {backFile && (
                <div style={{ marginTop: 10 }}>
                  <FilePreview
                    file={backFile}
                    data-testid="scanner-back-preview"
                  />
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
        )}

        {/* Scanner status in single mode (below front zone) */}
        {mode === "single" && (
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
        )}
      </div>
    </div>
  );
}

// ─── File Upload tab ──────────────────────────────────────────────────────────

function FileUploadTab({
  mode,
  onModeChange,
  frontFile,
  backFile,
  onFront,
  onBack,
}: {
  mode: CaptureMode;
  onModeChange: (m: CaptureMode) => void;
  frontFile: File | null;
  backFile: File | null;
  onFront: (f: File) => void;
  onBack: (f: File) => void;
}) {
  return (
    <div>
      <CaptureModeSelector mode={mode} onChange={onModeChange} />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: mode === "front-back" ? "1fr 1fr" : "1fr",
          gap: 14,
        }}
      >
        <Card title={mode === "front-back" ? "Front Side" : "Document"}>
          <CaptureDropZone
            label={
              mode === "front-back"
                ? "Front Side — Drop or click to select"
                : "Front Side — Drop or click to select"
            }
            onFiles={([f]) => f && onFront(f)}
            data-testid="upload-front-zone"
          />
          {frontFile && (
            <div style={{ marginTop: 10 }}>
              <FilePreview file={frontFile} data-testid="upload-front-preview" />
            </div>
          )}
        </Card>

        {mode === "front-back" && (
          <Card title="Back Side">
            <CaptureDropZone
              label="Back Side — Drop or click to select (optional)"
              onFiles={([f]) => f && onBack(f)}
              data-testid="upload-back-zone"
            />
            {backFile && (
              <div style={{ marginTop: 10 }}>
                <FilePreview
                  file={backFile}
                  data-testid="upload-back-preview"
                />
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}

// ─── Bulk Upload tab ──────────────────────────────────────────────────────────

function BulkUploadTab({
  bulkFiles,
  onFiles,
  background,
  onBackgroundChange,
}: {
  bulkFiles: File[];
  onFiles: (files: File[]) => void;
  background: boolean;
  onBackgroundChange: (v: boolean) => void;
}) {
  return (
    <Card title="Bulk Upload">
      <CaptureDropZone
        label="Drop multiple files or click to select (ZIP, PDFs, images)"
        multiple
        onFiles={onFiles}
        data-testid="bulk-zone"
      />

      {/* Background processing toggle — bulk extraction runs off the request path
          via the durable job queue, polled to completion. */}
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginTop: 12,
          padding: "9px 12px",
          background: "var(--ink3)",
          border: "1px solid var(--bd)",
          borderRadius: 7,
          cursor: "pointer",
          fontSize: 12,
        }}
      >
        <input
          type="checkbox"
          checked={background}
          aria-label="Process extraction in background"
          onChange={(e) => onBackgroundChange(e.target.checked)}
        />
        <span style={{ color: "var(--mist)", fontWeight: 600 }}>
          Process extraction in background
        </span>
        <span style={{ color: "var(--sil)", fontSize: 10 }}>
          Queues a durable job per document; status updates as it runs.
        </span>
      </label>
      {bulkFiles.length > 0 && (
        <div
          style={{
            marginTop: 12,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
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
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--sil)"
                strokeWidth="2"
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              <span
                style={{
                  flex: 1,
                  color: "var(--mist)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {f.name}
              </span>
              <span style={{ color: "var(--sil)" }}>
                {(f.size / 1024).toFixed(0)} KB
              </span>
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
  const canCapture =
    user?.permissions?.includes("document:capture") ?? false;

  const { captureDrawerOpen, setCaptureDrawerOpen, toggleCaptureDrawer } =
    useUiStore();

  // ── Tab state ──
  const [tab, setTab] = useState<"scanner" | "upload" | "bulk">("upload");

  // ── Capture mode (shared between scanner + upload tabs) ──
  const [captureMode, setCaptureMode] = useState<CaptureMode>("single");

  // ── Front/Back file slots ──
  const [frontFile, setFrontFile] = useState<File | null>(null);
  const [backFile, setBackFile] = useState<File | null>(null);
  const [bulkFiles, setBulkFiles] = useState<File[]>([]);

  // ── Bulk: process extraction in background via durable job queue (default on) ──
  const [bulkBackground, setBulkBackground] = useState(true);

  // ── Proceed/processing state ──
  const [processing, setProcessing] = useState(false);
  const [processingMsg, setProcessingMsg] = useState("");
  const [procError, setProcError] = useState<string | null>(null);
  const [currentExtraction, setCurrentExtraction] =
    useState<ExtractionResult | null>(null);

  // ── Capture queue ──
  const [queue, setQueue] = useState<CaptureQueueEntry[]>([]);
  const [selectedQueueId, setSelectedQueueId] = useState<string | null>(null);

  // ── Background job polling — track active timers so we can cancel on unmount ──
  const pollTimers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const timers = pollTimers.current;
    return () => {
      mountedRef.current = false;
      // Stop all in-flight polls on unmount (no leaks / no setState after unmount).
      for (const t of timers) clearTimeout(t);
      timers.clear();
    };
  }, []);

  /**
   * Poll GET /jobs/:id until a terminal status, reflecting queued → running →
   * succeeded/failed/dead onto the queue entry. Resolves when terminal or the
   * safety ceiling is reached. Never throws.
   */
  const pollJobToCompletion = useCallback(
    (entryId: string, jobId: string) =>
      new Promise<void>((resolve) => {
        let attempts = 0;

        const tick = async () => {
          if (!mountedRef.current) {
            resolve();
            return;
          }
          attempts += 1;
          try {
            const job = await getJob(jobId);
            if (!mountedRef.current) {
              resolve();
              return;
            }
            const entryStatus = jobStatusToEntry(job.status);
            setQueue((q) =>
              q.map((i) =>
                i.id === entryId
                  ? {
                      ...i,
                      status: entryStatus,
                      jobStatus: job.status,
                      attempts: job.attempts,
                      confidence:
                        job.status === "succeeded" &&
                        job.result &&
                        typeof (job.result as { confidence?: number }).confidence === "number"
                          ? (job.result as { confidence: number }).confidence
                          : i.confidence,
                      errorMsg:
                        job.status === "failed" || job.status === "dead"
                          ? job.last_error ?? "Extraction job failed"
                          : i.errorMsg,
                    }
                  : i,
              ),
            );

            // STOP polling on any terminal status.
            if (isTerminalJobStatus(job.status)) {
              resolve();
              return;
            }
          } catch (err) {
            // Transient poll error — surface on the entry but keep trying until
            // the ceiling so a flaky network doesn't kill an in-progress job.
            const msg = err instanceof Error ? err.message : "Job poll failed";
            setQueue((q) =>
              q.map((i) => (i.id === entryId ? { ...i, errorMsg: msg } : i)),
            );
          }

          if (attempts >= JOB_POLL_MAX_ATTEMPTS) {
            setQueue((q) =>
              q.map((i) =>
                i.id === entryId && i.status !== "done"
                  ? { ...i, status: "error", errorMsg: "Timed out waiting for extraction job." }
                  : i,
              ),
            );
            resolve();
            return;
          }

          const t = setTimeout(() => {
            pollTimers.current.delete(t);
            void tick();
          }, JOB_POLL_INTERVAL_MS);
          pollTimers.current.add(t);
        };

        void tick();
      }),
    [],
  );

  // ── Proceed modal (title / branch confirm) ──
  const [showProceedModal, setShowProceedModal] = useState(false);
  const [proceedTitle, setProceedTitle] = useState("");
  const [proceedBranch, setProceedBranch] = useState(
    user?.branch ?? "Thimphu"
  );

  // ── Computed "has file" for Proceed button ──
  const hasFile =
    tab === "bulk" ? bulkFiles.length > 0 : frontFile !== null;

  // ── Clear per-tab slots when tab changes ──
  function handleTabChange(key: string) {
    setTab(key as "scanner" | "upload" | "bulk");
    setFrontFile(null);
    setBackFile(null);
    setBulkFiles([]);
    setCurrentExtraction(null);
    setProcError(null);
    // Reset mode to single when switching tabs
    setCaptureMode("single");
  }

  // ── When mode changes to single, clear back file ──
  function handleModeChange(m: CaptureMode) {
    setCaptureMode(m);
    if (m === "single") setBackFile(null);
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

      const useBackground = bulkBackground;
      setProcessingMsg(
        useBackground
          ? "Uploading & queueing background extraction…"
          : "Uploading bulk files…",
      );

      await Promise.all(
        entries.map(async (entry) => {
          try {
            const { document: doc } = await uploadDocument(entry.frontFile!, {
              title: entry.title,
              branch: proceedBranch,
              source_channel: "BULK",
            });

            if (useBackground) {
              // ── Async path: enqueue a durable extraction job, then poll ──
              const { jobId } = await extractDocumentAsync(doc.id);
              setQueue((q) =>
                q.map((i) =>
                  i.id === entry.id
                    ? { ...i, status: "queued", docId: doc.id, jobId, jobStatus: "queued" }
                    : i,
                ),
              );
              // Poll GET /jobs/:id → reflects running → succeeded/failed/dead.
              await pollJobToCompletion(entry.id, jobId);
              return;
            }

            // ── Synchronous path (toggle off) ──
            setQueue((q) =>
              q.map((i) =>
                i.id === entry.id
                  ? { ...i, status: "extracting", docId: doc.id }
                  : i
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
            const msg =
              err instanceof Error ? err.message : "Upload failed";
            setQueue((q) =>
              q.map((i) =>
                i.id === entry.id ? { ...i, status: "error", errorMsg: msg } : i
              )
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
      backFile: captureMode === "front-back" ? backFile : null,
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
        q.map((i) =>
          i.id === queueId
            ? { ...i, status: "extracting", docId: doc.id }
            : i
        )
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
        q.map((i) =>
          i.id === queueId ? { ...i, status: "error", errorMsg: msg } : i
        )
      );
    } finally {
      setProcessing(false);
      setProcessingMsg("");
    }
  }, [
    tab,
    captureMode,
    frontFile,
    backFile,
    bulkFiles,
    bulkBackground,
    pollJobToCompletion,
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
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: "var(--gold3)",
              lineHeight: 1,
              margin: 0,
            }}
          >
            Document Capture
          </h2>
          <p
            style={{
              fontSize: 11,
              color: "var(--sil)",
              marginTop: 4,
              marginBottom: 0,
            }}
          >
            Scanner · File Upload · Bulk Upload — AI auto-classification &amp;
            extraction
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Tag variant="green">
            {queue.filter((i) => i.status === "done").length} Captured
          </Tag>
          <Tag variant="amber">
            {
              queue.filter(
                (i) =>
                  i.status === "ready" ||
                  i.status === "uploading" ||
                  i.status === "extracting" ||
                  i.status === "queued" ||
                  i.status === "running"
              ).length
            }{" "}
            In Progress
          </Tag>
        </div>
      </div>

      {/* ── Channel Tabs + Proceed (same row, button top-right) ── */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <Tabs items={TABS} active={tab} onChange={handleTabChange} />
        {!processing && (
          <button
            type="button"
            aria-label="Proceed to upload and extract"
            disabled={!hasFile}
            onClick={hasFile ? openProceedModal : undefined}
            style={{
              padding: "9px 24px",
              background: hasFile
                ? "linear-gradient(135deg,#b8912a,#f0c84a)"
                : "rgba(184,145,42,.25)",
              border: "none",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 700,
              cursor: hasFile ? "pointer" : "not-allowed",
              color: hasFile ? "#050d1a" : "rgba(5,13,26,.4)",
              boxShadow: hasFile ? "0 4px 16px rgba(184,145,42,.3)" : "none",
              opacity: hasFile ? 1 : 0.5,
            }}
          >
            ▶ Proceed
          </button>
        )}
      </div>

      {/* ── Tab Content ── */}
      <div style={{ marginTop: 14 }}>
        {tab === "scanner" && (
          <ScannerTab
            mode={captureMode}
            onModeChange={handleModeChange}
            frontFile={frontFile}
            backFile={backFile}
            onFront={setFrontFile}
            onBack={setBackFile}
          />
        )}
        {tab === "upload" && (
          <FileUploadTab
            mode={captureMode}
            onModeChange={handleModeChange}
            frontFile={frontFile}
            backFile={backFile}
            onFront={setFrontFile}
            onBack={setBackFile}
          />
        )}
        {tab === "bulk" && (
          <BulkUploadTab
            bulkFiles={bulkFiles}
            onFiles={setBulkFiles}
            background={bulkBackground}
            onBackgroundChange={setBulkBackground}
          />
        )}
      </div>


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
            <div
              style={{ fontSize: 13, fontWeight: 600, color: "var(--mist)" }}
            >
              Processing…
            </div>
            <div style={{ fontSize: 11, color: "var(--sil)", marginTop: 2 }}>
              {processingMsg}
            </div>
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

      {/* ── Extraction result inline (read-only summary) ── */}
      {currentExtraction && !processing && (
        <div style={{ marginTop: 20 }}>
          <ExtractionResultPanel result={currentExtraction} />
        </div>
      )}

      {/* ── Compact queue list ── */}
      {queue.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <Card
            title={
              <span>
                Capture Queue{" "}
                <Tag variant="gold">{queue.length} items</Tag>
              </span>
            }
            action={
              <button
                type="button"
                onClick={() =>
                  setQueue((q) =>
                    q.filter(
                      (i) =>
                        i.status !== "done" &&
                        i.status !== "error" &&
                        i.status !== "dead"
                    )
                  )
                }
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
                      <div
                        style={{
                          fontSize: 12,
                          color: "var(--mist)",
                          fontWeight: 600,
                        }}
                      >
                        {item.title}
                      </div>
                      <div
                        style={{
                          fontSize: 10,
                          color: "var(--sil)",
                          marginTop: 1,
                        }}
                      >
                        {item.channel}
                        {item.confidence != null &&
                          ` · AI: ${Math.round(item.confidence * 100)}%`}
                      </div>
                    </div>
                    <Tag variant={s.variant} style={{ fontSize: 10 }}>
                      {s.label}
                    </Tag>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      )}

      {/* ── Proceed modal ── */}
      <Modal
        open={showProceedModal}
        onClose={() => setShowProceedModal(false)}
        title="Confirm Capture"
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 12, color: "var(--sil)" }}>
            {tab === "bulk"
              ? `${bulkFiles.length} file${bulkFiles.length !== 1 ? "s" : ""} will be uploaded and AI-extracted${
                  bulkBackground ? " in the background (queued job per document)." : "."
                }`
              : `Uploading ${frontFile?.name ?? ""}${
                  captureMode === "front-back" && backFile
                    ? ` + ${backFile.name}`
                    : ""
                }`}
          </div>
          {tab !== "bulk" && (
            <FormField
              label="Document Title *"
              placeholder="e.g. Passport — Sonam Dorji"
              value={proceedTitle}
              onChange={(e) =>
                setProceedTitle((e.target as HTMLInputElement).value)
              }
            />
          )}
          <FormField
            as="select"
            label="Branch"
            value={proceedBranch}
            onChange={(e) =>
              setProceedBranch((e.target as HTMLSelectElement).value)
            }
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
        <span
          style={{
            position: "relative",
            fontSize: 20,
            color: "#050d1a",
            lineHeight: 1,
          }}
        >
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
