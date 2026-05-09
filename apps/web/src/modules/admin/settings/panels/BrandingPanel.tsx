import { ConfigPanel } from '../ConfigPanel';

/**
 * BrandingPanel — tenant-level brand identity settings.
 *
 * Validates the full ConfigPanel flow: loads branding.json schema,
 * renders primary_color as a colour picker, saves via CC1 setConfig,
 * and triggers the CC2 CSS custom prop update on the next /me hydration.
 *
 * Note on live --brand-primary update:
 * CC2 drives --brand-primary from tenant.primary_color (the Zustand tenant
 * store, populated from /spa/api/me). A save here writes to tenant_config
 * (namespace='branding', key='primary_color'), not to the tenants table.
 * The CSS property will update on the next full page reload when /me returns
 * the new branding config merged into the tenant. For a true live preview,
 * a follow-up can watch the config save and call
 * document.documentElement.style.setProperty('--brand-primary', value)
 * directly — deferred to a future CC wave.
 */
export function BrandingPanel() {
  return (
    <ConfigPanel
      namespace="branding"
      title="Branding"
      description="Tenant-level brand identity. Changes apply immediately to all users of this tenant on their next page load."
    />
  );
}
