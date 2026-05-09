/**
 * ActivityTab — paginated audit/activity log for the customer.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Clock } from 'lucide-react';
import { Button } from '@/components/ui';
import { t } from '@/lib/i18n';
import { fetchActivity } from '../api';

interface ActivityTabProps {
  cid: string;
}

const PAGE = 20;

export function ActivityTab({ cid }: ActivityTabProps) {
  const [offset, setOffset] = useState(0);

  const q = useQuery({
    queryKey: ['customer360', cid, 'activity', offset],
    queryFn:  () => fetchActivity(cid, { limit: PAGE, offset }),
  });

  if (q.isLoading) {
    return (
      <div className="space-y-2 py-2" aria-busy="true" aria-label={t('customer360.loading')}>
        {[1, 2, 3].map((n) => (
          <div key={n} className="h-8 rounded-card bg-divider animate-pulse" />
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
    return <p className="text-xs text-muted italic py-4 text-center">{t('customer360.activity_empty')}</p>;
  }

  return (
    <div className="space-y-1">
      {items.map((entry) => (
        <div
          key={entry.id}
          className="flex items-start gap-2 py-2 border-b border-divider last:border-b-0"
        >
          <Clock size={11} className="text-muted shrink-0 mt-0.5" aria-hidden="true" />
          <div className="min-w-0 space-y-0.5">
            <p className="text-xs text-ink font-medium">{entry.action}</p>
            <p className="text-2xs text-muted">
              {entry.actor && `${entry.actor}${entry.actor_role ? ` (${entry.actor_role})` : ''} · `}
              {new Date(entry.created_at).toLocaleString()}
            </p>
          </div>
        </div>
      ))}

      {total > PAGE && (
        <div className="flex justify-between items-center pt-2">
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
