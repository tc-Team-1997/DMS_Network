import { cn } from '@/lib/cn';
import type { DsarStatus } from '../schemas';

interface Props {
  daysRemaining: number | null;
  status: DsarStatus;
}

export function SlaCountdown({ daysRemaining, status }: Props) {
  if (status === 'COMPLETED') {
    return (
      <span className="inline-flex items-center gap-1 rounded-badge px-2 py-0.5 text-xs font-medium bg-success-bg text-success">
        Completed
      </span>
    );
  }

  if (daysRemaining === null) {
    return <span className="text-xs text-muted">No SLA set</span>;
  }

  const overdue = daysRemaining < 0;
  const urgent = !overdue && daysRemaining <= 5;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-badge px-2 py-0.5 text-xs font-semibold tabular-nums',
        overdue
          ? 'bg-danger-bg text-danger'
          : urgent
            ? 'bg-warning-bg text-warning'
            : 'bg-action-subtle text-action',
      )}
    >
      {overdue
        ? `${Math.abs(daysRemaining)}d overdue`
        : daysRemaining === 0
          ? 'Due today'
          : `${daysRemaining}d remaining`}
    </span>
  );
}
