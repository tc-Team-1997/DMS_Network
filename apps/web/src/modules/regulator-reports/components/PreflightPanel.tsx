/**
 * PreflightPanel — shows pre-flight check results before report generation.
 * Checks: missing_data, stale_signatures, retention_violations.
 * Each check has status: pass | warn | fail | error.
 */
import { CheckCircle, AlertTriangle, XCircle, AlertCircle } from 'lucide-react';
import { Skeleton } from '@/components/ui';
import type { PreflightCheck, PreflightResult } from '../schemas';

interface Props {
  result: PreflightResult | undefined;
  isLoading: boolean;
}

function CheckRow({ check }: { check: PreflightCheck }) {
  const cfg = {
    pass:  { icon: CheckCircle,   cls: 'text-success',  bg: 'bg-success-bg',  label: 'Pass'  },
    warn:  { icon: AlertTriangle, cls: 'text-warning',  bg: 'bg-warning-bg',  label: 'Warn'  },
    fail:  { icon: XCircle,       cls: 'text-danger',   bg: 'bg-danger-bg',   label: 'Fail'  },
    error: { icon: AlertCircle,   cls: 'text-muted',    bg: 'bg-raised',      label: 'Error' },
  }[check.status] ?? { icon: AlertCircle, cls: 'text-muted', bg: 'bg-raised', label: '?' };

  const Icon = cfg.icon;

  const checkLabel: Record<string, string> = {
    missing_data:         'Missing required data',
    stale_signatures:     'Stale signatures',
    retention_violations: 'Retention violations',
  };

  return (
    <div className={`flex items-start gap-3 rounded-input px-3 py-2.5 ${cfg.bg}`}>
      <Icon size={15} className={`mt-0.5 flex-shrink-0 ${cfg.cls}`} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-ink">
          {checkLabel[check.check] ?? check.check}
        </p>
        <p className="text-xs text-ink-sub mt-0.5">{check.detail}</p>
      </div>
      <span className={`flex-shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cfg.cls}`}>
        {cfg.label}
      </span>
    </div>
  );
}

export function PreflightPanel({ result, isLoading }: Props) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton height={40} />
        <Skeleton height={40} />
        <Skeleton height={40} />
      </div>
    );
  }

  if (!result) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between pb-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">Pre-flight checks</p>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            result.ready ? 'bg-success-bg text-success' : 'bg-danger-bg text-danger'
          }`}
        >
          {result.ready ? 'Ready to generate' : 'Issues found — review before generating'}
        </span>
      </div>
      {result.checks.map((c) => (
        <CheckRow key={c.check} check={c} />
      ))}
    </div>
  );
}
