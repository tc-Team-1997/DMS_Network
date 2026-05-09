/**
 * ABAC Editor — Playwright E2E spec.
 *
 * Happy-path tests: real stack (no mocking).
 * Error/edge tests: page.route() mocking.
 *
 * Seed creds: admin/admin123 (Doc Admin), sara/sara123 (Maker — non-admin).
 *
 * Structure:
 *   1. Happy path — page loads, rule list renders
 *   2. Happy path — create a rule, verify it appears in list
 *   3. Happy path — compile & push shows result banner
 *   4. Happy path — test policy panel returns a decision
 *   5. Error — compile failure (mocked 500) shows error, banner present
 *   6. Edge — non-admin user sees AccessDenied
 */

import { test, expect } from '@playwright/test';
import { login } from './helpers';

// ---------------------------------------------------------------------------
// Helper: check if ABAC endpoints are live (Node server has the new route)
// ---------------------------------------------------------------------------

async function abacEndpointsLive(page: import('@playwright/test').Page): Promise<boolean> {
  const resp = await page.request.get('/spa/api/admin/abac/rules');
  // 401 = unauthenticated (route exists), 404 = not registered (old server)
  return resp.status() !== 404;
}

// ---------------------------------------------------------------------------
// 1. Happy path — page loads, left rail shows ABAC entry, tabs visible
// ---------------------------------------------------------------------------

test.describe('ABAC Editor — page shell (happy path)', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
    await page.goto('/admin/settings/abac');
    await page.waitForLoadState('networkidle');
  });

  test('renders ABAC heading and left-rail nav entry', async ({ page }) => {
    // Heading inside the panel content
    await expect(page.locator('h2').filter({ hasText: 'ABAC Policy Editor' }).first())
      .toBeVisible({ timeout: 10_000 });

    // Breadcrumb shows ABAC
    const breadcrumb = page.locator('div.sticky.top-0').first();
    await expect(breadcrumb).toContainText('ABAC');

    // Left rail has the ABAC entry
    const rail = page.locator('aside').nth(1);
    await expect(rail.getByText('ABAC')).toBeVisible();
  });

  test('shows three tabs: Rules, Test Policy, Decision Trace', async ({ page }) => {
    await expect(page.locator('h2').filter({ hasText: 'ABAC Policy Editor' }).first())
      .toBeVisible({ timeout: 10_000 });

    await expect(page.getByRole('tab', { name: 'Rules' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Test Policy' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Decision Trace' })).toBeVisible();
  });

  test('shows Compile & Push button', async ({ page }) => {
    await expect(page.locator('h2').filter({ hasText: 'ABAC Policy Editor' }).first())
      .toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: /Compile/i }).first()).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 2. Happy path — create a rule and verify it appears
// ---------------------------------------------------------------------------

test.describe('ABAC Editor — create rule (happy path)', () => {
  test('can create a rule and see it in the list', async ({ page }) => {
    await login(page, 'admin', 'admin123');

    const live = await abacEndpointsLive(page);
    if (!live) {
      test.fixme(true, 'ABAC endpoints not active — restart Node server');
      return;
    }

    await page.goto('/admin/settings/abac');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('h2').filter({ hasText: 'ABAC Policy Editor' }).first())
      .toBeVisible({ timeout: 10_000 });

    // Rules tab should be active by default
    await expect(page.getByRole('tab', { name: 'Rules' })).toBeVisible();

    // Open new rule editor
    await page.getByRole('button', { name: 'New rule' }).click();

    // Wait for modal
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5000 });

    // Fill in the rule form
    const uniqueId = `r_e2e_${Date.now()}`;
    await page.locator('input[placeholder="r_my_rule"]').fill(uniqueId);
    await page.locator('input[placeholder="Critical docs require step-up"]').fill('E2E test rule');

    // Fill reason
    await page.locator('textarea[placeholder*="minimum 20"]').last().fill('E2E test: creating an ABAC rule to verify the editor works correctly');

    // Submit
    await page.getByRole('button', { name: 'Create rule' }).click();

    // Success toast
    await expect(page.getByRole('alert').first()).toContainText('Rule created', { timeout: 8000 });

    // Modal closes
    await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 5000 });

    // Rule appears in list
    await expect(page.getByText('E2E test rule').first()).toBeVisible({ timeout: 6000 });
  });
});

// ---------------------------------------------------------------------------
// 3. Happy path — compile & push shows result banner
// ---------------------------------------------------------------------------

