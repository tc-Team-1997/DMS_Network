/**
 * AuditPanel — right-rail "Audit" tab.
 *
 * Chronological list of view/download/print/annotation events for this
 * document. Data comes from GET /spa/api/documents/:id/audit.
 */

import { useQuery } from '@tanstack/react-query';
import { Clock, AlertTriangle } from 'lucide-react';
import { fetchDocumentAudit, type AuditEvent } from '../api';

// ── props ─────────────────────────────────────────────────────────────────────

export interface AuditPanelProps {
  documentId: number;
}

// ── component ─────────────────────────────────────────────────────────────────

export function AuditPanel({ documentId }: AuditPanelProps) {
  const { data: events, isLoading, isError } = useQuery({
    queryKey: ['audit', 'document', documentId],
    queryFn: () => fetchDocumentAudit(documentId),
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="p-4 space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-10 rounded-input bg-divider animate-pulse" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-4 flex items-center gap-2 text-xs text-danger">
        <AlertTriangle size={14} />
        Could not load audit log.
      </div>
    );
  }

  const list = events ?? [];

  if (list.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <p className="text-xs text-muted text-center">
          No audit events recorded for this document.
        </p>
      </div>
    );
  }

  return (
    <ul
      className="divide-y divide-divider overflow-y-auto"
      data-testid="audit-list"
    >
      {list.map((evt) => (
        <AuditRow key={evt.id} event={evt} />
      ))}
    </ul>
  );
}

// ── AuditRow ──────────────────────────────────────────────────────────────────

function AuditRow({ event }: { event: AuditEvent }) {
  const label = formatAction(event.action);
  const ts = new Date(event.created_at).toLocaleString();

  return (
    <li
      className="flex items-start gap-3 px-4 py-3"
      data-testid={`audit-row-${event.id}`}
    >
      <Clock size={12} className="mt-0.5 text-muted flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-xs text-ink font-medium">{label}</p>
        <p className="text-2xs text-muted mt-0.5">
          {event.username ?? `user #${event.user_id ?? '?'}`} · {ts}
        </p>
      </div>
    </li>
  );
}

// ── helpers ───────────────────────────────────────────────────────────────────

const ACTION_LABELS: Record<string, string> = {
  DOCUMENT_VIEWED:      'Viewed',
  DOCUMENT_DOWNLOADED:  'Downloaded',
  DOCUMENT_PRINTED:     'Printed',
  ANNOTATION_CREATED:   'Annotation added',
  ANNOTATION_UPDATED:   'Annotation updated',
  ANNOTATION_DELETED:   'Annotation deleted',
  DOCUMENT_REDACTED:    'Redacted',
  DOCUMENT_UPLOADED:    'Uploaded',
  DOCUMENT_UPDATED:     'Updated',
  DOCUMENT_DELETED:     'Deleted',
};

function formatAction(action: string): string {
  return ACTION_LABELS[action] ?? action.replace(/_/g, ' ');
}
