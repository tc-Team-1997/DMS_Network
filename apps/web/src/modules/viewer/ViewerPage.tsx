/**
 * ViewerPage v2 — Viewer + AI redesign (Wave A).
 *
 * Layout: toolbar | ( thumbnail rail | PDF canvas | right rail tabs )
 *
 * PDF is rendered via PDF.js (pdfjs-dist, lazy-loaded chunk).
 * tenant_config namespace='viewer' gates print/download/tools.
 */

import {
  lazy,
  Suspense,
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Sparkles,
  Highlighter,
  MessageSquare,
  Clock,
  GitBranch,
  Lock,
  LockOpen,
  ChevronDown,
  ChevronUp,
  Braces,
  Table as TableIcon,
  Check,
  Copy,
  ShieldCheck,
  ShieldAlert,
  ShieldX,
} from 'lucide-react';
import {
  Badge,
  Button,
  Panel,
  Tabs,
  TabList,
  Tab,
  TabPanel,
  statusTone,
} from '@/components/ui';
import { HttpError } from '@/lib/http';
import { cn } from '@/lib/cn';
import { useAuth } from '@/store/auth';
import { useTenantConfig } from '@/store/tenant-config';
import { WormBadge } from '@/modules/worm/components/WormBadge';
import { WormLockDialog } from '@/modules/worm/components/WormLockDialog';
import { WormUnlockDialog } from '@/modules/worm/components/WormUnlockDialog';
import { fetchWormStatus, FF_WORM } from '@/modules/worm/api';
import { t } from '@/lib/i18n';
import { fetchDocumentTypes, tamperCheck, type DocumentType } from '@/modules/document-types/api';
import { TranslateButton, SideBySideView } from '@/modules/translate';
import { translateDocument } from '@/modules/translate/api';
import type { TranslationResult, TargetLang } from '@/modules/translate/schemas';
import { RagChat } from '@/modules/docbrain/RagChat';

import { fetchDocument } from './api';
import { usePdfDocument } from './hooks/usePdfDocument';
import { useScrollToSpan } from './hooks/useScrollToSpan';
import { Toolbar } from './components/Toolbar';
import { ExtractedFields } from './components/ExtractedFields';
import { AnnotationsPanel } from './components/AnnotationsPanel';
import { VersionsPanel } from './components/VersionsPanel';
import { AuditPanel } from './components/AuditPanel';
import { AnnotationLayer } from './AnnotationLayer';

// Lazy-loaded — PDF.js only needed on /viewer/:id
const PdfCanvas = lazy(() =>
  import('./components/PdfCanvas').then((m) => ({ default: m.PdfCanvas })),
);
const Thumbnails = lazy(() =>
  import('./components/Thumbnails').then((m) => ({ default: m.Thumbnails })),
);

// ── viewer config ─────────────────────────────────────────────────────────────

function useViewerConfig() {
  const cfg = useTenantConfig('viewer');
  const data = cfg.data ?? {};
  return {
    printEnabled:    data['print_enabled']    !== false,
    downloadEnabled: data['download_enabled'] !== false,
  };
}

// ── main page ─────────────────────────────────────────────────────────────────

