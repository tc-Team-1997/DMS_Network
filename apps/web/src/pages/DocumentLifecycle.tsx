import { useEffect, useState, useCallback, useRef } from "react";
import { useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.js";
import {
  KpiCard, Card, DataTable, Tag, Tabs, BarChartCard,
} from "../components/ui/index.js";
import type { Column } from "../components/ui/index.js";
import { documentLifecycleApi } from "../api/documentLifecycle.js";
import type {
  LifecycleTrace,
  LifecycleStage,
  LifecycleVersion,
  DocumentSummary,
} from "../api/documentLifecycle.js";

/* ─── helpers ─── */
const STAGE_COLORS: Record<string, string> = {
  capture:  "var(--B)",
  index:    "var(--W)",
  workflow: "var(--P)",
  archive:  "var(--G)",
  disposal: "var(--R)",
};

const STAGE_BG: Record<string, string> = {
  capture:  "var(--BT)",
  index:    "var(--WT)",
  workflow: "var(--PT)",
  archive:  "var(--GT)",
  disposal: "var(--RT)",
};

const STAGE_LABELS: Record<string, string> = {
  capture:  "Capture",
  index:    "Indexing",
  workflow: "Workflow",
  archive:  "Archive",
  disposal: "Disposal",
};

function docStatusVariant(s: string): "green" | "amber" | "red" | "blue" | "purple" | "gold" {
  if (s === "Indexed" || s === "Approved" || s === "Archived") return "green";
  if (s === "Disposed") return "red";
  if (s === "Captured") return "blue";
  return "amber";
}

const TABS = [
  { key: "trace", label: "Lifecycle Trace" },
  { key: "funnel", label: "Pipeline Funnel" },
  { key: "versions", label: "Version Control" },
  { key: "browse", label: "Browse Documents" },
];

type VersionRow = LifecycleVersion & { _key: string };
type DocRow = DocumentSummary & { _key: string };

export function DocumentLifecycle() {
  /* Router params: optional — if ?docId is provided we load that trace directly */
  const params = useParams<{ docId?: string }>();
  const { user } = useAuth();
  const canRead = Boolean(user?.permissions.includes("document:read"));

  const [tab, setTab] = useState("trace");
  const [trace, setTrace] = useState<LifecycleTrace | null>(null);
  const [docList, setDocList] = useState<DocRow[]>([]);
  const [searchQ, setSearchQ] = useState("");
  const [trackInput, setTrackInput] = useState(params.docId ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTrace = useCallback(async (id: string | number) => {
    if (!canRead || !id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await documentLifecycleApi.getTrace(id);
      setTrace(res.trace);
      setTab("trace");
    } catch (e: any) {
      setError(String(e?.message ?? "Document not found"));
      setTrace(null);
    } finally {
      setLoading(false);
    }
  }, [canRead]);

  const loadDocList = useCallback(async (q?: string) => {
    if (!canRead) return;
    try {
      const res = await documentLifecycleApi.searchDocuments(q);
      setDocList(res.documents.map((d) => ({ ...d, _key: String(d.id) })));
    } catch { /* ignore */ }
  }, [canRead]);

  /* Auto-load if docId in route */
  const didInit = useRef(false);
  useEffect(() => {
    if (didInit.current) return;
    didInit.current = true;
    if (params.docId) {
      loadTrace(params.docId);
    } else {
      loadDocList();
    }
  }, [params.docId, loadTrace, loadDocList]);

  if (!canRead) {
    return (
      <div className="fade-up">
        <div className="page-header">
          <div>
            <h2 className="serif">Document Lifecycle</h2>
            <p>You do not have permission to view this page.</p>
          </div>
        </div>
      </div>
    );
  }

  /* ─── Funnel bar chart data ─── */
  const funnelData = trace
    ? Object.entries(trace.funnel).map(([stage, count]) => ({
        stage: STAGE_LABELS[stage] ?? stage,
        count,
      }))
    : [];

  const maxFunnel = Math.max(1, ...funnelData.map((d) => d.count));

  /* ─── Version table columns ─── */
  const versionCols: Column<VersionRow>[] = [
    {
      key: "version_no", header: "Version", width: 90,
      render: (r) => <Tag variant="blue">v{r.version_no}</Tag>,
    },
    {
      key: "file_hash_sha256", header: "SHA-256 Hash",
      render: (r) => (
        <span className="mono" style={{ fontSize: 11, color: "var(--gold3)" }}>
          {r.file_hash_sha256.slice(0, 32)}…
        </span>
      ),
    },
    { key: "created_at", header: "Date", width: 140, sortable: true, render: (r) => <span style={{ fontSize: 11, color: "var(--sil)" }}>{r.created_at ? new Date(r.created_at).toLocaleString() : "—"}</span> },
    { key: "created_by", header: "Author", width: 100, render: (r) => <span style={{ fontSize: 11 }}>{r.created_by ?? "—"}</span> },
  ];

  /* ─── Doc browser columns ─── */
  const docCols: Column<DocRow>[] = [
    { key: "doc_no", header: "Doc No", width: 130, sortable: true, render: (r) => <span className="mono" style={{ fontSize: 11, color: "var(--gold3)" }}>{r.doc_no ?? String(r.id)}</span> },
    { key: "doc_type", header: "Type", sortable: true, render: (r) => <Tag variant="gold">{r.doc_type}</Tag> },
    { key: "status", header: "Status", width: 120, render: (r) => <Tag variant={docStatusVariant(r.status)}>{r.status}</Tag> },
    { key: "branch", header: "Branch", width: 120, render: (r) => <span style={{ color: "var(--B)", fontSize: 11 }}>{r.branch ?? "—"}</span> },
    { key: "created_at", header: "Created", width: 130, sortable: true, render: (r) => <span style={{ fontSize: 11, color: "var(--sil)" }}>{r.created_at ? new Date(r.created_at).toLocaleDateString() : "—"}</span> },
    {
      key: "_action", header: "",  width: 80,
      render: (r) => (
        <button className="btn bs xs" onClick={() => loadTrace(r.id)}>
          Trace
        </button>
      ),
    },
  ];

  const versionRows: VersionRow[] = (trace?.versions ?? []).map((v) => ({ ...v, _key: `v${v.version_no}` }));

  return (
    <div className="fade-up">
      {/* ── page header ── */}
      <div className="page-header">
        <div>
          <h2 className="serif">Document Lifecycle</h2>
          <p>End-to-end: Capture → Index → Classify → Approve → Archive → Dispose</p>
        </div>
        <div className="phr" style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input
            type="text"
            style={{ width: 200, fontSize: 12 }}
            placeholder="Track by doc ID or number…"
            value={trackInput}
            onChange={(e) => setTrackInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && trackInput) loadTrace(trackInput); }}
          />
          <button
            className="btn bg sm"
            onClick={() => { if (trackInput) loadTrace(trackInput); }}
            disabled={loading || !trackInput}
          >
            Track
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: "10px 14px", background: "var(--RT)", border: "1px solid rgba(224,82,82,.3)", borderRadius: 8, marginBottom: 14, fontSize: 12, color: "var(--R)" }}>
          {error}
        </div>
      )}

      {/* ── KPI row (from fetched trace) ── */}
      {trace && (
        <div className="g4" style={{ marginBottom: 18 }}>
          <KpiCard
            label="Document"
            value={trace.doc_no ?? String(trace.document_id)}
            sub={<span style={{ color: "var(--sil)" }}>{trace.doc_type}</span>}
            variant="gold"
          />
          <KpiCard
            label="Stages Complete"
            value={`${trace.stages.filter((s) => s.complete).length} / ${trace.stages.length}`}
            sub="End-to-end lifecycle stages"
            variant="blue"
          />
          <KpiCard
            label="Versions"
            value={trace.versions.length}
            sub="Hash-verified revision history"
            variant="green"
          />
          <KpiCard
            label="Pipeline — Captured"
            value={trace.funnel.capture.toLocaleString()}
            sub={`${trace.funnel.disposal.toLocaleString()} disposed`}
            variant="amber"
          />
        </div>
      )}

      {/* ── Pipeline funnel (always visible when trace loaded) ── */}
      {trace && (
        <Card title="Lifecycle Pipeline — Real-Time" style={{ marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "stretch", gap: 0, overflowX: "auto", padding: "4px 0" }}>
            {Object.entries(trace.funnel).map(([stage, count], idx, arr) => (
              <div key={stage} style={{ display: "flex", alignItems: "center" }}>
                <div style={{
                  minWidth: 110, padding: 12,
                  background: STAGE_BG[stage] ?? "rgba(255,255,255,.03)",
                  border: `1px solid ${STAGE_COLORS[stage] ?? "var(--bd)"}20`,
                  borderRadius: idx === 0 ? "8px 0 0 8px" : idx === arr.length - 1 ? "0 8px 8px 0" : 0,
                  textAlign: "center",
                }}>
                  <div style={{ fontSize: 9, letterSpacing: "1px", textTransform: "uppercase", color: STAGE_COLORS[stage], marginBottom: 6 }}>
                    {STAGE_LABELS[stage] ?? stage}
                  </div>
                  <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 24 }}>
                    {count.toLocaleString()}
                  </div>
                  <div style={{ fontSize: 10, color: "var(--sil)", marginTop: 2 }}>documents</div>
                </div>
                {idx < arr.length - 1 && (
                  <div style={{ color: "var(--sil)", padding: "0 4px", fontSize: 14 }}>▶</div>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── Tabs ── */}
      <Tabs items={TABS} active={tab} onChange={setTab} />

      {/* ═══ TRACE TAB ═══ */}
      {tab === "trace" && (
        <div style={{ marginTop: 14 }}>
          {loading && (
            <div style={{ padding: 40, textAlign: "center", color: "var(--sil)" }}>
              Loading lifecycle trace…
            </div>
          )}
          {!loading && !trace && (
            <Card>
              <div style={{ padding: 40, textAlign: "center", color: "var(--sil)" }}>
                Enter a document ID above or browse documents to load a lifecycle trace.
              </div>
            </Card>
          )}
          {!loading && trace && (
            <div className="g2">
              {/* stage timeline */}
              <Card title={`Lifecycle Trace — ${trace.doc_no ?? trace.document_id}`}>
                <div className="tl">
                  {trace.stages.map((stage: LifecycleStage) => (
                    <div key={stage.stage} className="tli">
                      <div className={`tld ${stage.complete ? "done" : "pend"}`} />
                      <div>
                        <div className="tlt" style={{ textTransform: "capitalize" }}>
                          {STAGE_LABELS[stage.stage] ?? stage.stage}
                          {stage.complete && <span style={{ color: "var(--G)", marginLeft: 8, fontSize: 11 }}>✓</span>}
                        </div>
                        <div className="tls">
                          {stage.complete
                            ? [stage.at && new Date(stage.at).toLocaleString(), stage.actor].filter(Boolean).join(" · ") || "Completed"
                            : "Pending"}
                          {stage.detail && <span style={{ marginLeft: 6, color: "var(--sil)" }}>— {stage.detail}</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>

              {/* right panel */}
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {/* stage progress */}
                <Card title="Stage Progress">
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {trace.stages.map((stage: LifecycleStage) => (
                      <div key={stage.stage} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ width: 80, fontSize: 11, color: "var(--sil)", flexShrink: 0, textTransform: "capitalize" }}>
                          {STAGE_LABELS[stage.stage] ?? stage.stage}
                        </span>
                        <div style={{
                          flex: 1, height: 6, borderRadius: 3,
                          background: stage.complete ? STAGE_COLORS[stage.stage] ?? "var(--G)" : "rgba(255,255,255,.07)",
                        }} />
                        <span style={{ fontSize: 11, color: stage.complete ? "var(--G)" : "var(--sil)", flexShrink: 0 }}>
                          {stage.complete ? "Done" : "Pending"}
                        </span>
                      </div>
                    ))}
                  </div>
                </Card>

                {/* metadata */}
                <Card title="Document Info">
                  <div style={{ fontSize: 11, display: "flex", flexDirection: "column", gap: 5 }}>
                    {[
                      { label: "Document ID", value: String(trace.document_id) },
                      { label: "Doc Number", value: trace.doc_no ?? "—" },
                      { label: "Type", value: trace.doc_type },
                      { label: "Versions", value: String(trace.versions.length) },
                    ].map((kv) => (
                      <div key={kv.label} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid rgba(255,255,255,.04)" }}>
                        <span style={{ color: "var(--sil)" }}>{kv.label}</span>
                        <span className={kv.label === "Document ID" ? "mono" : ""} style={{ color: kv.label === "Document ID" ? "var(--gold3)" : "inherit" }}>{kv.value}</span>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ FUNNEL TAB ═══ */}
      {tab === "funnel" && (
        <div style={{ marginTop: 14 }}>
          {trace ? (
            <div className="g2">
              <BarChartCard
                title="Corpus Pipeline Funnel"
                data={funnelData}
                xKey="stage"
                bars={[{ key: "count", color: "var(--gold2)", name: "Documents" }]}
                height={280}
              />
              <Card title="Funnel Breakdown">
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 4 }}>
                  {funnelData.map((d) => (
                    <div key={d.stage} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ width: 80, color: "var(--sil)", fontSize: 11, flexShrink: 0 }}>{d.stage}</span>
                      <div style={{
                        flex: 1, background: "var(--gr)", borderRadius: 4, height: 20, position: "relative",
                        overflow: "hidden",
                      }}>
                        <div style={{
                          height: "100%", borderRadius: 4,
                          width: `${(d.count / maxFunnel) * 100}%`,
                          background: "var(--gold2)",
                          transition: "width 0.6s ease",
                          minWidth: d.count > 0 ? 4 : 0,
                        }} />
                      </div>
                      <span style={{ fontSize: 11, color: "var(--mist)", fontWeight: 600, width: 60, textAlign: "right", flexShrink: 0 }}>
                        {d.count.toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          ) : (
            <Card>
              <div style={{ padding: 40, textAlign: "center", color: "var(--sil)" }}>
                Track a document to see its funnel data.
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ═══ VERSION CONTROL TAB ═══ */}
      {tab === "versions" && (
        <Card title="Version History" style={{ marginTop: 14 }}>
          {trace ? (
            <DataTable<VersionRow>
              columns={versionCols}
              rows={versionRows}
              rowKey={(r) => r._key}
              emptyMessage="No version history available"
            />
          ) : (
            <div style={{ padding: 40, textAlign: "center", color: "var(--sil)" }}>
              Track a document first.
            </div>
          )}
        </Card>
      )}

      {/* ═══ BROWSE TAB ═══ */}
      {tab === "browse" && (
        <div style={{ marginTop: 14 }}>
          <Card title="Document Search" style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
              <div className="field" style={{ flex: 1, margin: 0 }}>
                <label>Search</label>
                <input
                  type="text"
                  value={searchQ}
                  placeholder="Doc number, type, branch…"
                  onChange={(e) => setSearchQ(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") loadDocList(searchQ); }}
                />
              </div>
              <button className="btn bg sm" onClick={() => loadDocList(searchQ)}>Search</button>
              <button className="btn bs sm" onClick={() => { setSearchQ(""); loadDocList(); }}>Clear</button>
            </div>
          </Card>
          <Card title={`Documents (${docList.length})`}>
            <DataTable<DocRow>
              columns={docCols}
              rows={docList}
              rowKey={(r) => r._key}
              onRowClick={(r) => loadTrace(r.id)}
              emptyMessage="No documents found — try a search"
            />
          </Card>
        </div>
      )}
    </div>
  );
}

export default DocumentLifecycle;
