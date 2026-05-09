/**
 * KpiTile — large value + delta badge + sparkline + status-vs-target chip.
 *
 * Reads nothing from the network itself; data is passed in as props from
 * DashboardPage (which owns the single useKpis() query).
 */

import { cn } from '@/lib/cn';
import { Badge } from '@/components/ui';
import { color } from '@/styles/tokens';
import { Skeleton } from '@/components/ui';
import type { BadgeTone } from '@/components/ui';
import type { TileStatus } from '../schemas';
import { Sparkline } from './Sparkline';

export interface KpiTileProps {
  label: string;
  subline: string;
  /** Formatted display value (already rounded/suffixed by DashboardPage). */
  value: string;
  /** Signed delta as a display string, e.g. "+3.2" or "-1". Null hides the badge. */
  delta: string | null;
  /**
   * Whether a higher delta is good (percent_automated, ai_confidence)
   * or bad (kyc_cycle, expiring_30d, audit_failures_ytd).
   */
  higherIsBetter: boolean;
  sparkline: number[];
  status: TileStatus;
  loading?: boolean;
}

const statusTone: Record<TileStatus, BadgeTone> = {
  'on-track': 'success',
  'at-risk':  'warning',
  'breach':   'danger',
};

const statusLabel: Record<TileStatus, string> = {
  'on-track': 'On track',
  'at-risk':  'At risk',
  'breach':   'Breach',
};

const sparklineColor: Record<TileStatus, string> = {
  'on-track': color.success,
  'at-risk':  color.warning,
  'breach':   color.danger,
};

export function KpiTile({
  label,
  subline,
  value,
  delta,
  higherIsBetter,
  sparkline,
  status,
  loading = false,
}: KpiTileProps) {
  if (loading) {
    return (
      <div className="card p-5 flex flex-col gap-3">
        <Skeleton variant="line" width="60%" height={12} />
        <Skeleton variant="block" width="40%" height={28} />
        <Skeleton variant="line" width="80%" height={10} />
      </div>
    );
  }

  const deltaNum = delta !== null ? parseFloat(delta) : null;
  const deltaPositive = deltaNum !== null && deltaNum > 0;
  const deltaNeutral  = deltaNum === null || deltaNum === 0;

  // Good means: positive AND higherIsBetter, OR negative AND !higherIsBetter
  const deltaGood = deltaNeutral
    ? null
    : (deltaPositive === higherIsBetter);

  const deltaPrefix = deltaNum !== null && deltaNum > 0 ? '+' : '';

  return (
    <div className="card p-5 flex flex-col gap-1">
      {/* Top row: label + status chip */}
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm font-medium text-ink-sub leading-tight">{label}</span>
        <Badge tone={statusTone[status]} className="shrink-0">
          {statusLabel[status]}
        </Badge>
      </div>

      {/* Value */}
      <div className="flex items-end gap-3 mt-1">
        <span className="text-2xl font-bold text-ink tracking-tight">{value}</span>
        {delta !== null && deltaNum !== null && (
          <span
            className={cn(
              'text-sm font-medium mb-0.5',
              deltaGood === true  && 'text-success',
              deltaGood === false && 'text-danger',
              deltaGood === null  && 'text-muted',
            )}
          >
            {deltaPrefix}{delta}
          </span>
        )}
      </div>

      {/* Subline */}
      <span className="text-xs text-muted leading-tight">{subline}</span>

      {/* Sparkline */}
      <div className="mt-2">
        <Sparkline data={sparkline} color={sparklineColor[status]} />
      </div>
    </div>
  );
}
