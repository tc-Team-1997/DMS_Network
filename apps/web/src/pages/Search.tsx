import { useState, useCallback, useRef, useEffect } from "react";
import { Search as SearchIcon, Filter, Bookmark, BookmarkCheck, Download, ChevronDown, ChevronUp, Clock, BarChart2, Zap } from "lucide-react";
import {
  KpiCard,
  Card,
  DataTable,
  Tag,
  Tabs,
  Modal,
  FormField,
  DonutChartCard,
  BarChartCard,
} from "../components/ui/index.js";
import { useAuth } from "../auth/AuthContext.js";
import {
  searchApi,
  type SearchHit,
  type SearchMode,
  type SearchFilters,
  type SearchResults,
  type SavedSearch,
} from "../api/searchApi.js";

// ─── Types ───────────────────────────────────────────────────────────────────

type SortMode = "relevance" | "recent";

interface FacetItem { value: string; count: number; }

// ─── Helpers ─────────────────────────────────────────────────────────────────

function levelTag(status: string) {
  if (status === "approved") return <Tag variant="green">{status}</Tag>;
  if (status === "pending")  return <Tag variant="amber">{status}</Tag>;
  if (status === "rejected") return <Tag variant="red">{status}</Tag>;
  return <Tag variant="blue">{status}</Tag>;
}

function riskTag(risk: string) {
  if (risk === "high")   return <Tag variant="red">High Risk</Tag>;
  if (risk === "medium") return <Tag variant="amber">Medium</Tag>;
  return <Tag variant="green">Low Risk</Tag>;
}

function modeLabel(m: SearchMode): string {
  const MAP: Record<SearchMode, string> = {
    fulltext: "Full Text",
    boolean:  "Boolean",
    wildcard: "Wildcard",
    fuzzy:    "Fuzzy",
    semantic: "Semantic AI",
  };
  return MAP[m] ?? m;
}

