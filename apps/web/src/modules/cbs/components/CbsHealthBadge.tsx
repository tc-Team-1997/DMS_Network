/**
 * CbsHealthBadge — small pill showing the Temenos T24 circuit-breaker state.
 *
 * - Polls /spa/api/cbs/health every 30 s (via react-query refetchInterval).
 * - Renders dot + text + icon (no colour-only signal — a11y requirement).
 * - Tooltip on hover shows cache hit rate as a percentage.
 * - When FF_CBS_LIVE is off: neutral grey pill "CBS off (feature flag)".
 * - When circuit is closed: green dot + "CBS healthy".
 * - When circuit is half_open: amber dot + "CBS degraded".
 * - When circuit is open: red dot + "CBS down".
 * - Respects prefers-reduced-motion — no animation when user prefers reduced.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, WifiOff, Wifi } from 'lucide-react';
import { cn } from '@/lib/cn';
import { t } from '@/lib/i18n';
import { fetchCbsHealth } from '../api';
import type { CbsHealth } from '../schemas';

// ── Feature flag ──────────────────────────────────────────────────────────

const FF_CBS_LIVE: boolean =
  import.meta.env['VITE_FF_CBS_LIVE'] !== undefined
    ? import.meta.env['VITE_FF_CBS_LIVE'] !== 'false'
    : false; // default OFF

// ── State-to-style map ────────────────────────────────────────────────────

type CircuitState = CbsHealth['circuit_state'];

const stateConfig: Record<
  CircuitState,
  { dot: string; label: string; icon: React.ReactNode }
> = {
  closed: {
    dot: 'bg-success',
    label: 'cbs.health_closed',
    icon: <Wifi size={12} aria-hidden="true" />,
  },
  half_open: {
    dot: 'bg-warning',
    label: 'cbs.health_half_open',
    icon: <Activity size={12} aria-hidden="true" />,
  },
  open: {
    dot: 'bg-danger',
    label: 'cbs.health_open',
    icon: <WifiOff size={12} aria-hidden="true" />,
  },
};

// ── Component ─────────────────────────────────────────────────────────────

export function CbsHealthBadge() {
  const [tooltipVisible, setTooltipVisible] = useState(false);

  const { data, isError } = useQuery({
    queryKey: ['cbs', 'health'],
    queryFn: fetchCbsHealth,
    refetchInterval: FF_CBS_LIVE ? 30_000 : false,
    enabled: FF_CBS_LIVE,
  });

  // Feature flag OFF
  if (!FF_CBS_LIVE) {
    return (
      <span
        data-testid="cbs-health-badge"
        className="inline-flex items-center gap-1.5 rounded-badge border border-border bg-divider px-2 py-0.5 text-xs text-ink-sub"
        role="status"
        aria-label={t('cbs.health_flag_off')}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-muted" aria-hidden="true" />
        {t('cbs.health_flag_off')}
      </span>
    );
  }

  // Error / unavailable before first response
  if (isError || !data) {
    return (
      <span
        data-testid="cbs-health-badge"
        className="inline-flex items-center gap-1.5 rounded-badge border border-border bg-divider px-2 py-0.5 text-xs text-ink-sub"
        role="status"
        aria-label={t('cbs.health_unknown')}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-muted" aria-hidden="true" />
        {t('cbs.health_unknown')}
      </span>
    );
  }

  const cfg = stateConfig[data.circuit_state];
  const cachePercent = Math.round(data.cache_hit_rate * 100);
  const badgeTone =
    data.circuit_state === 'closed'
      ? 'border-success/30 bg-success/10 text-success'
      : data.circuit_state === 'half_open'
      ? 'border-warning/30 bg-warning/10 text-warning'
      : 'border-danger/30 bg-danger/10 text-danger';

  const tooltipText = t('cbs.health_tooltip', { pct: cachePercent });

  return (
    <div className="relative inline-flex">
      <button
        type="button"
        data-testid="cbs-health-badge"
        aria-label={`${t(cfg.label)}. ${tooltipText}`}
        aria-describedby="cbs-health-tooltip"
        className={cn(
          'inline-flex cursor-default items-center gap-1.5 rounded-badge border px-2 py-0.5 text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue',
          badgeTone,
        )}
        onMouseEnter={() => setTooltipVisible(true)}
        onMouseLeave={() => setTooltipVisible(false)}
        onFocus={() => setTooltipVisible(true)}
        onBlur={() => setTooltipVisible(false)}
      >
        <span
          className={cn('h-1.5 w-1.5 shrink-0 rounded-full', cfg.dot)}
          aria-hidden="true"
        />
        {cfg.icon}
        {t(cfg.label)}
      </button>

      {tooltipVisible && (
        <div
          id="cbs-health-tooltip"
          data-testid="cbs-health-tooltip"
          role="tooltip"
          className="absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-input bg-ink px-2 py-1 text-2xs text-white shadow-card"
        >
          {tooltipText}
        </div>
      )}
    </div>
  );
}
