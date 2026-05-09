/**
 * ConfidenceBadge — wraps CC4 AiConfidenceBadge with document-capture context.
 *
 * When full CC4 props are available (model, promptId, sourceSpan, documentId)
 * this renders the interactive popover badge. When only a numeric confidence
 * is available (before upload, no documentId) it falls back to a simple
 * inline badge that is still visually meaningful but not interactive.
 */

import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/cn';
import { AiConfidenceBadge, type AiConfidenceBadgeProps } from '@/components/ui/AiConfidenceBadge';
import { DEFAULT_CONFIDENCE_HIGH, DEFAULT_AUTOFILL_FLOOR } from '../constants';

interface FullProps extends AiConfidenceBadgeProps {
  variant: 'full';
}

interface SimpleProps {
  variant: 'simple';
  confidence: number;
  confidenceHigh?: number;
  onOverride?: () => void;
}

type ConfidenceBadgeProps = FullProps | SimpleProps;

export function ConfidenceBadge(props: ConfidenceBadgeProps) {
  if (props.variant === 'full') {
    const { variant: _v, ...rest } = props;
    return <AiConfidenceBadge {...rest} />;
  }

  const { confidence, confidenceHigh = DEFAULT_CONFIDENCE_HIGH } = props;
  const pct = Math.round(Math.max(0, Math.min(100, confidence * 100)));
  const isHigh = confidence >= confidenceHigh;
  const isMed  = !isHigh && confidence >= DEFAULT_AUTOFILL_FLOOR;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-badge px-1.5 py-0.5 text-[10px] font-semibold',
        isHigh && 'text-success border border-success/40 bg-success-bg',
        isMed  && 'text-warning border border-warning/40 bg-warning-bg',
        !isHigh && !isMed && 'text-muted border border-border',
      )}
    >
      <Sparkles size={9} aria-hidden="true" />
      AI · {pct}%
      {isMed && ' · verify'}
    </span>
  );
}
