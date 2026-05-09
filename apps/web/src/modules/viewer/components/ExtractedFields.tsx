/**
 * ExtractedFields — right-rail tab panel.
 *
 * Renders extracted document fields from DocBrain analysis.
 * Each field with a source span shows an AiConfidenceBadge; clicking
 * "Show in doc" emits viewer:scroll-to-span via the event bus (CC4).
 */

import { useQuery } from '@tanstack/react-query';
import { Sparkles, AlertTriangle } from 'lucide-react';
import { AiConfidenceBadge } from '@/components/ui';
import type { SourceSpan } from '@/components/ui';
import { HttpError } from '@/lib/http';
import { fetchAnalysis } from '@/modules/docbrain/api';

// ── props ─────────────────────────────────────────────────────────────────────

export interface ExtractedFieldsProps {
  documentId: number;
}

// ── field list — same as AIPanel ──────────────────────────────────────────────

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

// ── component ─────────────────────────────────────────────────────────────────

export function ExtractedFields({ documentId }: ExtractedFieldsProps) {
  const analysis = useQuery({
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
    staleTime: 5 * 60 * 1000,
  });

  if (analysis.isLoading) {
    return (
      <div className="p-4 space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-8 rounded-input bg-divider animate-pulse" />
        ))}
      </div>
    );
  }

  if (analysis.isError) {
    return (
      <div className="p-4 flex items-center gap-2 text-xs text-danger">
        <AlertTriangle size={14} />
        Could not load extracted fields.
      </div>
    );
  }

  if (!analysis.data) {
    return (
      <div className="p-4 text-center">
        <Sparkles size={20} className="mx-auto text-muted mb-2" />
        <p className="text-sm text-ink font-medium">Not yet analysed</p>
        <p className="text-xs text-muted mt-1">
          Run <strong>Analyse</strong> from the DocBrain panel to extract fields.
        </p>
      </div>
    );
  }

  const { extraction } = analysis.data;

  return (
    <dl
      className="divide-y divide-divider"
      data-testid="extracted-fields-list"
    >
      {EXTRACT_FIELDS.map(({ key, label }) => {
        const field = extraction[key];
        const hasValue = field.value !== null && field.value !== '';

        // Build a synthetic source span for AiConfidenceBadge.
        // Real page/bbox would come from a future DocBrain v2 endpoint.
        // For now we use page 0 with zero bbox so the "Show in doc" event
        // still fires and scrolls to page 1.
        const sourceSpan: SourceSpan = {
          text: field.value ?? '',
          page: 0,
        };

        return (
          <div key={key} className="flex items-start justify-between gap-3 px-4 py-3">
            <dt className="text-xs text-muted font-medium min-w-[90px] flex-shrink-0 pt-0.5">
              {label}
            </dt>
            <dd className="flex flex-col items-end gap-1.5 text-right flex-1 min-w-0">
              <span
                className={hasValue ? 'text-xs text-ink break-words' : 'text-xs text-muted italic'}
                data-testid={`extracted-field-${key}`}
              >
                {hasValue ? field.value : '—'}
              </span>
              {hasValue && field.confidence > 0 && (
                <AiConfidenceBadge
                  confidence={field.confidence * 100}
                  model="docbrain-local"
                  promptId={key}
                  sourceSpan={sourceSpan}
                  documentId={String(documentId)}
                />
              )}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
