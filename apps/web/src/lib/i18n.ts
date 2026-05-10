/**
 * i18n — react-i18next + i18next-icu setup (Wave D).
 *
 * Replaces the hand-rolled shim from Wave A. Public API is backwards-compat:
 *   import { t } from '@/lib/i18n'        — synchronous translate (for non-React code)
 *   import { useTranslation } from 'react-i18next'  — React hook (preferred in TSX)
 *
 * Locale resolution order:
 *   1. localStorage 'dms_locale' (user override)
 *   2. tenant_config.i18n.default_locale (injected via initLocale())
 *   3. 'en' fallback
 *
 * ICU MessageFormat enabled via i18next-icu — supports:
 *   {count, plural, one {# hit} other {# hits}}
 *   {gender, select, male {his} female {her} other {their}}
 *
 * Missing key behaviour:
 *   - Production: falls back to English silently.
 *   - Development: console.warn once per missing key.
 */

import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import ICU from 'i18next-icu';

import enRaw from '@/i18n/en.json';
import dzRaw from '@/i18n/dz.json';

export const SUPPORTED_LOCALES = ['en', 'dz'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

const LS_KEY = 'dms_locale';

function storedLocale(): Locale | null {
  try {
    const v = localStorage.getItem(LS_KEY);
    if (v === 'en' || v === 'dz') return v;
  } catch {
    // localStorage unavailable (SSR / private browsing hardening)
  }
  return null;
}

export function persistLocale(locale: Locale): void {
  try {
    localStorage.setItem(LS_KEY, locale);
  } catch {
    // ignore
  }
}

export function getPersistedLocale(): Locale | null {
  return storedLocale();
}

// ── i18next instance ────────────────────────────────────────────────────────

// Use a flat resource structure matching the existing en.json / dz.json shape.
// Namespace is 'translation' (i18next default). Keys use dot-notation:
//   t('aml.title') resolves to resources.en.translation.aml.title
void i18next
  .use(ICU)
  .use(initReactI18next)
  .init({
    lng: storedLocale() ?? 'en',
    fallbackLng: 'en',
    resources: {
      en: { translation: enRaw },
      dz: { translation: dzRaw },
    },
    interpolation: {
      // React already escapes; ICU does its own escaping.
      escapeValue: false,
    },
    missingKeyHandler: (lngs, ns, key) => {
      if (import.meta.env.DEV) {
        console.warn(`[i18n] missing key: ${ns}:${key} (lngs: ${lngs.join(',')})`);
      }
    },
    saveMissing: import.meta.env.DEV,
    returnNull: false,
  });

export { i18next as i18n };

/**
 * Synchronous translate — wraps i18next.t().
 * For legacy call sites that cannot use the useTranslation hook.
 */
export function t(key: string, vars?: Record<string, string | number>): string {
  return i18next.t(key, vars ?? {});
}

/**
 * Called once the tenant config has been loaded — sets the default locale
 * unless the user already has a localStorage override.
 */
export function initLocale(defaultLocale: string): void {
  if (storedLocale() !== null) return; // user preference wins
  const locale = (defaultLocale === 'dz' ? 'dz' : 'en') satisfies Locale;
  void i18next.changeLanguage(locale);
  document.documentElement.lang = locale;
}

/**
 * Switch locale, persist it, and update <html lang>.
 */
export function changeLocale(locale: Locale): void {
  persistLocale(locale);
  void i18next.changeLanguage(locale);
  document.documentElement.lang = locale;
}
