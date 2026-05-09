import { cn } from '@/lib/cn';
import type { HTMLAttributes } from 'react';

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  /** Shape variant. Defaults to 'block'. */
  variant?: 'block' | 'line' | 'circle';
  /** CSS width value or pixel number. */
  width?: string | number;
  /** CSS height value or pixel number. */
  height?: string | number;
  /** Render this many skeleton elements stacked vertically. Defaults to 1. */
  count?: number;
}

function toCss(value: string | number): string {
  return typeof value === 'number' ? `${value}px` : value;
}

function SingleSkeleton({
  variant = 'block',
  width,
  height,
  className,
  style,
  ...rest
}: Omit<SkeletonProps, 'count'>) {
  const isCircle = variant === 'circle';
  const isLine = variant === 'line';

  const computedStyle: React.CSSProperties = {
    ...(width !== undefined ? { width: toCss(width) } : {}),
    ...(height !== undefined ? { height: toCss(height) } : {}),
    ...style,
  };

  return (
    <div
      aria-hidden="true"
      className={cn(
        'animate-pulse bg-divider',
        isCircle && 'rounded-full',
        !isCircle && 'rounded-input',
        isLine ? 'h-3 w-full' : !isCircle && 'h-10 w-full',
        isCircle && !width && !height && 'h-10 w-10',
        className,
      )}
      style={computedStyle}
      {...rest}
    />
  );
}

export function Skeleton({ count = 1, ...props }: SkeletonProps) {
  if (count === 1) {
    return <SingleSkeleton {...props} />;
  }
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: count }, (_, i) => (
        <SingleSkeleton key={i} {...props} />
      ))}
    </div>
  );
}
