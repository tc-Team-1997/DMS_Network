/**
 * DecisionTraceViewer — surfaces past authorization decisions from audit_log.
 *
 * Reads from GET /spa/api/admin/audit-log and filters rows whose `details`
 * JSON contains ABAC-related keys (allow, via, abac_deny).
 * No new DB columns needed — the existing detail column already carries this.
 */
import { RefreshCw, ShieldCheck, ShieldX, Activity } from 'lucide-react';
import { Badge, Button, EmptyState, Skeleton } from '@/components/ui';
import { useDecisionTrace } from '../api';
import type { DecisionTraceRow } from '../schemas';

function DecisionRow({ row }: { row: DecisionTraceRow }) {
  const isAllow = row.allow === true;
  const isDeny  = row.allow === false;

  return (
    <tr className="border-b border-divider last:border-0 hover:bg-surface-alt/50">
      <td className="py-2 pr-3 text-xs text-muted whitespace-nowrap">
        {new Date(row.created_at).toLocaleString()}
      </td>
      <td className="py-2 pr-3 text-xs font-mono text-ink">
        {row.action ?? '—'}
      </td>
      <td className="py-2 pr-3 text-xs text-ink-sub">
        {row.username ?? '—'}
      </td>
      <td className="py-2 pr-3">
        {isAllow && (
          <Badge tone="success">
            <ShieldCheck size={9} className="mr-0.5 inline-block" />
            ALLOW
          </Badge>
        )}
        {isDeny && (
          <Badge tone="danger">
            <ShieldX size={9} className="mr-0.5 inline-block" />
            DENY
          </Badge>
        )}
        {!isAllow && !isDeny && <Badge tone="neutral">—</Badge>}
      </td>
      <td className="py-2 pr-3 text-xs text-muted">
        {row.via ?? '—'}
      </td>
      <td className="py-2 text-xs font-mono text-ink-sub">
        {row.reason ?? '—'}
      </td>
    </tr>
  );
}

export function DecisionTraceViewer() {
  const trace = useDecisionTrace(100);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-ink-sub">
          Authorization decisions recorded in the audit log. Rows where the{' '}
          <code className="rounded bg-divider px-1 text-xs">details</code> JSON
          contains <code className="rounded bg-divider px-1 text-xs">allow</code> or{' '}
          <code className="rounded bg-divider px-1 text-xs">via</code> keys.
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => { void trace.refetch(); }}
          disabled={trace.isFetching}
        >
          <RefreshCw size={12} className={trace.isFetching ? 'animate-spin' : ''} />
          Refresh
        </Button>
      </div>

      {trace.isLoading && (
        <div className="space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-3/4" />
        </div>
      )}

      {!trace.isLoading && (trace.data ?? []).length === 0 && (
        <EmptyState
          icon={<Activity size={20} />}
          title="No authorization decisions in the audit log"
          body="ABAC decisions are recorded when OPA is active. Enable OPA_URL and perform some actions to see traces here."
        />
      )}

      {!trace.isLoading && (trace.data ?? []).length > 0 && (
        <div className="overflow-x-auto rounded-card border border-divider">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-divider bg-surface-alt">
                <th className="py-2 pr-3 text-xs font-semibold text-muted">When</th>
                <th className="py-2 pr-3 text-xs font-semibold text-muted">Action</th>
                <th className="py-2 pr-3 text-xs font-semibold text-muted">User</th>
                <th className="py-2 pr-3 text-xs font-semibold text-muted">Decision</th>
                <th className="py-2 pr-3 text-xs font-semibold text-muted">Via</th>
                <th className="py-2 text-xs font-semibold text-muted">Reason</th>
              </tr>
            </thead>
            <tbody>
              {(trace.data ?? []).map(row => (
                <DecisionRow key={row.id} row={row} />
              ))}
            </tbody>
          </table>
          <p className="px-3 py-2 text-[10px] text-muted">
            Showing last {(trace.data ?? []).length} matching audit entries.
          </p>
        </div>
      )}
    </div>
  );
}
