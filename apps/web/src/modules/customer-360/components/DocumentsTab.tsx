/**
 * DocumentsTab — paginated list of customer documents.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, FileText } from 'lucide-react';
import { Button } from '@/components/ui';
import { t } from '@/lib/i18n';
import { fetchC360Documents } from '../api';

interface DocumentsTabProps {
  cid: string;
}

const PAGE = 20;

export function DocumentsTab({ cid }: DocumentsTabProps) {
  const [offset, setOffset] = useState(0);

  const q = useQuery({
    queryKey: ['customer360', cid, 'documents', offset],
    queryFn:  () => fetchC360Documents(cid, { limit: PAGE, offset }),
  });

  if (q.isLoading) {
    return (
      <div className="space-y-2 py-2" aria-busy="true" aria-label={t('customer360.loading')}>
        {[1, 2, 3].map((n) => (
          <div key={n} className="h-10 rounded-card bg-divider animate-pulse" />
        ))}
      </div>
    );
  }

  if (q.isError) {
    return (
      <div className="rounded-input border border-danger/30 bg-danger-bg px-3 py-2 text-xs text-danger flex items-center gap-2">
        <AlertTriangle size={13} aria-hidden="true" />
        {t('customer360.error_load')}
      </div>
    );
  }

  const items = q.data?.items ?? [];
  const total = q.data?.total ?? 0;

  if (items.length === 0) {
    return <p className="text-xs text-muted italic py-4 text-center">{t('customer360.documents_empty')}</p>;
  }

  return (
    <div className="space-y-1.5">
      {items.map((doc) => (
        <div
          key={doc.id}
          className="flex items-start gap-2 rounded-card border border-divider bg-surface px-3 py-2"
        >
          <FileText size={13} className="text-muted shrink-0 mt-0.5" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-xs text-ink font-medium truncate">{doc.original_name}</p>
            <p className="text-2xs text-muted">
              {doc.doc_type ?? '—'}
              {' · '}
              {new Date(doc.created_at).toLocaleDateString()}
              {doc.status && ` · ${doc.status}`}
            </p>
          </div>
        </div>
      ))}

      {total > PAGE && (
        <div className="flex justify-between items-center pt-1">
          <Button
            type="button" size="sm" variant="ghost"
            disabled={offset === 0}
            onClick={() => setOffset((o) => Math.max(0, o - PAGE))}
          >
            {t('customer360.prev')}
          </Button>
          <span className="text-2xs text-muted">{offset + 1}–{Math.min(offset + PAGE, total)} / {total}</span>
          <Button
            type="button" size="sm" variant="ghost"
            disabled={offset + PAGE >= total}
            onClick={() => setOffset((o) => o + PAGE)}
          >
            {t('customer360.next')}
          </Button>
        </div>
      )}
    </div>
  );
}
