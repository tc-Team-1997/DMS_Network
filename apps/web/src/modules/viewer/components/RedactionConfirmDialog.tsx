/**
 * RedactionConfirmDialog — final irreversibility gate before the POST fires.
 *
 * Accessibility:
 *  - Focus trap: focus moves to the reason textarea on open, Tab cycles
 *    within the dialog, ESC cancels.
 *  - role="dialog" + aria-modal + aria-labelledby.
 *  - Submit disabled until: reason ≥ 20 chars + checkbox checked.
 */

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui';
import { REASON_LABELS } from '../redaction/schemas';
import type { CanvasRegion, Reason } from '../redaction/schemas';

// ── summary helpers ───────────────────────────────────────────────────────────

function summarise(regions: CanvasRegion[]): Map<Reason, number> {
  const m = new Map<Reason, number>();
  for (const r of regions) {
    m.set(r.reason, (m.get(r.reason) ?? 0) + 1);
  }
  return m;
}

// ── props ─────────────────────────────────────────────────────────────────────

export interface RedactionConfirmDialogProps {
  regions: CanvasRegion[];
  /** Called when user submits with the selected reason enum. */
  onConfirm: (reason: Reason) => void;
  /** Called when user cancels */
  onCancel: () => void;
  /** Whether the POST is in-flight */
  loading: boolean;
  /** If the POST returned an error */
  error: string | null;
}

const MIN_NOTES = 20;

// ── component ─────────────────────────────────────────────────────────────────

export function RedactionConfirmDialog({
  regions,
  onConfirm,
  onCancel,
  loading,
  error,
}: RedactionConfirmDialogProps) {
  const titleId = useId();
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState<Reason>('pii');
  const [checked, setChecked] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFocusRef = useRef<HTMLTextAreaElement>(null);

  // Move focus into dialog on mount
  useEffect(() => {
    firstFocusRef.current?.focus();
  }, []);

  // Focus trap + ESC close
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') { onCancel(); return; }
    if (e.key !== 'Tab') return;

    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button,textarea,input,select,[tabindex]:not([tabindex="-1"])',
      ),
    ).filter((el) => !el.hasAttribute('disabled'));

    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
  };

  const notesOk = notes.trim().length >= MIN_NOTES;
  const canSubmit = notesOk && checked && !loading;
  const summary = summarise(regions);

  const handleSubmit = () => {
    if (!canSubmit) return;
    onConfirm(reason);
  };

  return (
    /* backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/40"
      aria-hidden="false"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="redact-confirm-dialog"
        className="w-full max-w-md bg-white rounded-card shadow-card border border-divider p-6 space-y-5"
        onKeyDown={onKeyDown}
      >
        {/* Header */}
        <div className="flex items-start gap-3">
          <AlertTriangle size={20} className="text-danger flex-shrink-0 mt-0.5" />
          <div>
            <h2 id={titleId} className="text-md font-semibold text-ink">
              Save redacted copy
            </h2>
            <p className="text-xs text-muted mt-0.5">
              This action is permanent and cannot be undone. The original document
              will be preserved for audit purposes.
            </p>
          </div>
        </div>

        {/* Region summary */}
        <div className="rounded-input border border-divider bg-page p-3 space-y-1.5">
          <p className="text-xs font-medium text-ink-sub">
            {regions.length} region{regions.length === 1 ? '' : 's'} to redact
          </p>
          {Array.from(summary.entries()).map(([rsn, count]) => (
            <div key={rsn} className="flex justify-between text-xs">
              <span className="text-muted">{REASON_LABELS[rsn]}</span>
              <span className="text-ink font-medium">
                {count} region{count === 1 ? '' : 's'}
              </span>
            </div>
          ))}
        </div>

        {/* Overall reason dropdown */}
        <div>
          <label className="block">
            <span className="label">Primary reason for redaction</span>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value as Reason)}
              className="input"
              data-testid="redact-confirm-reason"
            >
              <option value="pii">PII</option>
              <option value="financial-secret">Financial secret</option>
              <option value="commercial-confidential">Commercial confidential</option>
              <option value="legal-hold">Legal hold</option>
              <option value="other">Other</option>
            </select>
          </label>
        </div>

        {/* Notes / justification */}
        <div>
          <label className="block">
            <span className="label">
              Justification{' '}
              <span className="text-muted font-normal">(min 20 chars)</span>
            </span>
            <textarea
              ref={firstFocusRef}
              data-testid="redact-confirm-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Describe why this redaction is necessary…"
              className="input resize-none"
              aria-describedby="notes-hint"
            />
          </label>
          <p
            id="notes-hint"
            className={notes.trim().length < MIN_NOTES && notes.length > 0
              ? 'text-2xs text-danger mt-0.5'
              : 'text-2xs text-muted mt-0.5'}
          >
            {notes.trim().length}/{MIN_NOTES} characters minimum
          </p>
        </div>

        {/* Irreversibility checkbox */}
        <label className="flex items-start gap-2.5 cursor-pointer group">
          <input
            type="checkbox"
            data-testid="redact-confirm-checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-border accent-danger"
          />
          <span className="text-xs text-ink-sub group-hover:text-ink">
            I understand this redaction is irreversible. The text in the selected
            regions will be permanently destroyed in the new document version.
          </span>
        </label>

        {/* Error banner */}
        {error && (
          <div
            role="alert"
            className="rounded-input border border-danger/30 bg-danger-bg px-3 py-2 text-xs text-danger"
          >
            {error}
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-1">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onCancel}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            size="sm"
            data-testid="redact-confirm-submit"
            loading={loading}
            disabled={!canSubmit}
            onClick={handleSubmit}
          >
            Save redacted copy
          </Button>
        </div>
      </div>
    </div>
  );
}
