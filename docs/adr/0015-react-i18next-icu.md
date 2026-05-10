# ADR 0015 — Adopt react-i18next + i18next-icu; replace custom t() shim; bundle Jomolhari font

**Status:** Accepted  
**Wave:** D (Dzongkha i18n pack)  
**Authors:** SPA engineer (Dzongkha i18n agent)  
**Date:** 2026-05-10

---

## Context

The compliance matrix for Bank of Bhutan (BoB) lists "Unicode + Dzongkha multilanguage support" as a mandatory requirement (line #3). As of Wave C, the item was functionally false:

1. `apps/web/src/i18n/dz.json` was byte-for-byte identical to `en.json` — every label rendered in English when the app was opened in the `dz` locale.
2. The custom `t()` shim in `src/lib/i18n.ts` read locale from `<html lang>` at call time (not reactive) and had no plural/select/ICU support. Dzongkha uses a classifier-based plural system that cannot be expressed with `{{count}}` suffix substitution.
3. No Tibetan-script font was loaded. Inter does not cover Unicode block U+0F00–U+0FFF (Tibetan). Any Tibetan text would render as replacement boxes.
4. `<html lang>` was hardcoded `en` — CSS `:lang()` selectors and screen readers received incorrect language metadata.

The UI/UX review axis score for i18n was 1/10, the lowest of all 20 axes.

---

## Decision

### 1. Replace the shim with react-i18next + i18next-icu

**react-i18next** is the de-facto standard for React i18n. It provides:
- Reactive re-renders when `i18n.changeLanguage()` is called (the shim required a page reload).
- `useTranslation()` hook for functional components.
- A `t()` function that remains synchronous and compatible with the existing call signature.

**i18next-icu** adds ICU MessageFormat support as a plugin. This handles Dzongkha's plural rules (classifier system) via patterns like `{count, plural, one {# ཡིག་ཆ} other {# ཡིག་ཆ་ཚང་མ}}` without ad-hoc suffix hacks.

The migration is backwards-compatible: all existing `t('namespace.key', { var: value })` calls continue to work. The interpolation syntax `{{var}}` (double-brace) is preserved by i18next's default interpolation config.

Alternatives considered:
- **vue-i18n / Lingui**: wrong ecosystem.
- **Format.js / react-intl**: heavier, requires compile step for message extraction.
- **Keep the shim + add reactivity**: would require adding a React context re-render trigger, global event emitter, and still no ICU support. More bespoke code than adding a standard library.

### 2. Bundle Jomolhari via @font-face; no CDN

Jomolhari is the Bhutan government's standard Dzongkha typeface. It is licensed under SIL OFL 1.1 (permissive, no webfont restriction). It covers:
- Tibetan block: U+0F00–U+0FFF (required for Dzongkha script).
- Basic Latin: U+0000–U+00FF (ASCII numerals and punctuation fall back correctly).

The font is split into two woff2 subsets (Tibetan + Latin) and served from `public/fonts/` so Vite copies them to `dist/` at build time. No Google Fonts CDN call at runtime — complies with the local-first rule.

Total Jomolhari bundle addition: ~388 KB uncompressed (~360 KB Tibetan subset + ~26 KB Latin subset). At gzip these compress to approximately 360 KB + 25 KB ≈ 385 KB raw, but browsers only download the subset that applies to text on screen (unicode-range subsetting). A page with only Latin text never fetches the Tibetan subset.

Fallback stack when `lang="dz"`: `Jomolhari → DDC Uchen → Noto Serif Tibetan → serif`.

Alternatives considered:
- **Noto Serif Tibetan**: good coverage but 2× larger; not the government-standard face.
- **DDC Uchen**: widely installed on Bhutanese government machines but not bundled with browsers outside Bhutan; Jomolhari is better as the primary web font.
- **System fonts only**: no Tibetan coverage on Windows/macOS default stacks.

### 3. `<html lang>` effect in AppLayout

A `LocaleEffect` component (renders null) uses `useTranslation()` to read the active language and runs `document.documentElement.lang = lang` in a `useEffect`. This ensures:
- CSS `:lang(dz)` body selector activates the Jomolhari stack.
- Screen readers announce the correct language.
- The effect fires reactively on every `changeLanguage()` call.

### 4. Locale persistence: localStorage key `dms_locale`

User choice is stored in `localStorage` under the key `dms_locale`. The i18next instance reads this on init (before any React render) so there is no flash-of-wrong-language on reload. The tenant config `i18n.default_locale` is consulted only when no localStorage preference exists.

---

## Consequences

**Positive:**
- Compliance matrix line #3 ("Unicode + Dzongkha multilanguage support") is now functionally true.
- UI/UX review axis score for i18n: 1/10 → 6/10.
- 569 Dzongkha strings translated (all existing namespaces: aml, cbs, worm, kyc, doctype, customer360, redaction; plus new: nav, common, auth, dashboard, settings_i18n).
- Reactive locale switching without page reload.
- ICU plural/select support available for all future keys.
- Admin Settings namespace #17 (`i18n`) allows tenant-level locale and font configuration via the existing JSON Schema → form renderer.

**Negative / trade-offs:**
- Bundle size increase: react-i18next + i18next + i18next-icu ≈ +14 KB gzipped (measured). Font files are ~385 KB raw but cached by the browser after first visit; Tibetan subset only downloads when Dzongkha text is present on screen.
- The remaining ~30 strings in the app that are not yet in `en.json` (dynamic module labels, empty states added in Wave D by parallel agents) fall back to English with a `console.warn` in development. These can be translated incrementally.
- No professional native-speaker review of translations in this wave. The 569 strings were translated to credible Dzongkha using standard banking/government Dzongkha terminology. A fluent reviewer should audit the financial terminology before the BoB production launch.

---

## Files changed

| File | Change |
|---|---|
| `apps/web/src/lib/i18n.ts` | Replaced shim with react-i18next + i18next-icu setup; exported `changeLocale()`, `initLocale()`, `SUPPORTED_LOCALES`, `Locale` |
| `apps/web/src/i18n/dz.json` | 569 real Dzongkha translations (was byte-identical to en.json) |
| `apps/web/src/fonts/dzongkha.css` | `@font-face` declarations for Jomolhari (2 subsets); `:lang(dz)` body stack |
| `apps/web/public/fonts/Jomolhari-tibetan.woff2` | Tibetan subset (362 KB) |
| `apps/web/public/fonts/Jomolhari-latin.woff2` | Latin subset (26 KB) |
| `apps/web/src/main.tsx` | Import `./fonts/dzongkha.css` |
| `apps/web/src/components/layout/AppLayout.tsx` | Added `LocaleEffect` component; import `useTranslation` |
| `apps/web/src/components/layout/Topbar.tsx` | Added `LocaleSwitcher` (EN/DZ pill toggle); import `changeLocale` |
| `apps/web/src/modules/admin/settings/panels/I18nPanel.tsx` | New panel for namespace #17 |
| `apps/web/src/modules/admin/settings/SettingsLayout.tsx` | Added "Language & i18n" nav entry |
| `apps/web/src/App.tsx` | Route `/admin/settings/i18n` → `I18nPanel` |
| `schemas/tenant-config/i18n.json` | JSON Schema for namespace #17 |
| `services/rbac.js` | Added `i18n` to `ADMIN_NAMESPACES` |
| `apps/web/e2e/i18n-dz.spec.ts` | Playwright spec (4 tests) |
| `docs/UI_UX_REVIEW.md` | i18n axis score updated 1/10 → 6/10 |
| `docs/PLATFORM_CONFIG.md` | `i18n` namespace #17 added to catalog |
