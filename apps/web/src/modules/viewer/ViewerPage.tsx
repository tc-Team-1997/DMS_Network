import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Download, ArrowLeft, Sparkles, Braces, Table as TableIcon, Copy, Check, ShieldCheck, ShieldAlert, ShieldX, ChevronDown, ChevronUp } from 'lucide-react';
import { Badge, Button, Panel, statusTone } from '@/components/ui';
import { AIPanel } from '@/modules/docbrain/AIPanel';
import { RagChat } from '@/modules/docbrain/RagChat';
import { fetchDocumentTypes, tamperCheck, type DocumentType } from '@/modules/document-types/api';
import { fetchDocument } from './api';
import { AnnotationLayer } from './AnnotationLayer';

export function ViewerPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const docId = id ? Number(id) : NaN;

  const doc = useQuery({
    queryKey: ['document', docId],
    queryFn: () => fetchDocument(docId),
    enabled: Number.isFinite(docId),
  });
  const types = useQuery({
    queryKey: ['document-types', { active: false }],
    queryFn: () => fetchDocumentTypes(false),
  });

  // Hoist blob-fetch state above early returns to satisfy Rules of Hooks —
  // hooks must be called unconditionally every render.
  const isPdf = (doc.data?.mime_type ?? '').includes('pdf');
  const blobSrc = doc.data?.filename ? `/uploads/${doc.data.filename}` : null;

  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!isPdf || !blobSrc) { setBlobUrl(null); return; }
    let cancelled = false;
    let createdUrl: string | null = null;
    fetch(blobSrc, { credentials: 'include' })
      .then((r) => r.ok ? r.blob() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((blob) => {
        if (cancelled) return;
        createdUrl = URL.createObjectURL(blob);
        setBlobUrl(createdUrl);
      })
      .catch(() => { if (!cancelled) setBlobUrl(null); });
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [blobSrc, isPdf]);

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

  if (doc.isLoading) return <Panel>Loading…</Panel>;
  if (doc.error) return <Panel title="Not found"><p className="text-md text-danger">{doc.error.message}</p></Panel>;
  if (!doc.data) return null;

  const d = doc.data;
  const src = `/uploads/${d.filename}`;
  const isImage = (d.mime_type ?? '').startsWith('image/');

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-6">
      {/* Left: preview + chat */}
      <div className="space-y-6">
        <Panel
          title={d.original_name ?? d.filename}
          action={
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => navigate(-1)}>
                <ArrowLeft size={14} /> Back
              </Button>
              <a href={src} download>
                <Button size="sm"><Download size={14} /> Download</Button>
              </a>
            </div>
          }
        >
          <AnnotationLayer
            documentId={docId}
            isPdf={isPdf}
            src={src}
          >
            <div className="min-h-[520px] flex items-center justify-center">
              {isPdf && blobUrl && (
                <iframe title="Document preview" src={blobUrl} className="w-full h-[620px] border-0" />
              )}
              {isPdf && !blobUrl && (
                <p className="text-sm text-muted">Loading PDF…</p>
              )}
              {isImage && (
                <img src={src} alt="" className="max-h-[620px] max-w-full object-contain" />
              )}
              {!isPdf && !isImage && (
                <div className="text-center text-muted p-8">
                  <p className="text-md mb-2">Preview not available for {d.mime_type ?? 'this file type'}.</p>
                  <a href={src} download><Button size="sm">Download</Button></a>
                </div>
              )}
            </div>
          </AnnotationLayer>
        </Panel>

        <RagChat documentId={docId} />
      </div>

      {/* Right: metadata + AI panel */}
      <div className="space-y-6">
        <AIPanel documentId={docId} />

        <Panel title="Core metadata">
          <dl className="space-y-3 text-md">
            <Row label="Status"><Badge tone={statusTone(d.status)}>{d.status}</Badge></Row>
            <Row label="Type">{d.doc_type ?? '—'}</Row>
            <Row label="Branch">{d.branch ?? '—'}</Row>
            <Row label="Uploaded">{new Date(d.uploaded_at).toLocaleString()}</Row>
            <Row label="Size">{d.size ? `${(d.size / 1024).toFixed(0)} KB` : '—'}</Row>
            <Row label="OCR">
              {d.ocr_confidence != null
                ? <Badge tone={d.ocr_confidence > 90 ? 'success' : d.ocr_confidence > 70 ? 'warning' : 'danger'}>
                    {d.ocr_confidence.toFixed(1)}%
                  </Badge>
                : <span className="text-muted">pending</span>}
            </Row>
            {d.schema_id != null && (
              <Row label="Authenticity check">
                <TamperChip documentId={d.id} schemaId={d.schema_id} />
              </Row>
            )}
          </dl>
        </Panel>

        <CapturedMetadataPanel doc={d} types={types.data ?? null} />
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between items-start gap-4">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-ink text-right">{children}</dd>
    </div>
  );
}

