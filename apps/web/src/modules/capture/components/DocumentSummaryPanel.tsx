/**
 * DocumentSummaryPanel — right-hand review panel shown in single-file mode.
 *
 * States:
 *   no file selected → capture guidelines
 *   preview running  → loading state with simple spinner
 *   preview error    → error card + retry
 *   preview done     → classification + OCR summary + extracted field list
 *
 * Also renders AiPipelineProgress and dedup result after a successful upload.
 */

import { FileText, Sparkles, Wand2, AlertCircle, CheckCircle2, Link as LinkIcon } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { Badge, Button, Panel } from '@/components/ui';
import { cn } from '@/lib/cn';
import { Link } from 'react-router-dom';
import type { Extraction, PreviewResponse } from '../api';
import { fetchDedupMatches } from '../api';
import type { AutoRouted } from '../api';
import { AiPipelineProgress } from './AiPipelineProgress';
import { AutoRoutedBadge } from './AutoRoutedBadge';
import { DEFAULT_CONFIDENCE_HIGH, DEFAULT_AUTOFILL_FLOOR, MAX_FILES } from '../constants';
import { fmtSize } from '../utils';

// ---------------------------------------------------------------------------
// DedupSummary — shown per uploaded doc when dedup decisions exist
// ---------------------------------------------------------------------------

