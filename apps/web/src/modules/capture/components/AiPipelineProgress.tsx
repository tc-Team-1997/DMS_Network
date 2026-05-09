/**
 * AiPipelineProgress — server-signal-driven pipeline step tracker.
 *
 * Step state is derived entirely from what the server reports via
 * GET /spa/api/documents/:id (fetchDocument).  No elapsed-time advancement.
 *
 * Step derivation:
 *   status === 'captured' && ocr_confidence === null  → 'ocr' (OCR in progress)
 *   status === 'captured' && ocr_confidence !== null  → 'classify' (classify running)
 *   status !== 'captured' (e.g. 'Valid')              → 'indexed' (complete)
 *   poll times out (60 s)                             → stays at last known step
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Sparkles } from 'lucide-react';
import { cn } from '@/lib/cn';
import { fetchDocument } from '@/modules/viewer/api';
import { PIPELINE_STEPS, POLL_INTERVAL_MS, POLL_MAX_MS } from '../constants';
import type { PipelineStep } from '../types';

interface AiPipelineProgressProps {
  documentId: number;
  initialOcr: number | null;
  initialDocType: string | null;
  initialOcrText: string | null;
}

function deriveStep(status: string, ocrConfidence: number | null): PipelineStep {
  if (status !== 'captured') return 'indexed';
  if (ocrConfidence !== null) return 'classify';
  return 'ocr';
}

export function AiPipelineProgress({
  documentId,
  initialOcr,
  initialDocType,
  initialOcrText,
}: AiPipelineProgressProps) {
  const [step, setStep] = useState<PipelineStep>(
    initialOcr !== null ? 'indexed' : 'uploaded',
  );
  const [docType, setDocType] = useState<string | null>(initialDocType);
  const [ocr, setOcr] = useState<number | null>(initialOcr);
  const [ocrText] = useState<string | null>(initialOcrText);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedRef = useRef(0);

  const stopPolling = useCallback(() => {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const poll = useCallback(async () => {
    elapsedRef.current += POLL_INTERVAL_MS;
    try {
      const doc = await fetchDocument(documentId);
      const nextStep = deriveStep(doc.status, doc.ocr_confidence ?? null);
      setStep(nextStep);
      if (doc.doc_type) setDocType(doc.doc_type);
      if (doc.ocr_confidence != null) setOcr(doc.ocr_confidence);
      if (nextStep === 'indexed') {
        stopPolling();
        return;
      }
    } catch {
      // Ignore transient poll errors; keep the interval running.
    }
    if (elapsedRef.current >= POLL_MAX_MS) {
      stopPolling();
    }
  }, [documentId, stopPolling]);

  useEffect(() => {
    if (initialOcr !== null) {
      // Already fully processed — no polling needed.
      setStep('indexed');
      return;
    }
    setStep('ocr');
    pollRef.current = setInterval(() => { void poll(); }, POLL_INTERVAL_MS);
    return stopPolling;
  }, [documentId, initialOcr, poll, stopPolling]);

  const activeIdx = PIPELINE_STEPS.findIndex((s) => s.id === step);

  return (
    <div
      className="rounded-lg border border-brand-blue/20 bg-brand-skyLight/20 px-4 py-4 space-y-4"
      data-testid="capture-ai-pipeline"
    >
      <p className="text-xs font-semibold text-brand-blue flex items-center gap-1.5">
        <Sparkles size={12} aria-hidden="true" /> AI Processing Pipeline
      </p>

      {/* Step progress bar */}
      <div className="flex items-center gap-0">
        {PIPELINE_STEPS.map((s, i) => {
          const done   = i < activeIdx || (i === activeIdx && step === 'indexed');
          const active = i === activeIdx && step !== 'indexed';
          const future = i > activeIdx;

          return (
            <div key={s.id} className="flex items-center flex-1 min-w-0">
              <div className="flex flex-col items-center flex-shrink-0">
                <div
                  className={cn(
                    'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all',
                    done   && 'bg-success border-success text-white',
                    active && 'bg-brand-blue border-brand-blue text-white ring-2 ring-brand-blue/30 ring-offset-1',
                    future && 'bg-white border-divider text-muted',
                  )}
                  aria-label={s.label}
                >
                  {done ? <CheckCircle2 size={14} /> : i + 1}
                </div>
                <span
                  className={cn(
                    'mt-1 text-[10px] whitespace-nowrap',
                    done   && 'text-success font-medium',
                    active && 'text-brand-blue font-medium',
                    future && 'text-muted',
                  )}
                >
                  {s.label}
                  {active && (
                    <span
                      className="ml-1 motion-safe:animate-pulse"
                      aria-hidden="true"
                    >…</span>
                  )}
                </span>
              </div>

              {i < PIPELINE_STEPS.length - 1 && (
                <div
                  className={cn(
                    'h-0.5 flex-1 mx-1 mb-4 rounded transition-all',
                    i < activeIdx ? 'bg-success/50' : 'bg-divider',
                  )}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Results when indexed */}
      {step === 'indexed' && (
        <div className="space-y-2">
          {docType && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-ink-sub font-medium">Document type:</span>
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-badge px-2 py-0.5 text-xs font-medium',
                  ocr !== null && ocr >= 70
                    ? 'bg-success-bg text-success border border-success/30'
                    : 'bg-warning-bg text-warning border border-warning/30',
                )}
              >
                <Sparkles size={10} aria-hidden="true" />
                {docType}
                {ocr !== null && ` — ${ocr.toFixed(0)}% confidence`}
              </span>
            </div>
          )}
          {ocrText && (
            <div>
              <p className="text-xs font-medium text-muted mb-1">OCR text preview:</p>
              <p className="text-xs text-ink bg-divider/30 border border-divider rounded-input px-3 py-2 font-mono leading-relaxed line-clamp-3">
                {ocrText.slice(0, 200)}{ocrText.length > 200 ? '…' : ''}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
