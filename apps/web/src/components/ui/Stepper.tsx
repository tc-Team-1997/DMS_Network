import { cn } from '@/lib/cn';
import { Check, X } from 'lucide-react';

export type StepStatus = 'pending' | 'active' | 'complete' | 'error';

export interface Step {
  key: string;
  label: string;
  description?: string;
}

export interface StepperProps {
  steps: Step[];
  /** Zero-based index of the current (active) step. */
  current: number;
  orientation?: 'horizontal' | 'vertical';
  /**
   * Called when a completed step is clicked. Error steps are also clickable
   * to allow retry navigation. Pending steps are not clickable.
   */
  onStepClick?: (index: number) => void;
  className?: string;
}

function getStatus(index: number, current: number): StepStatus {
  if (index < current) return 'complete';
  if (index === current) return 'active';
  return 'pending';
}

// ─── Step indicator circle ────────────────────────────────────────────────────

interface IndicatorProps {
  status: StepStatus;
  number: number;
}

function Indicator({ status, number }: IndicatorProps) {
  const base =
    'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ring-2 transition-colors';

  switch (status) {
    case 'complete':
      return (
        <span className={cn(base, 'bg-success ring-success text-white')}>
          <Check size={14} strokeWidth={3} />
        </span>
      );
    case 'active':
      return (
        <span className={cn(base, 'bg-brand-blue ring-brand-blue text-white')}>
          {number}
        </span>
      );
    case 'error':
      return (
        <span className={cn(base, 'bg-danger ring-danger text-white')}>
          <X size={14} strokeWidth={3} />
        </span>
      );
    case 'pending':
      return (
        <span className={cn(base, 'bg-surface ring-border text-muted')}>
          {number}
        </span>
      );
  }
}

// ─── Stepper ──────────────────────────────────────────────────────────────────

export function Stepper({
  steps,
  current,
  orientation = 'horizontal',
  onStepClick,
  className,
}: StepperProps) {
  const isVertical = orientation === 'vertical';

  return (
    <ol
      aria-label="Progress"
      className={cn(
        'flex',
        isVertical ? 'flex-col gap-0' : 'flex-row items-start gap-0',
        className,
      )}
    >
      {steps.map((step, idx) => {
        const status = getStatus(idx, current);
        const isClickable = (status === 'complete' || status === 'error') && onStepClick !== undefined;
        const isLast = idx === steps.length - 1;

        const labelColor =
          status === 'active'
            ? 'text-brand-blue font-semibold'
            : status === 'complete'
            ? 'text-ink'
            : status === 'error'
            ? 'text-danger font-semibold'
            : 'text-muted';

        const connectorActive = idx < current;

        const stepContent = (
          <>
            <Indicator status={status} number={idx + 1} />
            <div className={cn('mt-1', isVertical && 'mt-0 ml-3')}>
              <p className={cn('text-sm leading-tight', labelColor)}>{step.label}</p>
              {step.description !== undefined && (
                <p className="text-xs text-muted">{step.description}</p>
              )}
            </div>
          </>
        );

        return (
          <li
            key={step.key}
            aria-current={status === 'active' ? 'step' : undefined}
            className={cn(
              'relative flex',
              isVertical
                ? 'flex-row items-start pb-8 last:pb-0'
                : 'flex-col items-center flex-1 last:flex-none',
            )}
          >
            {/* Step button or static node */}
            {isClickable ? (
              <button
                type="button"
                onClick={() => onStepClick(idx)}
                className={cn(
                  'flex items-center gap-2 rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue focus-visible:ring-offset-2',
                  isVertical ? 'flex-row' : 'flex-col items-center text-center',
                )}
              >
                {stepContent}
              </button>
            ) : (
              <div
                className={cn(
                  'flex items-center gap-2',
                  isVertical ? 'flex-row' : 'flex-col items-center text-center',
                )}
              >
                {stepContent}
              </div>
            )}

            {/* Connector line */}
            {!isLast && (
              isVertical ? (
                /* Vertical connector — absolute line running down from this step */
                <span
                  aria-hidden="true"
                  className={cn(
                    'absolute left-4 top-8 h-full w-0.5 -translate-x-1/2',
                    connectorActive ? 'bg-success' : 'bg-border',
                  )}
                />
              ) : (
                /* Horizontal connector — fills the remaining width of the li */
                <span
                  aria-hidden="true"
                  className={cn(
                    'mt-4 h-0.5 w-full',
                    connectorActive ? 'bg-success' : 'bg-border',
                  )}
                />
              )
            )}
          </li>
        );
      })}
    </ol>
  );
}
