import { ConfigPanel } from '../ConfigPanel';

/**
 * I18nPanel — tenant-level localisation settings (Wave D).
 *
 * Renders the i18n namespace from the JSON Schema → form renderer (ConfigPanel).
 * Controls: default_locale (en/dz), available_locales, font_override, date_format.
 *
 * Write access requires Doc Admin (enforced by ConfigPanel → PUT /spa/api/admin/config/i18n).
 */
export function I18nPanel() {
  return (
    <ConfigPanel
      namespace="i18n"
      title="Language & Localisation"
      description="Configure the default locale, available languages, Tibetan-script font, and date display format for this tenant. Changes take effect on the next page load."
    />
  );
}