export function ViewerPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const docId = id !== undefined ? Number(id) : NaN;

  // — all hooks unconditional —
  const role   = useAuth((s) => s.user?.role);
  const isAdmin = role === 'Doc Admin';

  const pdfState    = usePdfDocument();
  const spanHighlight = useScrollToSpan(docId, pdfState);

  const viewerCfg = useViewerConfig();

  const [wormDialog, setWormDialog]               = useState<'lock' | 'unlock' | null>(null);
  const [activeTab, setActiveTab]                 = useState('fields');
  const [showSideBySide, setShowSideBySide]       = useState(false);
  const [translationResult, setTranslationResult] = useState<TranslationResult | null>(null);

  // Reset translation state when docId changes
  const prevDocId = useRef<number | null>(null);
  if (prevDocId.current !== docId) {
    prevDocId.current = docId;
    if (translationResult !== null) setTranslationResult(null);
    if (showSideBySide)             setShowSideBySide(false);
  }

  const doc = useQuery({
    queryKey: ['document', docId],
    queryFn: () => fetchDocument(docId),
    enabled: Number.isFinite(docId),
  });

  const types = useQuery({
    queryKey: ['document-types', { active: false }],
    queryFn: () => fetchDocumentTypes(false),
  });

  const wormStatus = useQuery({
    queryKey: ['worm', 'status', docId],
    queryFn: () => fetchWormStatus(docId),
    enabled: FF_WORM && Number.isFinite(docId),
    staleTime: 2 * 60 * 1000,
  });

  const translateMutation = useMutation({
    mutationFn: ({ target }: { target: TargetLang }) =>
      translateDocument(docId, target),
    onSuccess: (result) => {
      setTranslationResult(result);
      setShowSideBySide(true);
    },
  });

  const handleTranslate = useCallback(
    (target: TargetLang) => {
      translateMutation.mutate({ target });
      setShowSideBySide(true);
    },
    [translateMutation],
  );

  const handleSignAndSend = useCallback(() => {
    navigate(`/workflows?doc_id=${docId}`);
  }, [navigate, docId]);

  // ── early returns ─────────────────────────────────────────────────────────
  if (!Number.isFinite(docId)) {
    return (
      <Panel title="No document selected">
        <p className="text-md text-muted">
          Open a document from the{' '}
          <Link to="/repository" className="text-brand-blue hover:underline">repository</Link>.
        </p>
      </Panel>
    );
  }

  if (doc.isLoading) {
    return <Panel><p className="animate-pulse text-sm text-muted">Loading…</p></Panel>;
  }
  if (doc.error) {
    return (
      <Panel title="Not found">
        <p className="text-md text-danger">
          {doc.error instanceof HttpError ? doc.error.message : 'Document not found'}
        </p>
      </Panel>
    );
  }
  if (!doc.data) return null;

  const d = doc.data;
  const isPdf   = (d.mime_type ?? '').includes('pdf');
  const isImage = (d.mime_type ?? '').startsWith('image/');
  const pdfUrl  = `/uploads/${d.filename}`;

  // ── canvas area (shared between normal and side-by-side) ─────────────────

  const canvasContent = (
    <div className="flex flex-1 min-h-0 overflow-hidden">
      {/* Thumbnail rail */}
      {isPdf && pdfState.numPages > 0 && (
        <Suspense
          fallback={
            <div className="w-24 border-r border-divider bg-surface-alt animate-pulse flex-shrink-0" />
          }
        >
          <Thumbnails
            url={pdfUrl}
            numPages={pdfState.numPages}
            currentPage={pdfState.page}
            onPageSelect={pdfState.setPage}
          />
        </Suspense>
      )}

      {/* Main PDF or image */}
      <div className="flex-1 min-w-0 overflow-hidden">
        {isPdf ? (
          <Suspense
            fallback={
              <div className="flex items-center justify-center h-full bg-page">
                <span className="text-sm text-muted animate-pulse">Loading PDF renderer…</span>
              </div>
            }
          >
            <PdfCanvas
              url={pdfUrl}
              page={pdfState.page}
              zoom={pdfState.zoom}
              rotation={pdfState.rotation}
              searchQuery={pdfState.searchQuery}
              highlight={spanHighlight}
              onNumPages={pdfState.setNumPages}
              onMatchCount={pdfState.setSearchMatchCount}
              className="h-full"
            />
          </Suspense>
        ) : isImage ? (
          <div className="flex items-center justify-center h-full bg-page p-4">
            <img
              src={pdfUrl}
              alt={d.original_name ?? d.filename}
              className="max-h-full max-w-full object-contain"
            />
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-center p-8 bg-page">
            <p className="text-md text-muted mb-2">
              Preview not available for {d.mime_type ?? 'this file type'}.
            </p>
            <a href={pdfUrl} download>
              <Button size="sm">Download</Button>
            </a>
          </div>
        )}
      </div>
    </div>
  );

  // Wrap in annotation layer (draws annotation overlays + redaction mode)
  const annotatedCanvas = (
    <AnnotationLayer
      documentId={docId}
      isPdf={isPdf}
      src={pdfUrl}
      userRole={role}
      currentPage={pdfState.page}
      className="flex-1 min-h-0"
    >
      {canvasContent}
    </AnnotationLayer>
  );

  return (
    <div
      className={cn(
        'flex flex-col overflow-hidden',
        pdfState.isFullscreen
          ? 'fixed inset-0 z-50 bg-white'
          : 'h-[calc(100vh-4rem)]',
      )}
    >
      {/* Toolbar */}
      <Toolbar
        pdfState={pdfState}
        filename={d.original_name ?? d.filename}
        downloadHref={pdfUrl}
        printEnabled={viewerCfg.printEnabled}
        downloadEnabled={viewerCfg.downloadEnabled}
        onSignAndSend={handleSignAndSend}
      />

      {/* Back + translate breadcrumb bar */}
      <div className="flex items-center gap-2 px-4 py-1.5 border-b border-divider bg-white flex-wrap flex-shrink-0">
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <ArrowLeft size={13} /> Back
        </Button>
        <span className="text-sm font-medium text-ink truncate flex-1 min-w-0">
          {d.original_name ?? d.filename}
        </span>
        <TranslateButton
          onTranslate={handleTranslate}
          loading={translateMutation.isPending}
          hasResult={translationResult !== null}
        />
      </div>

      {/* Three-column body */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Centre: canvas + RAG chat */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          <div className="flex-1 min-h-0 overflow-hidden">
            {showSideBySide ? (
              <SideBySideView
                originalContent={annotatedCanvas}
                translation={translationResult}
                loading={translateMutation.isPending}
                onClose={() => setShowSideBySide(false)}
              />
            ) : (
              annotatedCanvas
            )}
          </div>
          <div className="flex-shrink-0 border-t border-divider max-h-56 overflow-y-auto">
            <RagChat documentId={docId} />
          </div>
        </div>

        {/* Right rail: 320px, tabs */}
        <aside
          className="w-80 flex-shrink-0 border-l border-divider bg-white flex flex-col overflow-hidden"
          aria-label="Document details"
        >
          <Tabs
            defaultValue="fields"
            value={activeTab}
            onChange={setActiveTab}
            className="flex flex-col h-full"
          >
            <TabList className="flex-shrink-0 overflow-x-auto border-b border-divider">
              <Tab value="fields">
                <Sparkles size={11} /> Fields
              </Tab>
              <Tab value="annotations">
                <Highlighter size={11} /> Notes
              </Tab>
              <Tab value="versions">
                <GitBranch size={11} /> Versions
              </Tab>
              <Tab value="audit">
                <Clock size={11} /> Audit
              </Tab>
            </TabList>

            <div className="flex-1 min-h-0 overflow-y-auto">
              <TabPanel value="fields">
                <ExtractedFields documentId={docId} />
              </TabPanel>
              <TabPanel value="annotations">
                <AnnotationsPanel
                  documentId={docId}
                  onAdd={() => { /* AnnotationLayer toolbar handles tool activation */ }}
                />
              </TabPanel>
              <TabPanel value="versions">
                <VersionsPanel documentId={docId} currentFilename={d.filename} />
              </TabPanel>
              <TabPanel value="audit">
                <AuditPanel documentId={docId} />
              </TabPanel>
            </div>

            {/* Core metadata below tabs */}
            <div className="flex-shrink-0 border-t border-divider overflow-y-auto max-h-72">
              <CoreMetadataSection
                d={d}
                isAdmin={isAdmin}
                wormStatus={wormStatus.data ?? null}
                onWormLock={() => setWormDialog('lock')}
                onWormUnlock={() => setWormDialog('unlock')}
                types={types.data ?? null}
                docId={docId}
              />
            </div>
          </Tabs>
        </aside>
      </div>

      {/* WORM dialogs */}
      {FF_WORM && wormDialog === 'lock' && (
        <WormLockDialog
          documentId={d.id}
          documentName={d.original_name ?? d.filename}
          onClose={() => setWormDialog(null)}
          onLocked={() => {
            setWormDialog(null);
            void qc.invalidateQueries({ queryKey: ['worm', 'status', docId] });
          }}
        />
      )}
      {FF_WORM && wormDialog === 'unlock' && (
        <WormUnlockDialog
          documentId={d.id}
          documentName={d.original_name ?? d.filename}
          unlockAfter={wormStatus.data?.unlock_after ?? null}
          onClose={() => setWormDialog(null)}
          onUnlocked={() => {
            setWormDialog(null);
            void qc.invalidateQueries({ queryKey: ['worm', 'status', docId] });
          }}
        />
      )}
    </div>
  );
}

