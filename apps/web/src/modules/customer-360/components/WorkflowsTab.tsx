/**
 * WorkflowsTab — paginated list of customer workflows.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Workflow } from 'lucide-react';
import { Button } from '@/components/ui';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/cn';
import { fetchC360Workflows } from '../api';

interface WorkflowsTabProps {
  cid: string;
}

const PAGE = 20;

const STATUS_CLASS: Record<string, string> = {
  open:       'bg-brand-skyLight text-brand-blue',
  approved:   'bg-success-bg text-success',
  rejected:   'bg-danger-bg text-danger',
  pending:    'bg-warning-bg text-warning',
  escalated:  'bg-warning-bg text-warning',
  completed:  'bg-success-bg text-success',
};

export function WorkflowsTab({ cid }: WorkflowsTabProps) {
  const [offset, setOffset] = useState(0);

  const q = useQuery({
    queryKey: ['customer360', cid, 'workflows', offset],
    queryFn:  () => fetchC360Workflows(cid, { limit: PAGE, offset }),
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
    return <p className="text-xs text-muted italic py-4 text-center">{t('customer360.workflows_empty')}</p>;
  }

  return (
    <div className="space-y-1.5">
      {items.map((wf) => (
        <div
          key={wf.id}
          className="flex items-start justify-between gap-2 rounded-card border border-divider bg-surface px-3 py-2"
        >
          <div className="flex items-start gap-2 min-w-0">
            <Workflow size={13} className="text-muted shrink-0 mt-0.5" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-xs text-ink font-medium truncate">
                {wf.workflow_type ?? `Workflow #${wf.id}`}
              </p>
              <p className="text-2xs text-muted">
                {new Date(wf.created_at).toLocaleDateString()}
                {wf.updated_at && ` · updated ${new Date(wf.updated_at).toLocaleDateString()}`}
              </p>
            </div>
          </div>
          {wf.status && (
            <span
              className={cn(
                'rounded-badge px-1.5 py-0.5 text-2xs font-semibold capitalize shrink-0',
                STATUS_CLASS[wf.status.toLowerCase()] ?? 'bg-divider text-ink-sub',
              )}
            >
              {wf.status}
            </span>
          )}
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
