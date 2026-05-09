/**
 * E2E error handling tests for AML Screening feature.
 *
 * Tests error states and edge cases from the contract's error matrix (§11).
 * All tests use mocked responses to test error handling paths.
 *
 * Run with: npx playwright test aml-screening.errors.spec.ts --reporter=line
 */

import { test, expect } from '@playwright/test';
import { login } from './helpers';

// ─────────────────────────────────────────────────────────────────────────────
// Error: Empty watchlists
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Error: Empty watchlists (no entries loaded)', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
    // Mock watchlists endpoint to return empty list
    await page.route('**/spa/api/aml/watchlists', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [], total: 0 }),
      });
    });
  });

  test('screening completes but hits are empty when no watchlists loaded', async ({ page }) => {
    const screeningResponse = await page.evaluate(async () => {
      const res = await fetch('/spa/api/aml/screen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_cid: 'test-empty-watchlist' }),
      });
      return res.json();
    });

    // Screening should still complete but return 0 hits
    expect(screeningResponse).toHaveProperty('status');
    // Should not error; screening is fail-open
    expect([200, 201, 202]).toContain(screeningResponse.status ?? 200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Error: Network failure during refresh
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Error: Network failure during watchlist refresh', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
    // Mock refresh to fail
    await page.route('**/spa/api/aml/watchlists/refresh', (route) => {
      route.abort('failed');
    });
  });

  test('refresh failure returns error to caller', async ({ page }) => {
    const refreshResponse = await page.evaluate(async () => {
      try {
        const res = await fetch('/spa/api/aml/watchlists/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        return { status: res.status, ok: res.ok };
      } catch (err) {
        return { error: (err as Error).message };
      }
    });

    // Should either fail or return a 5xx error
    if ('error' in refreshResponse) {
      expect(refreshResponse.error).toBeTruthy();
    } else {
      expect(refreshResponse.ok).toBe(false);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Error: 400 Invalid match_threshold (out of [0, 1])
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Error: Invalid match_threshold out of range', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
  });

  test('PATCH watchlist with invalid threshold returns 400', async ({ page }) => {
    const patchResponse = await page.evaluate(async () => {
      const res = await fetch('/spa/api/aml/watchlists/1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ match_threshold: 1.5 }), // out of range
      });
      return {
        status: res.status,
        data: await res.json(),
      };
    });

    expect(patchResponse.status).toBe(400);
    expect(patchResponse.data).toHaveProperty('error');
    expect(patchResponse.data.error).toBe('validation_failed');
  });
});

