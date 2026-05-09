/**
 * SideBySideView — horizontally-split pane layout.
 *
 * Left: original document preview (iframe / image).
 * Right: translated OCR text + extracted fields.
 *
 * A11y requirements (contract §10):
 *  - Tab moves focus between panes.
 *  - aria-live="polite" announces "Translation complete" when data arrives.
 *  - Right pane uses dir="rtl" when target_lang === "ar".
 *  - Confidence badge + low-confidence warning.
 * Reduced-motion: no fade-in transitions.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Copy, Check, X } from 'lucide-react';
import { ConfidenceBadge } from './ConfidenceBadge';
import type { TranslationResult } from '../schemas';

interface SideBySideViewProps {
  /** Original document preview — pass the existing <iframe> or <img> element. */
  originalContent: ReactNode;
  /** Translation payload when fetch has resolved; null while loading or before translate. */
  translation: TranslationResult | null;
  /** Is a translation request currently in-flight? */
  loading: boolean;
  /** Dismiss the side-by-side view and revert to single-pane. */
  onClose: () => void;
}

export function SideBySideView({
  originalContent,
  translation,
  loading,
  onClose,
}: SideBySideViewProps) {
  const [copied, setCopied] = useState(false);
  const liveRef = useRef<HTMLDivElement>(null);

  // Announce "Translation complete" to screen readers when data arrives.
  useEffect(() => {
    if (translation && liveRef.current) {
      liveRef.current.textContent = 'Translation complete';
      // Reset after a brief delay so the announcement fires again on re-translate.
      const t = setTimeout(() => {
        if (liveRef.current) liveRef.current.textContent = '';
      }, 3000);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [translation]);

  const handleCopy = async () => {
    if (!translation) return;
    await navigator.clipboard.writeText(translation.translated_text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const isRtl = translation?.target_lang === 'ar';
  const isLowConfidence =
    translation != null && translation.confidence_estimate < 0.7;

  return (
    <div className="flex flex-col gap-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">Side-by-side translation</h2>
        <button
          type="button"
          data-testid="side-by-side-toggle"
          onClick={onClose}
          aria-label="Close side-by-side view and return to single pane"
          className="inline-flex items-center gap-1.5 rounded-input border border-border bg-white px-3 py-1.5 text-xs text-ink-sub hover:bg-divider focus:outline-none focus:ring-2 focus:ring-brand-blue/40"
        >
          <X size={12} aria-hidden="true" />
          Single pane
        </button>
      </div>

      {/* Low-confidence warning */}
      {isLowConfidence && (
        <div
          role="alert"
          className="rounded-input bg-warning-bg px-3 py-2 text-xs text-warning border border-warning/20"
        >
          Low confidence translation. Accuracy below expected threshold — review carefully.
        </div>
      )}

      {/* Screen-reader live region */}
      <div
        ref={liveRef}
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      />

      {/* Split panes */}
      <div className="grid grid-cols-2 gap-3 min-h-[480px]">
        {/* Left — original */}
        <section
          data-testid="side-by-side-original"
          aria-label="Original document"
          tabIndex={0}
          className="rounded-card border border-divider bg-surface overflow-hidden focus:outline-none focus:ring-2 focus:ring-brand-blue/40"
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-divider bg-raised">
            <span className="text-xs font-medium text-muted uppercase tracking-wider">Original</span>
          </div>
          <div className="p-2 h-full overflow-auto">
            {originalContent}
          </div>
        </section>

        {/* Right — translation */}
        <section
          data-testid="side-by-side-translated"
          role="region"
          aria-label="Translated text"
          tabIndex={0}
          dir={isRtl ? 'rtl' : 'ltr'}
          className="rounded-card border border-divider bg-surface flex flex-col overflow-hidden focus:outline-none focus:ring-2 focus:ring-brand-blue/40"
        >
          <div className="flex items-center justify-between px-3 py-2 border-b border-divider bg-raised">
            <span className="text-xs font-medium text-muted uppercase tracking-wider">Translation</span>
            {translation && (
              <div className="flex items-center gap-2">
                {translation.cache_hit && (
                  <span className="text-[11px] text-muted">(cached)</span>
                )}
                <ConfidenceBadge confidence={translation.confidence_estimate} />
                <button
                  type="button"
                  data-testid="translate-copy-button"
                  onClick={() => void handleCopy()}
                  aria-label="Copy translated text to clipboard"
                  className="inline-flex items-center gap-1 rounded-input border border-border bg-white px-2 py-1 text-[11px] text-ink hover:bg-divider focus:outline-none focus:ring-2 focus:ring-brand-blue/40"
                >
                  {copied ? <Check size={11} className="text-success" aria-hidden="true" /> : <Copy size={11} aria-hidden="true" />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            )}
          </div>

          <div className="flex-1 overflow-auto p-3">
            {loading && (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-muted">
                <span
                  className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-brand-blue border-t-transparent"
                  aria-hidden="true"
                />
                <p className="text-sm">Translating…</p>
                <p className="text-xs text-center max-w-[240px]">
                  First translation may take 30s while the model loads
                </p>
              </div>
            )}
            {!loading && !translation && (
              <p className="text-sm text-muted">
                Click "Translate to…" to begin.
              </p>
            )}
            {!loading && translation && (
              <pre className="text-sm text-ink font-sans whitespace-pre-wrap break-words leading-relaxed">
                {translation.translated_text}
              </pre>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
