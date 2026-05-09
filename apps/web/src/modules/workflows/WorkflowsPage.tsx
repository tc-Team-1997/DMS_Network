import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Check, X, ArrowUp, ExternalLink, Clock, AlertTriangle } from 'lucide-react';
import { Badge, Button, DataTable, Panel, statusTone, type Column } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { Workflow } from '@/lib/schemas';
import { useAuth } from '@/store/auth';
import { actOnWorkflow, fetchWorkflows, type WorkflowAction } from './api';

type QueueKey = 'all' | 'pending' | 'approved' | 'rejected';

const queueLabels: Record<QueueKey, string> = {
  all: 'All',
  pending: 'Pending review',
  approved: 'Approved',
  rejected: 'Rejected / rework',
};

/** SLA window for demo: 48 hours from created_at */
const SLA_HOURS = 48;

function matchesQueue(stage: string, queue: QueueKey): boolean {
  if (queue === 'all') return true;
  if (queue === 'approved') return stage === 'Approved';
  if (queue === 'rejected') return stage.startsWith('Rejected');
  // pending = anything that is neither approved nor rejected
  return stage !== 'Approved' && !stage.startsWith('Rejected');
}

/** Returns ms remaining until SLA breach (negative = overdue). */
function slaRemainingMs(createdAt: string): number {
  const created = new Date(createdAt).getTime();
  const deadline = created + SLA_HOURS * 60 * 60 * 1000;
  return deadline - Date.now();
}

/** Format a duration in ms to "Xh Ym" or "OVERDUE by Xh Ym". */
function formatSla(remainingMs: number): { label: string; tone: 'success' | 'warning' | 'danger' } {
  const abs = Math.abs(remainingMs);
  const h = Math.floor(abs / (1000 * 60 * 60));
  const m = Math.floor((abs % (1000 * 60 * 60)) / (1000 * 60));
  const parts = h > 0 ? `${h}h ${m}m` : `${m}m`;

  if (remainingMs < 0) {
    return { label: `OVERDUE by ${parts}`, tone: 'danger' };
  }
  if (remainingMs < 4 * 60 * 60 * 1000) {
    return { label: `${parts} remaining`, tone: 'danger' };
  }
  if (remainingMs < 24 * 60 * 60 * 1000) {
    return { label: `${parts} remaining`, tone: 'warning' };
  }
  return { label: `${parts} remaining`, tone: 'success' };
}

function SlaBadge({ createdAt, stage }: { createdAt: string; stage: string }) {
  // Don't show SLA for terminal stages
  if (stage === 'Approved' || stage.startsWith('Rejected')) return null;

  const remaining = slaRemainingMs(createdAt);
  const { label, tone } = formatSla(remaining);

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-badge px-1.5 py-0.5 text-xs font-medium',
        tone === 'success' && 'bg-success-bg text-success',
        tone === 'warning' && 'bg-warning-bg text-warning',
        tone === 'danger'  && 'bg-danger-bg text-danger',
      )}
    >
      {remaining < 0
        ? <AlertTriangle size={10} />
        : <Clock size={10} />}
      {label}
    </span>
  );
}

