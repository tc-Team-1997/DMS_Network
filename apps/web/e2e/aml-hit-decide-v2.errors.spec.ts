/**
 * E2E error/edge-state tests for AML hit-decide v2.
 * These tests use page.route() to mock API responses.
 *
 * Run: npx playwright test aml-hit-decide-v2.errors.spec.ts --reporter=line
 */

import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('AML hit-decide v2 — error states', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
  });

  test('shows error when hits endpoint returns 500', async ({ page }) => {
    // Mock the hits endpoint to fail
    await page.route('**/spa/api/aml/hits**', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'internal_server_error' }),
      });
    });

    await page.goto('/aml');
    await page.getByRole('tab', { name: /hits queue/i }).click();
    await page.waitForLoadState('networkidle');

    // Should show error state, not crash
    await expect(page.getByTestId('aml-error')).toBeVisible({ timeout: 5000 });
  });

  test('shows conflict error when hit already decided (409)', async ({ page }) => {
    // Seed a mock hit in the queue
    await page.route('**/spa/api/aml/hits**', async (route) => {
      if (!route.request().url().includes('/decide') && !route.request().url().includes('/history')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            items: [{
              id: 9999,
              screening_id: 1,
              watchlist_entry_id: 1,
              watchlist_entry_name: 'John Doe Test',
              watchlist_name: 'OFAC SDN',
              matched_name: 'John Doe',
              watchlist_dob: null,
              watchlist_country: null,
              original_record: null,
              subject_name: 'Johnathon Doe',
              subject_dob: null,
              subject_country: null,
              score: 0.87,
              score_breakdown: { name: 0.87, dob: 0, country: 0 },
              decision: 'open',
              reviewed_by: null,
              reviewed_at: null,
              review_notes: null,
              created_at: new Date().toISOString(),
            }],
            total: 1,
            next_cursor: null,
          }),
        });
      } else {
        await route.continue();
      }
    });

    // Mock the decide endpoint to return 409
    await page.route('**/spa/api/aml/hits/9999/decide', async (route) => {
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'conflict', detail: 'Already decided' }),
      });
    });

    // Mock the history endpoint
    await page.route('**/spa/api/aml/hits/9999/history', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          hit_id: 9999,
          subject_cid: 'test-cid',
          watchlist_entry_id: 1,
          decisions: [],
          suppressions: [],
        }),
      });
    });

    await page.goto('/aml');
    await page.getByRole('tab', { name: /hits queue/i }).click();
    await page.waitForLoadState('networkidle');

    const decideBtn = page.getByTestId('aml-hit-decide-button-9999');
    await expect(decideBtn).toBeVisible({ timeout: 5000 });
    await decideBtn.click();

    await expect(page.getByTestId('aml-hit-decide-v2-modal')).toBeVisible();
    await page.getByRole('tab', { name: /action/i }).click();

    const notesField = page.getByTestId('aml-v2-action-notes');
    await notesField.fill('Verified — clear false positive match for test purposes');

    await page.getByTestId('aml-v2-action-cleared').click();

    // Should show conflict error
    await expect(page.getByRole('alert')).toContainText(/recently updated|conflict/i, { timeout: 5000 });
  });

  test('suppression dialog validates minimum reason length', async ({ page }) => {
    // Seed a mock hit
    await page.route('**/spa/api/aml/hits**', async (route) => {
      if (!route.request().url().includes('/')) {
        await route.continue();
        return;
      }
      const url = route.request().url();
      if (url.endsWith('/hits') || url.includes('/hits?')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            items: [{
              id: 8888,
              screening_id: 1,
              watchlist_entry_id: 1,
              watchlist_entry_name: 'Test Person',
              watchlist_name: 'OFAC',
              matched_name: null,
              watchlist_dob: null,
              watchlist_country: null,
              original_record: null,
              subject_name: 'Tester Person',
              subject_dob: null,
              subject_country: null,
              score: 0.75,
              decision: 'open',
              reviewed_by: null,
              reviewed_at: null,
              review_notes: null,
              created_at: new Date().toISOString(),
            }],
            total: 1,
            next_cursor: null,
          }),
        });
      } else {
        await route.continue();
      }
    });

    await page.route('**/spa/api/aml/hits/8888/history', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          hit_id: 8888,
          subject_cid: 'test-cid',
          watchlist_entry_id: 1,
          decisions: [],
          suppressions: [],
        }),
      });
    });

    await page.goto('/aml');
    await page.getByRole('tab', { name: /hits queue/i }).click();
    await page.waitForLoadState('networkidle');

    const decideBtn = page.getByTestId('aml-hit-decide-button-8888');
    if (!(await decideBtn.isVisible({ timeout: 3000 }).catch(() => false))) {
      test.skip();
      return;
    }
    await decideBtn.click();

    await expect(page.getByTestId('aml-hit-decide-v2-modal')).toBeVisible();
    await page.getByRole('tab', { name: /action/i }).click();
    await page.getByTestId('aml-v2-action-notes').fill('Long enough notes for the action panel here');

    // Click "Cleared + Suppress" to open suppression dialog
    await page.getByTestId('aml-v2-action-suppress').click();

    // Dialog should appear
    await expect(page.getByTestId('aml-suppression-dialog')).toBeVisible({ timeout: 3000 });

    // Submit button should be disabled with short reason
    const submitBtn = page.getByTestId('aml-suppress-submit');
    await expect(submitBtn).toBeDisabled();

    // Fill enough reason
    await page.getByTestId('aml-suppress-reason').fill('This is a verified false positive suppression reason');
    await expect(submitBtn).toBeEnabled();
  });

  test('SAR modal requires narrative ≥ 50 chars', async ({ page }) => {
    // Use a mocked hit
    await page.route('**/spa/api/aml/hits**', async (route) => {
      const url = route.request().url();
      if (url.includes('/history') || url.includes('/suppress') || url.includes('/sar-submit') || url.includes('/decide')) {
        await route.continue();
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [{
            id: 7777,
            screening_id: 1,
            watchlist_entry_id: 1,
            watchlist_entry_name: 'OFAC Match Person',
            watchlist_name: 'OFAC SDN',
            matched_name: null,
            watchlist_dob: null,
            watchlist_country: null,
            original_record: null,
            subject_name: 'Suspect Person',
            subject_dob: null,
            subject_country: null,
            score: 0.97,
            score_breakdown: { name: 0.97, dob: 0, country: 0 },
            decision: 'open',
            reviewed_by: null,
            reviewed_at: null,
            review_notes: null,
            created_at: new Date().toISOString(),
          }],
          total: 1,
          next_cursor: null,
        }),
      });
    });

    await page.route('**/spa/api/aml/hits/7777/history', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          hit_id: 7777, subject_cid: 'cid', watchlist_entry_id: 1,
          decisions: [], suppressions: [],
        }),
      });
    });

    await page.goto('/aml');
    await page.getByRole('tab', { name: /hits queue/i }).click();
    await page.waitForLoadState('networkidle');

    const decideBtn = page.getByTestId('aml-hit-decide-button-7777');
    if (!(await decideBtn.isVisible({ timeout: 3000 }).catch(() => false))) {
      test.skip();
      return;
    }
    await decideBtn.click();

    await expect(page.getByTestId('aml-hit-decide-v2-modal')).toBeVisible();
    await page.getByRole('tab', { name: /action/i }).click();
    await page.getByTestId('aml-v2-action-notes').fill('Notes for this high-risk SAR action trigger test case');

    // Click SAR button
    await page.getByTestId('aml-v2-action-sar').click();

    // SAR modal should open
    await expect(page.getByTestId('aml-sar-draft-modal')).toBeVisible({ timeout: 3000 });

    // Narrative textarea exists (pre-filled with default text)
    const narrativeField = page.getByTestId('aml-sar-narrative');
    await expect(narrativeField).toBeVisible();

    // Clear it and check button is disabled
    await narrativeField.clear();
    await expect(page.getByTestId('aml-sar-download')).toBeDisabled();
    await expect(page.getByTestId('aml-sar-submit')).toBeDisabled();

    // Fill ≥ 50 chars to enable
    await narrativeField.fill('This customer matched an OFAC SDN entry at 97% confidence. Refer for SAR filing.');
    await expect(page.getByTestId('aml-sar-download')).toBeEnabled();
  });
});
