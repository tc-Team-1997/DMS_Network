# ADR-0017: Branding Finalize — Precedence Chain, Runtime Title/Favicon Swap, Bundle-Free Brand Assets

**Date**: 2026-05-10
**Status**: Accepted (Wave D)
**Deciders**: Platform Engineering, Design Lead
**Supersedes**: Nothing — extends the CC2 sweep from Foundation.

---

## Context

Wave A–C shipped a CC2 sweep that removed the most visible "NBE" / "National Bank of Egypt" literals from the authenticated chrome (Topbar logo, dashboard greeting, sidebar monogram chip). However, the following surfaces still contained hardcoded brand strings as of the start of Wave D:

| Location | Hardcode |
|---|---|
| `apps/web/src/components/layout/Sidebar.tsx:42` | `"DocManager"` (literal in JSX) |
| `apps/web/src/modules/auth/LoginPage.tsx:52,152` | `'DocManager'` fallback when `display_name` was empty |
| `apps/web/src/modules/aml-screening/components/SarDraftModal.tsx:53` | `'National Bank of Egypt'` fallback |
| `apps/web/src/modules/integrations/IntegrationsPage.tsx:55` | `"DocManager"` literal in marketing copy |
| `apps/web/index.html:8` | `<title>DocManager · Document Management</title>` (static) |
| `apps/web/src/App.tsx:98` | `document.title = \`\${tenant.display_name} · Document Management\`` (hard suffix) |

Additionally, the `branding` JSON Schema had only 6 keys (`primary_color`, `monogram`, `logo_path`, `favicon_path`, `login_banner`, `footer_text`) — no product name, tagline, welcome message, support contact, or login-screen customization.

---

## Decision

### 1. Branding precedence chain

All user-visible brand strings resolve through this chain:

```
tenant_config.branding[key]   (highest — admin can override anything)
    ↓ if absent
seed default                  (BoB-specific values in db/seed.js)
    ↓ if absent
app default                   (hardcoded in SPA component, used only when
                               tenant has not loaded yet or has no value)
```

"App default" values must be neutral and invisible to end users — they exist only to prevent blank UI during the loading stub phase (the 0–200 ms before `/spa/api/me` resolves). Once the tenant resolves, all strings come from the store.

### 2. New branding namespace keys (11 additions)

The `schemas/tenant-config/branding.json` schema is extended with:

| Key | Purpose |
|---|---|
| `product_name` | Browser tab title + sidebar header. No placeholder interpolation. |
| `tagline` | Login hero sub-copy. Supports `{product_name}`, `{tenant_display_name}`. |
| `welcome_message` | Login form welcome heading. Supports same placeholders. |
| `subtitle` | Login form sub-heading. Supports same placeholders. |
| `login_logo_url` | Logo on login screen (hero + mobile). Falls back to `logo_path`. |
| `login_background_color` | Solid hex override for the login hero background. |
| `login_background_image_url` | Image override for login hero background. |
| `footer_copyright` | Copyright line on login. Supports `{year}`, `{tenant_display_name}`. |
| `support_email` | Support email on login footer + error pages. |
| `support_phone` | Support phone on login footer + error pages. |
| `favicon_url` | Favicon URL (takes precedence over legacy `favicon_path`). |
| `theme_mode` | `light` / `dark` / `auto`. Wired to future CSS color-scheme. |

Placeholder interpolation (`{product_name}`, `{tenant_display_name}`, `{year}`) is performed client-side in `LoginPage.tsx::interpolate()`. Server-side values are stored raw; the client substitutes at render time so the admin sees the template in the Settings form.

### 3. Browser title and favicon runtime swap

`TenantBrandingEffect` in `apps/web/src/App.tsx` sets:

```ts
document.title = tenant.product_name ?? tenant.display_name;
const faviconHref = tenant.favicon_url ?? tenant.favicon_path;
// sets <link rel=icon> href
```

The static `index.html` now reads:

```html
<title>DocManager</title>
<link rel="icon" type="image/svg+xml" href="/branding/bob-logo.svg" />
```

This gives a branded pre-hydration state (BoB SVG shown in the browser tab while JS loads) that is then overridden by the runtime effect if `favicon_url` differs.

### 4. Brand assets are not bundled

Logo, favicon, and login background images are served from `public/branding/` (static file serving, no Vite processing). This means:

- Swapping a tenant logo is an ops operation (replace the file in `public/branding/` or point `login_logo_url` at a CDN URL) with no redeploy required.
- The SVG placeholder at `public/branding/bob-logo.svg` is a 1 KB text file, not a binary PNG, so it does not inflate the JS bundle.
- This approach avoids baking brand assets into the Vite bundle, keeping the gzipped bundle under the 300 KB budget.

### 5. BoB tenant seed

`db/seed.js` seeds two tenant rows (idempotent via `INSERT OR IGNORE`):
- `tenant_id='nbe'` — backward-compat partition key; all existing `tenant_config` rows keep this key.
- `tenant_id='bob'` — canonical fresh-install key; new deployments boot with this as the active tenant.

Both rows share `display_name='Bank of Bhutan'`, `primary_color='#1B3A6B'`, `monogram='BoB'`, `regulator_name='Royal Monetary Authority'`, `regulator_short='RMA'`, `default_locale='dz-BT'`, `allowed_locales=["en","dz"]`.

The `branding` tenant_config namespace is seeded for both tenant IDs with concrete BoB values (`product_name`, `tagline`, `welcome_message`, `subtitle`, `login_logo_url=/branding/bob-logo.svg`, `footer_copyright`, `support_email=support@bob.bt`, `support_phone=+975 2 322777`, `theme_mode=light`).

---

## Consequences

### Positive
- **Zero hardcoded brand strings** in user-visible SPA code. All five surfaced hardcodes eliminated.
- **Single admin Settings knob** for every brand dimension — no code change required to rebrand for a new tenant.
- **Login screen is fully BoB-branded** on a fresh `node db/seed.js`, no post-seed admin edits needed.
- **Bundle size unchanged** — no new dependencies, logos are public static files.
- **Typecheck passes cleanly** — `TenantSchema` updated with optional fields, all components typed against it.

### Negative / Trade-offs
- `product_name` in the Settings form is a separate field from `display_name` in the tenants table, which may confuse admins ("why are there two names?"). Mitigated by description text in the JSON Schema.
- Placeholder interpolation (`{product_name}`) is a bespoke micro-template format. We chose not to use `i18next` interpolation here because the i18n agent owns that surface; the branding agent owns the admin config path. The two systems are deliberately decoupled.
- The `favicon_url` / `favicon_path` duality (two favicon keys) is legacy baggage. A future cleanup wave should deprecate `favicon_path` once all tenants have migrated to `favicon_url`.

---

## Related
- ADR-0008 — tenant-config spine
- ADR-0010 — hash-chained config history
- `docs/PLATFORM_CONFIG.md` §1 branding namespace
- `apps/web/e2e/branding.spec.ts` — Wave D Playwright spec
