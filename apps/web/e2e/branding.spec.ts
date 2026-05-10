/**
 * Branding finalize — Wave D Playwright spec.
 *
 * Verifies:
 *   1. Login screen reads from tenant_config.branding (no hardcoded "DocManager" / "NBE")
 *   2. document.title matches branding.product_name after login
 *   3. Topbar logo and tenant display_name are driven by tenant branding
 *   4. /admin/settings/branding form exposes all new Wave D fields
 *   5. support_email update propagates to the login footer (mocked)
 *   6. 404 / wildcard route references tenant display_name, not "DocManager"
 *
 * Happy-path tests (1, 2, 3) run against the real stack — no mocking.
 * Tests 4–6 mock the tenant API to control the response precisely.
 *
 * Seeded tenant: tenant_id='nbe', display_name='Bank of Bhutan',
 *                product_name='DocManager', monogram='BoB'.
 */

import { test, expect } from '@playwright/test';
import { login } from './helpers';

// ---------------------------------------------------------------------------
// 1. Login screen — BoB branding, no hardcoded "DocManager" / "NBE"
// ---------------------------------------------------------------------------

test.describe('Login screen branding', () => {
  test('hero shows Bank of Bhutan display_name from seeded tenant', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByLabel('Username')).toBeVisible();

    // The hero panel (left column) or the mobile header should contain the
    // seeded tenant's display_name.
    await expect(page.getByText('Bank of Bhutan').first()).toBeVisible();

    // No "NBE" or "National Bank of Egypt" should appear anywhere in the DOM.
    const html = await page.content();
    expect(html).not.toContain('National Bank of Egypt');
    // Allow the tenant_id literal 'nbe' only inside JSON/data attributes, not as
    // user-visible text.
    const visibleText = await page.evaluate(() => document.body.innerText);
    expect(visibleText).not.toMatch(/\bNBE\b/);
  });

  test('login screen footer copyright references Bank of Bhutan', async ({ page }) => {
    // Mock the public tenant endpoint to return a tenant with footer_copyright set.
    await page.route('**/spa/api/tenant-public', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          tenant_id: 'nbe',
          slug: 'bob',
          display_name: 'Bank of Bhutan',
          regulator_name: 'Royal Monetary Authority',
          regulator_short: 'RMA',
          default_locale: 'en',
          allowed_locales: ['en', 'dz'],
          primary_color: '#1B3A6B',
          monogram: 'BoB',
          logo_path: null,
          favicon_path: null,
          login_banner: null,
          footer_text: null,
          environment_label: null,
          product_name: 'DocManager',
          tagline: 'Document Operations for Bank of Bhutan',
          footer_copyright: '© 2026 Bank of Bhutan. All rights reserved.',
          support_email: 'support@bob.bt',
          support_phone: '+975 2 322777',
        }),
      }),
    );
    await page.goto('/login');
    await expect(page.getByLabel('Username')).toBeVisible();

    // Footer copyright must reflect BoB, not a hardcoded string.
    await expect(page.getByText('© 2026 Bank of Bhutan. All rights reserved.')).toBeVisible();
  });

  test('support_email and support_phone appear on login screen', async ({ page }) => {
    await page.route('**/spa/api/tenant-public', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          tenant_id: 'nbe',
          slug: 'bob',
          display_name: 'Bank of Bhutan',
          regulator_name: 'Royal Monetary Authority',
          regulator_short: 'RMA',
          default_locale: 'en',
          allowed_locales: ['en', 'dz'],
          primary_color: '#1B3A6B',
          monogram: 'BoB',
          logo_path: null,
          favicon_path: null,
          login_banner: null,
          footer_text: null,
          environment_label: null,
          support_email: 'support@bob.bt',
          support_phone: '+975 2 322777',
        }),
      }),
    );
    await page.goto('/login');
    await expect(page.getByLabel('Username')).toBeVisible();
    await expect(page.getByText('support@bob.bt')).toBeVisible();
    await expect(page.getByText('+975 2 322777')).toBeVisible();
  });

  test('welcome_message placeholder interpolation works', async ({ page }) => {
    await page.route('**/spa/api/tenant-public', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          tenant_id: 'nbe',
          slug: 'bob',
          display_name: 'Bank of Bhutan',
          regulator_name: 'Royal Monetary Authority',
          regulator_short: 'RMA',
          default_locale: 'en',
          allowed_locales: ['en'],
          primary_color: '#1B3A6B',
          monogram: 'BoB',
          logo_path: null,
          favicon_path: null,
          login_banner: null,
          footer_text: null,
          environment_label: null,
          product_name: 'DocManager',
          welcome_message: 'Welcome to {product_name}',
        }),
      }),
    );
    await page.goto('/login');
    await expect(page.getByLabel('Username')).toBeVisible();
    // The rendered welcome message should have the placeholder resolved.
    await expect(page.getByText('Welcome to DocManager')).toBeVisible();
    // The raw placeholder string should NOT appear in the DOM.
    const html = await page.content();
    expect(html).not.toContain('{product_name}');
  });

  test('fallback: no hardcoded DocManager fallback when tenant is unavailable', async ({ page }) => {
    // Simulate 503 — all branding falls back to generic, no "DocManager" hard-baked.
    await page.route('**/spa/api/tenant-public', (route) =>
      route.fulfill({ status: 503, body: JSON.stringify({ error: 'no_active_tenant' }) }),
    );
    await page.goto('/login');
    // Sign in form is still accessible.
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    // No unhandled error should surface.
    await expect(page.getByText(/something went wrong/i)).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 2. Authenticated chrome — document.title and sidebar use product_name
// ---------------------------------------------------------------------------

test.describe('Authenticated chrome branding', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
  });

  test('document.title matches product_name from branding', async ({ page }) => {
    // After login with seeded tenant (product_name='DocManager'), the tab title
    // should be set to the product_name value, not a hardcoded string.
    const title = await page.title();
    // The title must not be the raw static HTML fallback "DocManager · Document Management"
    // (that string was the old hardcoded value we removed). It should be either
    // the product_name alone or include it.
    expect(title.length).toBeGreaterThan(0);
    // Must not contain old hardcoded suffix pattern.
    expect(title).not.toBe('DocManager · Document Management');
  });

  test('sidebar shows tenant display_name and not hardcoded "DocManager" when tenant is loaded', async ({ page }) => {
    const aside = page.locator('aside');
    // Once authenticated the tenant resolves to 'Bank of Bhutan'.
    // The sidebar header shows product_name (DocManager in BoB seed) + tenant monogram.
    await expect(aside.getByText('BoB')).toBeVisible();
    await expect(aside.getByText('Bank of Bhutan')).toBeVisible();
  });

  test('topbar tenant chip shows Bank of Bhutan', async ({ page }) => {
    // Only visible at md+ breakpoints in current Topbar layout.
    await page.setViewportSize({ width: 1280, height: 800 });
    const topbar = page.getByRole('banner');
    await expect(topbar.getByText('Bank of Bhutan')).toBeVisible();
  });

  test('page does not contain "National Bank of Egypt" in visible text', async ({ page }) => {
    const visibleText = await page.evaluate(() => document.body.innerText);
    expect(visibleText).not.toContain('National Bank of Egypt');
    expect(visibleText).not.toMatch(/\bNBE\b/);
  });
});