function formatMs(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(2)} s`;
}

function buildFacetDonut(items: FacetItem[] | undefined) {
  if (!items?.length) return [];
  const top = items.slice(0, 6);
  return top.map((f, i) => ({
    name: f.value,
    value: f.count,
    color: ["var(--gold2)", "var(--B)", "var(--G)", "var(--P)", "var(--W)", "var(--R)"][i % 6],
  }));
}

const EMPTY_RESULTS: SearchResults = {
  hits: [], total: 0, page: 1, pageSize: 20, tookMs: 0, facets: {},
};

const SEARCH_MODES: SearchMode[] = ["fulltext", "boolean", "wildcard", "fuzzy", "semantic"];

// ─── Sub-component: Facet Panel ──────────────────────────────────────────────

function FacetPanel({
  facets,
  filters,
  onFilterChange,
}: {
  facets: Record<string, FacetItem[]>;
  filters: SearchFilters;
  onFilterChange: (f: SearchFilters) => void;
}) {
  const dims: Array<{ key: keyof SearchFilters; label: string }> = [
    { key: "doc_type",      label: "Document Type" },
    { key: "branch",        label: "Branch" },
    { key: "status",        label: "Status" },
    { key: "risk_band",     label: "Risk Band" },
    { key: "expiry_status", label: "Expiry" },
  ];

  return (
    <Card title="Filter by" className="facet-panel" style={{ minWidth: 200 }}>
      {dims.map(({ key, label }) => {
        const items = facets[key] ?? [];
        if (!items.length) return null;
        const current = filters[key] as string | undefined;
        return (
          <div key={key} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: "var(--sil)", marginBottom: 6, letterSpacing: ".4px", textTransform: "uppercase" }}>
              {label}
            </div>
            {items.slice(0, 8).map((f) => (
              <div
                key={f.value}
                onClick={() =>
                  onFilterChange({
                    ...filters,
                    [key]: current === f.value ? undefined : f.value,
                  })
                }
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "3px 6px",
                  borderRadius: 4,
                  cursor: "pointer",
                  fontSize: 11,
                  background: current === f.value ? "rgba(184,145,42,.18)" : "transparent",
                  color: current === f.value ? "var(--gold2)" : "var(--mist)",
                  marginBottom: 2,
                }}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 130 }}>
                  {f.value}
                </span>
                <span style={{ fontSize: 10, color: "var(--sil)", marginLeft: 4, flexShrink: 0 }}>
                  {f.count}
                </span>
              </div>
            ))}
          </div>
        );
      })}
      {Object.values(filters).some((v) => v !== undefined) && (
        <button
          className="btn"
          style={{ width: "100%", marginTop: 4, fontSize: 11 }}
          onClick={() => onFilterChange({})}
        >
          Clear filters
        </button>
      )}
    </Card>
  );
}

// ─── Sub-component: Hit Detail Panel ─────────────────────────────────────────

function HitPanel({
  hit,
  onClose,
  onDownload,
}: {
  hit: SearchHit;
  onClose: () => void;
  onDownload?: (hit: SearchHit) => void;
}) {
  return (
    <div
      style={{
        position: "fixed", top: 0, right: 0, bottom: 0, width: 400,
        background: "var(--ink2)", borderLeft: "1px solid var(--bd)",
        zIndex: 200, overflowY: "auto", padding: 24,
        display: "flex", flexDirection: "column", gap: 16,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <h3 style={{ margin: 0, fontSize: 14 }}>Document Preview</h3>
        <button className="ic" onClick={onClose} aria-label="Close panel">×</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div>
          <div style={{ fontSize: 10, color: "var(--sil)", marginBottom: 2 }}>DOC ID</div>
          <div style={{ fontSize: 12, fontFamily: "monospace" }}>{hit.doc_id}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: "var(--sil)", marginBottom: 2 }}>TYPE</div>
          <div style={{ fontSize: 11 }}>{hit.doc_type}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: "var(--sil)", marginBottom: 2 }}>BRANCH</div>
          <div style={{ fontSize: 11 }}>{hit.branch}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: "var(--sil)", marginBottom: 2 }}>STATUS</div>
          <div>{levelTag(hit.status)}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: "var(--sil)", marginBottom: 2 }}>RELEVANCE</div>
          <div style={{ fontSize: 12 }}>{Math.round(hit.score * 100)}%</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: "var(--sil)", marginBottom: 2 }}>INDEXED</div>
          <div style={{ fontSize: 11 }}>{new Date(hit.indexed_at).toLocaleDateString()}</div>
        </div>
      </div>

      <div>
        <div style={{ fontSize: 10, color: "var(--sil)", marginBottom: 6 }}>SNIPPET</div>
        <div
          style={{
            background: "var(--ink3)", borderRadius: 6, padding: 12,
            fontSize: 12, lineHeight: 1.7, color: "var(--wh)", border: "1px solid var(--bd)",
          }}
        >
          {hit.snippet || <span style={{ color: "var(--sil)" }}>No preview available.</span>}
        </div>
      </div>

      <div style={{ marginTop: "auto", display: "flex", gap: 8 }}>
        <button
          className="btn-primary"
          style={{ flex: 1 }}
          onClick={() => window.open(`/svc/core/documents/${encodeURIComponent(hit.doc_id)}/view`, "_blank")}
          aria-label="Open document"
        >
          Open Document
        </button>
        <button
          className="btn"
          onClick={() => onDownload?.(hit)}
          aria-label="Download document"
          title="Download"
        >
          <Download size={13} />
        </button>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Search() {
  const { user } = useAuth();
  // "search:read" does not exist in RBAC; the server gates all search endpoints
  // on "document:read". Default to false (not true) when user is null so that
  // the Save-search button stays hidden for unauthenticated visitors.
  const canSearch  = user?.permissions.includes("document:read") ?? false;
  const canExport  = user?.permissions.includes("document:read") ?? false;

  // Query state
  const [text,    setText]    = useState("");
  const [mode,    setMode]    = useState<SearchMode>("fulltext");
  const [sort,    setSort]    = useState<SortMode>("relevance");
  const [filters, setFilters] = useState<SearchFilters>({});
  const [page,    setPage]    = useState(1);
  const pageSize = 20;

  // Results state
  const [results,  setResults]  = useState<SearchResults>(EMPTY_RESULTS);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [tookMs,   setTookMs]   = useState<number | null>(null);
  const [hasSearched, setHasSearched] = useState(false);

  // UI state
  const [tab,         setTab]         = useState<"results" | "analytics">("results");
  const [selectedHit, setSelectedHit] = useState<SearchHit | null>(null);
  const [showFilters, setShowFilters] = useState(true);

  // Saved searches
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [saveName,      setSaveName]      = useState("");
  const [saveVis,       setSaveVis]       = useState<"private" | "public">("private");
  const [saveLoading,   setSaveLoading]   = useState(false);
  const [showSavedPanel, setShowSavedPanel] = useState(false);

  // Debounce ref
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doSearch = useCallback(async (q: string, m: SearchMode, f: SearchFilters, p: number, s: SortMode) => {
    if (!q.trim() && !Object.values(f).some(Boolean)) {
      setResults(EMPTY_RESULTS);
      setHasSearched(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await searchApi.query({ text: q, mode: m, filters: f, page: p, pageSize, sort: s });
      setResults(res);
      setTookMs(res.tookMs);
      setHasSearched(true);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Search failed");
      setResults(EMPTY_RESULTS);
    } finally {
      setLoading(false);
    }
  }, []);

  // Trigger search when user types (debounced 300ms)
  useEffect(() => {
    if (searchRef.current) clearTimeout(searchRef.current);
    searchRef.current = setTimeout(() => doSearch(text, mode, filters, page, sort), 300);
    return () => { if (searchRef.current) clearTimeout(searchRef.current); };
  }, [text, mode, filters, page, sort, doSearch]);

  // Load saved searches on mount
  useEffect(() => {
    searchApi.listSaved().then((r) => setSavedSearches(r.saved)).catch(() => {});
  }, []);

  function handleRunSaved(s: SavedSearch) {
    const q = s.query_json;
    setText(q.text ?? "");
    setMode(q.mode ?? "fulltext");
    setFilters(q.filters ?? {});
    setSort(q.sort ?? "relevance");
    setShowSavedPanel(false);
  }

  async function handleExportCsv() {
    try {
      const blob = await searchApi.exportCsv({ text, mode, filters, sort, page, pageSize });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `search-export-${Date.now()}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      // silently ignore — user will see nothing downloaded
    }
  }

  function handleDownload(hit: SearchHit) {
    const url = `/svc/core/documents/${encodeURIComponent(hit.doc_id)}/download`;
    const a = document.createElement("a");
    a.href = url;
    a.download = hit.doc_id;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  async function handleSave() {
    if (!saveName.trim()) return;
    setSaveLoading(true);
    try {
      await searchApi.saveSearch(saveName, { text, mode, filters, sort }, saveVis);
      const updated = await searchApi.listSaved();
      setSavedSearches(updated.saved);
      setShowSaveModal(false);
      setSaveName("");
    } catch {
      // ignore
    } finally {
      setSaveLoading(false);
    }
  }

  const totalPages = Math.ceil(results.total / pageSize);
  const facets = results.facets ?? {};

  // Analytics data derived from facets
  const docTypeData = (facets["doc_type"] ?? []).slice(0, 8).map((f) => ({
    name: f.value.replace(/_/g, " "),
    count: f.count,
  }));
  const branchData = (facets["branch"] ?? []).slice(0, 10).map((f) => ({
    name: f.value,
    count: f.count,
  }));
  const riskDonut = buildFacetDonut(facets["risk_band"]);
  const statusDonut = buildFacetDonut(facets["status"]);

  const columns = [
    {
      key: "doc_id",
      header: "Document ID",
      sortable: true,
      render: (row: Record<string, unknown>) => (
        <span style={{ fontFamily: "monospace", fontSize: 11, color: "var(--gold2)" }}>
          {row.doc_id as string}
        </span>
      ),
    },
    {
      key: "doc_type",
      header: "Type",
      sortable: true,
      render: (row: Record<string, unknown>) => (
        <span style={{ fontSize: 11 }}>{String(row.doc_type ?? "").replace(/_/g, " ")}</span>
      ),
    },
    {
      key: "branch",
      header: "Branch",
      sortable: true,
    },
    {
      key: "status",
      header: "Status",
      render: (row: Record<string, unknown>) => levelTag(row.status as string),
    },
    {
      key: "score",
      header: "Relevance",
      sortable: true,
      render: (row: Record<string, unknown>) => {
        const pct = Math.round((row.score as number) * 100);
        return (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ flex: 1, height: 4, background: "var(--bd)", borderRadius: 2, minWidth: 48 }}>
              <div style={{ width: `${pct}%`, height: "100%", background: "var(--gold2)", borderRadius: 2 }} />
            </div>
            <span style={{ fontSize: 10, color: "var(--sil)", width: 28, textAlign: "right" }}>{pct}%</span>
          </div>
        );
      },
    },
    {
      key: "snippet",
      header: "Snippet",
      render: (row: Record<string, unknown>) => (
        <span style={{ fontSize: 11, color: "var(--sil)", maxWidth: 280, display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {row.snippet as string}
        </span>
      ),
    },
    {
      key: "indexed_at",
      header: "Indexed",
      sortable: true,
      render: (row: Record<string, unknown>) =>
        new Date(row.indexed_at as string).toLocaleDateString(),
    },
  ];

  const hitRows = results.hits.map((h) => h as unknown as Record<string, unknown>);

  return (
    <div className="fade-up" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Page header */}
      <div className="page-header">
        <div>
          <h2 className="serif">Enterprise Search</h2>
          <p>Full-text, boolean, wildcard, fuzzy &amp; semantic AI search across all branches and documents</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            className="btn"
            onClick={() => setShowSavedPanel((v) => !v)}
            title="Saved searches"
          >
            <Bookmark size={14} />
            <span style={{ marginLeft: 6 }}>Saved</span>
            {savedSearches.length > 0 && (
              <span style={{ marginLeft: 4, fontSize: 10, background: "var(--gold2)", color: "#241a06", borderRadius: 8, padding: "1px 5px" }}>
                {savedSearches.length}
              </span>
            )}
          </button>
          {canExport && hasSearched && (
            <button className="btn" title="Export CSV" onClick={handleExportCsv}>
              <Download size={14} />
              <span style={{ marginLeft: 6 }}>Export</span>
            </button>
          )}
        </div>
      </div>

      {/* KPI Row */}
      {hasSearched && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          <KpiCard label="Total Results" value={results.total.toLocaleString()} variant="gold" />
          <KpiCard
            label="Search Time"
            value={tookMs !== null ? formatMs(tookMs) : "—"}
            variant="blue"
          />
          <KpiCard
            label="Branches Hit"
            value={(facets["branch"]?.length ?? 0)}
            variant="green"
          />
          <KpiCard
            label="Doc Types"
            value={(facets["doc_type"]?.length ?? 0)}
            variant="purple"
          />
        </div>
      )}

      {/* Search Bar */}
      <Card>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {/* Mode selector */}
          <div style={{ display: "flex", gap: 4, background: "var(--ink3)", borderRadius: 6, padding: 3 }}>
            {SEARCH_MODES.map((m) => (
              <button
                key={m}
                className={`tab${mode === m ? " on" : ""}`}
                onClick={() => { setMode(m); setPage(1); }}
                style={{ fontSize: 11, padding: "4px 10px" }}
                title={modeLabel(m)}
              >
                {m === "semantic" ? <Zap size={11} style={{ marginRight: 3 }} /> : null}
                {modeLabel(m)}
              </button>
            ))}
          </div>

          {/* Search input */}
          <div style={{ flex: 1, position: "relative", minWidth: 280 }}>
            <SearchIcon
              size={14}
              style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: "var(--sil)", pointerEvents: "none" }}
            />
            <input
              className="field"
              style={{ paddingLeft: 32, paddingRight: 12, width: "100%", boxSizing: "border-box" }}
              placeholder={
                mode === "boolean"  ? 'e.g. loan AND dorji NOT closed' :
                mode === "wildcard" ? 'e.g. loan* or dor?i' :
                mode === "semantic" ? 'Describe what you are looking for…' :
                'Search documents, OCR text, metadata…'
              }
              value={text}
              onChange={(e) => { setText(e.target.value); setPage(1); }}
              aria-label="Search query"
            />
          </div>

          {/* Sort */}
          <select
            className="field"
            style={{ width: 130 }}
            value={sort}
            onChange={(e) => { setSort(e.target.value as SortMode); setPage(1); }}
          >
            <option value="relevance">Relevance</option>
            <option value="recent">Most Recent</option>
          </select>

          {/* Toggle filters */}
          <button
            className="btn"
            onClick={() => setShowFilters((v) => !v)}
            title="Toggle filters"
          >
            <Filter size={13} />
            {showFilters ? <ChevronUp size={12} style={{ marginLeft: 4 }} /> : <ChevronDown size={12} style={{ marginLeft: 4 }} />}
          </button>

          {/* Save search */}
          {canSearch && text.trim() && (
            <button className="btn" onClick={() => setShowSaveModal(true)} title="Save this search">
              <BookmarkCheck size={13} />
            </button>
          )}
        </div>

        {/* Mode hint */}
        {mode === "boolean" && (
          <div style={{ fontSize: 10, color: "var(--sil)", marginTop: 6, padding: "0 2px" }}>
            Syntax: <code>term1 AND term2</code>, <code>term1 OR term2</code>, <code>NOT term</code>
          </div>
        )}
        {mode === "wildcard" && (
          <div style={{ fontSize: 10, color: "var(--sil)", marginTop: 6, padding: "0 2px" }}>
            Use <code>*</code> for any characters, <code>?</code> for a single character.
          </div>
        )}
      </Card>

      {/* Main body — filters + results */}
      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>

        {/* Facet panel */}
        {showFilters && hasSearched && Object.keys(facets).length > 0 && (
          <div style={{ width: 220, flexShrink: 0 }}>
            <FacetPanel
              facets={facets}
              filters={filters}
              onFilterChange={(f) => { setFilters(f); setPage(1); }}
            />
          </div>
        )}

        {/* Results area */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <Tabs
            items={[
              { key: "results",   label: `Results${hasSearched ? ` (${results.total.toLocaleString()})` : ""}` },
              { key: "analytics", label: "Analytics" },
            ]}
            active={tab}
            onChange={(k) => setTab(k as "results" | "analytics")}
          />

          {tab === "results" && (
            <div style={{ marginTop: 12 }}>
              {loading && (
                <div style={{ textAlign: "center", padding: 40, color: "var(--sil)" }}>
                  <SearchIcon size={24} style={{ marginBottom: 8, opacity: 0.5 }} />
                  <div>Searching…</div>
                </div>
              )}

              {error && !loading && (
                <div style={{ background: "rgba(220,38,38,.12)", border: "1px solid var(--R)", borderRadius: 8, padding: 16, color: "var(--R)" }}>
                  {error}
                </div>
              )}

              {!loading && !error && !hasSearched && (
                <div style={{ textAlign: "center", padding: 60, color: "var(--sil)" }}>
                  <SearchIcon size={40} style={{ marginBottom: 12, opacity: 0.3 }} />
                  <div style={{ fontSize: 14 }}>Start typing to search across all documents</div>
                  <div style={{ fontSize: 12, marginTop: 6 }}>
                    {SEARCH_MODES.map((m) => <Tag key={m} variant="gold" style={{ marginRight: 4 }}>{modeLabel(m)}</Tag>)}
                  </div>
                </div>
              )}

              {!loading && !error && hasSearched && results.hits.length === 0 && (
                <div style={{ textAlign: "center", padding: 60, color: "var(--sil)" }}>
                  <SearchIcon size={32} style={{ marginBottom: 8, opacity: 0.3 }} />
                  <div style={{ fontSize: 14 }}>No results found</div>
                  <div style={{ fontSize: 12, marginTop: 4 }}>Try a different query or broaden your filters.</div>
                </div>
              )}

              {!loading && !error && results.hits.length > 0 && (
                <>
                  {/* Auto-classified results — document types found, with counts */}
                  {(facets["doc_type"] ?? []).length > 0 && (
                    <div style={{ marginBottom: 12 }}>
                      <Card title={<span>Auto-classified results <Tag variant="gold">{(facets["doc_type"] ?? []).length} types</Tag></span>}>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                          {(facets["doc_type"] ?? []).map((f) => (
                            <div key={f.value} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", border: "1px solid var(--bd)", borderRadius: 8, background: "var(--ink2)", fontSize: 12 }}>
                              <span style={{ fontWeight: 600, color: "var(--wh)" }}>{f.value.replace(/_/g, " ")}</span>
                              <span style={{ fontWeight: 700, color: "var(--navy)", background: "var(--goldT)", borderRadius: 20, padding: "1px 9px", fontSize: 11 }}>{f.count}</span>
                            </div>
                          ))}
                        </div>
                      </Card>
                    </div>
                  )}
                  <Card>
                    <DataTable
                      columns={columns}
                      rows={hitRows}
                      rowKey={(r) => r.doc_id as string}
                      onRowClick={(r) => setSelectedHit(r as unknown as SearchHit)}
                      emptyMessage="No results"
                    />
                  </Card>

                  {/* Pagination */}
                  {totalPages > 1 && (
                    <div style={{ display: "flex", gap: 6, justifyContent: "center", marginTop: 12, alignItems: "center" }}>
                      <button className="btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                        Previous
                      </button>
                      <span style={{ fontSize: 12, color: "var(--sil)" }}>
                        Page {page} of {totalPages} — {results.total} results
                      </span>
                      <button className="btn" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                        Next
                      </button>
                    </div>
                  )}

                  {tookMs !== null && (
                    <div style={{ textAlign: "center", fontSize: 10, color: "var(--sil)", marginTop: 6 }}>
                      <Clock size={10} style={{ marginRight: 4, verticalAlign: "middle" }} />
                      {results.total} result{results.total !== 1 ? "s" : ""} in {formatMs(tookMs)}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {tab === "analytics" && hasSearched && (
            <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <BarChartCard
                title={<><BarChart2 size={13} style={{ marginRight: 6 }} />Document Types</>}
                data={docTypeData}
                xKey="name"
                bars={[{ key: "count", color: "var(--gold2)", name: "Count" }]}
                height={200}
              />
              <BarChartCard
                title="Results by Branch"
                data={branchData}
                xKey="name"
                bars={[{ key: "count", color: "var(--B)", name: "Count" }]}
                height={200}
              />
              {riskDonut.length > 0 && (
                <DonutChartCard
                  title="Risk Distribution"
                  data={riskDonut}
                  height={200}
                />
              )}
              {statusDonut.length > 0 && (
                <DonutChartCard
                  title="Status Distribution"
                  data={statusDonut}
                  height={200}
                />
              )}
            </div>
          )}

          {tab === "analytics" && !hasSearched && (
            <div style={{ textAlign: "center", padding: 60, color: "var(--sil)", marginTop: 12 }}>
              Run a search first to see analytics.
            </div>
          )}
        </div>
      </div>

      {/* Hit detail side panel */}
      {selectedHit && (
        <HitPanel hit={selectedHit} onClose={() => setSelectedHit(null)} onDownload={handleDownload} />
      )}

      {/* Saved searches panel */}
      {showSavedPanel && (
        <div
          style={{
            position: "fixed", top: 0, right: 0, bottom: 0, width: 320,
            background: "var(--ink2)", borderLeft: "1px solid var(--bd)",
            zIndex: 200, overflowY: "auto", padding: 20,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h3 style={{ margin: 0, fontSize: 14 }}>Saved Searches</h3>
            <button className="ic" onClick={() => setShowSavedPanel(false)}>×</button>
          </div>
          {savedSearches.length === 0 && (
            <div style={{ color: "var(--sil)", fontSize: 12, textAlign: "center", padding: 20 }}>
              No saved searches yet.
            </div>
          )}
          {savedSearches.map((s) => (
            <div
              key={s.id}
              style={{
                background: "var(--ink3)", borderRadius: 8, padding: 12,
                marginBottom: 8, cursor: "pointer", border: "1px solid var(--bd)",
              }}
              onClick={() => handleRunSaved(s)}
            >
              <div style={{ fontSize: 12, fontWeight: 600 }}>{s.name}</div>
              <div style={{ fontSize: 10, color: "var(--sil)", marginTop: 3 }}>
                Mode: {modeLabel(s.query_json.mode)} · {s.visibility === "public" ? "Public" : "Private"}
              </div>
              <div style={{ fontSize: 11, color: "var(--sil)", marginTop: 2, fontFamily: "monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {s.query_json.text}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Save search modal */}
      <Modal open={showSaveModal} onClose={() => setShowSaveModal(false)} title="Save Search">
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <FormField
            label="Search Name"
            placeholder="My saved search…"
            value={saveName}
            onChange={(e) => setSaveName((e.target as HTMLInputElement).value)}
          />
          <FormField
            as="select"
            label="Visibility"
            value={saveVis}
            onChange={(e) => setSaveVis((e.target as HTMLSelectElement).value as "private" | "public")}
          >
            <option value="private">Private (only me)</option>
            <option value="public">Public (all users)</option>
          </FormField>
          <div style={{ fontSize: 11, color: "var(--sil)", background: "var(--ink3)", padding: 8, borderRadius: 6, fontFamily: "monospace" }}>
            Query: {text || "(empty)"} · Mode: {modeLabel(mode)}
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button className="btn" onClick={() => setShowSaveModal(false)}>Cancel</button>
            <button
              className="btn-primary"
              onClick={handleSave}
              disabled={saveLoading || !saveName.trim()}
            >
              {saveLoading ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
