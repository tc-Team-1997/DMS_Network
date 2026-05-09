/**
 * E2E error/edge-state tests for Customer-360.
 * All API calls are mocked.
 *
 * Run: npx playwright test customer-360.errors.spec.ts --reporter=line
 */

import { test, expect } from '@playwright/test';
import { login } from './helpers';

const MOCK_CID = 'CIFTEST_ERR001';

test.describe('Customer-360 — error states', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
  });

  test('header endpoint 403 → forbidden error response', async ({ page }) => {
    await page.route(`**/spa/api/customer360/${MOCK_CID}`, async (route) => {
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'forbidden', detail: 'Insufficient permissions' }),
      });
    });

    await page.goto('/');

    const status = await page.evaluate(async (cid) => {
      const res = await fetch(`/spa/api/customer360/${cid}`);
      return res.status;
    }, MOCK_CID);

    expect(status).toBe(403);
  });

  test('pii-reveal rejects reason < 20 chars (server 400)', async ({ page }) => {
    await page.route(`**/spa/api/customer360/${MOCK_CID}/pii-reveal`, async (route) => {
      const body = JSON.parse(route.request().postData() ?? '{}');
      const reason: string = body.reason ?? '';
      if (reason.length < 20) {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({
            error: 'validation_failed',
            details: { reason: 'must be at least 20 characters' },
          }),
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            cid: MOCK_CID,
            revealed: { phone: '+201234567890' },
            revealed_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 60_000).toISOString(),
          }),
        });
      }
    });

    await page.goto('/');

    // Short reason → 400
    const shortRes = await page.evaluate(async (cid) => {
      const res = await fetch(`/spa/api/customer360/${cid}/pii-reveal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: ['phone'], reason: 'too short' }),
      });
      return { status: res.status, body: await res.json() };
    }, MOCK_CID);

    expect(shortRes.status).toBe(400);
    expect(shortRes.body.error).toBe('validation_failed');

    // Long reason → 200
    const longRes = await page.evaluate(async (cid) => {
      const res = await fetch(`/spa/api/customer360/${cid}/pii-reveal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: ['phone'], reason: 'Customer called to verify account balance details' }),
      });
      return { status: res.status, body: await res.json() };
    }, MOCK_CID);

    expect(longRes.status).toBe(200);
    expect(longRes.body.revealed).toHaveProperty('phone');
  });

  test('accounts endpoint 502 → proxy error body', async ({ page }) => {
    await page.route(`**/spa/api/customer360/${MOCK_CID}/accounts**`, async (route) => {
      await route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'proxy_error', detail: 'Python service unavailable' }),
      });
    });

    await page.goto('/');

    const res = await page.evaluate(async (cid) => {
      const r = await fetch(`/spa/api/customer360/${cid}/accounts`);
      return { status: r.status, body: await r.json() };
    }, MOCK_CID);

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('proxy_error');
  });
});
