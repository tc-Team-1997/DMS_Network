/**
 * RedactionToolbar — appears in the Viewer annotation bar.
 *
 * Shows "Redact" button when:
 *   - FF_REDACTION flag is on
 *   - user has `documents:redact` permission (Maker, Checker, or Doc Admin)
 *
 * Clicking the button toggles redact mode.  When redact mode is active the
 * button shows a distinctive active style and a status label.
 */

import { Scissors } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui';
import { FF_REDACTION } from '../redaction/schemas';

// ── permission helper ─────────────────────────────────────────────────────────
// Roles that carry `documents:redact` per contract §8
const REDACT_ROLES = new Set(['Doc Admin', 'Maker', 'Checker']);

export interface RedactionToolbarProps {
  /** Current user role from the auth store */
  userRole: string | null | undefined;
  /** Whether redact mode is currently active */
  active: boolean;
  /** Number of regions currently placed */
  regionCount: number;
  /** Toggle redact mode */
  onToggle: () => void;
  /** Open the confirmation / save dialog */
  onSave: () => void;
}

export function RedactionToolbar({
  userRole,
  active,
  regionCount,
  onToggle,
  onSave,
}: RedactionToolbarProps) {
  // Feature-flag gate + RBAC gate
  if (!FF_REDACTION) return null;
  if (!userRole || !REDACT_ROLES.has(userRole)) return null;

  return (
    <>
      <div className="w-px h-5 bg-border mx-0.5" aria-hidden="true" />

      <button
        type="button"
        data-testid="redact-toolbar-button"
        aria-pressed={active}
        aria-label={active ? 'Exit redaction mode' : 'Enter redaction mode'}
        onClick={onToggle}
        className={cn(
          'inline-flex items-center gap-1 px-2 py-1 rounded-input text-xs transition-colors',
          active
            ? 'bg-danger text-white'
            : 'bg-white border border-border text-ink hover:bg-divider',
        )}
      >
        <Scissors size={14} />
        <span>Redact</span>
      </button>

      {/* Active state indicator + region count live region */}
      {active && (
        <>
          <span
            data-testid="redact-mode-active"
            className="inline-flex items-center px-2 py-1 rounded-input bg-danger/10 text-danger text-xs font-medium"
            aria-live="polite"
            aria-atomic="true"
          >
            {regionCount === 0
              ? 'Draw regions to redact'
              : `${regionCount} region${regionCount === 1 ? '' : 's'} selected`}
          </span>

          {regionCount > 0 && (
            <Button
              size="sm"
              variant="danger"
              data-testid="redact-confirm-button"
              onClick={onSave}
            >
              Save redacted copy
            </Button>
          )}
        </>
      )}
    </>
  );
}
