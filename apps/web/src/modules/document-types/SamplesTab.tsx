/**
 * SamplesTab — thumbnail grid of stored samples for a given doc type.
 * Shown as a "Samples" tab inside the DocumentTypesPage edit panel.
 */

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, RefreshCw, Trash2, Upload, X } from 'lucide-react';
import { Badge, Button } from '@/components/ui';
import { cn } from '@/lib/cn';
import { HttpError } from '@/lib/http';
import {
  deleteSample,
  inferDoctype,
  listSamples,
  reindexDoctype,
  type DocumentType,
} from './api';

const WIZARD_ALLOWED = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/tiff',
];

export function SamplesTab({ docType }: { docType: DocumentType }) {
  const qc = useQueryClient();
  const [selectedSampleId, setSelectedSampleId] = useState<number | null>(null);
  const [reindexMsg, setReindexMsg] = useState<string | null>(null);
  const [reindexErr, setReindexErr] = useState<string | null>(null);

  const samplesQuery = useQuery({
    queryKey: ['doctype-samples', docType.id],
    queryFn: () => listSamples(docType.id),
  });

  const deleteMutation = useMutation({
    mutationFn: ({ sampleId }: { sampleId: number }) =>
      deleteSample(docType.id, sampleId),
    onSuccess: () => {
      setSelectedSampleId(null);
      void qc.invalidateQueries({ queryKey: ['doctype-samples', docType.id] });
    },
  });

  const reindexMutation = useMutation({
    mutationFn: () => reindexDoctype(docType.id),
    onSuccess: (r) => {
      setReindexMsg(
        `Reindexed ${r.samples_reindexed} sample${r.samples_reindexed === 1 ? '' : 's'} — schema v${r.new_schema_version}`,
      );
      setReindexErr(null);
    },
    onError: (e: unknown) => {
      setReindexErr(e instanceof HttpError ? e.message : (e as Error).message);
      setReindexMsg(null);
    },
  });

  const selectedSample = selectedSampleId != null
    ? samplesQuery.data?.find((s) => s.id === selectedSampleId) ?? null
    : null;

  const inferenceStatus = docType.inference_status ?? 'manual';

  return (
    <div className="space-y-4" data-testid="samples-tab">
      {/* Status bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Badge
            tone={
              inferenceStatus === 'live' ? 'success'
              : inferenceStatus === 'draft' ? 'warning'
              : 'neutral'
            }
            data-testid="samples-status-badge"
          >
            {inferenceStatus}
          </Badge>
          <span className="text-xs text-muted">
            {samplesQuery.data?.length ?? 0} sample{(samplesQuery.data?.length ?? 0) === 1 ? '' : 's'}
          </span>
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => reindexMutation.mutate()}
          loading={reindexMutation.isPending}
          data-testid="samples-reindex"
        >
          <RefreshCw size={12} /> Re-analyse with current model
        </Button>
      </div>

      {reindexMsg && (
        <p className="text-xs text-success bg-success-bg border border-success/30 rounded-input px-3 py-2" data-testid="samples-reindex-ok">
          {reindexMsg}
        </p>
      )}
      {reindexErr && (
        <p className="text-xs text-danger bg-danger-bg border border-danger/30 rounded-input px-3 py-2" data-testid="samples-reindex-err">
          {reindexErr}
        </p>
      )}

      {samplesQuery.isLoading && (
        <div className="grid grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-24 rounded-card bg-divider animate-pulse" />
          ))}
        </div>
      )}

      {!samplesQuery.isLoading && samplesQuery.data && samplesQuery.data.length === 0 && (
        <p className="text-sm text-muted py-4 text-center">
          No samples stored yet. Add some below.
        </p>
      )}

      {/* Thumbnail grid */}
      {samplesQuery.data && samplesQuery.data.length > 0 && (
        <div className="grid grid-cols-3 gap-3" data-testid="samples-grid">
          {samplesQuery.data.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSelectedSampleId(s.id)}
              className={cn(
                'relative rounded-card border overflow-hidden bg-page flex items-center justify-center h-24 cursor-pointer transition-colors',
                selectedSampleId === s.id ? 'border-brand-blue' : 'border-divider hover:border-brand-blue/60',
              )}
              aria-label={`View sample ${s.filename}`}
              data-testid={`sample-thumb-${s.id}`}
            >
              {s.thumbnail_url ? (
                <img
                  src={s.thumbnail_url}
                  alt={s.filename}
                  className="w-full h-full object-cover"
                />
              ) : (
                <FileText size={20} className="text-brand-blue/60" />
              )}
              <span className="absolute bottom-0 left-0 right-0 bg-ink/50 text-white text-[10px] truncate px-1 py-0.5">
                {s.filename}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Side panel for selected sample */}
      {selectedSample && (
        <SampleSidePanel
          sample={selectedSample}
          onClose={() => setSelectedSampleId(null)}
          onDelete={() => {
            if (confirm(`Delete sample "${selectedSample.filename}"?`)) {
              deleteMutation.mutate({ sampleId: selectedSample.id });
            }
          }}
          isDeleting={deleteMutation.isPending}
        />
      )}

      {/* Add more samples CTA */}
      <AddSampleDropzone schemaId={docType.id} />
    </div>
  );
}

// ── Side panel ────────────────────────────────────────────────────────────────

type SampleLike = {
  id: number;
  filename: string;
  ocr_backend?: string | undefined;
  mean_confidence?: number | undefined;
  uploaded_at: string;
  uploader?: string | undefined;
  thumbnail_url?: string | null | undefined;
};

// This can accept both Sample and SampleDetail since it only reads common fields.
function SampleSidePanel({
  sample,
  onClose,
  onDelete,
  isDeleting,
}: {
  sample: SampleLike & { ocr_text_preview?: string };
  onClose: () => void;
  onDelete: () => void;
  isDeleting: boolean;
}) {
  return (
    <div
      className="rounded-card border border-divider bg-white p-4 space-y-3"
      data-testid="sample-side-panel"
      role="region"
      aria-label={`Sample details: ${sample.filename}`}
    >
      <div className="flex items-center justify-between">
        <p className="text-md font-medium text-ink truncate">{sample.filename}</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close sample panel"
          className="text-muted hover:text-ink"
        >
          <X size={13} />
        </button>
      </div>

      <dl className="space-y-1.5 text-xs">
        {sample.ocr_backend && (
          <div className="flex justify-between gap-3">
            <dt className="text-muted">OCR backend</dt>
            <dd className="text-ink">{sample.ocr_backend}</dd>
          </div>
        )}
        {sample.mean_confidence != null && (
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Mean confidence</dt>
            <dd>
              <Badge tone={sample.mean_confidence >= 0.7 ? 'success' : 'warning'}>
                {Math.round(sample.mean_confidence * 100)}%
              </Badge>
            </dd>
          </div>
        )}
        <div className="flex justify-between gap-3">
          <dt className="text-muted">Uploaded</dt>
          <dd className="text-ink">{new Date(sample.uploaded_at).toLocaleString()}</dd>
        </div>
        {sample.uploader && (
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Uploader</dt>
            <dd className="text-ink">{sample.uploader}</dd>
          </div>
        )}
      </dl>

      {'ocr_text_preview' in sample && sample.ocr_text_preview && (
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-1">OCR preview</p>
          <pre className="rounded-input bg-page border border-divider px-2 py-1.5 text-[11px] font-mono text-ink overflow-auto max-h-32 whitespace-pre-wrap">
            {sample.ocr_text_preview.slice(0, 500)}
          </pre>
        </div>
      )}

      <Button
        size="sm"
        variant="danger" // falls through to ghost if not a valid variant — use danger
        onClick={onDelete}
        loading={isDeleting}
        data-testid="sample-delete"
        className="w-full justify-center"
      >
        <Trash2 size={12} /> Delete sample
      </Button>
    </div>
  );
}

// ── Add sample dropzone ───────────────────────────────────────────────────────

function AddSampleDropzone({ schemaId }: { schemaId: number }) {
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = async (files: File[]) => {
    const valid = files.filter((f) => WIZARD_ALLOWED.includes(f.type) && f.size <= 25 * 1024 * 1024);
    if (valid.length === 0) {
      setErr('No valid files. Supported: PDF, JPEG, PNG, WEBP, TIFF — max 25 MB each.');
      return;
    }
    setUploading(true);
    setErr(null);
    setOk(null);
    try {
      // Re-use the infer endpoint as an "add samples" path with a single call
      await inferDoctype(valid);
      setOk(`${valid.length} sample${valid.length === 1 ? '' : 's'} added.`);
      void qc.invalidateQueries({ queryKey: ['doctype-samples', schemaId] });
    } catch (e: unknown) {
      setErr(e instanceof HttpError ? e.message : (e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-2">
      <label
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void handleFiles(Array.from(e.dataTransfer.files));
        }}
        className={cn(
          'flex items-center justify-center gap-2 rounded-card border-2 border-dashed',
          'border-border bg-page hover:border-brand-blue hover:bg-brand-skyLight transition-colors cursor-pointer py-4 px-4',
        )}
        aria-label="Drop additional samples or click to browse"
        data-testid="add-sample-dropzone"
      >
        <Upload size={16} className="text-brand-blue" />
        <span className="text-sm text-muted">
          {uploading ? 'Adding…' : 'Add more samples — drop here or click'}
        </span>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="sr-only"
          accept={WIZARD_ALLOWED.join(',')}
          onChange={(e) => {
            void handleFiles(Array.from(e.target.files ?? []));
            if (fileInputRef.current) fileInputRef.current.value = '';
          }}
        />
      </label>
      {err && <p className="text-xs text-danger">{err}</p>}
      {ok && <p className="text-xs text-success">{ok}</p>}
    </div>
  );
}

