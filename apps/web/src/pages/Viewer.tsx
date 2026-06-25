import { useEffect, useState, useCallback, useRef } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { SVC } from "../config.js";
import { useUrlState } from "../hooks/useUrlState.js";
import {
  Card,
  Tag,
  Modal,
  FormField,
  StatusDot,
} from "../components/ui/index.js";
import { useAuth } from "../auth/AuthContext.js";
import { repositoryViewerApi } from "../api/repositoryViewerApi.js";
import type { DocumentRecord, Annotation, DocumentVersion } from "../api/repositoryViewerApi.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function annotationColor(kind: string): { bg: string; border: string; text: string } {
  if (kind === "highlight") return { bg: "rgba(240,220,60,.06)", border: "#e8d020", text: "#e8d020" };
  if (kind === "redaction") return { bg: "var(--RT)", border: "var(--R)", text: "var(--R)" };
  if (kind === "stamp") return { bg: "var(--PT)", border: "var(--P)", text: "var(--P)" };
  return { bg: "var(--BT)", border: "var(--B)", text: "var(--B)" };
}

function kindLabel(kind: string): string {
  if (kind === "highlight") return "Highlight";
  if (kind === "redaction") return "Redaction";
  if (kind === "stamp") return "Stamp";
  return "Note";
}

// ── Sub-Components ────────────────────────────────────────────────────────────

interface AnnotationOverlayProps {
  annotations: Annotation[];
  canvasWidth: number;
  canvasHeight: number;
  currentPage: number;
}

function AnnotationOverlay({ annotations, canvasWidth, canvasHeight, currentPage }: AnnotationOverlayProps) {
  const pageAnnotations = annotations.filter((a) => a.page === currentPage);
  return (
    <>
      {pageAnnotations.map((a) => {
        if (a.kind === "redaction") {
          return (
            <div
              key={a.id}
              style={{
                position: "absolute",
                left: (a.x / 100) * canvasWidth,
                top: (a.y / 100) * canvasHeight,
                width: (a.width / 100) * canvasWidth,
                height: (a.height / 100) * canvasHeight,
                background: "#1a1a1a",
                border: "2px solid var(--R)",
                borderRadius: 2,
              }}
              title="Redacted content"
            />
          );
        }
        if (a.kind === "highlight") {
          return (
            <div
              key={a.id}
              style={{
                position: "absolute",
                left: (a.x / 100) * canvasWidth,
                top: (a.y / 100) * canvasHeight,
                width: (a.width / 100) * canvasWidth,
                height: (a.height / 100) * canvasHeight,
                background: "rgba(240,220,60,.25)",
                border: "1px solid rgba(240,220,60,.5)",
                borderRadius: 2,
              }}
              title={a.content ?? "Highlight"}
            />
          );
        }
        if (a.kind === "stamp") {
          return (
            <div
              key={a.id}
              style={{
                position: "absolute",
                left: (a.x / 100) * canvasWidth,
                top: (a.y / 100) * canvasHeight,
                background: "var(--PT)",
                border: "1px solid rgba(155,111,224,.4)",
                borderRadius: 6,
                padding: "4px 8px",
                fontSize: 9,
                color: "var(--P)",
                fontWeight: 700,
                letterSpacing: 1,
                pointerEvents: "none",
              }}
            >
              {a.content ?? "STAMP"}
            </div>
          );
        }
        // note
        return (
          <div
            key={a.id}
            style={{
              position: "absolute",
              left: (a.x / 100) * canvasWidth,
              top: (a.y / 100) * canvasHeight,
              background: "var(--BT)",
              border: "1px solid rgba(58,159,208,.4)",
              borderRadius: 4,
              padding: "3px 7px",
              fontSize: 9,
              color: "var(--B)",
            }}
            title={a.content ?? "Note"}
          >
            {a.content ?? "Note"}
          </div>
        );
      })}
    </>
  );
}

interface MetadataPanelProps {
  doc: DocumentRecord;
  parsedMeta: Record<string, unknown>;
}

