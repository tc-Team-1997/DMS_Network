/**
 * DashboardToolbar — timeframe selector, comparator selector, refresh button.
 * Uses CC4 Combobox for both selectors.
 */

import { RefreshCw } from 'lucide-react';
import { Combobox, type ComboboxOption } from '@/components/ui';
import {
  COMPARATOR_LABELS,
  COMPARATORS,
  TIMEFRAME_LABELS,
  TIMEFRAMES,
  type Comparator,
  type Timeframe,
} from '../schemas';

interface DashboardToolbarProps {
  timeframe:     Timeframe;
  comparator:    Comparator;
  onTimeframe:   (tf: Timeframe)    => void;
  onComparator:  (c: Comparator)    => void;
  onRefresh:     () => void;
  isRefreshing:  boolean;
  onCustomize:   () => void;
}

const TF_OPTIONS: ComboboxOption[] = TIMEFRAMES.map((tf) => ({
  value: tf,
  label: TIMEFRAME_LABELS[tf],
}));

const CMP_OPTIONS: ComboboxOption[] = COMPARATORS.map((c) => ({
  value: c,
  label: COMPARATOR_LABELS[c],
}));

export function DashboardToolbar({
  timeframe,
  comparator,
  onTimeframe,
  onComparator,
  onRefresh,
  isRefreshing,
  onCustomize,
}: DashboardToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Timeframe */}
      <div className="w-36">
        <Combobox
          value={timeframe}
          options={TF_OPTIONS}
          onChange={(v) => onTimeframe(v as Timeframe)}
          placeholder="Timeframe"
        />
      </div>

      {/* Comparator */}
      <div className="w-44">
        <Combobox
          value={comparator}
          options={CMP_OPTIONS}
          onChange={(v) => onComparator(v as Comparator)}
          placeholder="Compare"
        />
      </div>

      <div className="ml-auto flex items-center gap-2">
        {/* Customize */}
        <button
          type="button"
          onClick={onCustomize}
          className="inline-flex items-center gap-1.5 rounded-input border border-divider bg-surface px-3 py-1.5 text-sm text-ink-sub hover:bg-divider focus:outline-none focus:ring-2 focus:ring-brand-blue transition-colors"
        >
          Customize
        </button>

        {/* Refresh */}
        <button
          type="button"
          onClick={onRefresh}
          aria-label="Refresh dashboard"
          disabled={isRefreshing}
          className="inline-flex items-center gap-1.5 rounded-input border border-divider bg-surface px-3 py-1.5 text-sm text-ink-sub hover:bg-divider focus:outline-none focus:ring-2 focus:ring-brand-blue disabled:opacity-50 transition-colors"
        >
          <RefreshCw
            size={13}
            className={isRefreshing ? 'animate-spin' : undefined}
          />
          Refresh
        </button>
      </div>
    </div>
  );
}
