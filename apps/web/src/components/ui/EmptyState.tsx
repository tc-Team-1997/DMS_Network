import { cn } from '@/lib/cn';
import type { ReactNode } from 'react';

export interface EmptyStateProps {
  /** Optional icon element rendered above the title. */
  icon?: ReactNode;
  /** Primary heading. */
  title: string;
  /** Supporting copy beneath the title. */
  body?: string;
  /** Optional call-to-action button. */
  action?: { label: string; onClick: () => void };
  className?: string;
}

export function EmptyState({ icon, title, body, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-3 py-16 text-center',
        className,
      )}
    >
      {icon !== undefined && (
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-divider text-muted">
          {icon}
        </div>
      )}
      <div className="flex flex-col gap-1">
        <p className="text-md font-semibold text-ink">{title}</p>
        {body !== undefined && <p className="text-sm text-muted">{body}</p>}
      </div>
      {action !== undefined && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-1 inline-flex items-center rounded-input bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-blueHover focus:outline-none focus:ring-2 focus:ring-brand-blue focus:ring-offset-1 transition-colors"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
