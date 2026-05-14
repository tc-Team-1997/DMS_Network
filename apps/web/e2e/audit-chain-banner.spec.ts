/**
 * Plan 3 (Wave-E1) — Task #4: Audit Log chain-verify banner + diff drawer.
 *
 * Specs:
 *   1. /admin/audit renders the promoted green banner with the
 *      "Chain verified through N events" + SHA-256 text.
 *   2. /spa/api/audit/chain/verify returns the expected
 *      { verified, count, latest_anchor, broken_at } envelope.
 *   3. Clicking an audit row opens `audit-diff-drawer` and renders the
 *      three new sections: policy_decision JSON, before/after, chain segment.
 *   4. (Optional, gated on NODE_ENV !== production) breaking a hash flips the
 *      banner to the red `chain-broken` state.
 */

import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('audit log shows green chain-verify banner at top of events tab', async ({ page }) => {
  await login(page, 'admin', 'admin123');
  await page.goto('/admin/audit');

  const banner = page.getByTestId('audit-chain-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toHaveClass(/chain-verified|bg-success-bg/);
  await expect(banner).toContainText(/Chain verified through \d+ events?/i);
  await expect(banner).toContainText(/SHA-256/i);
});

test('chain-verify endpoint returns full chain coverage', async ({ request, page }) => {
  await login(page, 'admin', 'admin123');
  const r = await request.get('/spa/api/audit/chain/verify');
  expect(r.ok()).toBe(true);
  const body = await r.json();
  expect(body).toMatchObject({
    verified: expect.any(Boolean),
    count: expect.any(Number),
  });
  expect(body.count).toBeGreaterThan(0);
  // latest_anchor + broken_at are nullable — assert presence of the keys.
  expect(body).toHaveProperty('latest_anchor');
  expect(body).toHaveProperty('broken_at');
});

test('audit chain banner shows red break state when a hash is tampered', async ({ page, request }) => {
  await login(page, 'admin', 'admin123');

  // Pick a small-id row to break (events are seeded in increasing order).
  const list = await request.get('/spa/api/audit/events?per_page=10&page=1');
  expect(list.ok()).toBe(true);
  const listBody = await list.json();
  const events = Array.isArray(listBody.events) ? listBody.events : [];
  test.skip(events.length === 0, 'no audit rows seeded; cannot exercise tamper path');
  const targetId = events[events.length - 1].id;

  const breakResp = await request.post(`/spa/api/audit/_test_break_chain_at?id=${targetId}`);
  // Test-only endpoint — skipped in production.
  test.skip(!breakResp.ok(), 'tamper endpoint not available (NODE_ENV=production?)');

  try {
    await page.goto('/admin/audit');
    await page.reload();
    const banner = page.getByTestId('audit-chain-banner');
    await expect(banner).toHaveClass(/chain-broken|bg-danger-bg/);
    await expect(banner).toContainText(/broken at event #\d+/i);
  } finally {
    await request.post('/spa/api/audit/_test_repair_chain');
  }
});

test('clicking an audit row opens diff drawer with policy_decision + chain segment', async ({ page }) => {
  await login(page, 'admin', 'admin123');
  await page.goto('/admin/audit');

  // Click the first data row in the events tab table.
  const eventsTab = page.getByTestId('events-tab');
  await expect(eventsTab).toBeVisible();
  const firstRow = eventsTab.locator('tr').filter({ has: page.locator('td') }).first();
  await firstRow.click();

  const drawer = page.getByTestId('audit-diff-drawer');
  await expect(drawer).toBeVisible();
  await expect(drawer.getByTestId('audit-policy-decision-json')).toBeVisible();
  await expect(drawer.getByTestId('audit-chain-segment')).toBeVisible();
  await expect(drawer.getByTestId('audit-chain-segment')).toContainText(/prev:/);
  await expect(drawer.getByTestId('audit-chain-segment')).toContainText(/this:/);
});
