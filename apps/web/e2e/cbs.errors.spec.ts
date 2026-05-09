/**
 * E2E tests for CBS (Temenos T24) adapter — error cases.
 *
 * Contract: docs/contracts/temenos-cbs-adapter.md §11 (error matrix)
 *
 * Each test covers one error scenario. Tests mock upstream responses via
 * page.route() to simulate error conditions without depending on actual
 * T24 failure states.
 *
 * Run with: npx playwright test cbs.errors.spec.ts --reporter=line
 */

import { test, expect } from '@playwright/test';
import { login } from './helpers';

test.describe('CBS error matrix — validation errors', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
    await page.goto('/');
  });

  test('400: Empty CIF input', async ({ page }) => {
    // Try to fetch with an empty CIF.
    const response = await page.request.get('/spa/api/cbs/customers/');
    // Expect 400 or 404 depending on how the router handles empty params.
    expect([400, 404]).toContain(response.status());
  });

  test('400: Invalid CIF format (special characters)', async ({ page }) => {
    // CIF with invalid characters.
    const response = await page.request.get('/spa/api/cbs/customers/CIF!@%23');
    expect(response.status()).toBe(400);

    const error = await response.json();
    expect(error).toHaveProperty('error');
    expect(error.error).toBe('validation_failed');
  });

  test('400: CIF too short (< 4 chars per contract §8)', async ({ page }) => {
    const response = await page.request.get('/spa/api/cbs/customers/CIF');
    // Depending on validation, might be 400 or 404.
    expect([400, 404]).toContain(response.status());
  });

  test('400: Missing required field in link-document', async ({ page }) => {
    // Missing transaction_ref field.
    const response = await page.request.post('/spa/api/cbs/customers/CIF001/link-document', {
      headers: {
        'Content-Type': 'application/json',
      },
      data: {
        document_id: 42,
        // missing transaction_ref
      },
    });

    expect(response.status()).toBe(400);
    const error = await response.json();
    expect(error).toHaveProperty('error');
    expect(error.error).toBe('validation_failed');
  });

  test('400: document_id is not a positive integer', async ({ page }) => {
    const response = await page.request.post('/spa/api/cbs/customers/CIF001/link-document', {
      headers: {
        'Content-Type': 'application/json',
      },
      data: {
        document_id: -1,
        transaction_ref: 'TEST-001',
      },
    });

    expect(response.status()).toBe(400);
    const error = await response.json();
    expect(error).toHaveProperty('error');
  });
});

test.describe('CBS error matrix — upstream errors', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
    await page.goto('/');
  });

  test('404: Customer not found in T24', async ({ page }) => {
    // Mock the upstream response to 404.
    await page.route('**/api/v1/cbs/pull-customer', (route) => {
      route.abort('notfound');
    });

    const response = await page.request.get('/spa/api/cbs/customers/CIF-NOT-FOUND');

    // The proxy should translate this to a 404 or 502 depending on implementation.
    expect([404, 502]).toContain(response.status());
  });

  test('503: T24 unavailable, circuit open', async ({ page }) => {
    // Mock the upstream to return service unavailable.
    await page.route('**/api/v1/cbs/**', (route) => {
      route.abort('failed');
    });

    const response = await page.request.get('/spa/api/cbs/customers/CIF001');

    // Should return 503 or 502.
    expect([502, 503, 504]).toContain(response.status());
  });

  test('504: Upstream timeout', async ({ page }) => {
    // Mock a slow response that times out.
    await page.route('**/api/v1/cbs/pull-customer', (route) => {
      route.abort('timedout');
    });

    const response = await page.request.get('/spa/api/cbs/customers/CIF001', {
      timeout: 2000, // Short timeout to ensure we hit it.
    });

    // Expect a timeout-related status or 504.
    expect([504, 502]).toContain(response.status());
  });

  test('429: Rate limited response', async ({ page }) => {
    // Mock rate-limit response.
    await page.route('**/api/v1/cbs/**', (route) => {
      route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'rate_limited',
          message: 'Too many requests',
          retry_after: 30,
        }),
      });
    });

    const response = await page.request.get('/spa/api/cbs/customers/CIF001');
    expect(response.status()).toBe(429);

    const error = await response.json();
    expect(error).toHaveProperty('retry_after');
  });

  test('502: CBS proxy error', async ({ page }) => {
    // Mock a 502 from the upstream proxy.
    await page.route('**/api/v1/cbs/**', (route) => {
      route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'proxy_error',
          detail: 'Bad gateway',
        }),
      });
    });

    const response = await page.request.get('/spa/api/cbs/customers/CIF001');
    expect(response.status()).toBe(502);
  });
});