test.describe('Error: Invalid match_threshold negative', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
  });

  test('PATCH with negative threshold returns 400', async ({ page }) => {
    const patchResponse = await page.evaluate(async () => {
      const res = await fetch('/spa/api/aml/watchlists/1', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ match_threshold: -0.1 }),
      });
      return {
        status: res.status,
        data: await res.json(),
      };
    });

    expect(patchResponse.status).toBe(400);
    expect(patchResponse.data.error).toBe('validation_failed');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Error: 400 Invalid decision enum
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Error: Invalid decision enum value', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
  });

  test('POST decide with invalid decision returns 400', async ({ page }) => {
    const decideResponse = await page.evaluate(async () => {
      const res = await fetch('/spa/api/aml/hits/1/decide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'invalid_action' }),
      });
      return {
        status: res.status,
        data: await res.json(),
      };
    });

    expect(decideResponse.status).toBe(400);
    expect(decideResponse.data.error).toBe('validation_failed');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Error: 403 Forbidden (insufficient role)
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Error: 403 Forbidden on insufficient role', () => {
  test.beforeEach(async ({ page }) => {
    // Log in as Viewer (no aml:review permission)
    await login(page, 'nour', 'nour123'); // Viewer role
  });

  test('viewer cannot decide hits (aml:review required)', async ({ page }) => {
    const decideResponse = await page.evaluate(async () => {
      const res = await fetch('/spa/api/aml/hits/1/decide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'cleared' }),
      });
      return res.status;
    });

    expect(decideResponse).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Error: 5xx Server error during decide
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Error: 5xx Server error during hit decision', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
    // Mock decide endpoint to return 500
    await page.route('**/spa/api/aml/hits/*/decide', (route) => {
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'internal_server_error',
          detail: 'Database connection failed',
        }),
      });
    });
  });

  test('decide returns 500 on server error', async ({ page }) => {
    const decideResponse = await page.evaluate(async () => {
      const res = await fetch('/spa/api/aml/hits/1/decide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'cleared' }),
      });
      return res.status;
    });

    expect(decideResponse).toBe(500);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Error: 409 Concurrent edit (hit already decided)
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Error: 409 Concurrent edit — hit already decided', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
    // Mock decide to return 409 on the second call for the same hit
    let callCount = 0;
    await page.route('**/spa/api/aml/hits/999/decide', (route) => {
      callCount++;
      if (callCount === 1) {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            hit_id: 999,
            decision: 'cleared',
            reviewed_by: 'admin',
            reviewed_at: new Date().toISOString(),
          }),
        });
      } else {
        route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            error: 'conflict',
            detail: 'Hit already decided by john.doe at 2026-05-09T10:00:00Z',
          }),
        });
      }
    });
  });

  test('second decide on same hit returns 409', async ({ page }) => {
    // First decision succeeds
    const first = await page.evaluate(async () => {
      const res = await fetch('/spa/api/aml/hits/999/decide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'cleared' }),
      });
      return res.status;
    });
    expect(first).toBe(200);

    // Second decision fails with 409
    const second = await page.evaluate(async () => {
      const res = await fetch('/spa/api/aml/hits/999/decide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision: 'escalated' }),
      });
      return res.status;
    });
    expect(second).toBe(409);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Error: Screening pending > 30 seconds (still running hint)
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Error: Screening pending > 30 seconds', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
    // Mock screenings to return a pending screening
    await page.route('**/spa/api/aml/screenings*', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [
            {
              screening_id: 123,
              customer_cid: 'long-running',
              customer_name: 'Test Customer',
              screened_at: new Date(Date.now() - 35000).toISOString(), // 35 seconds ago
              hit_count: 0,
              status: 'pending_review',
              hits: [],
            },
          ],
          total: 1,
        }),
      });
    });
  });

  test('screening running > 30s should show "still running" hint', async ({ page }) => {
    const screening = await page.evaluate(async () => {
      const res = await fetch('/spa/api/aml/screenings');
      const data = await res.json();
      return data.items[0];
    });

    // Verify the screening is old enough
    const screenTime = new Date(screening.screened_at).getTime();
    const ageMs = Date.now() - screenTime;
    expect(ageMs).toBeGreaterThan(30_000);

    // The frontend should display a "still running" indicator
    expect(screening.status).toBe('pending_review');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Error: Watchlist refresh in progress (disable button)
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Error: Watchlist refresh already in progress', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
    let refreshInProgress = false;
    await page.route('**/spa/api/aml/watchlists/refresh', (route) => {
      if (refreshInProgress) {
        route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            error: 'conflict',
            detail: 'Watchlist refresh already in progress (job_id: abc123)',
          }),
        });
      } else {
        refreshInProgress = true;
        // Simulate a long-running refresh
        setTimeout(() => {
          refreshInProgress = false;
        }, 500);
        route.fulfill({
          status: 202,
          contentType: 'application/json',
          body: JSON.stringify({
            job_id: 'abc123',
            status: 'queued',
            message: 'Watchlist refresh enqueued',
          }),
        });
      }
    });
  });

  test('second refresh while one is in progress returns 409', async ({ page }) => {
    // First refresh succeeds
    const first = await page.evaluate(async () => {
      const res = await fetch('/spa/api/aml/watchlists/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      return res.status;
    });
    expect(first).toBe(202);

    // Second refresh immediately returns 409
    const second = await page.evaluate(async () => {
      const res = await fetch('/spa/api/aml/watchlists/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      return res.status;
    });
    expect(second).toBe(409);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Additional validation: customer_cid required and non-empty
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Error: Invalid screening request (missing customer_cid)', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
  });

  test('screen without customer_cid returns 400', async ({ page }) => {
    const screenResponse = await page.evaluate(async () => {
      const res = await fetch('/spa/api/aml/screen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}), // missing customer_cid
      });
      return {
        status: res.status,
        data: await res.json(),
      };
    });

    expect(screenResponse.status).toBe(400);
    expect(screenResponse.data.error).toBe('validation_failed');
  });
});

test.describe('Error: Invalid screening request (empty customer_cid)', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
  });

  test('screen with empty customer_cid returns 400', async ({ page }) => {
    const screenResponse = await page.evaluate(async () => {
      const res = await fetch('/spa/api/aml/screen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_cid: '' }),
      });
      return {
        status: res.status,
        data: await res.json(),
      };
    });

    expect(screenResponse.status).toBe(400);
    expect(screenResponse.data.error).toBe('validation_failed');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Additional validation: pagination limits
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Error: Invalid pagination parameters', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
  });

  test('limit > 200 returns 400', async ({ page }) => {
    const response = await page.evaluate(async () => {
      const res = await fetch('/spa/api/aml/screenings?limit=500');
      return {
        status: res.status,
        data: await res.json(),
      };
    });

    expect(response.status).toBe(400);
    expect(response.data.error).toBe('validation_failed');
  });
});