export function WorkflowsPage() {
  const role = useAuth((s) => s.user?.role);
  const canAct = role === 'Doc Admin' || role === 'Checker' || role === 'Maker';
  const canApprove = role === 'Doc Admin' || role === 'Checker';
  const [queue, setQueue] = useState<QueueKey>('pending');
  const qc = useQueryClient();

  const workflows = useQuery({
    queryKey: ['workflows', { limit: 200 }],
    queryFn: () => fetchWorkflows({ limit: 200 }),
  });

  const filtered = useMemo(
    () => (workflows.data ?? []).filter((w) => matchesQueue(w.stage, queue)),
    [workflows.data, queue],
  );

  const act = useMutation({
    mutationFn: ({ id, action }: { id: number; action: WorkflowAction }) =>
      actOnWorkflow(id, action),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['workflows'] });
      void qc.invalidateQueries({ queryKey: ['stats'] });
    },
  });

  const counts = useMemo(() => {
    const rows = workflows.data ?? [];
    return {
      all: rows.length,
      pending: rows.filter((w) => matchesQueue(w.stage, 'pending')).length,
      approved: rows.filter((w) => matchesQueue(w.stage, 'approved')).length,
      rejected: rows.filter((w) => matchesQueue(w.stage, 'rejected')).length,
    } as Record<QueueKey, number>;
  }, [workflows.data]);

  const columns = useMemo<Column<Workflow>[]>(
    () => [
      {
        key: 'ref',
        header: 'Ref',
        width: 140,
        render: (w) => <span className="font-mono text-xs">{w.ref_code ?? '—'}</span>,
      },
      {
        key: 'title',
        header: 'Title',
        render: (w) => (
          <div className="flex flex-col">
            <span className="text-md text-ink">{w.title ?? '—'}</span>
            {w.doc_id ? (
              <Link
                to={`/viewer/${w.doc_id}`}
                className="text-xs text-brand-blue hover:underline inline-flex items-center gap-1"
                data-testid={`workflow-${w.id}-doc`}
              >
                <ExternalLink size={11} /> View document
              </Link>
            ) : null}
          </div>
        ),
      },
      {
        key: 'stage',
        header: 'Stage',
        width: 160,
        render: (w) => (
          <span data-testid={`workflow-${w.id}-stage`}>
            <Badge tone={statusTone(w.stage)}>{w.stage}</Badge>
          </span>
        ),
      },
      {
        key: 'sla',
        header: 'SLA',
        width: 180,
        render: (w) => (
          <span data-testid={`workflow-${w.id}-sla`}>
            <SlaBadge createdAt={w.created_at} stage={w.stage} />
          </span>
        ),
      },
      {
        key: 'priority',
        header: 'Priority',
        width: 100,
        render: (w) => (
          <Badge
            tone={w.priority === 'High' ? 'danger' : w.priority === 'Low' ? 'neutral' : 'warning'}
          >
            {w.priority}
          </Badge>
        ),
      },
      {
        key: 'updated',
        header: 'Updated',
        width: 160,
        render: (w) => (
          <span className="text-xs text-muted">{new Date(w.updated_at).toLocaleString()}</span>
        ),
      },
      ...(canAct
        ? [
            {
              key: 'actions',
              header: '',
              width: 180,
              align: 'right' as const,
              render: (w: Workflow) => {
                const done = w.stage === 'Approved' || w.stage.startsWith('Rejected');
                if (done) return <span className="text-xs text-muted">—</span>;
                return (
                  <div className="flex justify-end gap-1">
                    {canApprove && (
                      <button
                        type="button"
                        aria-label="Approve"
                        data-testid={`workflow-${w.id}-approve`}
                        disabled={act.isPending}
                        onClick={() => act.mutate({ id: w.id, action: 'approve' })}
                        className="w-7 h-7 rounded-md flex items-center justify-center text-success hover:bg-success-bg disabled:opacity-40"
                      >
                        <Check size={14} />
                      </button>
                    )}
                    {canApprove && (
                      <button
                        type="button"
                        aria-label="Reject"
                        data-testid={`workflow-${w.id}-reject`}
                        disabled={act.isPending}
                        onClick={() => act.mutate({ id: w.id, action: 'reject' })}
                        className="w-7 h-7 rounded-md flex items-center justify-center text-danger hover:bg-danger-bg disabled:opacity-40"
                      >
                        <X size={14} />
                      </button>
                    )}
                    <button
                      type="button"
                      aria-label="Escalate"
                      data-testid={`workflow-${w.id}-escalate`}
                      disabled={act.isPending}
                      onClick={() => act.mutate({ id: w.id, action: 'escalate' })}
                      className="w-7 h-7 rounded-md flex items-center justify-center text-warning hover:bg-warning-bg disabled:opacity-40"
                    >
                      <ArrowUp size={14} />
                    </button>
                  </div>
                );
              },
            },
          ]
        : []),
    ],
    [canAct, canApprove, act],
  );

  return (
    <div className="space-y-6">
      <Panel title="Workflow queues">
        <div className="flex flex-wrap gap-2" role="tablist">
          {(Object.keys(queueLabels) as QueueKey[]).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={queue === k}
              data-testid={`queue-${k}`}
              onClick={() => setQueue(k)}
              className={cn(
                'px-3 py-1.5 rounded-input text-md border transition',
                queue === k
                  ? 'bg-brand-skyLight text-brand-blue border-brand-blue/30 font-medium'
                  : 'bg-white text-ink border-border hover:bg-divider',
              )}
            >
              {queueLabels[k]}
              <span className="ml-2 text-xs text-muted">{counts[k] ?? 0}</span>
            </button>
          ))}
        </div>
      </Panel>

      {filtered.length === 0 && !workflows.isLoading && (
        <Panel>
          <div className="py-10 flex flex-col items-center text-center text-muted">
            <Check size={32} className="mb-3 text-success" />
            <p className="text-md font-medium text-ink">No workflows in this queue</p>
            <p className="text-xs mt-1">All documents are up to date — no pending actions required.</p>
          </div>
        </Panel>
      )}

      {(filtered.length > 0 || workflows.isLoading) && (
        <Panel
          title={`${filtered.length} item${filtered.length === 1 ? '' : 's'} — ${queueLabels[queue]}`}
          action={
            <div className="flex gap-2">
              <Link to="/workflows/templates">
                <Button size="sm" variant="ghost" data-testid="templates-link">
                  Templates
                </Button>
              </Link>
              <Link to="/repository">
                <Button size="sm" variant="ghost">
                  Repository
                </Button>
              </Link>
            </div>
          }
        >
          <DataTable<Workflow>
            columns={columns}
            data={filtered}
            empty={workflows.isLoading ? 'Loading…' : 'No workflows in this queue'}
          />
          {act.isError && (
            <div
              className="mt-3 rounded-input bg-danger-bg border border-danger/30 px-3 py-2 text-xs text-danger"
              data-testid="workflow-error"
            >
              Action failed. Check permissions and try again.
            </div>
          )}
          {act.isSuccess && (
            <div
              className="mt-3 rounded-input bg-success-bg border border-success/30 px-3 py-2 text-xs text-success"
              data-testid="workflow-success"
            >
              Workflow moved to {act.data.stage}.
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}