function MetadataPanel({ doc, parsedMeta }: MetadataPanelProps) {
  const rows: Array<[string, string]> = [
    ["Type", doc.doc_type ?? "—"],
    ["Branch", doc.branch ?? "—"],
    ["Format", doc.mime_type ?? "—"],
    ["Size", formatBytes(doc.file_size_bytes)],
    ["Pages", String(doc.page_count)],
    ["Version", `v${doc.current_version}.0`],
    ["Status", doc.status],
    ["Review Flag", doc.review_flag ? "Yes" : "No"],
    ["Source", doc.source_channel],
    ["Retention", doc.retention_years ? `${doc.retention_years} Years` : "—"],
    ["Destruction", doc.destruction_date ?? "—"],
    ["Legal Hold", "None"],
    ["Encryption", "AES-256"],
    ["SHA-256", doc.file_hash_sha256.slice(0, 12) + "…"],
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {rows.map(([label, value]) => (
        <div
          key={label}
          style={{
            display: "flex",
            justifyContent: "space-between",
            padding: "5px 0",
            borderBottom: "1px solid var(--bd)",
            fontSize: 11,
          }}
        >
          <span style={{ color: "var(--sil)" }}>{label}</span>
          <span
            style={{
              color: label === "Review Flag" && doc.review_flag ? "var(--W)"
                : label === "Status" && doc.status === "Active" ? "var(--G)"
                : "var(--mist)",
              fontFamily: label === "SHA-256" ? "monospace" : undefined,
              fontSize: label === "SHA-256" ? 9 : 11,
            }}
          >
            {value}
          </span>
        </div>
      ))}

      {/* Extracted metadata fields */}
      {Object.keys(parsedMeta).length > 0 && (
        <>
          <div style={{ fontSize: 10, color: "var(--gold)", marginTop: 10, marginBottom: 6, letterSpacing: 1, textTransform: "uppercase" }}>
            Extracted Fields
          </div>
          {Object.entries(parsedMeta).map(([k, v]) => (
            <div
              key={k}
              style={{
                display: "flex",
                justifyContent: "space-between",
                padding: "4px 0",
                borderBottom: "1px solid var(--line)",
                fontSize: 10,
              }}
            >
              <span style={{ color: "var(--sil)" }}>{k}</span>
              <span style={{ color: "var(--mist)" }}>{String(v)}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

// ── Main Viewer Screen ────────────────────────────────────────────────────────

// Pagination constant for annotations list (pattern 3)
const ANN_PAGE_SIZE = 5;

export default function Viewer() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const docIdParam = searchParams.get("doc");

  // Permissions
  const canAnnotate = user?.permissions.includes("annotation:write") ?? false;
  const canRead = user?.permissions.includes("document:read") ?? false;

  // Pattern 2: URL-driven page state — bookmarkable and refresh-safe
  const [viewerUrl, setViewerUrl] = useUrlState({ page: "1", annp: "1" });
  const currentPage = Math.max(1, Number(viewerUrl.page) || 1);
  const setCurrentPage = (p: number | ((prev: number) => number)) => {
    const next = typeof p === "function" ? p(currentPage) : p;
    setViewerUrl({ page: String(next) });
  };
  const annListPage = Math.max(1, Number(viewerUrl.annp) || 1);
  const setAnnListPage = (p: number) => setViewerUrl({ annp: String(p) });

  // State
  const [doc, setDoc] = useState<DocumentRecord | null>(null);
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [versions, setVersions] = useState<DocumentVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(100);

  // Annotation add modal
  const [annModalOpen, setAnnModalOpen] = useState(false);
  const [annKind, setAnnKind] = useState<"note" | "highlight" | "redaction" | "stamp">("redaction");
  const [annContent, setAnnContent] = useState("");
  const [annPage, setAnnPage] = useState(1);
  const [annX, setAnnX] = useState("10");
  const [annY, setAnnY] = useState("10");
  const [annW, setAnnW] = useState("20");
  const [annH, setAnnH] = useState("10");
  const [annError, setAnnError] = useState("");

  // Canvas ref for overlay sizing
  const canvasRef = useRef<HTMLDivElement>(null);
  const [canvasDims, setCanvasDims] = useState({ w: 600, h: 440 });

  useEffect(() => {
    const obs = new ResizeObserver((entries) => {
      const e = entries[0];
      if (e) setCanvasDims({ w: e.contentRect.width, h: e.contentRect.height });
    });
    if (canvasRef.current) obs.observe(canvasRef.current);
    return () => obs.disconnect();
  }, []);

  const docId = docIdParam ? Number(docIdParam) : null;

  const load = useCallback(async (id: number) => {
    setLoading(true);
    setError(null);
    try {
      const [docRes, annRes, verRes] = await Promise.all([
        repositoryViewerApi.getDocument(id),
        repositoryViewerApi.listAnnotations(id),
        repositoryViewerApi.listVersions(id),
      ]);
      setDoc(docRes.document);
      setAnnotations(annRes.annotations);
      setVersions(verRes.versions);
    } catch (e: unknown) {
      const err = e as { body?: { error?: string }; message?: string };
      setError(err?.body?.error ?? err?.message ?? "Failed to load document");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (docId) {
      load(docId);
    } else {
      setLoading(false);
    }
  }, [docId, load]);

  const parsedMeta: Record<string, unknown> = (() => {
    if (!doc?.metadata) return {};
    try { return JSON.parse(doc.metadata) as Record<string, unknown>; } catch { return {}; }
  })();

  async function handleAddAnnotation(e: React.FormEvent) {
    e.preventDefault();
    setAnnError("");
    if (!doc) return;
    try {
      await repositoryViewerApi.createAnnotation(doc.id, {
        kind: annKind,
        page: annPage,
        x: Number(annX),
        y: Number(annY),
        width: Number(annW),
        height: Number(annH),
        content: annContent || undefined,
      });
      const res = await repositoryViewerApi.listAnnotations(doc.id);
      setAnnotations(res.annotations);
      setAnnModalOpen(false);
      setAnnContent("");
    } catch (e: unknown) {
      const err2 = e as { body?: { error?: string }; message?: string };
      setAnnError(err2?.body?.error ?? err2?.message ?? "Failed to add annotation");
    }
  }

  async function handleDeleteAnnotation(annId: number) {
    if (!doc) return;
    if (!confirm("Delete this annotation?")) return;
    try {
      await repositoryViewerApi.deleteAnnotation(doc.id, annId);
      setAnnotations((prev) => prev.filter((a) => a.id !== annId));
    } catch (e: unknown) {
      const err3 = e as { body?: { error?: string } };
      alert(err3?.body?.error ?? "Delete annotation failed.");
    }
  }

  const totalPages = doc?.page_count ?? 1;

  // ── Render: Access denied — I4 fix: guard is first so no partial render leaks through ─────────

  if (!canRead) {
    return (
      <div className="fade-up" style={{ padding: 40, textAlign: "center" }}>
        <div style={{ color: "var(--R)", fontSize: 14, marginBottom: 8 }}>Access Denied</div>
        <div style={{ color: "var(--sil)", fontSize: 12 }}>You do not have permission to view documents.</div>
      </div>
    );
  }

  // ── Render: No document selected ─────────────────────────────────────────

  if (!docId && !loading) {
    return (
      <div className="fade-up">
        <div className="page-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 }}>
          <div>
            <h2 className="serif" style={{ fontSize: 24, color: "var(--gold3)" }}>Document Viewer</h2>
            <p style={{ fontSize: 11, color: "var(--sil)", marginTop: 3 }}>
              Annotation · Redaction · e-Signature (eIDAS) · Stamp · Version Compare · Collaboration
            </p>
          </div>
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: 320,
            background: "var(--ink2)",
            border: "1px solid var(--bd)",
            borderRadius: 10,
            color: "var(--sil)",
          }}
        >
          <div style={{ fontSize: 32, marginBottom: 12 }}>📄</div>
          <div style={{ fontSize: 13, marginBottom: 6, color: "var(--mist)" }}>No document selected</div>
          <div style={{ fontSize: 11 }}>Open a document from the Repository to view it here.</div>
          <button
            className="btn bs"
            style={{ marginTop: 16 }}
            onClick={() => navigate("/repository")}
          >
            Go to Repository
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fade-up">
      {/* Page Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <h2 className="serif" style={{ fontSize: 24, color: "var(--gold3)" }}>Document Viewer</h2>
          {doc && (
            <p style={{ fontSize: 13, color: "var(--mist)", marginTop: 2, fontWeight: 600 }}>{doc.title}</p>
          )}
          <p style={{ fontSize: 11, color: "var(--sil)", marginTop: 3 }}>
            Annotation · Redaction · e-Signature (eIDAS) · Stamp · Version Compare · Collaboration
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {doc && (
            <a
              href={`${SVC.core}/documents/${doc.id}/download`}
              className="btn bs sm"
              download={doc.original_filename ?? doc.title}
            >
              Download
            </a>
          )}
          <button className="btn bs sm" onClick={() => window.print()}>Print</button>
          <button className="btn bg sm" disabled title="Share — coming soon" aria-label="Share (not yet available)">Share</button>
        </div>
      </div>

      {/* Toolbar */}
      <Card style={{ padding: "10px 14px", marginBottom: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <button className="btn bs xs" onClick={() => setZoom((z) => Math.max(50, z - 25))}>⊖</button>
          <span style={{ fontSize: 10, color: "var(--sil)", minWidth: 40, textAlign: "center" }}>{zoom}%</span>
          <button className="btn bs xs" onClick={() => setZoom((z) => Math.min(200, z + 25))}>⊕</button>

          <div style={{ width: 1, height: 20, background: "var(--bd)", margin: "0 4px" }} />

          {canAnnotate && (
            <>
              <button
                className="btn xs"
                style={{ background: "rgba(240,220,60,.1)", color: "#e8d020", border: "1px solid rgba(240,220,60,.3)" }}
                onClick={() => { setAnnKind("highlight"); setAnnModalOpen(true); }}
                aria-label="Add Highlight"
              >
                ✏ Highlight
              </button>
              <button
                className="btn xs"
                style={{ background: "var(--RT)", color: "var(--R)", border: "1px solid rgba(224,82,82,.3)" }}
                onClick={() => { setAnnKind("redaction"); setAnnModalOpen(true); }}
                aria-label="add redaction"
              >
                🔒 Redact
              </button>
              <button
                className="btn xs"
                style={{ background: "var(--GT)", color: "var(--G)", border: "1px solid rgba(46,204,138,.3)" }}
                onClick={() => { setAnnKind("note"); setAnnModalOpen(true); }}
              >
                ✍ Annotate
              </button>
              <button
                className="btn xs"
                style={{ background: "var(--PT)", color: "var(--P)", border: "1px solid rgba(155,111,224,.3)" }}
                onClick={() => { setAnnKind("stamp"); setAnnModalOpen(true); }}
              >
                📋 Stamp
              </button>

              <div style={{ width: 1, height: 20, background: "var(--bd)", margin: "0 4px" }} />
            </>
          )}

          <button className="btn bs xs" disabled title="Compare Versions — coming soon" aria-label="Compare Versions (not yet available)">Compare Versions</button>
          <button className="btn bs xs" disabled title="Share View — coming soon" aria-label="Share View (not yet available)">Share View</button>

          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ fontSize: 11, color: "var(--sil)" }}>Page</span>
            <input
              type="number"
              value={currentPage}
              min={1}
              max={totalPages}
              onChange={(e) => setCurrentPage(Math.max(1, Math.min(totalPages, Number(e.target.value))))}
              style={{ width: 34, textAlign: "center", padding: 4, background: "rgba(15,23,42,.04)", border: "1px solid var(--bd)", borderRadius: 5, color: "var(--wh)", fontSize: 11 }}
            />
            <span style={{ fontSize: 11, color: "var(--sil)" }}>/ {totalPages}</span>
            <button className="btn bs xs" onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}>◀ Prev</button>
            <button className="btn bs xs" onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}>Next ▶</button>
          </div>
        </div>
      </Card>

      {error && (
        <div style={{ background: "var(--RT)", border: "1px solid rgba(224,82,82,.3)", borderRadius: 8, padding: "10px 14px", marginBottom: 12, fontSize: 12, color: "var(--R)" }}>
          {error}
        </div>
      )}

      {/* Main Content: 2fr 1fr */}
      <div className="g21">
        {/* Document Canvas */}
        <Card>
          <div
            ref={canvasRef}
            style={{
              background: "var(--gr)",
              border: "1px solid var(--bd)",
              borderRadius: 8,
              padding: 32,
              minHeight: 440,
              position: "relative",
              overflow: "hidden",
              transform: `scale(${zoom / 100})`,
              transformOrigin: "top left",
              width: `${10000 / zoom}%`,
            }}
          >
            {loading ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 380, color: "var(--sil)", fontSize: 12 }}>
                Loading document…
              </div>
            ) : doc ? (
              <div style={{ maxWidth: 480, margin: "0 auto", position: "relative" }}>
                {/* Document header mockup */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                  <div style={{ fontSize: 9, letterSpacing: 2, textTransform: "uppercase", color: "var(--gold)" }}>
                    ZORDMS · {doc.doc_type ?? "DOCUMENT RECORD"}
                  </div>
                  <div
                    style={{
                      background: doc.status === "Active" ? "var(--GT)" : "var(--WT)",
                      border: `1px solid ${doc.status === "Active" ? "rgba(46,204,138,.3)" : "rgba(240,160,48,.3)"}`,
                      borderRadius: 4,
                      padding: "2px 8px",
                      fontSize: 9,
                      color: doc.status === "Active" ? "var(--G)" : "var(--W)",
                    }}
                  >
                    {doc.status.toUpperCase()}
                  </div>
                </div>

                {/* Title */}
                <div style={{ height: 12, background: "rgba(15,23,42,.12)", borderRadius: 2, marginBottom: 8, width: "80%" }} />

                {/* Content lines */}
                {[100, 70, 90, 55, 85].map((w, i) => (
                  <div key={i} style={{ height: 9, background: "rgba(15,23,42,.07)", borderRadius: 2, marginBottom: 7, width: `${w}%` }} />
                ))}

                {/* Highlight overlay example */}
                {annotations.filter((a) => a.page === currentPage && a.kind === "highlight").length > 0 && (
                  <div style={{ padding: 10, background: "rgba(240,220,60,.06)", borderLeft: "3px solid #e8d020", borderRadius: "0 6px 6px 0", marginBottom: 12 }}>
                    <div style={{ fontSize: 9, color: "#e8d020", marginBottom: 4, letterSpacing: 1 }}>HIGHLIGHTED — REVIEWER NOTE</div>
                    <div style={{ height: 8, background: "rgba(240,220,60,.2)", borderRadius: 2, marginBottom: 5 }} />
                    <div style={{ height: 8, background: "rgba(240,220,60,.12)", borderRadius: 2, width: "70%" }} />
                  </div>
                )}

                {/* More content */}
                {[80, 65, 95].map((w, i) => (
                  <div key={i} style={{ height: 9, background: "rgba(15,23,42,.07)", borderRadius: 2, marginBottom: 7, width: `${w}%` }} />
                ))}

                {/* Redaction overlay example */}
                {annotations.filter((a) => a.page === currentPage && a.kind === "redaction").length > 0 && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                    <div style={{ fontSize: 10, color: "var(--sil)" }}>REDACTED:</div>
                    <div style={{ height: 12, width: 160, background: "#1a1a1a", borderRadius: 2 }} />
                  </div>
                )}

                {/* Stamp overlay */}
                {annotations.filter((a) => a.page === currentPage && a.kind === "stamp").map((a) => (
                  <div
                    key={a.id}
                    style={{
                      display: "inline-block",
                      background: "var(--PT)",
                      border: "1px solid rgba(155,111,224,.4)",
                      borderRadius: 6,
                      padding: "4px 10px",
                      fontSize: 9,
                      color: "var(--P)",
                      fontWeight: 700,
                      letterSpacing: 1,
                      marginBottom: 8,
                    }}
                  >
                    {a.content ?? "CONFIDENTIAL"}
                  </div>
                ))}

                {/* Digital signature mockup */}
                <div style={{ marginTop: 24, padding: 14, border: "1px dashed rgba(46,204,138,.4)", borderRadius: 8, display: "flex", alignItems: "center", gap: 12 }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--G)" strokeWidth="2">
                    <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                  </svg>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "var(--G)" }}>
                      Digitally Signed · {user?.username ?? "System"} · eIDAS
                    </div>
                    <div style={{ fontSize: 10, color: "var(--sil)" }}>
                      ZorDMS-2024 · ✓ Valid
                    </div>
                  </div>
                </div>

                {/* Page indicator */}
                <div style={{ position: "absolute", top: -20, right: 0, fontSize: 10, color: "var(--sil)" }}>
                  Page {currentPage} of {totalPages}
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 380, color: "var(--sil)", fontSize: 12 }}>
                Document not found
              </div>
            )}

            {/* Annotation overlay */}
            {doc && (
              <AnnotationOverlay
                annotations={annotations}
                canvasWidth={canvasDims.w}
                canvasHeight={canvasDims.h}
                currentPage={currentPage}
              />
            )}
          </div>
        </Card>

        {/* Right Panel */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Metadata */}
          {doc && (
            <Card title={<span style={{ display: "flex", alignItems: "center", gap: 8 }}>Document Metadata <StatusDot color={doc.status === "Active" ? "green" : "amber"} /></span>}>
              <MetadataPanel doc={doc} parsedMeta={parsedMeta} />
            </Card>
          )}

          {/* Annotations List — with simple pager (pattern 3) */}
          {(() => {
            const annTotalPages = Math.max(1, Math.ceil(annotations.length / ANN_PAGE_SIZE));
            const safeAnnPage = Math.min(Math.max(1, annListPage), annTotalPages);
            const pagedAnnotations = annotations.slice((safeAnnPage - 1) * ANN_PAGE_SIZE, safeAnnPage * ANN_PAGE_SIZE);
            return (
              <Card
                title={
                  <span>
                    Annotations{" "}
                    <Tag variant={annotations.length > 0 ? "blue" : "amber"}>
                      {annotations.length}
                    </Tag>
                  </span>
                }
                action={
                  canAnnotate && doc ? (
                    <button
                      className="btn bs xs"
                      onClick={() => setAnnModalOpen(true)}
                      aria-label="add annotation"
                    >
                      + Add
                    </button>
                  ) : undefined
                }
              >
                {annotations.length === 0 ? (
                  <div style={{ fontSize: 11, color: "var(--sil)", padding: "8px 0" }}>
                    No annotations yet.
                  </div>
                ) : (
                  <>
                    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                      {pagedAnnotations.map((a) => {
                        const c = annotationColor(a.kind);
                        return (
                          <div
                            key={a.id}
                            style={{
                              padding: 8,
                              background: c.bg,
                              borderRadius: 6,
                              borderLeft: `2px solid ${c.border}`,
                              cursor: "pointer",
                              position: "relative",
                            }}
                            onClick={() => setCurrentPage(a.page)}
                          >
                            <div style={{ fontSize: 10, color: c.text }}>{kindLabel(a.kind)} · Page {a.page}</div>
                            <div style={{ fontSize: 11, color: "var(--mist)", marginTop: 2 }}>
                              {a.content ?? `${kindLabel(a.kind)} applied`}
                            </div>
                            <div style={{ fontSize: 9, color: "var(--sil)", marginTop: 2 }}>
                              {a.created_by ?? "System"} · {a.created_at ? new Date(a.created_at).toLocaleDateString() : ""}
                            </div>
                            {canAnnotate && (
                              <button
                                onClick={(e) => { e.stopPropagation(); handleDeleteAnnotation(a.id); }}
                                style={{
                                  position: "absolute",
                                  top: 6,
                                  right: 6,
                                  background: "none",
                                  border: "none",
                                  color: "var(--sil)",
                                  cursor: "pointer",
                                  fontSize: 11,
                                  padding: 2,
                                }}
                                title="Delete annotation"
                              >
                                ×
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                    {annTotalPages > 1 && (
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, fontSize: 11 }}>
                        <button
                          className="btn bs xs"
                          disabled={safeAnnPage <= 1}
                          onClick={() => setAnnListPage(safeAnnPage - 1)}
                          aria-label="Previous annotation page"
                        >
                          Prev
                        </button>
                        <span style={{ color: "var(--sil)", flex: 1, textAlign: "center" }}>
                          {safeAnnPage} / {annTotalPages}
                        </span>
                        <button
                          className="btn bs xs"
                          disabled={safeAnnPage >= annTotalPages}
                          onClick={() => setAnnListPage(safeAnnPage + 1)}
                          aria-label="Next annotation page"
                        >
                          Next
                        </button>
                      </div>
                    )}
                  </>
                )}
              </Card>
            );
          })()}

          {/* Version History */}
          {versions.length > 0 && (
            <Card title="Version History">
              <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 11 }}>
                {[...versions].sort((a, b) => b.version_no - a.version_no).map((v) => {
                  const isCurrent = v.version_no === doc?.current_version;
                  return (
                    <div
                      key={v.id}
                      style={{
                        display: "flex",
                        gap: 8,
                        alignItems: "center",
                        padding: 7,
                        background: "var(--gr)",
                        borderRadius: 6,
                      }}
                    >
                      <Tag variant={isCurrent ? "green" : "blue"}>v{v.version_no}.0</Tag>
                      <div style={{ flex: 1 }}>
                        <div style={{ color: isCurrent ? "var(--mist)" : "var(--sil)" }}>
                          {v.comment ?? (isCurrent ? "Current version" : "Previous version")}
                        </div>
                        <div style={{ fontSize: 10, color: "var(--sil)" }}>
                          {v.created_at ? new Date(v.created_at).toLocaleDateString() : "—"}
                          {" · "}{v.created_by ?? "System"}
                        </div>
                      </div>
                      {doc && (
                        // C4 fix: label clarifies this downloads the *current* version,
                        // not the specific historical version (version-specific download
                        // endpoint not yet exposed by the backend).
                        <a
                          href={`${SVC.core}/documents/${doc.id}/download`}
                          className="btn bs xs"
                          style={{ fontSize: 9, textDecoration: "none" }}
                          target="_blank"
                          rel="noreferrer"
                          title={isCurrent ? "Download current version" : "Version-specific download not yet available — downloads current version"}
                          aria-label={isCurrent ? `Download current version v${v.version_no}` : `Download (current version, not v${v.version_no})`}
                        >
                          {isCurrent ? "Download" : "Download (current)"}
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {/* Collaborators — M3 fix: hardcoded initials removed;
              real collaborators API not yet available */}
          {doc && (
            <Card title="Collaborators">
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <span style={{ fontSize: 11, color: "var(--sil)" }}>
                  Collaborator data not yet available.
                </span>
                <button className="btn bs xs" style={{ marginLeft: "auto" }} disabled title="Invite collaborator — coming soon" aria-label="Invite collaborator (not yet available)">Invite</button>
              </div>
            </Card>
          )}
        </div>
      </div>

      {/* ── Add Annotation Modal ── */}
      <Modal
        open={annModalOpen}
        onClose={() => { setAnnModalOpen(false); setAnnError(""); }}
        title="Add Annotation"
        width={440}
      >
        <form onSubmit={handleAddAnnotation} style={{ padding: "4px 0" }}>
          <FormField
            as="select"
            label="Kind"
            value={annKind}
            onChange={(e) => setAnnKind((e.target as HTMLSelectElement).value as typeof annKind)}
          >
            <option value="highlight">Highlight</option>
            <option value="redaction">Redaction</option>
            <option value="note">Note</option>
            <option value="stamp">Stamp</option>
          </FormField>

          <FormField
            as="textarea"
            label="Content (optional)"
            placeholder="Note text, stamp label…"
            value={annContent}
            onChange={(e) => setAnnContent((e.target as HTMLTextAreaElement).value)}
            rows={2}
          />

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", gap: 8, marginBottom: 12 }}>
            {[
              ["Page", annPage, (v: string) => setAnnPage(Number(v)), "1"],
              ["X (%)", annX, setAnnX, "10"],
              ["Y (%)", annY, setAnnY, "10"],
              ["W (%)", annW, setAnnW, "20"],
              ["H (%)", annH, setAnnH, "10"],
            ].map(([label, val, setter, placeholder]) => (
              <div key={String(label)}>
                <label style={{ display: "block", fontSize: 10, color: "var(--sil)", marginBottom: 3 }}>{String(label)}</label>
                <input
                  type="number"
                  value={String(val)}
                  placeholder={String(placeholder)}
                  onChange={(e) => (setter as (v: string) => void)(e.target.value)}
                  style={{
                    background: "rgba(15,23,42,.03)",
                    border: "1px solid var(--bd)",
                    borderRadius: 6,
                    padding: "6px 8px",
                    fontSize: 11,
                    color: "var(--wh)",
                    width: "100%",
                  }}
                />
              </div>
            ))}
          </div>

          {annError && (
            <div style={{ fontSize: 11, color: "var(--R)", marginBottom: 10 }}>{annError}</div>
          )}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" className="btn bs" onClick={() => setAnnModalOpen(false)}>Cancel</button>
            <button type="submit" className="btn bg">Add Annotation</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
