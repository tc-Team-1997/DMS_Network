/**
 * FieldPane — right pane of the Indexing Station.
 *
 * Renders a form with one input per editable field. Each field shows:
 *   - Label
 *   - Input (text or date)
 *   - AiConfidenceBadge when confidence data is available (CC4 primitive)
 *
 * Keyboard: clicking a field sets focusedFieldIndex so J/K can pick up from
 * there. Tab order is native.
 *
 * Autofocus: when a new document is opened, the parent passes
 * initialFocusFieldKey to scroll to and focus the first low-confidence field.
 */

import { useRef, useEffect, useCallback, type RefObject } from 'react';
import { Save, Loader2 } from 'lucide-react';
import { Button, AiConfidenceBadge } from '@/components/ui';
import type { SourceSpan } from '@/components/ui';
import { cn } from '@/lib/cn';
import { FIELD_DEFS, type FieldKey, type AnalysisResponse } from '../schemas';

export interface FieldPaneProps {
  documentId: number;
  draft: Record<FieldKey, string>;
  onDraftChange: (key: FieldKey, value: string) => void;
  onSave: () => void;
  onRelease: () => void;
  isSaving: boolean;
  saveError: boolean;
  analysis: AnalysisResponse | null;
  /** Field key to auto-focus when the document is first opened. */
  initialFocusFieldKey: FieldKey | null;
  focusedFieldIndex: number;
  setFocusedFieldIndex: (i: number) => void;
  /** Exposed so the keyboard hook can imperatively focus inputs. */
  fieldRefs: RefObject<HTMLInputElement | null>[];
}

export function FieldPane({
  documentId,
  draft,
  onDraftChange,
  onSave,
  onRelease,
  isSaving,
  saveError,
  analysis,
  initialFocusFieldKey,
  focusedFieldIndex,
  setFocusedFieldIndex,
  fieldRefs,
}: FieldPaneProps) {
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Auto-focus the initial low-confidence field when the document opens.
  useEffect(() => {
    if (!initialFocusFieldKey) return;
    const idx = FIELD_DEFS.findIndex((f) => f.key === initialFocusFieldKey);
    if (idx === -1) return;
    const ref = fieldRefs[idx];
    if (ref?.current) {
      ref.current.focus();
      ref.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setFocusedFieldIndex(idx);
    }
  }, [initialFocusFieldKey, fieldRefs, setFocusedFieldIndex]);

  const handleBboxFocus = useCallback(
    (fieldKey: string) => {
      const idx = FIELD_DEFS.findIndex((f) => f.key === fieldKey);
      if (idx === -1) return;
      const ref = fieldRefs[idx];
      if (ref?.current) {
        ref.current.focus();
        ref.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setFocusedFieldIndex(idx);
      }
    },
    [fieldRefs, setFocusedFieldIndex],
  );

  // Expose handleBboxFocus via the ref trick so PdfPane can call it.
  // (Passed up to IndexingPage which wires it to onBboxClick.)
  void handleBboxFocus; // used externally via props

  return (
    <div className="flex flex-col h-full border-l border-divider">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-divider bg-raised">
        <span className="text-xs font-semibold text-ink">Index fields</span>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={onRelease}
          >
            Release
          </Button>
          <Button
            size="sm"
            onClick={onSave}
            loading={isSaving}
            data-testid="station-save"
          >
            {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Save
          </Button>
        </div>
      </div>

      {/* Fields */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {FIELD_DEFS.map((fieldDef, idx) => {
          const fieldKey = fieldDef.key;
          const aiField = analysis?.fields[fieldKey];
          const confidence = aiField?.confidence != null ? aiField.confidence * 100 : null;
          const isFocused = focusedFieldIndex === idx;

          // Build a synthetic SourceSpan for AiConfidenceBadge.
          // exactOptionalPropertyTypes: only spread bbox when it is present —
          // never assign `undefined` to an optional property.
          const sourceSpan: SourceSpan = {
            text: aiField?.value ?? '',
            page: 1,
            ...(aiField?.bbox !== undefined
              ? { bbox: { x: aiField.bbox.x, y: aiField.bbox.y, w: aiField.bbox.w, h: aiField.bbox.h } }
              : {}),
          };

          return (
            <div
              key={fieldKey}
              data-testid={`field-row-${fieldKey}`}
              className={cn(
                'rounded-input border px-3 py-2.5 transition-colors',
                isFocused ? 'border-brand-blue bg-action-subtle' : 'border-border bg-surface',
              )}
            >
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <label
                  htmlFor={`indexing-input-${fieldKey}`}
                  className="text-xs font-medium text-ink-sub"
                >
                  {fieldDef.label}
                </label>
                {confidence !== null && confidence > 0 && (
                  <AiConfidenceBadge
                    confidence={confidence}
                    model="docbrain-local"
                    promptId={fieldKey}
                    sourceSpan={sourceSpan}
                    documentId={String(documentId)}
                    onOverride={() => {
                      // Override = focus the input so user can type.
                      fieldRefs[idx]?.current?.focus();
                    }}
                  />
                )}
              </div>
              <input
                id={`indexing-input-${fieldKey}`}
                ref={(el) => {
                  const r = fieldRefs[idx];
                  if (r) {
                    (r as { current: HTMLInputElement | null }).current = el;
                  }
                }}
                type={fieldDef.type}
                value={draft[fieldKey]}
                data-testid={`indexing-input-${fieldKey}`}
                onChange={(e) => onDraftChange(fieldKey, e.target.value)}
                onFocus={() => setFocusedFieldIndex(idx)}
                className={cn(
                  'w-full h-8 rounded-input border border-border px-2 text-md text-ink',
                  'focus:outline-none focus:border-brand-blue focus:ring-1 focus:ring-brand-blue',
                  'bg-surface transition-colors',
                )}
              />
            </div>
          );
        })}
      </div>

      {/* Error banner */}
      {saveError && (
        <div
          data-testid="indexing-error"
          className="mx-4 mb-3 rounded-input bg-danger-bg border border-danger/30 px-3 py-2 text-xs text-danger"
        >
          Save failed. Check permissions and try again.
        </div>
      )}
    </div>
  );
}
