import { cn } from '@/lib/cn';

interface ShortcutItem {
  key: string;
  label: string;
}

const SHORTCUTS: ShortcutItem[] = [
  { key: 'A', label: 'Approve' },
  { key: 'R', label: 'Reject' },
  { key: 'E', label: 'Escalate' },
  { key: 'Esc', label: 'Close drawer' },
  { key: '?', label: 'Help' },
];

interface KeyboardShortcutsLegendProps {
  className?: string;
}

export function KeyboardShortcutsLegend({ className }: KeyboardShortcutsLegendProps) {
  return (
    <div className={cn('flex flex-wrap gap-x-4 gap-y-1', className)}>
      {SHORTCUTS.map(({ key, label }) => (
        <span key={key} className="inline-flex items-center gap-1 text-xs text-muted">
          <kbd className="rounded border border-border bg-raised px-1 py-0.5 font-mono text-2xs text-ink-sub leading-none">
            {key}
          </kbd>
          <span>{label}</span>
        </span>
      ))}
    </div>
  );
}
