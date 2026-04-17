import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Sparkles, ShieldCheck, Loader2, AlertTriangle, RefreshCw } from 'lucide-react';
import { Badge, Button, Panel, type BadgeTone } from '@/components/ui';
import { HttpError } from '@/lib/http';
import { analyzeDocument, fetchAnalysis } from './api';
import type { StoredAnalysis } from './api';
import { cn } from '@/lib/cn';

const EXTRACT_FIELDS = [
  { key: 'customer_cid',      label: 'Customer CID' },
  { key: 'customer_name',     label: 'Customer name' },
  { key: 'doc_number',        label: 'Document number' },
  { key: 'dob',               label: 'Date of birth' },
  { key: 'issue_date',        label: 'Issue date' },
  { key: 'expiry_date',       label: 'Expiry date' },
  { key: 'issuing_authority', label: 'Issuing authority' },
  { key: 'address',           label: 'Address' },
] as const;

function confidenceTone(c: number): BadgeTone {
  if (c >= 0.95) return 'success';
  if (c >= 0.80) return 'blue';
  if (c >= 0.60) return 'warning';
  return 'danger';
}

function ConfidenceBar({ value }: { value: number }) {
  const tone =
    value >= 0.95 ? 'bg-success' :
    value >= 0.80 ? 'bg-brand-blue' :
    value >= 0.60 ? 'bg-warning' : 'bg-danger';
  return (
    <div className="h-1 w-full rounded-full bg-divider overflow-hidden">
      <div className={cn('h-full transition-all', tone)} style={{ width: `${Math.min(100, Math.max(0, value * 100))}%` }} />
    </div>
  );
}

export function AIPanel({ documentId }: { documentId: number }) {
  const qc = useQueryClient();
  const analysis = useQuery<StoredAnalysis | null>({
    queryKey: ['docbrain', 'analysis', documentId],
    queryFn: async () => {
      try {
        return await fetchAnalysis(documentId);
      } catch (err) {
        if (err instanceof HttpError && err.status === 404) return null;
        throw err;
      }
    },
    retry: false,
  });

  const analyze = useMutation({
    mutationFn: () => analyzeDocument(documentId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['docbrain', 'analysis', documentId] });
      void qc.invalidateQueries({ queryKey: ['document', documentId] });
    },
  });

  const data = analysis.data;
  const running = analyze.isPending;

  return (
    <Panel
      title="DocBrain"
      action={
        <Button
          size="sm"
          variant={data ? 'secondary' : 'primary'}
          onClick={() => analyze.mutate()}
          loading={running}
          data-testid="docbrain-analyze-btn"
        >
          {running ? (
            <><Loader2 size={14} className="animate-spin" /> Analysing…</>
          ) : data ? (
            <><RefreshCw size={14} /> Re-analyse</>
          ) : (
            <><Sparkles size={14} /> Analyse</>
          )}
        </Button>
      }
    >
      {analysis.isLoading && <p className="text-sm text-muted">Loading analysis…</p>}

      {analyze.error instanceof HttpError && (
        <div className="mb-3 rounded-input bg-danger-bg border border-danger/30 px-3 py-2 text-xs text-danger flex items-center gap-2">
          <AlertTriangle size={14} />
          DocBrain failed: {analyze.error.message}
        </div>
      )}

      {!data && !analysis.isLoading && !running && (
        <div className="py-6 text-center">
          <Sparkles size={22} className="mx-auto text-muted mb-2" />
          <p className="text-sm text-ink font-medium">Not analysed yet</p>
          <p className="text-xs text-muted mt-1">Run OCR + classification + entity extraction locally on this machine.</p>
        </div>
      )}

      {data && (
        <div className="space-y-4" data-testid="docbrain-analysis">
          {/* Classification */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">Classification</p>
              <Badge tone={confidenceTone(data.classification.confidence)}>
                {(data.classification.confidence * 100).toFixed(0)}%
              </Badge>
            </div>
            <p className="text-md font-semibold text-ink">{data.classification.doc_class}</p>
            <p className="text-xs text-muted mt-1 leading-relaxed">{data.classification.reasoning}</p>
            {data.classification.alternative && (
              <p className="text-xs text-muted mt-1 italic">
                Alt: {data.classification.alternative}
              </p>
            )}
          </div>

          {/* Entities */}
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-2">Entities</p>
            <dl className="space-y-2">
              {EXTRACT_FIELDS.map(({ key, label }) => {
                const f = data.extraction[key];
                const has = f.value !== null && f.value !== '';
                return (
                  <div key={key} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <dt className="text-muted">{label}</dt>
                      <dd className={cn('text-right', has ? 'text-ink font-medium' : 'text-muted italic')}>
                        {has ? f.value : '—'}
                      </dd>
                    </div>
                    {has && <ConfidenceBar value={f.confidence} />}
                  </div>
                );
              })}
            </dl>
          </div>

          {/* Footer */}
          <div className="pt-3 border-t border-divider flex items-center justify-between text-[11px] text-muted">
            <div className="flex items-center gap-1.5">
              <ShieldCheck size={12} />
              <span>Local · {data.ocr_language ?? 'eng'} · OCR {Math.round(data.ocr_confidence)}%</span>
            </div>
            <span>{data.chunks_indexed} chunks indexed</span>
          </div>
        </div>
      )}
    </Panel>
  );
}