function DedupSummary({ docId }: { docId: number }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['dedup-matches', docId],
    queryFn: () => fetchDedupMatches(docId),
    staleTime: 60_000,
  });

  if (isLoading) return null;
  if (isError || !data || data.matches.length === 0) return null;

  const nonUnique = data.matches.filter(
    (m) => m.decision === 'duplicate' || m.decision === 'near',
  );
  if (nonUnique.length === 0) return null;

  return (
    <div className="rounded-lg border border-warning/30 bg-warning-bg px-3 py-2 space-y-1.5" data-testid="capture-dedup-banner">
      <p className="text-xs font-medium text-warning flex items-center gap-1.5">
        <AlertCircle size={12} aria-hidden="true" /> Potential duplicate detected
      </p>
      {nonUnique.map((m) => (
        <div key={m.id} className="flex items-center gap-2 flex-wrap">
          <Badge
            tone={m.decision === 'duplicate' ? 'danger' : 'warning'}
            className="text-[10px] normal-case"
          >
            {m.decision === 'duplicate' ? 'SHA-exact match' : 'Near duplicate'}
            {m.score != null ? ` · ${(m.score * 100).toFixed(0)}%` : ''}
          </Badge>
          {m.matched_doc_id != null && (
            <Link
              to={`/viewer/${m.matched_doc_id}`}
              className="inline-flex items-center gap-1 text-[10px] text-brand-blue hover:underline"
              data-testid="capture-dedup-link-existing"
            >
              <LinkIcon size={9} aria-hidden="true" />
              Link to existing doc #{m.matched_doc_id}
            </Link>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ExtractedRow
// ---------------------------------------------------------------------------

function ExtractedRow({
  label,
  field,
}: {
  label: string;
  field: { value: string | null; confidence: number };
}) {
  const present = !!field.value;
  const tone =
    field.confidence >= DEFAULT_CONFIDENCE_HIGH ? 'success'
    : field.confidence >= DEFAULT_AUTOFILL_FLOOR  ? 'warning'
    : 'neutral';
  return (
    <div className="flex items-baseline gap-2">
      <dt className="w-32 shrink-0 text-muted truncate">{label}</dt>
      <dd className="flex-1 min-w-0">
        {present ? (
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-mono text-ink truncate max-w-full" title={field.value ?? ''}>
              {field.value}
            </span>
            <Badge tone={tone}>{Math.round(field.confidence * 100)}%</Badge>
          </div>
        ) : (
          <span className="text-muted italic">not detected</span>
        )}
      </dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const EXTRACT_ROWS: Array<{ key: keyof Extraction; label: string }> = [
  { key: 'customer_cid',      label: 'Customer CID' },
  { key: 'customer_name',     label: 'Customer name' },
  { key: 'doc_number',        label: 'Document number' },
  { key: 'dob',               label: 'Date of birth' },
  { key: 'issue_date',        label: 'Issue date' },
  { key: 'expiry_date',       label: 'Expiry date' },
  { key: 'issuing_authority', label: 'Issuing authority' },
  { key: 'address',           label: 'Address' },
];

interface DocumentSummaryPanelProps {
  file: File | null;
  status: 'idle' | 'running' | 'done' | 'error';
  preview: PreviewResponse | null;
  onRetry: () => void;
  error: string | null;
  /** Set after a successful upload to show pipeline + dedup info. */
  lastUploadId?: number | null;
  lastAutoRouted?: AutoRouted | null;
  uploadedOcr?: number | null;
  uploadedDocType?: string | null;
  uploadedOcrText?: string | null;
}

export function DocumentSummaryPanel({
  file,
  status,
  preview,
  onRetry,
  error,
  lastUploadId = null,
  lastAutoRouted = null,
  uploadedOcr = null,
  uploadedDocType = null,
  uploadedOcrText = null,
}: DocumentSummaryPanelProps) {
  if (!file) {
    return (
      <Panel title="Capture guidelines">
        <ul className="space-y-2 text-md text-muted">
          <li>• Form fields come from admin-configured per-type schemas at /admin/document-types.</li>
          <li>• AI auto-fill runs on the selected file before upload. Edit any field to override.</li>
          <li>• Required fields (marked *) block upload if empty.</li>
          <li>• Scanned PDFs under 10 MB OCR fastest.</li>
          <li>• Expiry date drives alerts — fill it when known.</li>
          <li>• Drop up to {MAX_FILES} files at once for batch upload.</li>
        </ul>
      </Panel>
    );
  }

  if (status === 'running') {
    return (
      <Panel
        title="Document summary"
        action={
          <span className="inline-flex items-center gap-1.5 text-xs text-brand-blue">
            <Wand2 size={12} className="animate-pulse" aria-hidden="true" /> Analysing…
          </span>
        }
      >
        <div className="space-y-3" data-testid="capture-summary-loading">
          <p className="text-md text-muted">
            DocBrain is reading <span className="font-medium text-ink">{file.name}</span>. This runs
            OCR across every page, classifies the document, and pulls every field we can identify.
          </p>
          {/* Restrained loading indicator — no QuantumLoader */}
          <div className="flex items-center justify-center h-32 rounded-card bg-brand-skyLight/20">
            <Wand2 size={28} className="text-brand-blue/40 motion-safe:animate-pulse" aria-label="Processing…" />
          </div>
        </div>
      </Panel>
    );
  }

  if (status === 'error') {
    return (
      <Panel title="Document summary">
        <div className="space-y-3" data-testid="capture-summary-error">
          <div className="flex items-start gap-2 rounded-card border border-danger/30 bg-danger-bg p-3 text-xs text-danger">
            <AlertCircle size={13} className="mt-0.5 shrink-0" />
            <div>
              <p className="font-medium">AI preview failed</p>
              <p className="mt-0.5">{error ?? 'The analyser did not return a response.'}</p>
            </div>
          </div>
          <Button size="sm" variant="secondary" onClick={onRetry}>Retry preview</Button>
        </div>
      </Panel>
    );
  }

  if (!preview) return null;
  const cls = preview.classification;
  const ocr = preview.ocr;
  const ext = preview.extraction;
  const capturedCount = EXTRACT_ROWS.filter((r) => !!ext[r.key].value).length;

  return (
    <Panel
      title="Document summary"
      action={
        <Badge tone={cls.confidence >= DEFAULT_CONFIDENCE_HIGH ? 'success' : 'warning'}>
          {cls.doc_class} · {Math.round(cls.confidence * 100)}%
        </Badge>
      }
    >
      <div className="space-y-4" data-testid="capture-summary-done">
        <div className="flex items-start gap-2 text-md text-ink">
          <FileText size={14} className="text-brand-blue mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="font-medium truncate" title={file.name}>{file.name}</p>
            <p className="text-xs text-muted">
              {fmtSize(file.size)} · {file.type || 'unknown'}
            </p>
          </div>
        </div>

        {preview.summary && (
          <div className="rounded-input bg-brand-skyLight/40 border border-brand-blue/20 px-3 py-2">
            <p className="text-xs font-medium text-brand-blue mb-1 inline-flex items-center gap-1">
              <Sparkles size={10} aria-hidden="true" /> AI summary
            </p>
            <p className="text-xs text-ink leading-relaxed">{preview.summary}</p>
          </div>
        )}

        {cls.reasoning && (
          <div>
            <p className="text-xs font-medium text-muted mb-1">Classification</p>
            <p className="text-xs text-ink leading-relaxed">{cls.reasoning}</p>
            {cls.alternative && (
              <p className="text-[11px] text-muted mt-1">Alternative considered: {cls.alternative}</p>
            )}
          </div>
        )}

        <div>
          <p className="text-xs font-medium text-muted mb-1">OCR</p>
          <div className="flex flex-wrap gap-1.5">
            <Badge tone="blue">{ocr.pages} page{ocr.pages === 1 ? '' : 's'}</Badge>
            <Badge tone={ocr.mean_confidence >= 85 ? 'success' : ocr.mean_confidence >= 70 ? 'warning' : 'danger'}>
              {ocr.mean_confidence.toFixed(0)}% text clarity
            </Badge>
            {ocr.backend && ocr.backend !== 'tesseract' && ocr.backend !== 'passthrough' && (
              <Badge tone="purple" className={cn('inline-flex items-center gap-1 normal-case')}>
                <Sparkles size={9} aria-hidden="true" /> {ocr.backend}
              </Badge>
            )}
            <Badge tone="neutral">{ocr.languages.join(', ') || 'unknown'}</Badge>
          </div>
        </div>

        <div>
          <p className="text-xs font-medium text-muted mb-2">
            Extracted fields ({capturedCount} / {EXTRACT_ROWS.length})
          </p>
          <dl className="space-y-1.5 text-xs">
            {EXTRACT_ROWS.map(({ key, label }) => (
              <ExtractedRow key={key} label={label} field={ext[key]} />
            ))}
          </dl>
        </div>

        {/* Post-upload: pipeline progress + dedup + auto-route */}
        {lastUploadId != null && (
          <div className="space-y-3 pt-2 border-t border-divider">
            <div className="rounded-lg bg-success-bg border border-success/30 px-3 py-2 text-xs text-success flex items-center gap-2 font-medium">
              <CheckCircle2 size={14} /> Uploaded as document #{lastUploadId}
            </div>
            {lastAutoRouted != null && (
              <AutoRoutedBadge
                folderName={lastAutoRouted.folder_name}
                documentId={lastUploadId}
              />
            )}
            <DedupSummary docId={lastUploadId} />
            <AiPipelineProgress
              documentId={lastUploadId}
              initialOcr={uploadedOcr ?? null}
              initialDocType={uploadedDocType ?? null}
              initialOcrText={uploadedOcrText ?? null}
            />
            <div>
              <Link to={`/viewer/${lastUploadId}`}>
                <Button size="sm">
                  Open in viewer
                </Button>
              </Link>
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}
