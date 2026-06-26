import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { DocumentPreview } from "../components/DocumentPreview.js";
import { useUrlState } from "../hooks/useUrlState.js";
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
import type { Column } from "../components/ui/index.js";
import { useAuth } from "../auth/AuthContext.js";
import { repositoryViewerApi } from "../api/repositoryViewerApi.js";
import type { FolderNode, DocumentRecord } from "../api/repositoryViewerApi.js";

// ── Folder Tree Sub-Component ─────────────────────────────────────────────────

function FolderIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

interface FolderTreeProps {
  nodes: FolderNode[];
  selectedId: string | null;
  onSelect: (node: FolderNode) => void;
  depth?: number;
}

function FolderTree({ nodes, selectedId, onSelect, depth = 0 }: FolderTreeProps) {
  return (
    <div>
      {nodes.map((node) => (
        <div key={node.id}>
          <div
            onClick={() => onSelect(node)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 7,
              padding: depth === 0 ? "7px 10px" : "6px 10px 6px " + (10 + depth * 16) + "px",
              borderRadius: 6,
              cursor: "pointer",
              background: selectedId === node.id ? "var(--goldT)" : "transparent",
              color: selectedId === node.id ? "var(--gold3)" : depth === 0 ? "var(--mist)" : "var(--sil)",
              fontSize: 12,
              transition: ".15s",
              marginBottom: 1,
            }}
          >
            <FolderIcon />
            <span style={{ flex: 1 }}>{node.name}</span>
            {node.domain && (
              <span style={{ fontSize: 9, color: "var(--sil)", opacity: 0.7 }}>{node.domain.slice(0, 3).toUpperCase()}</span>
            )}
          </div>
          {node.children.length > 0 && (
            <FolderTree nodes={node.children} selectedId={selectedId} onSelect={onSelect} depth={depth + 1} />
          )}
        </div>
      ))}
    </div>
  );
}

// ── Status Tag Helper ─────────────────────────────────────────────────────────

function docStatusVariant(status: string, reviewFlag?: boolean) {
  if (reviewFlag) return <Tag variant="amber">Review</Tag>;
  if (status === "Active") return <Tag variant="green">Active</Tag>;
  if (status === "Deleted") return <Tag variant="red">Deleted</Tag>;
  return <Tag variant="blue">{status}</Tag>;
}

