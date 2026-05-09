/**
 * CC2 — Tenant branding E2E spec.
 *
 * Happy-path tests run against the real stack (no mocking).
 * Error / edge-state tests use page.route() to mock the network.
 *
 * Seeded tenant: tenant_id='nbe', display_name='Bank of Bhutan', monogram='BoB'.
 */
import { test, expect } from '@playwright/test';
import { login } from './helpers';

// ---------------------------------------------------------------------------
// 1. Login page — unauthenticated, tenant-public endpoint drives the hero
// ---------------------------------------------------------------------------

test.describe('Login page tenant branding', () => {
  test('hero panel shows Bank of Bhutan and NOT NBE / National Bank of Egypt', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByLabel('Username')).toBeVisible();

    // The hero panel (left column, visible on large viewports) should show
    // the seeded tenant's display_name.
    await expect(page.getByText('Bank of Bhutan').first()).toBeVisible();

    const html = await page.content();
    expect(html).not.toContain('National Bank of Egypt');
    expect(html).not.toContain('NBE ');
    expect(html).not.toMatch(/\bNBE\b/);
  });

  test('GET /spa/api/tenant-public returns 200 with expected public fields (no auth)', async ({
    page,
  }) => {
    const resp = await page.request.get('/spa/api/tenant-public');
    expect(resp.status()).toBe(200);
    const body = await resp.json() as Record<string, unknown>;

    // Verify required public fields are present.
    expect(typeof body['tenant_id']).toBe('string');
    expect(typeof body['display_name']).toBe('string');
    expect(typeof body['monogram']).toBe('string');
    expect(typeof body['primary_color']).toBe('string');
    expect(typeof body['regulator_short']).toBe('string');
    expect(Array.isArray(body['allowed_locales'])).toBe(true);

    // Verify seeded values.
    expect(body['display_name']).toBe('Bank of Bhutan');
    expect(body['monogram']).toBe('BoB');
    expect(body['regulator_short']).toBe('RMA');
  });

  test('tenant-public fallback: hero shows generic copy when endpoint is unavailable', async ({
    page,
  }) => {
    // Simulate a 503 from the tenant-public endpoint.
    await page.route('**/spa/api/tenant-public', (route) =>
      route.fulfill({ status: 503, body: JSON.stringify({ error: 'no_active_tenant' }) }),
    );
    await page.goto('/login');
    await expect(page.getByLabel('Username')).toBeVisible();

    // Should fall back to generic "DocManager" copy — no hard crash.
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    // No unhandled error banner.
    await expect(page.getByText(/something went wrong/i)).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 2. Authenticated chrome — sidebar monogram + topbar tenant chip
// ---------------------------------------------------------------------------

test.describe('Authenticated chrome tenant branding', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
  });

  test('sidebar shows BoB monogram and Bank of Bhutan display name', async ({ page }) => {
    const aside = page.locator('aside');
    // The monogram chip renders inside the sidebar header area.
    await expect(aside.getByText('BoB')).toBeVisible();
    await expect(aside.getByText('Bank of Bhutan')).toBeVisible();
  });

  test('topbar shows tenant chip with display_name', async ({ page }) => {
    const topbar = page.getByRole('banner');
    await expect(topbar.getByText('Bank of Bhutan')).toBeVisible();
  });

  test('topbar tenant chip dropdown opens with at least one option', async ({ page }) => {
    const topbar = page.getByRole('banner');
    const chip = topbar.getByRole('button', { name: /Tenant: Bank of Bhutan/i });
    await chip.click();

    // Dropdown with listbox role should appear.
    const listbox = page.getByRole('listbox', { name: 'Available tenants' });
    await expect(listbox).toBeVisible();

    // At least one option — the current tenant.
    const options = listbox.getByRole('option');
    await expect(options.first()).toBeVisible();
    await expect(options.first()).toContainText('Bank of Bhutan');
  });

  test('topbar tenant chip dropdown: switching to same tenant is no-op', async ({ page }) => {
    const topbar = page.getByRole('banner');
    const chip = topbar.getByRole('button', { name: /Tenant: Bank of Bhutan/i });
    await chip.click();

    const listbox = page.getByRole('listbox', { name: 'Available tenants' });
    await expect(listbox).toBeVisible();

    // Click the active tenant option — should not crash.
    const activeOption = listbox.getByRole('option').first();
    await activeOption.click();

    // Dropdown should close or show no error.
    // The page should remain on the dashboard with no error message.
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  });

  test('page does not contain NBE or National Bank of Egypt literals', async ({ page }) => {
    const html = await page.content();
    expect(html).not.toContain('National Bank of Egypt');
    // Allow 'nbe' as a tenant_id value embedded in JSON but not as user-visible text.
    // Check the visible text specifically.
    const visibleText = await page.evaluate(() => document.body.innerText);
    expect(visibleText).not.toContain('National Bank of Egypt');
    expect(visibleText).not.toMatch(/\bNBE\b/);
  });
});

// ---------------------------------------------------------------------------
// 3. /spa/api/me includes tenant payload (authenticated)
// ---------------------------------------------------------------------------

test.describe('/spa/api/me tenant payload', () => {
  test('GET /spa/api/me returns tenant and available_tenants after login', async ({ page }) => {
    await login(page, 'admin', 'admin123');

    const resp = await page.request.get('/spa/api/me');
    expect(resp.status()).toBe(200);
    const body = await resp.json() as Record<string, unknown>;

    // Tenant object.
    expect(body['tenant']).toBeTruthy();
    const tenant = body['tenant'] as Record<string, unknown>;
    expect(tenant['display_name']).toBe('Bank of Bhutan');
    expect(tenant['monogram']).toBe('BoB');

    // available_tenants: at minimum [current tenant].
    expect(Array.isArray(body['available_tenants'])).toBe(true);
    const av = body['available_tenants'] as unknown[];
    expect(av.length).toBeGreaterThanOrEqual(1);
  });
});
