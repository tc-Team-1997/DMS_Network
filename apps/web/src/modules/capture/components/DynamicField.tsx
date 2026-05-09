/**
 * DynamicField — renders any extracted field (text/date/number/select).
 *
 * Enhancements over the original:
 *   - "Revert to AI value" link shown when user has edited an AI-filled field
 *     and the original AI value is still available.
 *   - "Lock" toggle prevents accidental overwrite (field becomes read-only).
 */

import React from 'react';
import { Sparkles, Lock, LockOpen, RotateCcw } from 'lucide-react';
import { Input } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { FieldDef } from '@/modules/document-types/api';
import { DEFAULT_CONFIDENCE_HIGH, DEFAULT_AUTOFILL_FLOOR } from '../constants';

function htmlInputType(t: FieldDef['type']): string {
  switch (t) {
    case 'date':   return 'date';
    case 'number': return 'number';
    case 'email':  return 'email';
    case 'tel':    return 'tel';
    default:       return 'text';
  }
}

interface DynamicFieldProps {
  field: FieldDef;
  value: string;
  onChange: (v: string) => void;
  confidence: number | undefined;
  /** Original AI-extracted value, if any; used for "Revert" affordance. */
  aiOriginalValue?: string;
  /** Whether the user has manually edited this field. */
  isManuallyEdited?: boolean;
  /** Whether this field is locked (read-only). */
  isLocked?: boolean;
  onToggleLock?: (key: string) => void;
  onRevert?: (key: string) => void;
  confidenceHigh?: number;
  compact?: boolean;
}

export function DynamicField({
  field,
  value,
  onChange,
  confidence,
  aiOriginalValue,
  isManuallyEdited = false,
  isLocked = false,
  onToggleLock,
  onRevert,
  confidenceHigh = DEFAULT_CONFIDENCE_HIGH,
  compact = false,
}: DynamicFieldProps) {
  const testId = `capture-field-${field.key}`;
  const hasAi   = confidence != null;
  const isHigh  = hasAi && confidence >= confidenceHigh;
  const isMed   = hasAi && !isHigh && confidence >= DEFAULT_AUTOFILL_FLOOR;

  // Show "Revert" only when: the field was AI-filled, the user has manually
  // changed it, and the original AI value differs from current value.
  const canRevert =
    hasAi &&
    isManuallyEdited &&
    aiOriginalValue != null &&
    aiOriginalValue !== value;

  /** Left-border glow style applied when AI has filled the field */
  const aiGlowStyle: React.CSSProperties | undefined = hasAi && !isManuallyEdited
    ? {
        borderLeftWidth: '3px',
        borderLeftColor: isHigh
          ? '#1D9E75'
          : isMed
            ? '#EF9F27'
            : '#888780',
        boxShadow: isHigh
          ? '0 0 8px 0 rgba(29,158,117,0.28)'
          : isMed
            ? '0 0 8px 0 rgba(239,159,39,0.22)'
            : 'none',
      }
    : undefined;

  const common = {
    value,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onChange(e.target.value),
    'data-testid': testId,
    readOnly: isLocked,
    disabled: isLocked,
  };

  return (
    <label className="block">
      <span className="mb-1 flex items-center gap-2 flex-wrap font-medium text-muted text-xs">
        {field.label}
        {field.required && <span className="text-danger" aria-label="required">*</span>}

        {hasAi && !isManuallyEdited && (
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-badge px-1.5 py-0.5 text-[10px] font-semibold normal-case',
              isHigh && 'text-success border border-success/40 bg-success-bg',
              isMed  && 'text-warning border border-warning/40 bg-warning-bg',
              !isHigh && !isMed && 'text-muted border border-border',
            )}
          >
            <Sparkles size={9} aria-hidden="true" />
            AI · {Math.round(confidence * 100)}%
            {isMed && ' · verify'}
          </span>
        )}

        {isManuallyEdited && hasAi && (
          <span className="inline-flex items-center gap-1 text-[10px] text-muted">
            <span className="text-muted">edited</span>
          </span>
        )}

        {/* Revert to AI value */}
        {canRevert && onRevert && (
          <button
            type="button"
            onClick={() => onRevert(field.key)}
            className="inline-flex items-center gap-0.5 text-[10px] text-brand-blue hover:underline ml-auto"
            data-testid={`capture-revert-${field.key}`}
            title={`Revert to AI value: ${aiOriginalValue ?? ''}`}
          >
            <RotateCcw size={9} aria-hidden="true" />
            Revert
          </button>
        )}

        {/* Lock toggle */}
        {onToggleLock && (
          <button
            type="button"
            onClick={() => onToggleLock(field.key)}
            className={cn(
              'ml-auto inline-flex items-center gap-0.5 text-[10px] rounded px-1 py-0.5 transition-colors',
              isLocked
                ? 'text-warning bg-warning-bg border border-warning/30'
                : 'text-muted hover:text-ink hover:bg-divider',
            )}
            data-testid={`capture-lock-${field.key}`}
            title={isLocked ? 'Unlock field' : 'Lock field to prevent accidental edits'}
            aria-pressed={isLocked}
          >
            {isLocked
              ? <><Lock size={9} aria-hidden="true" /> Locked</>
              : <LockOpen size={9} aria-hidden="true" />
            }
          </button>
        )}
      </span>

      <div className="relative transition-all duration-200">
        {field.type === 'textarea' ? (
          <textarea
            rows={compact ? 2 : 3}
            className={cn(
              'w-full rounded-lg border border-border bg-white px-3 py-2 text-md transition-all duration-200',
              isLocked && 'opacity-60 cursor-not-allowed bg-divider/30',
            )}
            style={aiGlowStyle}
            value={common.value}
            onChange={common.onChange}
            data-testid={testId}
            readOnly={isLocked}
          />
        ) : (
          <Input
            type={htmlInputType(field.type)}
            className={cn(
              hasAi && !isManuallyEdited && 'transition-all duration-200',
              isLocked && 'opacity-60 cursor-not-allowed',
            )}
            style={aiGlowStyle}
            value={common.value}
            onChange={common.onChange}
            data-testid={testId}
            readOnly={isLocked}
          />
        )}
      </div>
    </label>
  );
}
