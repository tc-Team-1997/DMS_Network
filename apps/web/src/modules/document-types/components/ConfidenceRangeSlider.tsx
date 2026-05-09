/**
 * ConfidenceRangeSlider — two independent range inputs (floor + high)
 * on the same 0–1 axis.
 *
 * Visual design:
 *   - Gold track for autofill_floor handle
 *   - Green track for high_confidence handle
 *   - Tick marks at 0.0, 0.1, … 1.0 with numeric labels
 *   - Constraint: floor <= high; dragging past the other snaps to it
 *
 * A11y:
 *   - Each handle is a native <input type="range">
 *   - aria-valuetext announces "NN percent. <purpose> threshold."
 *   - Tab order: floor → high
 *   - Step = 0.05 for arrow keys, 0.01 for Shift+Arrow (via keyboard handler)
 */

import { useCallback, useId } from 'react';
import { cn } from '@/lib/cn';
import { t } from '@/lib/i18n';

const TICKS = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0] as const;

export interface ConfidenceRangeSliderProps {
  /** 0–1 value for the autofill floor (gold) */
  floor: number;
  /** 0–1 value for the high-confidence threshold (green) */
  high: number;
  onFloorChange: (v: number) => void;
  onHighChange: (v: number) => void;
  disabled?: boolean;
}

function pct(v: number): number {
  return Math.round(v * 100);
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export function ConfidenceRangeSlider({
  floor,
  high,
  onFloorChange,
  onHighChange,
  disabled = false,
}: ConfidenceRangeSliderProps) {
  const floorId = useId();
  const highId = useId();

  const handleFloor = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = parseFloat(e.target.value);
      // Clamp: floor cannot exceed high
      const next = clamp(raw, 0, high);
      onFloorChange(parseFloat(next.toFixed(2)));
    },
    [high, onFloorChange],
  );

  const handleHigh = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = parseFloat(e.target.value);
      // Clamp: high cannot go below floor
      const next = clamp(raw, floor, 1);
      onHighChange(parseFloat(next.toFixed(2)));
    },
    [floor, onHighChange],
  );

  // Shift+Arrow gives finer step (0.01), plain Arrow = 0.05
  const makeKeyHandler =
    (current: number, setter: (v: number) => void, min: number, max: number) =>
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      const step = e.shiftKey ? 0.01 : 0.05;
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
        e.preventDefault();
        setter(parseFloat(clamp(current + step, min, max).toFixed(2)));
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
        e.preventDefault();
        setter(parseFloat(clamp(current - step, min, max).toFixed(2)));
      }
    };

  return (
    <div className="space-y-5" data-testid="thresholds-tab">
      {/* ── autofill_floor (gold) ── */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label htmlFor={floorId} className="text-xs font-medium text-ink">
            {t('doctype.autofill_floor_label')}
          </label>
          <span
            className="text-xs font-mono text-warning font-semibold w-12 text-right"
            aria-live="polite"
            aria-atomic="true"
            data-testid="threshold-slider-floor-label"
          >
            {pct(floor)}%
          </span>
        </div>

        <div className="relative">
          <input
            id={floorId}
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={floor}
            onChange={handleFloor}
            onKeyDown={makeKeyHandler(floor, onFloorChange, 0, high)}
            disabled={disabled}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct(floor)}
            aria-valuetext={`${pct(floor)} percent. Auto-fill threshold.`}
            aria-label={t('doctype.autofill_floor_label')}
            data-testid="threshold-slider-floor"
            className={cn(
              'w-full h-2 rounded-full appearance-none cursor-pointer',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-warning focus-visible:ring-offset-1',
              '[&::-webkit-slider-thumb]:appearance-none',
              '[&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4',
              '[&::-webkit-slider-thumb]:rounded-full',
              '[&::-webkit-slider-thumb]:bg-warning',
              '[&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white',
              '[&::-webkit-slider-thumb]:shadow-sm',
              '[&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4',
              '[&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-none',
              '[&::-moz-range-thumb]:bg-warning',
              disabled ? 'opacity-50 cursor-not-allowed' : '',
            )}
            style={{
              background: `linear-gradient(to right, rgb(217,119,6) 0%, rgb(217,119,6) ${pct(floor)}%, #F1EFE8 ${pct(floor)}%, #F1EFE8 100%)`,
            }}
          />
        </div>

        <p className="text-[10px] text-muted leading-snug">{t('doctype.autofill_floor_hint')}</p>
      </div>

      {/* ── high_confidence (green) ── */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label htmlFor={highId} className="text-xs font-medium text-ink">
            {t('doctype.confidence_high_label')}
          </label>
          <span
            className="text-xs font-mono text-success font-semibold w-12 text-right"
            aria-live="polite"
            aria-atomic="true"
            data-testid="threshold-slider-high-label"
          >
            {pct(high)}%
          </span>
        </div>

        <div className="relative">
          <input
            id={highId}
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={high}
            onChange={handleHigh}
            onKeyDown={makeKeyHandler(high, onHighChange, floor, 1)}
            disabled={disabled}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct(high)}
            aria-valuetext={`${pct(high)} percent. Highlight threshold.`}
            aria-label={t('doctype.confidence_high_label')}
            data-testid="threshold-slider-high"
            className={cn(
              'w-full h-2 rounded-full appearance-none cursor-pointer',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-success focus-visible:ring-offset-1',
              '[&::-webkit-slider-thumb]:appearance-none',
              '[&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4',
              '[&::-webkit-slider-thumb]:rounded-full',
              '[&::-webkit-slider-thumb]:bg-success',
              '[&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white',
              '[&::-webkit-slider-thumb]:shadow-sm',
              '[&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4',
              '[&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-none',
              '[&::-moz-range-thumb]:bg-success',
              disabled ? 'opacity-50 cursor-not-allowed' : '',
            )}
            style={{
              background: `linear-gradient(to right, rgb(34,197,94) 0%, rgb(34,197,94) ${pct(high)}%, #F1EFE8 ${pct(high)}%, #F1EFE8 100%)`,
            }}
          />
        </div>

        <p className="text-[10px] text-muted leading-snug">{t('doctype.confidence_high_hint')}</p>
      </div>

      {/* ── Tick marks ── */}
      <div className="relative w-full" aria-hidden="true">
        <div className="flex justify-between">
          {TICKS.map((tick) => (
            <div key={tick} className="flex flex-col items-center">
              <div className="w-px h-1.5 bg-border" />
              <span className="text-[9px] text-muted mt-0.5">{pct(tick)}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Live summary (screen-reader friendly) ── */}
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {t('doctype.autofill_label_display', { pct: pct(floor) })}&nbsp;·&nbsp;
        {t('doctype.high_label_display', { pct: pct(high) })}
      </p>
    </div>
  );
}
