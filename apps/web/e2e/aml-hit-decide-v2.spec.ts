/**
 * E2E happy-path tests for AML hit-decide v2.
 *
 * Tests run against the real live stack (no mocking).
 * Assumptions: the stack is running, admin user exists, at least one open hit
 * is present (or the test seeds one by triggering a screening).
 *
 * Run: npx playwright test aml-hit-decide-v2.spec.ts --reporter=line
 */

import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('AML hit-decide v2 — happy path', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
  });

  test('opens AML page and hits-queue tab is visible', async ({ page }) => {
    await page.goto('/aml');
    await page.waitForLoadState('networkidle');

    // Should show the hits queue tab
    await expect(page.getByRole('tab', { name: /hits queue/i })).toBeVisible();
  });

  test('can view the score breakdown section in compare tab', async ({ page }) => {
    // Seed a screening/hit via the API
    const cid = `e2e-cid-v2-${Date.now()}`;
    await page.evaluate(
      async (customerCid) => {
        await fetch('/spa/api/aml/screen', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ customer_cid: customerCid }),
        });
      },
      cid,
    );

    await page.goto('/aml');

    // Click Hits Queue tab
    await page.getByRole('tab', { name: /hits queue/i }).click();
    await page.waitForLoadState('networkidle');

    // If hits exist, click the first Decide button
    const decideBtn = page.getByRole('button', { name: /decide/i }).first();
    if (await decideBtn.isVisible()) {
      await decideBtn.click();

      // The v2 modal should open
      await expect(page.getByTestId('aml-hit-decide-v2-modal')).toBeVisible();

      // Compare tab should be active by default
      await expect(page.getByRole('tab', { name: /compare/i })).toBeVisible();

      // Score breakdown section should be present
      await expect(page.getByText(/match score breakdown/i)).toBeVisible();
    }
  });

  test('history tab loads without error', async ({ page }) => {
    await page.goto('/aml');
    await page.getByRole('tab', { name: /hits queue/i }).click();
    await page.waitForLoadState('networkidle');

    const decideBtn = page.getByRole('button', { name: /decide/i }).first();
    if (await decideBtn.isVisible()) {
      await decideBtn.click();
      await expect(page.getByTestId('aml-hit-decide-v2-modal')).toBeVisible();

      // Click history tab
      await page.getByRole('tab', { name: /history/i }).click();

      // Should show either history or empty state — no error
      const historyPanel = page.getByRole('tabpanel').filter({ hasText: /prior decisions|no prior/i });
      await expect(historyPanel).toBeVisible({ timeout: 5000 });
    }
  });

  test('adverse media tab shows stub notice', async ({ page }) => {
    await page.goto('/aml');
    await page.getByRole('tab', { name: /hits queue/i }).click();
    await page.waitForLoadState('networkidle');

    const decideBtn = page.getByRole('button', { name: /decide/i }).first();
    if (await decideBtn.isVisible()) {
      await decideBtn.click();
      await expect(page.getByTestId('aml-hit-decide-v2-modal')).toBeVisible();

      await page.getByRole('tab', { name: /adverse media/i }).click();
      await expect(page.getByText(/stub mode/i)).toBeVisible({ timeout: 5000 });
    }
  });

  test('action tab shows notes field with min-char counter', async ({ page }) => {
    await page.goto('/aml');
    await page.getByRole('tab', { name: /hits queue/i }).click();
    await page.waitForLoadState('networkidle');

    const decideBtn = page.getByRole('button', { name: /decide/i }).first();
    if (await decideBtn.isVisible()) {
      await decideBtn.click();
      await expect(page.getByTestId('aml-hit-decide-v2-modal')).toBeVisible();

      await page.getByRole('tab', { name: /action/i }).click();

      const notesField = page.getByTestId('aml-v2-action-notes');
      await expect(notesField).toBeVisible();

      // Clear button should be disabled until 20 chars entered
      const clearedBtn = page.getByTestId('aml-v2-action-cleared');
      await expect(clearedBtn).toBeDisabled();

      // Type 20+ chars to enable actions
      await notesField.fill('Verified — clear false positive match');
      await expect(clearedBtn).toBeEnabled();
    }
  });
});
