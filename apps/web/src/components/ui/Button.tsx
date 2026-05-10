import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

const base =
  'inline-flex items-center justify-center gap-2 rounded-input font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

const variants: Record<Variant, string> = {
  primary:   'bg-brand-blue text-white hover:bg-brand-blueHover focus:outline-none focus:ring-2 focus:ring-brand-blue focus:ring-offset-1',
  secondary: 'bg-brand-skyLight text-brand-blue hover:bg-[#d0e3fb] focus:outline-none focus:ring-2 focus:ring-brand-blue/40',
  ghost:     'bg-white border border-border text-ink-sub hover:bg-surface-alt focus:outline-none focus:ring-2 focus:ring-border',
  danger:    'bg-danger text-white hover:bg-[#c73b3a]',
};

/**
 * Sizes: desktop heights are h-8 (sm) / h-10 (md).
 * On mobile (below md breakpoint) we enforce min-h-[44px] per HIG / WCAG
 * touch target guidance. The md: override restores the compact desktop size.
 */
const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-xs min-h-[44px] md:min-h-0',
  md: 'h-10 px-4 text-sm min-h-[44px] md:min-h-0',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, disabled, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled ?? loading}
      className={cn(base, variants[variant], sizes[size], className)}
      {...rest}
    >
      {loading ? <span className="animate-pulse">…</span> : children}
    </button>
  );
});
