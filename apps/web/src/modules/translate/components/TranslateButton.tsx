/**
 * TranslateButton — pill button + language dropdown for the Viewer page header.
 *
 * Hidden when VITE_FF_DZONGKHA_TRANSLATION is not "true".
 * Respects reduced-motion preference for the loading indicator.
 */

import { useState } from 'react';
import { Languages } from 'lucide-react';
import { TARGET_LANG_LABELS, type TargetLang } from '../schemas';

interface TranslateButtonProps {
  /** Called with the chosen target language when user confirms. */
  onTranslate: (target: TargetLang) => void;
  /** While a translation request is in-flight. */
  loading: boolean;
  /** Whether a translation result is already shown (to allow re-translate). */
  hasResult: boolean;
}

const FF_ON =
  import.meta.env.VITE_FF_DZONGKHA_TRANSLATION === 'true';

const TARGET_OPTIONS: TargetLang[] = ['en', 'dz', 'ar'];

export function TranslateButton({
  onTranslate,
  loading,
  hasResult,
}: TranslateButtonProps) {
  const [target, setTarget] = useState<TargetLang>('en');

  if (!FF_ON) return null;

  const handleClick = () => {
    if (!loading) onTranslate(target);
  };

  const reducedMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  return (
    <div className="inline-flex items-center gap-0 rounded-input border border-border bg-white overflow-hidden">
      {/* Language select */}
      <label className="sr-only" htmlFor="translate-target-select">
        Target translation language
      </label>
      <select
        id="translate-target-select"
        data-testid="translate-target-select"
        value={target}
        onChange={(e) => setTarget(e.target.value as TargetLang)}
        disabled={loading}
        className="h-8 border-0 bg-transparent pl-2 pr-1 text-xs text-ink focus:outline-none focus:ring-2 focus:ring-brand-blue/40 disabled:opacity-50"
      >
        {TARGET_OPTIONS.map((lang) => (
          <option key={lang} value={lang}>
            {TARGET_LANG_LABELS[lang]}
          </option>
        ))}
      </select>

      {/* Divider */}
      <span className="w-px self-stretch bg-border" aria-hidden="true" />

      {/* Translate trigger */}
      <button
        type="button"
        data-testid="translate-button"
        aria-label={`Translate document to ${TARGET_LANG_LABELS[target]}`}
        disabled={loading}
        onClick={handleClick}
        className="inline-flex h-8 items-center gap-1.5 px-3 text-xs font-medium text-brand-blue hover:bg-brand-skyLight disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
      >
        {loading ? (
          <>
            {reducedMotion ? (
              <span data-testid="translate-loading">Loading...</span>
            ) : (
              <span
                data-testid="translate-loading"
                className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-brand-blue border-t-transparent"
                aria-hidden="true"
              />
            )}
            <span>Translating…</span>
          </>
        ) : (
          <>
            <Languages size={13} aria-hidden="true" />
            <span>{hasResult ? 'Re-translate' : 'Translate to…'}</span>
          </>
        )}
      </button>
    </div>
  );
}