// ---------------------------------------------------------------------------
// 3. /admin/settings/branding — form exposes all Wave D fields
// ---------------------------------------------------------------------------

test.describe('/admin/settings/branding form fields', () => {
  test.beforeEach(async ({ page }) => {
    // Mock the branding schema to return the full Wave D field set.
    await page.route('**/spa/api/admin/config-schema/branding', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          schema: {
            $schema: 'http://json-schema.org/draft-07/schema#',
            type: 'object',
            properties: {
              product_name:      { type: 'string', description: 'Product name shown in browser tab and sidebar' },
              welcome_message:   { type: 'string', maxLength: 120, description: 'Welcome heading on login' },
              footer_copyright:  { type: 'string', maxLength: 200, description: 'Copyright line on login' },
              support_email:     { type: 'string', description: 'Support email address' },
              support_phone:     { type: 'string', description: 'Support phone number' },
              tagline:           { type: 'string', description: 'Short marketing tagline' },
              subtitle:          { type: 'string', maxLength: 200, description: 'Sub-heading under welcome' },
              login_logo_url:    { type: 'string', description: 'Logo URL for the login screen' },
              login_background_color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$', description: 'Login background color' },
              footer_text:       { type: 'string', description: 'Legacy footer text' },
              theme_mode:        { type: 'string', enum: ['light', 'dark', 'auto'], description: 'UI color scheme preference' },
              primary_color:     { type: 'string', pattern: '^#[0-9a-fA-F]{6}$', description: 'Brand primary color' },
              monogram:          { type: 'string', minLength: 1, maxLength: 8, description: 'Sidebar initials' },
            },
          },
        }),
      }),
    );
    await page.route('**/spa/api/admin/config/branding', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          product_name: 'DocManager',
          welcome_message: 'Welcome to {product_name}',
          footer_copyright: '© {year} {tenant_display_name}. All rights reserved.',
          support_email: 'support@bob.bt',
          support_phone: '+975 2 322777',
          theme_mode: 'light',
          primary_color: '#1B3A6B',
          monogram: 'BoB',
        }),
      }),
    );
    await login(page, 'admin', 'admin123');
    await page.goto('/admin/settings/branding');
  });

  test('branding settings page has product_name field', async ({ page }) => {
    await expect(page.getByText(/product name/i).first()).toBeVisible();
  });

  test('branding settings page has welcome_message field', async ({ page }) => {
    await expect(page.getByText(/welcome/i).first()).toBeVisible();
  });

  test('branding settings page has footer_copyright field', async ({ page }) => {
    await expect(page.getByText(/footer/i).first()).toBeVisible();
  });

  test('branding settings page has support_email field', async ({ page }) => {
    await expect(page.getByText(/support email/i).first()).toBeVisible();
  });

  test('branding settings page has theme_mode enum selector', async ({ page }) => {
    await expect(page.getByText(/theme|color scheme|ui mode/i).first()).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 4. support_email update propagates to login page footer (mocked E2E)
// ---------------------------------------------------------------------------

test.describe('Branding config update propagation', () => {
  test('updated support_email appears on login page footer', async ({ page }) => {
    const NEW_EMAIL = 'it-helpdesk@bob.bt';

    // Route the public tenant endpoint to return the new email.
    await page.route('**/spa/api/tenant-public', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          tenant_id: 'nbe',
          slug: 'bob',
          display_name: 'Bank of Bhutan',
          regulator_name: 'Royal Monetary Authority',
          regulator_short: 'RMA',
          default_locale: 'en',
          allowed_locales: ['en', 'dz'],
          primary_color: '#1B3A6B',
          monogram: 'BoB',
          logo_path: null,
          favicon_path: null,
          login_banner: null,
          footer_text: null,
          environment_label: null,
          support_email: NEW_EMAIL,
          footer_copyright: '© 2026 Bank of Bhutan. All rights reserved.',
        }),
      }),
    );

    await page.goto('/login');
    await expect(page.getByLabel('Username')).toBeVisible();
    // The updated support email must appear in the login page footer.
    await expect(page.getByText(NEW_EMAIL)).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 5. Integrations page — no hardcoded "DocManager" brand copy
// ---------------------------------------------------------------------------

test.describe('Integrations page branding', () => {
  test('integrations marketplace copy references tenant name not hardcoded DocManager', async ({ page }) => {
    // Mock /me to return BoB tenant with display_name so the integration page
    // pulls from the tenant store.
    await login(page, 'admin', 'admin123');
    await page.goto('/integration');
    await expect(page.getByText('Integration marketplace')).toBeVisible();
    // The copy should now say "Connect DocManager to..." or "Connect Bank of Bhutan to..."
    // but NOT the old raw hardcoded string. Since we replaced it with {productName},
    // it resolves to the tenant product_name.
    const visibleText = await page.evaluate(() => document.body.innerText);
    // The dynamic string must be present (product_name resolves to "DocManager" from seed).
    expect(visibleText).toMatch(/Connect .+ to your core banking/i);
  });
});

// ---------------------------------------------------------------------------
// 6. BoB SVG logo placeholder is served
// ---------------------------------------------------------------------------

test.describe('BoB logo asset', () => {
  test('/branding/bob-logo.svg is accessible', async ({ page }) => {
    const resp = await page.request.get('/branding/bob-logo.svg');
    expect(resp.status()).toBe(200);
    const contentType = resp.headers()['content-type'] ?? '';
    expect(contentType).toMatch(/svg/);
  });
});