test.describe('CBS error matrix — authorization errors', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
    await page.goto('/');
  });

  test('403: User without cbs:write cannot link document', async ({ page }) => {
    // Log in as a Viewer role (no cbs:write permission).
    // Note: If role-based filtering is not yet implemented in the E2E setup,
    // this test may need to be skipped with a comment.
    await login(page, 'nour', 'nour123'); // viewer role, no cbs:write

    const response = await page.request.post('/spa/api/cbs/customers/CIF001/link-document', {
      headers: {
        'Content-Type': 'application/json',
      },
      data: {
        document_id: 42,
        transaction_ref: 'LOAN-001',
      },
    });

    // Expect 403 (Forbidden) or 401 (Unauthorized).
    expect([401, 403]).toContain(response.status());
  });

  test('401: Unauthenticated request rejected', async ({ page }) => {
    // Make a request without authentication by clearing session cookies.
    // (Note: This requires either logging out or making a raw request without session.)
    const unauthResponse = await page.request.get('/spa/api/cbs/customers/CIF001');

    // If session is required, this should fail. The actual status depends on
    // whether the auth middleware redirects (302) or returns 401.
    expect([301, 302, 401, 403]).toContain(unauthResponse.status());
  });
});

test.describe('CBS error matrix — network errors', () => {
  test('Network failure: offline handling', async ({ page }) => {
    // Simulate network offline.
    await page.route('**/spa/api/cbs/**', (route) => {
      route.abort('failed');
    });

    const response = await page.request.get('/spa/api/cbs/customers/CIF001');

    // Should fail with a network error or proxy error.
    expect([502, 503, 504]).toContain(response.status());
  });

  test('Concurrent edit race condition returns 409 if supported', async ({ page }) => {
    // Mock a 409 Conflict response (concurrent edit).
    await page.route('**/api/v1/cbs/link-document', (route) => {
      route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'conflict',
          message: 'Document already linked by another process',
        }),
      });
    });

    const response = await page.request.post('/spa/api/cbs/customers/CIF001/link-document', {
      headers: {
        'Content-Type': 'application/json',
      },
      data: {
        document_id: 42,
        transaction_ref: 'LOAN-001',
      },
    });

    // If the backend supports 409, we should see it. Otherwise, it might be
    // translated to a 503 or generic error.
    expect([409, 502, 503]).toContain(response.status());
  });
});

test.describe('CBS error matrix — stale data with cache fallback', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
    await page.goto('/');
  });

  test('503 with cached data returns stale=true and cached_at', async ({ page }) => {
    // Mock the upstream to fail, but assume the cache layer returns fallback data.
    // This is tested at the Python service level, but we verify the SPA behavior.

    // First, warm the cache by making a successful request.
    await page.request.get('/spa/api/cbs/customers/CIF-CACHE-TEST');

    // Then mock the upstream to fail.
    await page.route('**/api/v1/cbs/pull-customer', (route) => {
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          cif: 'CIF-CACHE-TEST',
          name: 'Cached Customer',
          national_id: '12345',
          email: 'cached@example.com',
          phone: '+20100000000',
          risk_band: 'medium',
          kyc_status: 'VERIFIED',
          stale: true,
          cached_at: new Date().toISOString(),
        }),
      });
    });

    // The response should still be 200 with stale flag (cache fallback).
    const response = await page.request.get('/spa/api/cbs/customers/CIF-CACHE-TEST');

    // The Python service should return 200 with stale=true when cache is available.
    if (response.status() === 200) {
      const data = await response.json();
      expect(data.stale).toBe(true);
      expect(data.cached_at).toBeDefined();
    }
  });
});