// ── CoreMetadataSection ───────────────────────────────────────────────────────

interface WormStatusLike {
  worm_locked?: boolean;
  unlock_after?: string | null;
}

interface DocLike {
  id: number;
  filename: string;
  original_name: string | null;
  status: string;
  doc_type: string | null;
  branch: string | null;
  uploaded_at: string;
  size: number | null;
  ocr_confidence: number | null;
  schema_id?: number | null | undefined;
  metadata_json?: string | null | undefined;
}

function CoreMetadataSection({
  d,
  isAdmin,
  wormStatus,
  onWormLock,
  onWormUnlock,
  types,
  docId,
}: {
  d: DocLike;
  isAdmin: boolean;
  wormStatus: WormStatusLike | null;
  onWormLock: () => void;
  onWormUnlock: () => void;
  types: DocumentType[] | null;
  docId: number;
}) {
  return (
    <div className="p-4 space-y-3">
      <p className="text-2xs font-semibold uppercase tracking-wide text-muted">Core metadata</p>
      <dl className="space-y-2 text-xs">
        <MetaRow label="Status">
          <Badge tone={statusTone(d.status)}>{d.status}</Badge>
        </MetaRow>
        <MetaRow label="Type">{d.doc_type ?? '—'}</MetaRow>
        <MetaRow label="Branch">{d.branch ?? '—'}</MetaRow>
        <MetaRow label="Uploaded">
          {new Date(d.uploaded_at).toLocaleString()}
        </MetaRow>
        <MetaRow label="Size">
          {d.size != null ? `${(d.size / 1024).toFixed(0)} KB` : '—'}
        </MetaRow>
        <MetaRow label="OCR">
          {d.ocr_confidence != null ? (
            <Badge
              tone={
                d.ocr_confidence > 90 ? 'success' :
                d.ocr_confidence > 70 ? 'warning' : 'danger'
              }
            >
              {d.ocr_confidence.toFixed(1)}%
            </Badge>
          ) : (
            <span className="text-muted">pending</span>
          )}
        </MetaRow>
        {d.schema_id != null && (
          <MetaRow label="Authenticity">
            <TamperChip documentId={d.id} schemaId={d.schema_id} />
          </MetaRow>
        )}
        {FF_WORM && (
          <MetaRow label="Retention">
            <WormBadge documentId={d.id} />
          </MetaRow>
        )}
      </dl>

      {FF_WORM && isAdmin && (
        <div className="flex gap-2 justify-end pt-1 border-t border-divider">
          {wormStatus?.worm_locked === true ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid="worm-unlock-button"
              onClick={onWormUnlock}
            >
              <LockOpen size={13} aria-hidden="true" />
              {t('worm.unlock_button')}
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid="worm-lock-button"
              onClick={onWormLock}
            >
              <Lock size={13} aria-hidden="true" />
              {t('worm.lock_button')}
            </Button>
          )}
        </div>
      )}

      {d.metadata_json && d.metadata_json !== 'null' && (
        <CapturedMetadataPanel doc={d} types={types} />
      )}

      {/* Ask the document stub (Wave C) */}
      <div className="pt-2 border-t border-divider">
        <a
          href={`/docbrain?doc_id=${docId}`}
          className="inline-flex items-center gap-1.5 text-xs text-brand-blue hover:underline"
          data-testid="ask-document-link"
        >
          <MessageSquare size={11} />
          Ask the document (DocBrain)
        </a>
      </div>
    </div>
  );
}

