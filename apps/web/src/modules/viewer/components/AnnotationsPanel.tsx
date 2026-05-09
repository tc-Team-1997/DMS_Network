/**
 * AnnotationsPanel — right-rail "Annotations" tab.
 *
 * Lists all server-persisted annotations for the current document.
 * Clicking an annotation row emits viewer:scroll-to-span so PdfCanvas scrolls
 * to that page.
 *
 * Delete is available to the annotation owner and Doc Admin.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Highlighter, MessageSquare, Stamp, PenLine, Square, Trash2, Plus } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui';
import { eventBus } from '@/lib/events';
import { useAuth } from '@/store/auth';
import {
  fetchAnnotations,
  deleteAnnotation,
  type ServerAnnotation,
  type AnnotationType,
} from '../api';

// ── icons per type ────────────────────────────────────────────────────────────

const TYPE_ICONS: Record<AnnotationType, React.ReactNode> = {
  highlight:  <Highlighter size={12} />,
  comment:    <MessageSquare size={12} />,
  stamp:      <Stamp size={12} />,
  signature:  <PenLine size={12} />,
  redact:     <Square size={12} className="fill-ink" />,
};

const TYPE_LABELS: Record<AnnotationType, string> = {
  highlight:  'Highlight',
  comment:    'Comment',
  stamp:      'Stamp',
  signature:  'Signature',
  redact:     'Redaction',
};

// ── props ─────────────────────────────────────────────────────────────────────

export interface AnnotationsPanelProps {
  documentId: number;
  /** Called when user wants to add a new annotation (opens the drawing layer) */
  onAdd: () => void;
}

// ── component ─────────────────────────────────────────────────────────────────

export function AnnotationsPanel({ documentId, onAdd }: AnnotationsPanelProps) {
  const qc = useQueryClient();
  const userId = useAuth((s) => s.user?.id);
  const role   = useAuth((s) => s.user?.role);

  const { data: annotations, isLoading, isError } = useQuery({
    queryKey: ['annotations', documentId],
    queryFn: () => fetchAnnotations(documentId),
    staleTime: 30_000,
  });

  const deleteMut = useMutation({
    mutationFn: ({ annId }: { annId: number }) =>
      deleteAnnotation(documentId, annId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['annotations', documentId] });
    },
  });

  function handleRowClick(ann: ServerAnnotation) {
    // Emit scroll-to-span; x/y/w/h default to 0 if not meaningful
    eventBus.emit({
      type: 'viewer:scroll-to-span',
      payload: {
        documentId: String(documentId),
        span: {
          page: ann.page,
          x: ann.x,
          y: ann.y,
          w: ann.w,
          h: ann.h,
        },
      },
    });
  }

  if (isLoading) {
    return (
      <div className="p-4 space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-10 rounded-input bg-divider animate-pulse" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <p className="p-4 text-xs text-danger">Failed to load annotations.</p>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-divider">
        <span className="text-xs font-semibold text-ink-sub uppercase tracking-wide">
          {annotations?.length ?? 0} annotation{annotations?.length === 1 ? '' : 's'}
        </span>
        <Button size="sm" variant="secondary" onClick={onAdd} data-testid="ann-add-button">
          <Plus size={12} /> Add
        </Button>
      </div>

      {(!annotations || annotations.length === 0) ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-xs text-muted text-center px-4">
            No annotations yet. Use the tools above the document to annotate.
          </p>
        </div>
      ) : (
        <ul className="flex-1 overflow-y-auto divide-y divide-divider" data-testid="annotations-list">
          {annotations.map((ann) => {
            const canDelete =
              ann.user_id === userId || role === 'Doc Admin';
            return (
              <li
                key={ann.id}
                className="group flex items-start gap-3 px-4 py-3 hover:bg-divider cursor-pointer"
                onClick={() => handleRowClick(ann)}
                data-testid={`ann-row-${ann.id}`}
              >
                <span
                  className={cn(
                    'mt-0.5 flex-shrink-0 text-muted',
                    ann.kind === 'highlight' && 'text-warning',
                    ann.kind === 'redact'    && 'text-danger',
                  )}
                  aria-label={TYPE_LABELS[ann.kind]}
                >
                  {TYPE_ICONS[ann.kind]}
                </span>

                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-ink">
                    {TYPE_LABELS[ann.kind]}
                    <span className="ml-1.5 text-muted font-normal">
                      · p.{ann.page + 1}
                    </span>
                  </p>
                  {ann.text && ann.text.length > 0 && (
                    <p className="text-2xs text-muted mt-0.5 truncate">
                      {ann.text}
                    </p>
                  )}
                  {ann.username && (
                    <p className="text-2xs text-muted">
                      {ann.username} · {new Date(ann.created_at).toLocaleDateString()}
                    </p>
                  )}
                </div>

                {canDelete && (
                  <button
                    type="button"
                    aria-label="Delete annotation"
                    data-testid={`ann-delete-${ann.id}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteMut.mutate({ annId: ann.id });
                    }}
                    className={cn(
                      'opacity-0 group-hover:opacity-100 transition-opacity',
                      'flex-shrink-0 w-6 h-6 rounded-input flex items-center justify-center',
                      'text-danger hover:bg-danger/10',
                    )}
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