function categoryVariant(cat?: string) {
  if (!cat) return <span style={{ color: "var(--sil)" }}>—</span>;
  if (cat.includes("KYC") || cat.includes("Identity")) return <Tag variant="gold">{cat}</Tag>;
  if (cat.includes("Loan") || cat.includes("Credit")) return <Tag variant="blue">{cat}</Tag>;
  if (cat.includes("Compliance") || cat.includes("AML")) return <Tag variant="red">{cat}</Tag>;
  if (cat.includes("Legal") || cat.includes("Contract")) return <Tag variant="purple">{cat}</Tag>;
  return <Tag variant="amber">{cat}</Tag>;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Preview Panel ─────────────────────────────────────────────────────────────

interface PreviewPanelProps {
  doc: DocumentRecord | null;
  versions: Array<{ id: string; version_no: number; mime_type?: string; created_by?: string; comment?: string; created_at?: string; file_size_bytes: number }>;
  onViewInViewer: (doc: DocumentRecord) => void;
  canDelete: boolean;
  onDelete: (doc: DocumentRecord) => void;
}

function PreviewPanel({ doc, versions, onViewInViewer, canDelete, onDelete }: PreviewPanelProps) {
  if (!doc) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: 220,
          border: "1px dashed var(--bd)",
          borderRadius: 8,
          color: "var(--sil)",
          fontSize: 12,
          background: "var(--gr)",
        }}
      >
        Select a document to preview
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 11 }}>
      <div style={{ marginBottom: 8 }}>
        {/* Real preview (auth-fetched blob) for the selected document. */}
        <DocumentPreview
          docId={doc.id}
          mimeType={doc.mime_type}
          fileName={doc.original_filename ?? doc.title}
          height={200}
          compact
        />
      </div>

      {[
        ["Version", `v${doc.current_version}.0`],
        ["Branch", doc.branch ?? "—"],
        ["Size", formatBytes(doc.file_size_bytes)],
        ["Format", doc.mime_type ?? "—"],
        ["Retention", doc.retention_years ? `${doc.retention_years} Years` : "—"],
        ["Source", doc.source_channel],
        ["Review Flag", doc.review_flag ? "Yes" : "No"],
      ].map(([label, value]) => (
        <div key={label} style={{ display: "flex", justifyContent: "space-between", paddingBottom: 4, borderBottom: "1px solid var(--bd)" }}>
          <span style={{ color: "var(--sil)" }}>{label}</span>
          <span style={{ color: doc.review_flag && label === "Review Flag" ? "var(--W)" : "var(--mist)" }}>{value}</span>
        </div>
      ))}

      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <button
          className="btn bg"
          style={{ flex: 1, justifyContent: "center", fontSize: 10 }}
          onClick={() => onViewInViewer(doc)}
        >
          Open Viewer
        </button>
        {canDelete && (
          <button
            className="btn bx"
            style={{ fontSize: 10 }}
            onClick={() => onDelete(doc)}
            aria-label="delete"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

// ── Version History Panel ─────────────────────────────────────────────────────

interface VersionHistoryProps {
  versions: Array<{ id: string; version_no: number; mime_type?: string; created_by?: string; comment?: string; created_at?: string; file_size_bytes: number }>;
  currentVersion: number;
  docId: string;
  canRollback: boolean;
  onRollback: (version: number) => void;
}

function VersionHistory({ versions, currentVersion, canRollback, onRollback }: VersionHistoryProps) {
  if (versions.length === 0) {
    return <div style={{ fontSize: 11, color: "var(--sil)", padding: "8px 0" }}>No version history available.</div>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 11 }}>
      {[...versions].sort((a, b) => b.version_no - a.version_no).map((v) => {
        const isCurrent = v.version_no === currentVersion;
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
                {v.created_at ? new Date(v.created_at).toLocaleDateString() : "—"} · {v.created_by ?? "System"}
                {" · "}{formatBytes(v.file_size_bytes)}
              </div>
            </div>
            {canRollback && !isCurrent && (
              <button
                className="btn bs xs"
                onClick={() => onRollback(v.version_no)}
                style={{ fontSize: 9 }}
              >
                Rollback
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Main Repository Screen ────────────────────────────────────────────────────

export default function Repository() {
  const { user } = useAuth();
  const navigate = useNavigate();

  // Permissions
  const canRead = user?.permissions.includes("document:read") ?? false;
  const canDelete = user?.permissions.includes("document:delete") ?? false;
  const canCapture = user?.permissions.includes("document:capture") ?? false;
  const canCreateFolder = user?.permissions.includes("folder:create") ?? false;
  const canFolderRead = user?.permissions.includes("folder:read") ?? false;

  // Pattern 2: URL-driven state for filters, folder selection.
  // Tab uses dual state (local + URL sync) so React re-renders instantly
  // on tab click while still updating the URL for bookmarkability.
  const [urlFilters, setUrlFilters] = useUrlState({ tab: "browse", q: "", status: "all", category: "all", folder: "" });
  const [tab, setTabLocal] = useState(urlFilters.tab);
  const setTab = (t: string) => { setTabLocal(t); setUrlFilters({ tab: t }); };
  const filterStatus = urlFilters.status;
  const filterCategory = urlFilters.category;
  const setFilterStatus = (s: string) => setUrlFilters({ status: s });
  const setFilterCategory = (c: string) => setUrlFilters({ category: c });
  const [filterText, _setFilterTextLocal] = useState(urlFilters.q);
  const _debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setFilterText = (v: string) => {
    _setFilterTextLocal(v);
    if (_debounceRef.current) clearTimeout(_debounceRef.current);
    _debounceRef.current = setTimeout(() => setUrlFilters({ q: v }), 300);
  };
  const [_selFolder, _setSelFolder] = useState<FolderNode | null>(null);
  const selectedFolder = _selFolder;
  const setSelectedFolder = (node: FolderNode | null) => {
    _setSelFolder(node);
    setUrlFilters({ folder: node ? String(node.id) : "" });
  };

  // State
  const [tree, setTree] = useState<FolderNode[]>([]);
  const [docs, setDocs] = useState<DocumentRecord[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<DocumentRecord | null>(null);
  const [versions, setVersions] = useState<Array<{ id: string; version_no: number; mime_type?: string; created_by?: string; comment?: string; created_at?: string; file_size_bytes: number }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Upload modal
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadBranch, setUploadBranch] = useState(user?.branch ?? "");
  const [uploadSourceChannel, setUploadSourceChannel] = useState<string>("UPLOAD");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadMsg, setUploadMsg] = useState("");
  const [uploading, setUploading] = useState(false);

  // New folder modal
  const [folderModalOpen, setFolderModalOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderDomain, setNewFolderDomain] = useState("");
  const [folderMsg, setFolderMsg] = useState("");

  // Dashboard summary for analytics tab
  const [summary, setSummary] = useState<{ totalDocuments: number; pendingReview: number; indexedToday: number; byCategory: Record<string, number> } | null>(null);

  const loadData = useCallback(async () => {
    if (!canRead) return;
    setLoading(true);
    setError(null);
    try {
      // Use allSettled so a folder:read 403 does not abort the document load
      const [foldersResult, docsResult] = await Promise.allSettled([
        canFolderRead ? repositoryViewerApi.listFolders() : Promise.resolve(null),
        repositoryViewerApi.listDocuments(),
      ]);
      if (foldersResult.status === "fulfilled" && foldersResult.value) {
        const loadedTree = foldersResult.value.tree;
        setTree(loadedTree);
        // Pattern 2: Restore selected folder from URL
        const folderParam = urlFilters.folder;
        if (folderParam) {
          const targetId = folderParam;
          const findNode = (nodes: FolderNode[]): FolderNode | null => {
            for (const n of nodes) {
              if (n.id === targetId) return n;
              const found = findNode(n.children);
              if (found) return found;
            }
            return null;
          };
          const restored = findNode(loadedTree);
          if (restored) _setSelFolder(restored);
        }
      }
      if (docsResult.status === "fulfilled") {
        setDocs(docsResult.value.documents);
      } else {
        throw docsResult.reason;
      }
    } catch (e: unknown) {
      const _err = e as { body?: { error?: string }; message?: string };
      setError(_err?.body?.error ?? _err?.message ?? "Failed to load repository data");
    } finally {
      setLoading(false);
    }
  }, [canRead, canFolderRead]);

  const loadSummary = useCallback(async () => {
    try {
      const s = await repositoryViewerApi.dashboardSummary();
      setSummary(s);
    } catch {
      // summary is best-effort
    }
  }, []);

  useEffect(() => {
    loadData();
    loadSummary();
  }, [loadData, loadSummary]);

  // Load versions when doc selected
  useEffect(() => {
    if (!selectedDoc) { setVersions([]); return; }
    repositoryViewerApi.listVersions(selectedDoc.id).then((r) => setVersions(r.versions)).catch(() => setVersions([]));
  }, [selectedDoc]);

  // Filtered docs
  const filteredDocs = docs.filter((d) => {
    const matchText = !filterText || d.title.toLowerCase().includes(filterText.toLowerCase()) || (d.original_filename ?? "").toLowerCase().includes(filterText.toLowerCase());
    const matchStatus = filterStatus === "all" || (filterStatus === "review" ? d.review_flag : d.status === filterStatus);
    const matchCat = filterCategory === "all" || (d.catalog_category ?? "") === filterCategory;
    const matchFolder = !selectedFolder || d.folder_id === selectedFolder.id;
    return matchText && matchStatus && matchCat && matchFolder;
  });

  // Categories for filter
  const categories = Array.from(new Set(docs.map((d) => d.catalog_category).filter(Boolean))) as string[];

  // KPI data
  const totalActive = docs.filter((d) => d.status === "Active").length;
  const pendingReview = docs.filter((d) => d.review_flag).length;
  const totalFolders = countNodes(tree);

  function countNodes(nodes: FolderNode[]): number {
    return nodes.reduce((acc, n) => acc + 1 + countNodes(n.children), 0);
  }

  // Upload handler
  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!uploadFile) { setUploadMsg("Please select a file."); return; }
    setUploading(true);
    setUploadMsg("");
    try {
      const form = new FormData();
      form.append("title", uploadTitle || uploadFile.name);
      form.append("branch", uploadBranch);
      form.append("sourceChannel", uploadSourceChannel);
      if (selectedFolder) form.append("folderId", String(selectedFolder.id));
      form.append("file", uploadFile);
      await repositoryViewerApi.uploadDocument(form);
      setUploadMsg("Document captured successfully.");
      setUploadTitle("");
      setUploadFile(null);
      await loadData();
    } catch (e: unknown) {
      const _err2 = e as { body?: { error?: string }; message?: string };
      setUploadMsg(_err2?.body?.error ?? _err2?.message ?? "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  // Delete handler
  async function handleDelete(doc: DocumentRecord) {
    if (!confirm(`Delete "${doc.title}"?`)) return;
    try {
      await repositoryViewerApi.deleteDocument(doc.id);
      setSelectedDoc(null);
      await loadData();
    } catch (e: unknown) {
      const _err3 = e as { body?: { error?: string } };
      alert(_err3?.body?.error ?? "Delete failed.");
    }
  }

  // Folder creation
  async function handleCreateFolder(e: React.FormEvent) {
    e.preventDefault();
    setFolderMsg("");
    try {
      await repositoryViewerApi.createFolder({
        name: newFolderName,
        parentId: selectedFolder?.id ?? null,
        domain: newFolderDomain || undefined,
      });
      setFolderMsg("Folder created.");
      setNewFolderName("");
      setFolderModalOpen(false);
      await loadData();
    } catch (e: unknown) {
      const _err4 = e as { body?: { error?: string }; message?: string };
      setFolderMsg(_err4?.body?.error ?? _err4?.message ?? "Create folder failed.");
    }
  }

  // Rollback
  async function handleRollback(version: number) {
    if (!selectedDoc) return;
    if (!confirm(`Roll back to v${version}.0?`)) return;
    try {
      await repositoryViewerApi.rollback(selectedDoc.id, version);
      const updated = await repositoryViewerApi.getDocument(selectedDoc.id);
      setSelectedDoc(updated.document);
      await loadData();
    } catch (e: unknown) {
      const _err5 = e as { body?: { error?: string } };
      alert(_err5?.body?.error ?? "Rollback failed.");
    }
  }

  // Open viewer — C3 fix: use React Router navigate instead of direct window.location mutations
  function openViewer(doc: DocumentRecord) {
    navigate(`/viewer?doc=${doc.id}`);
  }

  // Table columns
  const docColumns: Column<Record<string, unknown>>[] = [
    {
      key: "title",
      header: "Document Name",
      sortable: true,
      render: (row) => (
        <span
          style={{ color: "var(--gold3)", cursor: "pointer" }}
          onClick={() => setSelectedDoc(row as unknown as DocumentRecord)}
        >
          {String(row.title)}
        </span>
      ),
    },
    {
      key: "branch",
      header: "Branch",
      sortable: true,
      render: (row) => <span style={{ color: "var(--B)", fontSize: 11 }}>{String(row.branch ?? "—")}</span>,
    },
    {
      key: "doc_type",
      header: "Type",
      render: (row) => row.doc_type ? <Tag variant="gold">{String(row.doc_type)}</Tag> : <span style={{ color: "var(--sil)" }}>—</span>,
    },
    {
      key: "catalog_category",
      header: "Category",
      render: (row) => categoryVariant(row.catalog_category as string | undefined),
    },
    {
      key: "current_version",
      header: "Version",
      render: (row) => <span className="mono" style={{ fontSize: 11 }}>v{String(row.current_version)}.0</span>,
    },
    {
      key: "status",
      header: "Status",
      render: (row) => docStatusVariant(String(row.status), Boolean(row.review_flag)),
    },
    {
      key: "actions",
      header: "",
      width: 80,
      render: (row) => (
        <button
          className="btn bs xs"
          onClick={(e) => { e.stopPropagation(); openViewer(row as unknown as DocumentRecord); }}
        >
          View
        </button>
      ),
    },
  ];

  // Analytics tab: category breakdown for charts
  const categoryChartData = summary
    ? Object.entries(summary.byCategory).map(([name, value]) => ({ name, value }))
    : categories.map((c) => ({ name: c, value: docs.filter((d) => d.catalog_category === c).length }));

  const ingestChartData = (() => {
    const byMonth: Record<string, number> = {};
    docs.forEach((d) => {
      if (!d.ingest_timestamp) return;
      // ingest_timestamp may be a Unix ms number or an ISO string
      const ts = typeof d.ingest_timestamp === "number"
        ? new Date(d.ingest_timestamp).toISOString()
        : String(d.ingest_timestamp);
      const m = ts.slice(0, 7);
      byMonth[m] = (byMonth[m] ?? 0) + 1;
    });
    return Object.entries(byMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-6)
      .map(([month, count]) => ({ month, count }));
  })();

  if (!canRead) {
    return (
      <div className="fade-up" style={{ padding: 40, textAlign: "center" }}>
        <div style={{ color: "var(--R)", fontSize: 14, marginBottom: 8 }}>Access Denied</div>
        <div style={{ color: "var(--sil)", fontSize: 12 }}>You do not have permission to view the repository.</div>
      </div>
    );
  }

  return (
    <div className="fade-up">
      {/* Page Header */}
      <div className="page-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h2 className="serif" style={{ fontSize: 24, color: "var(--gold3)" }}>Document Repository</h2>
          <p style={{ fontSize: 11, color: "var(--sil)", marginTop: 3 }}>
            Hierarchical cabinet structure · Version control · Full-text search · Secure archival
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {canCreateFolder && (
            <button className="btn bs sm" onClick={() => setFolderModalOpen(true)}>New Folder</button>
          )}
          {canCapture && (
            <button className="btn bg sm" onClick={() => setUploadOpen(true)}>Upload Document</button>
          )}
        </div>
      </div>

      {/* KPI Row */}
      <div className="g4" style={{ marginBottom: 14 }}>
        <KpiCard
          label="Total Documents"
          value={loading ? "…" : totalActive.toLocaleString()}
          sub="Active in repository"
          variant="gold"
        />
        <KpiCard
          label="Pending Review"
          value={loading ? "…" : pendingReview.toLocaleString()}
          sub="Review flag raised"
          variant="amber"
        />
        <KpiCard
          label="Folder Nodes"
          value={loading ? "…" : totalFolders.toLocaleString()}
          sub="In hierarchy"
          variant="blue"
        />
        <KpiCard
          label="Indexed Today"
          value={loading ? "…" : (summary?.indexedToday ?? "—")}
          sub="Documents processed"
          variant="green"
        />
      </div>

      {/* Tabs */}
      <Tabs
        items={[
          { key: "browse", label: "Browse" },
          { key: "analytics", label: "Analytics" },
        ]}
        active={tab}
        onChange={setTab}
      />

      {error && (
        <div style={{ background: "var(--RT)", border: "1px solid rgba(224,82,82,.3)", borderRadius: 8, padding: "10px 14px", marginBottom: 14, fontSize: 12, color: "var(--R)" }}>
          {error}
        </div>
      )}

      {/* ── Browse Tab ── */}
      {tab === "browse" && (
        <div style={{ display: "grid", gridTemplateColumns: "220px 1fr 260px", gap: 14 }}>
          {/* Folder Tree Panel */}
          <Card title="Folder Structure" style={{ padding: 12 }}>
            {!canFolderRead ? (
              <div style={{ color: "var(--sil)", fontSize: 11, padding: "8px 0" }}>
                You do not have permission to view folders.
              </div>
            ) : loading ? (
              <div style={{ color: "var(--sil)", fontSize: 11, padding: "8px 0" }}>Loading folders…</div>
            ) : tree.length === 0 ? (
              <div style={{ color: "var(--sil)", fontSize: 11, padding: "8px 0" }}>No folders yet.</div>
            ) : (
              <>
                <div
                  onClick={() => setSelectedFolder(null)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    padding: "7px 10px",
                    borderRadius: 6,
                    cursor: "pointer",
                    background: !selectedFolder ? "var(--goldT)" : "transparent",
                    color: !selectedFolder ? "var(--gold3)" : "var(--sil)",
                    fontSize: 12,
                    marginBottom: 4,
                  }}
                >
                  <FolderIcon /> All Documents
                  <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--sil)" }}>{totalActive}</span>
                </div>
                <FolderTree nodes={tree} selectedId={selectedFolder?.id ?? null} onSelect={setSelectedFolder} />
              </>
            )}
          </Card>

          {/* Documents Table */}
          <Card
            title={
              <span>
                {selectedFolder ? `${selectedFolder.name} — ` : "All Documents — "}
                <span style={{ fontWeight: 400, color: "var(--sil)", fontSize: 11 }}>
                  {filteredDocs.length} document{filteredDocs.length !== 1 ? "s" : ""}
                </span>
              </span>
            }
            action={
              <div style={{ display: "flex", gap: 5 }}>
                <input
                  value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
                  placeholder="Search…"
                  style={{
                    background: "rgba(15,23,42,.04)",
                    border: "1px solid var(--bd)",
                    borderRadius: 6,
                    padding: "4px 10px",
                    fontSize: 11,
                    color: "var(--wh)",
                    width: 140,
                  }}
                />
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  style={{ background: "var(--ink2)", border: "1px solid var(--bd)", borderRadius: 6, padding: "4px 8px", fontSize: 11, color: "var(--mist)" }}
                >
                  <option value="all">All Status</option>
                  <option value="Active">Active</option>
                  <option value="review">Review Flag</option>
                  {/* "Deleted" option removed: server only returns Active documents;
                      deleted docs are archived and not browseable here */}
                </select>
                {categories.length > 0 && (
                  <select
                    value={filterCategory}
                    onChange={(e) => setFilterCategory(e.target.value)}
                    style={{ background: "var(--ink2)", border: "1px solid var(--bd)", borderRadius: 6, padding: "4px 8px", fontSize: 11, color: "var(--mist)" }}
                  >
                    <option value="all">All Categories</option>
                    {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                )}
              </div>
            }
            style={{ overflow: "auto" }}
          >
            {loading ? (
              <div style={{ color: "var(--sil)", fontSize: 11, padding: "12px 0" }}>Loading documents…</div>
            ) : (
              <DataTable
                  columns={docColumns}
                  rows={filteredDocs as unknown as Record<string, unknown>[]}
                  rowKey={(r) => String(r.id)}
                  onRowClick={(r) => setSelectedDoc(r as unknown as DocumentRecord)}
                  emptyMessage={selectedFolder ? `No documents in ${selectedFolder.name}` : "No documents found"}
                  pageSize={10}
                />
            )}
          </Card>

          {/* Right Panel: Preview + Version History */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <Card title="Document Preview" style={{ padding: 14 }}>
              <PreviewPanel
                doc={selectedDoc}
                versions={versions}
                onViewInViewer={openViewer}
                canDelete={canDelete}
                onDelete={handleDelete}
              />
            </Card>

            {selectedDoc && (
              <Card title={<span>Version History <Tag variant="blue">v{selectedDoc.current_version}.0 current</Tag></span>}>
                <VersionHistory
                  versions={versions}
                  currentVersion={selectedDoc.current_version}
                  docId={selectedDoc.id}
                  canRollback={user?.permissions.includes("document:index") ?? false}
                  onRollback={handleRollback}
                />
              </Card>
            )}
          </div>
        </div>
      )}

      {/* ── Analytics Tab ── */}
      {tab === "analytics" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          {categoryChartData.length > 0 ? (
            <DonutChartCard
              title="Documents by Category"
              data={categoryChartData}
              height={240}
            />
          ) : (
            <Card title="Documents by Category">
              <div style={{ color: "var(--sil)", fontSize: 11, padding: "40px 0", textAlign: "center" }}>
                No categorised documents yet.
              </div>
            </Card>
          )}

          {ingestChartData.length > 0 ? (
            <BarChartCard
              title="Ingest Volume (Last 6 Months)"
              data={ingestChartData}
              xKey="month"
              bars={[{ key: "count", name: "Documents", color: "var(--gold2)" }]}
              height={240}
            />
          ) : (
            <Card title="Ingest Volume">
              <div style={{ color: "var(--sil)", fontSize: 11, padding: "40px 0", textAlign: "center" }}>
                No ingest data available.
              </div>
            </Card>
          )}

          {summary && (
            <Card title="Repository Summary" style={{ gridColumn: "1 / -1" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
                {[
                  { label: "Total Active", value: summary.totalDocuments, color: "var(--gold3)" },
                  { label: "Pending Review", value: summary.pendingReview, color: "var(--W)" },
                  { label: "Indexed Today", value: summary.indexedToday, color: "var(--G)" },
                  { label: "Categories", value: Object.keys(summary.byCategory).length, color: "var(--B)" },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{ textAlign: "center", padding: "12px 0" }}>
                    <div style={{ fontFamily: "'Cormorant Garamond', serif", fontSize: 28, fontWeight: 700, color }}>
                      {value.toLocaleString()}
                    </div>
                    <div style={{ fontSize: 10, color: "var(--sil)", marginTop: 4, textTransform: "uppercase", letterSpacing: 1 }}>
                      {label}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ── Upload Modal ── */}
      <Modal open={uploadOpen} onClose={() => { setUploadOpen(false); setUploadMsg(""); }} title="Upload Document" width={480}>
        <form onSubmit={handleUpload} style={{ padding: "4px 0" }}>
          <FormField
            label="Title"
            placeholder="Document title (leave blank to use filename)"
            value={uploadTitle}
            onChange={(e) => setUploadTitle((e.target as HTMLInputElement).value)}
          />
          <FormField
            label="Branch"
            placeholder="Branch"
            value={uploadBranch}
            onChange={(e) => setUploadBranch((e.target as HTMLInputElement).value)}
          />
          <FormField
            as="select"
            label="Source Channel"
            value={uploadSourceChannel}
            onChange={(e) => setUploadSourceChannel((e.target as HTMLSelectElement).value)}
          >
            <option value="UPLOAD">Upload (Web)</option>
            <option value="SCAN">Scan</option>
            <option value="EMAIL">Email</option>
            <option value="API">API</option>
          </FormField>
          {selectedFolder && (
            <div style={{ fontSize: 11, color: "var(--sil)", marginBottom: 10 }}>
              Uploading to: <span style={{ color: "var(--gold3)" }}>{selectedFolder.path}</span>
            </div>
          )}
          <div style={{ marginBottom: 12 }}>
            <label style={{ display: "block", fontSize: 10.5, color: "var(--sil)", marginBottom: 4 }}>File</label>
            <input
              type="file"
              style={{ background: "rgba(15,23,42,.03)", border: "1px solid var(--bd)", borderRadius: 7, padding: "8px 12px", fontSize: 12, color: "var(--wh)", width: "100%" }}
              onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
              aria-label="file"
            />
          </div>
          {uploadMsg && (
            <div style={{ fontSize: 11, color: uploadMsg.includes("success") ? "var(--G)" : "var(--R)", marginBottom: 10 }}>
              {uploadMsg}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" className="btn bs" onClick={() => setUploadOpen(false)}>Cancel</button>
            <button type="submit" className="btn bg" disabled={uploading}>
              {uploading ? "Uploading…" : "Capture Document"}
            </button>
          </div>
        </form>
      </Modal>

      {/* ── New Folder Modal ── */}
      <Modal open={folderModalOpen} onClose={() => { setFolderModalOpen(false); setFolderMsg(""); }} title="New Folder" width={400}>
        <form onSubmit={handleCreateFolder} style={{ padding: "4px 0" }}>
          <FormField
            label="Folder Name"
            placeholder="e.g. KYC Documents"
            value={newFolderName}
            onChange={(e) => setNewFolderName((e.target as HTMLInputElement).value)}
          />
          <FormField
            as="select"
            label="Domain"
            value={newFolderDomain}
            onChange={(e) => setNewFolderDomain((e.target as HTMLSelectElement).value)}
          >
            <option value="">— Select domain —</option>
            <option value="Customers">Customers</option>
            <option value="Operations">Operations</option>
            <option value="Compliance">Compliance</option>
            <option value="Legal">Legal</option>
            <option value="IT">IT</option>
            <option value="General">General</option>
          </FormField>
          {selectedFolder && (
            <div style={{ fontSize: 11, color: "var(--sil)", marginBottom: 10 }}>
              Parent: <span style={{ color: "var(--gold3)" }}>{selectedFolder.path}</span>
            </div>
          )}
          {folderMsg && (
            <div style={{ fontSize: 11, color: folderMsg.includes("created") ? "var(--G)" : "var(--R)", marginBottom: 10 }}>
              {folderMsg}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" className="btn bs" onClick={() => setFolderModalOpen(false)}>Cancel</button>
            <button type="submit" className="btn bg" disabled={!newFolderName}>Create Folder</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