function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between items-start gap-4">
      <dt className="text-muted flex-shrink-0">{label}</dt>
      <dd className="text-ink text-right">{children}</dd>
    </div>
  );
}

// ── Captured metadata ─────────────────────────────────────────────────────────

interface RawMeta { [k: string]: unknown }

function parseMeta(src: string | null | undefined): RawMeta {
  if (!src) return {};
  try {
    const p = JSON.parse(src);
    return p && typeof p === 'object' && !Array.isArray(p) ? (p as RawMeta) : {};
  } catch { return {}; }
}

function CapturedMetadataPanel({
  doc,
  types,
}: {
  doc: { doc_type: string | null; metadata_json?: string | null | undefined };
  types: DocumentType[] | null;
}) {
  const meta = useMemo(() => parseMeta(doc.metadata_json), [doc.metadata_json]);
  const [mode, setMode]   = useState<'pretty' | 'raw'>('pretty');
  const [copied, setCopied] = useState(false);

  const schema = useMemo<DocumentType | null>(() => {
    if (!types || !doc.doc_type) return null;
    return types.find((t) => t.name === doc.doc_type) ?? null;
  }, [types, doc.doc_type]);

  const entries    = Object.entries(meta);
  const aiFields   = (meta._ai_fields as Record<string, { value: string | null; confidence: number }> | undefined) ?? undefined;
  const schemaKeys = new Set((schema?.fields ?? []).map((f) => f.key));

  const rows = entries
    .filter(([k]) => !k.startsWith('_'))
    .map(([k, v]) => ({
      key: k,
      label: schemaKeys.has(k)
        ? (schema?.fields.find((f) => f.key === k)?.label ?? k)
        : k,
      value: v,
    }));

  if (rows.length === 0) return null;

  const copyJson = async () => {
    await navigator.clipboard.writeText(JSON.stringify(meta, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className="pt-2 border-t border-divider">
      <div className="flex items-center justify-between mb-2">
        <p className="text-2xs font-semibold uppercase tracking-wide text-muted">
          Captured metadata
        </p>
        <div className="inline-flex rounded-input border border-border overflow-hidden" role="tablist">
          {(['pretty', 'raw'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => setMode(m)}
              data-testid={`viewer-meta-${m}`}
              className={cn(
                'px-1.5 py-0.5 text-2xs inline-flex items-center gap-0.5',
                m !== 'pretty' && 'border-l border-border',
                mode === m ? 'bg-brand-blue text-white' : 'bg-white text-ink hover:bg-divider',
              )}
            >
              {m === 'pretty' ? <><TableIcon size={9} /> Pretty</> : <><Braces size={9} /> JSON</>}
            </button>
          ))}
        </div>
      </div>

      {mode === 'pretty' ? (
        <dl className="space-y-1.5">
          {rows.map((row) => {
            const ai = aiFields?.[row.key];
            const display =
              row.value == null ? '—'
              : typeof row.value === 'string' ? row.value
              : JSON.stringify(row.value);
            return (
              <div key={row.key} className="flex justify-between items-start gap-2 text-2xs">
                <dt className="text-muted flex-shrink-0">{row.label}</dt>
                <dd className="text-ink text-right flex flex-wrap justify-end items-center gap-1">
                  <span>{display}</span>
                  {ai && ai.confidence > 0 && (
                    <Badge
                      tone={ai.confidence >= 0.7 ? 'purple' : 'warning'}
                      className="inline-flex items-center gap-0.5 normal-case"
                    >
                      <Sparkles size={8} /> AI · {Math.round(ai.confidence * 100)}%
                    </Badge>
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
      ) : (
        <div className="relative">
          <button
            type="button"
            onClick={copyJson}
            data-testid="viewer-meta-copy"
            className="absolute top-1.5 right-1.5 inline-flex items-center gap-1 rounded-input border border-border bg-white px-1.5 py-0.5 text-2xs text-ink hover:bg-divider"
          >
            {copied ? <Check size={9} className="text-success" /> : <Copy size={9} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          <pre
            className="max-h-40 overflow-auto rounded-card border border-divider bg-page p-2 text-2xs leading-relaxed font-mono text-ink"
            data-testid="viewer-meta-json"
          >
            {JSON.stringify(meta, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

// ── TamperChip ────────────────────────────────────────────────────────────────

function TamperChip({
  documentId,
  schemaId,
}: {
  documentId: number;
  schemaId: number;
}) {
  const [expanded, setExpanded] = useState(false);

  const query = useQuery({
    queryKey: ['tamper-check', documentId, schemaId],
    queryFn: () => tamperCheck(schemaId, documentId),
    staleTime: 5 * 60 * 1000,
  });

  if (query.isLoading) {
    return <span className="text-xs text-muted animate-pulse">Checking…</span>;
  }
  if (query.isError || !query.data) {
    return <span className="text-xs text-muted">—</span>;
  }

  const { verdict, reasons } = query.data;

  const icon =
    verdict === 'verified' ? <ShieldCheck size={12} className="text-success" /> :
    verdict === 'tampered' ? <ShieldX size={12} className="text-danger" /> :
    <ShieldAlert size={12} className="text-warning" />;

  const label =
    verdict === 'verified' ? 'Verified' :
    verdict === 'tampered' ? `Tampered (${reasons.length})` :
    'Needs review';

  const tone: 'success' | 'danger' | 'warning' =
    verdict === 'verified' ? 'success' :
    verdict === 'tampered' ? 'danger' : 'warning';

  return (
    <div className="inline-flex flex-col items-end gap-0.5">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label="Toggle authenticity details"
        data-testid="tamper-chip"
      >
        <Badge tone={tone} className="inline-flex items-center gap-1 cursor-pointer">
          {icon} {label}
          {reasons.length > 0 && (expanded ? <ChevronUp size={9} /> : <ChevronDown size={9} />)}
        </Badge>
      </button>
      {expanded && reasons.length > 0 && (
        <ul
          className="mt-0.5 text-right space-y-0.5 text-2xs text-muted"
          data-testid="tamper-reasons"
        >
          {reasons.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      )}
    </div>
  );
}