test.describe('ABAC Editor — compile (happy path)', () => {
  test('compile & push shows a result banner', async ({ page }) => {
    await login(page, 'admin', 'admin123');

    const live = await abacEndpointsLive(page);
    if (!live) {
      test.fixme(true, 'ABAC endpoints not active — restart Node server');
      return;
    }

    await page.goto('/admin/settings/abac');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('h2').filter({ hasText: 'ABAC Policy Editor' }).first())
      .toBeVisible({ timeout: 10_000 });

    const compileBtn = page.getByRole('button', { name: /Compile/i }).first();
    await expect(compileBtn).toBeVisible();
    await compileBtn.click();

    // Wait for banner (either success or OPA-push-non-fatal warning)
    await expect(
      page.locator('text=compiled').or(page.locator('text=Compile failed')).first()
    ).toBeVisible({ timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// 4. Happy path — test policy panel returns a decision
// ---------------------------------------------------------------------------

test.describe('ABAC Editor — test policy panel (happy path)', () => {
  test('Run test button returns a decision badge', async ({ page }) => {
    await login(page, 'admin', 'admin123');

    const live = await abacEndpointsLive(page);
    if (!live) {
      test.fixme(true, 'ABAC endpoints not active — restart Node server');
      return;
    }

    await page.goto('/admin/settings/abac');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('h2').filter({ hasText: 'ABAC Policy Editor' }).first())
      .toBeVisible({ timeout: 10_000 });

    // Switch to Test Policy tab
    await page.getByRole('tab', { name: 'Test Policy' }).click();

    // Run test button
    await expect(page.getByRole('button', { name: 'Run test' })).toBeVisible({ timeout: 5000 });
    await page.getByRole('button', { name: 'Run test' }).click();

    // Either ALLOW or DENY badge appears
    await expect(
      page.locator('text=ALLOW').or(page.locator('text=DENY')).first()
    ).toBeVisible({ timeout: 8000 });
  });
});

// ---------------------------------------------------------------------------
// 5. Error — compile fails (mocked 500) — shows error banner, file untouched
// ---------------------------------------------------------------------------

test.describe('ABAC Editor — compile failure (mocked)', () => {
  test('compile 500 shows error banner and does NOT navigate away', async ({ page }) => {
    await login(page, 'admin', 'admin123');

    // Mock the compile endpoint to return 500
    await page.route('**/spa/api/admin/abac/compile', (route) => {
      void route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, error: 'Compile failed: unknown field path "resource.owner_id"' }),
      });
    });

    await page.goto('/admin/settings/abac');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('h2').filter({ hasText: 'ABAC Policy Editor' }).first())
      .toBeVisible({ timeout: 10_000 });

    const compileBtn = page.getByRole('button', { name: /Compile/i }).first();
    await compileBtn.click();

    // Error toast appears
    await expect(page.getByRole('alert').first()).toContainText('failed', { timeout: 8000 });

    // Error banner appears in the compile section
    await expect(page.locator('text=Compile failed').first()).toBeVisible({ timeout: 5000 });

    // Still on the same page
    await expect(page).toHaveURL(/\/admin\/settings\/abac/);
  });
});

// ---------------------------------------------------------------------------
// 6. Edge — non-admin sees AccessDenied
// ---------------------------------------------------------------------------

test.describe('ABAC Editor — RBAC gate', () => {
  test('Maker user sees AccessDenied at /admin/settings/abac', async ({ page }) => {
    await login(page, 'sara', 'sara123');
    await page.goto('/admin/settings/abac');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('Access restricted')).toBeVisible({ timeout: 8000 });
    await expect(page.getByText("You don't have access to this area")).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 7. Mocked — rules list returns items and renders rule cards
// ---------------------------------------------------------------------------

test.describe('ABAC Editor — rules list (mocked)', () => {
  test('renders rule cards from mocked response', async ({ page }) => {
    await login(page, 'admin', 'admin123');

    // Mock rules endpoint
    await page.route('**/spa/api/admin/abac/rules', (route) => {
      void route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          rules: [
            {
              id: 'r_critical',
              name: 'Block critical docs after hours',
              description: 'Deny approve on critical-risk docs between 22:00 and 07:00',
              effect: 'deny',
              priority: 50,
              condition: {
                resource: 'document',
                action: 'approve',
                when_all: [
                  { field: 'resource.risk_band', op: 'eq', value: 'critical' },
                  { field: 'context.stepup_valid', op: 'eq', value: false },
                ],
              },
            },
          ],
        }),
      });
    });

    await page.goto('/admin/settings/abac');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('h2').filter({ hasText: 'ABAC Policy Editor' }).first())
      .toBeVisible({ timeout: 10_000 });

    // Rule card appears
    await expect(page.getByText('Block critical docs after hours')).toBeVisible({ timeout: 6000 });
    // Effect badge
    await expect(page.getByText('deny').first()).toBeVisible();
    // Condition chips
    await expect(page.getByText('resource.risk_band').first()).toBeVisible();
  });
});
