import { test, expect } from '@playwright/test';
import { login } from './helpers';

// ── Helpers ────────────────────────────────────────────────────────────────────

const SESSION_STATUS_URL = '**/spa/api/auth/session-status';
const EXTEND_SESSION_URL = '**/spa/api/auth/extend-session';

/** Build a session-status response that looks like the server contract. */
function makeAuthResponse(secondsRemaining: number, warningThreshold = 1800) {
  const now = Date.now();
  const expiresAt = new Date(now + secondsRemaining * 1000).toISOString();
  return {
    authenticated: true,
    user: { id: 1, username: 'admin', role: 'Doc Admin', tenant_id: 'nbe' },
    session: {
      id: 'abcd1234',
      created_at: new Date(now - 3600_000).toISOString(),
      expires_at: expiresAt,
      seconds_remaining: secondsRemaining,
      last_active_at: new Date(now - 60_000).toISOString(),
      can_extend: true,
      warning_threshold: warningThreshold,
    },
  };
}

function makeUnauthResponse() {
  return { authenticated: false, warning_seconds_threshold: 1800 };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

test.describe('Session expiry UX', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
  });

  test('Test 1: banner appears when seconds_remaining is 1500 (25 min)', async ({ page }) => {
    // We are already on the dashboard after login. Override the session-status
    // route so the next poll (or forced refetch) returns the warning state.
    await page.route(SESSION_STATUS_URL, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(makeAuthResponse(1500)),
      }),
    );

    // Navigate to trigger a fresh render + the hook's interval kick.
    await page.goto('/');

    // The banner should appear since 1500 <= 1800 (threshold) and > 60.
    await expect(page.getByTestId('session-expiry-banner')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('session-expiry-banner')).toContainText('25 minutes');
  });

  test('Test 2: clicking "Extend session" fires POST, banner disappears after seconds jump to 7200', async ({ page }) => {
    // Start in warning state.
    await page.route(SESSION_STATUS_URL, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(makeAuthResponse(1500)),
      }),
    );

    await page.goto('/');
    await expect(page.getByTestId('session-expiry-banner')).toBeVisible({ timeout: 10_000 });

    // The extend endpoint returns a refreshed session well outside the warning window.
    await page.route(EXTEND_SESSION_URL, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(makeAuthResponse(7200)),
      }),
    );

    // After extend, status polling will return the extended session too.
    await page.unroute(SESSION_STATUS_URL);
    await page.route(SESSION_STATUS_URL, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(makeAuthResponse(7200)),
      }),
    );

    const extendBtn = page.getByTestId('session-expiry-banner').getByRole('button', { name: 'Extend session' });
    await extendBtn.click();

    // Banner should disappear because seconds_remaining is now > warning_threshold.
    await expect(page.getByTestId('session-expiry-banner')).not.toBeVisible({ timeout: 5_000 });
  });

  test('Test 3: modal appears when seconds_remaining is 45', async ({ page }) => {
    await page.route(SESSION_STATUS_URL, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(makeAuthResponse(45)),
      }),
    );

    await page.goto('/');

    await expect(page.getByTestId('session-expired-modal')).toBeVisible({ timeout: 10_000 });
    // Should show MM:SS countdown
    const modal = page.getByTestId('session-expired-modal');
    await expect(modal).toContainText(/\d{2}:\d{2}/);
    // Banner should NOT be showing (modal takes over below 60 s).
    await expect(page.getByTestId('session-expiry-banner')).not.toBeVisible();
  });

  test('Test 4: when authenticated flips to false, page navigates to /login with ?next param', async ({ page }) => {
    // Route the session-status to immediately return unauthenticated on the
    // first call after we navigate to /capture. Because the hook runs on mount
    // with staleTime=0, the very first query result will be unauthenticated and
    // AuthRedirectOnExpiry will trigger the redirect.
    //
    // We still need a "previously authenticated" state recorded in the ref, so
    // we prime it by letting the login flow set prevAuthenticatedRef = true
    // during beforeEach, then intercept AFTER we navigate so the second poll
    // (on /capture) is the one that flips the state.
    //
    // Simplest reliable approach: route the endpoint on /capture to return
    // unauthenticated, which the component receives as an authenticated→false
    // transition (prev=true from login, current=false).

    await page.route(SESSION_STATUS_URL, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(makeUnauthResponse()),
      }),
    );

    await page.goto('/capture');

    await page.waitForURL('**/login**', { timeout: 10_000 });
    expect(page.url()).toContain('next=');
    expect(page.url()).toContain('%2Fcapture');
  });
});
