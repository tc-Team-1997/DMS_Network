import { cn } from '@/lib/cn';
import type { HTMLAttributes } from 'react';

export type BadgeTone = 'success' | 'warning' | 'danger' | 'blue' | 'purple' | 'neutral';

const tones: Record<BadgeTone, string> = {
  success: 'bg-success-bg text-success-on-light',
  warning: 'bg-warning-bg text-warning-on-light',
  danger:  'bg-danger-bg  text-danger-on-light',
  blue:    'bg-brand-skyLight text-brand-blue',
  purple:  'bg-purple-bg text-purple-on-light',
  neutral: 'bg-divider    text-ink-sub',
};

type BadgeProps = { tone?: BadgeTone } & HTMLAttributes<HTMLSpanElement>;

export function Badge({ tone = 'neutral', children, className, ...rest }: BadgeProps) {
  return (
    <span
      {...rest}
      className={cn(
        'inline-block rounded-badge px-[9px] py-[3px] text-[11px] font-medium',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function statusTone(status: string): BadgeTone {
  const s = status.toLowerCase();
  if (s === 'valid' || s === 'approved' || s === 'active') return 'success';
  if (s === 'expiring' || s === 'pending') return 'warning';
  if (s === 'expired' || s.includes('reject') || s === 'locked') return 'danger';
  if (s.includes('review') || s.includes('sign')) return 'blue';
  return 'neutral';
}