// ---------- captured-metadata panel -------------------------------------

interface RawMeta {
  [k: string]: unknown;
}

function parseMeta(src: string | null): RawMeta {
  if (!src) return {};
  try {
    const parsed = JSON.parse(src);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as RawMeta) : {};
  } catch {
    return {};
  }
}

interface DocRowLike {
  doc_type: string | null;
  metadata_json: string | null;
}

function CapturedMetadataPanel({
  doc,
  types,
}: {
  doc: DocRowLike;
  types: DocumentType[] | null;
}) {
  const meta = useMemo(() => parseMeta(doc.metadata_json), [doc.metadata_json]);
  const [mode, setMode] = useState<'pretty' | 'raw'>('pretty');
  const [copied, setCopied] = useState(false);

  // Find the matching schema (by doc_type name) so we can render friendly
  // labels. Missing schema falls through to raw keys.
  const schema = useMemo<DocumentType | null>(() => {
    if (!types || !doc.doc_type) return null;
    return types.find((t) => t.name === doc.doc_type) ?? null;
  }, [types, doc.doc_type]);

  // Split metadata: schema-driven fields, extra keys, and the _ai provenance.
  const entries = Object.entries(meta);
  const aiInfo = (meta._ai as RawMeta | undefined) ?? undefined;
  const aiFields = (meta._ai_fields as Record<string, { value: string | null; confidence: number }> | undefined) ?? undefined;
  const schemaKeys = new Set((schema?.fields ?? []).map((f) => f.key));

  const primary = entries
    .filter(([k]) => !k.startsWith('_') && schemaKeys.has(k))
    .map(([k, v]) => ({ key: k, label: schema?.fields.find((f) => f.key === k)?.label ?? k, value: v }));

  const extras = entries
    .filter(([k]) => !k.startsWith('_') && !schemaKeys.has(k))
    .map(([k, v]) => ({ key: k, label: k, value: v }));

  const copyJson = async () => {
    await navigator.clipboard.writeText(JSON.stringify(meta, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  if (entries.length === 0) {
    return (
      <Panel title="Captured metadata">
        <p className="text-md text-muted py-3">
          No metadata captured for this document. Run <strong>Analyse</strong> above to populate it.
        </p>
      </Panel>
    );
  }

  return (
    <Panel
      title="Captured metadata"
      action={
        <div className="inline-flex rounded-input border border-border overflow-hidden" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'pretty'}
            onClick={() => setMode('pretty')}
            data-testid="viewer-meta-pretty"
            className={mode === 'pretty'
              ? 'px-2 py-0.5 text-[11px] bg-brand-blue text-white inline-flex items-center gap-1'
              : 'px-2 py-0.5 text-[11px] bg-white text-ink hover:bg-divider inline-flex items-center gap-1'}
          >
            <TableIcon size={11} /> Pretty
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'raw'}
            onClick={() => setMode('raw')}
            data-testid="viewer-meta-raw"
            className={mode === 'raw'
              ? 'px-2 py-0.5 text-[11px] bg-brand-blue text-white border-l border-border inline-flex items-center gap-1'
              : 'px-2 py-0.5 text-[11px] bg-white text-ink hover:bg-divider border-l border-border inline-flex items-center gap-1'}
          >
            <Braces size={11} /> JSON
          </button>
        </div>
      }
    >
      {mode === 'pretty' ? (
        <div className="space-y-4">
          {primary.length > 0 && (
            <section>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-1.5">
                {schema ? `${schema.name} fields` : 'Fields'}
              </p>
              <dl className="space-y-2">
                {primary.map((row) => (
                  <MetaRow key={row.key} row={row} {...(aiFields ? { aiFields } : {})} />
                ))}
              </dl>
            </section>
          )}

          {extras.length > 0 && (
            <section>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-1.5">Additional fields</p>
              <dl className="space-y-2">
                {extras.map((row) => (
                  <MetaRow key={row.key} row={row} {...(aiFields ? { aiFields } : {})} />
                ))}
              </dl>
            </section>
          )}

          {aiInfo && <AiProvenanceCard aiInfo={aiInfo} />}
        </div>
      ) : (
        <div className="relative">
          <button
            type="button"
            onClick={copyJson}
            data-testid="viewer-meta-copy"
            className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-input border border-border bg-white px-2 py-1 text-[11px] text-ink hover:bg-divider"
          >
            {copied ? <Check size={11} className="text-success" /> : <Copy size={11} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          <pre
            className="max-h-[480px] overflow-auto rounded-card border border-divider bg-page p-3 text-[11px] leading-relaxed font-mono text-ink"
            data-testid="viewer-meta-json"
          >
            {JSON.stringify(meta, null, 2)}
          </pre>
        </div>
      )}
    </Panel>
  );
}

function MetaRow({
  row,
  aiFields,
}: {
  row: { key: string; label: string; value: unknown };
  aiFields?: Record<string, { value: string | null; confidence: number }>;
}) {
  const ai = aiFields?.[row.key];
  const displayValue =
    row.value == null
      ? '—'
      : typeof row.value === 'string'
        ? row.value
        : JSON.stringify(row.value);
  return (
    <div className="flex justify-between items-start gap-3 text-xs">
      <dt className="text-muted font-medium flex-shrink-0 min-w-[90px]">{row.label}</dt>
      <dd className="flex-1 text-right text-ink break-words flex flex-wrap justify-end items-center gap-1.5">
        <span>{displayValue}</span>
        {ai && ai.confidence > 0 && (
          <Badge
            tone={ai.confidence >= 0.7 ? 'purple' : 'warning'}
            className="inline-flex items-center gap-1 normal-case"
          >
            <Sparkles size={9} /> AI · {Math.round(ai.confidence * 100)}%
          </Badge>
        )}
      </dd>
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
    // Lazy: only runs on first render (staleTime 0 means it runs immediately when mounted)
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
    verdict === 'verified' ? <ShieldCheck size={13} className="text-success" /> :
    verdict === 'tampered' ? <ShieldX size={13} className="text-danger" /> :
    <ShieldAlert size={13} className="text-warning" />;

  const label =
    verdict === 'verified' ? 'Verified' :
    verdict === 'tampered' ? `Tampered (${reasons.length} reason${reasons.length === 1 ? '' : 's'})` :
    'Needs review';

  const tone: 'success' | 'danger' | 'warning' =
    verdict === 'verified' ? 'success' :
    verdict === 'tampered' ? 'danger' :
    'warning';

  return (
    <div className="inline-flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label="Toggle authenticity details"
        data-testid="tamper-chip"
      >
        <Badge tone={tone} className="inline-flex items-center gap-1 cursor-pointer">
          {icon}
          {label}
          {reasons.length > 0 && (expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />)}
        </Badge>
      </button>
      {expanded && reasons.length > 0 && (
        <ul
          className="mt-1 text-right space-y-0.5 text-[11px] text-muted"
          data-testid="tamper-reasons"
        >
          {reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AiProvenanceCard({ aiInfo }: { aiInfo: RawMeta }) {
  const cls = (aiInfo.classification as RawMeta | undefined) ?? undefined;
  const ocr = (aiInfo.ocr as RawMeta | undefined) ?? undefined;
  const extractedAt = typeof aiInfo.extracted_at === 'string' ? aiInfo.extracted_at : undefined;
  const chunks = typeof aiInfo.chunks_indexed === 'number' ? aiInfo.chunks_indexed : undefined;
  return (
    <section
      className="rounded-card border border-brand-blue/20 bg-brand-skyLight/30 p-3"
      data-testid="viewer-meta-ai"
    >
      <p className="text-[10px] font-semibold uppercase tracking-wider text-brand-blue mb-1.5 inline-flex items-center gap-1">
        <Sparkles size={10} /> AI provenance
      </p>
      <dl className="space-y-1 text-[11px]">
        {cls && (
          <>
            <div className="flex justify-between gap-2">
              <dt className="text-muted">Classified as</dt>
              <dd className="text-ink">
                {String(cls.doc_class ?? '—')}
                {typeof cls.confidence === 'number' && ` · ${Math.round(cls.confidence * 100)}%`}
              </dd>
            </div>
            {typeof cls.reasoning === 'string' && cls.reasoning && (
              <div className="text-muted italic">{cls.reasoning}</div>
            )}
          </>
        )}
        {ocr && (
          <div className="flex justify-between gap-2">
            <dt className="text-muted">OCR</dt>
            <dd className="text-ink">
              {typeof ocr.pages === 'number' ? `${ocr.pages}p` : ''}
              {typeof ocr.mean_confidence === 'number' && ` · ${Math.round(ocr.mean_confidence)}%`}
              {typeof ocr.backend === 'string' && ocr.backend !== 'tesseract' ? ` · via ${ocr.backend}` : ''}
            </dd>
          </div>
        )}
        {chunks != null && (
          <div className="flex justify-between gap-2">
            <dt className="text-muted">Chunks indexed</dt>
            <dd className="text-ink">{chunks}</dd>
          </div>
        )}
        {extractedAt && (
          <div className="flex justify-between gap-2">
            <dt className="text-muted">Extracted</dt>
            <dd className="text-ink">{new Date(extractedAt).toLocaleString()}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}
