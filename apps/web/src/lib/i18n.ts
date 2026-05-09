/**
 * Lightweight i18n shim — no external library.
 * Reads locale from <html lang> attribute, falls back to 'en'.
 * Full react-i18next can replace this later; the t() call signature is compatible.
 *
 * Usage:
 *   import { t } from '@/lib/i18n';
 *   t('doctype.thresholds_tab')          // → "Thresholds"
 *   t('doctype.autofill_label_display', { pct: 40 })  // → "Auto-fill at 40%"
 */

import enRaw from '@/i18n/en.json';
import dzRaw from '@/i18n/dz.json';

type Strings = typeof enRaw;

const LOCALES: Record<string, Strings> = {
  en: enRaw,
  dz: dzRaw,
};

function detectLocale(): string {
  const lang = document.documentElement.lang ?? 'en';
  const base = lang.split('-')[0] ?? 'en';
  return base in LOCALES ? base : 'en';
}

/**
 * Resolve a dot-path string from the locale object.
 * e.g. 'doctype.thresholds_tab' → locale.doctype.thresholds_tab
 */
function resolve(obj: Record<string, unknown>, path: string): string {
  const parts = path.split('.');
  let cur: unknown = obj;
  for (const part of parts) {
    if (typeof cur !== 'object' || cur === null || !(part in cur)) {
      return path; // key not found — return key as fallback
    }
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === 'string' ? cur : path;
}

/**
 * Translate a key, optionally interpolating {{placeholder}} variables.
 */
export function t(key: string, vars?: Record<string, string | number>): string {
  const locale = detectLocale();
  const strings = LOCALES[locale] ?? enRaw;
  let str = resolve(strings as unknown as Record<string, unknown>, key);

  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v));
    }
  }

  return str;
}
