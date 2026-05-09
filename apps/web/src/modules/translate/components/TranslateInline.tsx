/**
 * TranslateInline — small "Translate this" link next to long text fields.
 *
 * On click, sends the text to POST /spa/api/translate and replaces the
 * displayed value in-place. A "show original" toggle reverts the change.
 *
 * Hidden when VITE_FF_DZONGKHA_TRANSLATION is not "true".
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { translateText } from '../api';
import type { TargetLang } from '../schemas';

interface TranslateInlineProps {
  /**
   * Stable identifier used in data-testid attributes so Playwright can target
   * specific inline translate links on a page that has multiple instances.
   */
  fieldKey: string;
  /** The original text to translate. */
  text: string;
  /** Source language code (2-char ISO 639-1). Defaults to 'dz'. */
  sourceLang?: string;
  /** Target language code. Defaults to 'en'. */
  targetLang?: TargetLang;
  /** Called with the translated string so the parent can update its state. */
  onTranslated?: (translated: string) => void;
}

const FF_ON = import.meta.env.VITE_FF_DZONGKHA_TRANSLATION === 'true';

export function TranslateInline({
  fieldKey,
  text,
  sourceLang = 'dz',
  targetLang = 'en',
  onTranslated,
}: TranslateInlineProps) {
  const [showTranslated, setShowTranslated] = useState(false);
  const [translatedText, setTranslatedText] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      translateText({
        text,
        source_lang: sourceLang,
        target_lang: targetLang,
      }),
    onSuccess: (result) => {
      setTranslatedText(result.translated_text);
      setShowTranslated(true);
      onTranslated?.(result.translated_text);
    },
  });

  if (!FF_ON) return null;

  const handleTranslate = () => {
    if (translatedText !== null) {
      // Already fetched — just toggle visibility.
      setShowTranslated(true);
      return;
    }
    mutation.mutate();
  };

  const handleShowOriginal = () => {
    setShowTranslated(false);
  };

  const isRtl = targetLang === 'ar' && showTranslated;

  return (
    <span className="inline" dir={isRtl ? 'rtl' : undefined}>
      {showTranslated && translatedText !== null ? (
        <>
          <span data-testid={`translate-inline-${fieldKey}`}>
            {translatedText}
          </span>
          <button
            type="button"
            data-testid={`translate-original-toggle-${fieldKey}`}
            onClick={handleShowOriginal}
            className="ms-1.5 text-[11px] text-brand-blue hover:underline focus:outline-none focus:ring-1 focus:ring-brand-blue rounded-sm"
          >
            show original
          </button>
        </>
      ) : (
        <>
          <span>{text}</span>
          {mutation.isError && (
            <span className="ms-1 text-[11px] text-danger">Translation failed.</span>
          )}
          <button
            type="button"
            data-testid={`translate-inline-${fieldKey}`}
            onClick={handleTranslate}
            disabled={mutation.isPending}
            aria-label={`Translate this ${fieldKey} field`}
            className="ms-1.5 text-[11px] text-brand-blue hover:underline disabled:opacity-50 disabled:cursor-wait focus:outline-none focus:ring-1 focus:ring-brand-blue rounded-sm"
          >
            {mutation.isPending ? 'Translating…' : 'Translate this'}
          </button>
        </>
      )}
    </span>
  );
}
