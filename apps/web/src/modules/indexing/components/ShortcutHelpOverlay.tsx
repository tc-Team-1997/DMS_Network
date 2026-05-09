/**
 * ShortcutHelpOverlay — modal shown when the user presses '?'.
 * Lists all keyboard shortcuts for the Indexing Station.
 */

import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface ShortcutHelpOverlayProps {
  open: boolean;
  onClose: () => void;
  keyNext: string;
  keyPrev: string;
}

interface ShortcutRow {
  keys: string[];
  action: string;
}

function Kbd({ children }: { children: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex items-center justify-center rounded-input border border-border',
        'bg-raised px-1.5 py-0.5 font-mono text-xs text-ink min-w-[24px]',
      )}
    >
      {children}
    </kbd>
  );
}

export function ShortcutHelpOverlay({ open, onClose, keyNext, keyPrev }: ShortcutHelpOverlayProps) {
  if (!open) return null;

  const shortcuts: ShortcutRow[] = [
    { keys: [keyNext.toUpperCase()],                    action: 'Next field' },
    { keys: [keyPrev.toUpperCase()],                    action: 'Previous field' },
    { keys: ['Tab'],                                    action: 'Next field (Tab order)' },
    { keys: ['Shift', 'Enter'],                         action: 'Save + advance to next document' },
    { keys: ['Esc'],                                    action: 'Release lock + close document' },
    { keys: ['?'],                                      action: 'Toggle this help overlay' },
  ];

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-96 rounded-card border border-divider bg-surface shadow-card">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-divider px-5 py-4">
          <h2 className="text-md font-semibold text-ink">Keyboard shortcuts</h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className={cn(
              'rounded-input p-1 text-muted hover:bg-divider',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue',
            )}
          >
            <X size={16} />
          </button>
        </div>

        {/* Shortcut table */}
        <dl className="divide-y divide-divider px-5 py-3">
          {shortcuts.map((s) => (
            <div key={s.action} className="flex items-center justify-between gap-4 py-2">
              <dt className="text-xs text-muted">{s.action}</dt>
              <dd className="flex items-center gap-1">
                {s.keys.map((k, i) => (
                  <span key={i} className="flex items-center gap-1">
                    <Kbd>{k}</Kbd>
                    {i < s.keys.length - 1 && (
                      <span className="text-2xs text-muted">+</span>
                    )}
                  </span>
                ))}
              </dd>
            </div>
          ))}
        </dl>

        <div className="border-t border-divider px-5 py-3">
          <p className="text-2xs text-muted">
            J/K keys are configurable in Admin Settings → Indexing.
          </p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
