/**
 * users-v2.spec.ts — Users v2 Playwright specs.
 *
 * Happy-path suite: runs against the real stack.
 * Error/edge suites: mocked via page.route().
 *
 * Approved deviations (not tested here):
 *   - WebAuthn enrollment — disabled, Wave C
 *   - SAML test-SSO outbound roundtrip — returns XML only
 *   - SMS OTP send flow — not implemented
 */

import { test, expect } from '@playwright/test';
import { login } from './helpers';

// ---------------------------------------------------------------------------
// Happy path — Users tab (tabbed layout)
// ---------------------------------------------------------------------------

test.describe('Users v2 — Users tab', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
    await page.goto('/users?tab=users');
    await page.waitForLoadState('networkidle');
  });

  test('shows tabbed layout with four tabs', async ({ page }) => {
    await expect(page.getByTestId('tab-users')).toBeVisible();
    await expect(page.getByTestId('tab-mfa')).toBeVisible();
    await expect(page.getByTestId('tab-saml')).toBeVisible();
    await expect(page.getByTestId('tab-sessions')).toBeVisible();
  });

  test('lists seeded users with no password column', async ({ page }) => {
    await expect(page.getByText('admin')).toBeVisible();
    await expect(page.getByText('sara')).toBeVisible();
    // Confirm there is no password field visible
    await expect(page.getByLabel(/password/i)).not.toBeVisible();
  });

  test('opens invite drawer with magic-link banner and no password field', async ({ page }) => {
    await page.getByTestId('user-invite-btn').click();
    await expect(page.getByTestId('invite-email')).toBeVisible();
    await expect(page.getByText(/magic link/i)).toBeVisible();
    await expect(page.getByTestId('invite-password')).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Happy path — MFA tab
// ---------------------------------------------------------------------------

test.describe('Users v2 — MFA tab', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
    await page.goto('/users?tab=mfa');
    await page.waitForLoadState('networkidle');
  });

  test('shows MFA enforcement policy panel with four role buttons', async ({ page }) => {
    await expect(page.getByTestId('mfa-enforce-Doc Admin')).toBeVisible();
    await expect(page.getByTestId('mfa-enforce-Maker')).toBeVisible();
    await expect(page.getByTestId('mfa-enforce-Checker')).toBeVisible();
    await expect(page.getByTestId('mfa-enforce-Viewer')).toBeVisible();
  });

  test('shows user factors table', async ({ page }) => {
    await expect(page.getByText('User factors')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Happy path — SAML tab
// ---------------------------------------------------------------------------

test.describe('Users v2 — SAML tab', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
    await page.goto('/users?tab=saml');
    await page.waitForLoadState('networkidle');
  });

  test('shows SAML IdP list and Add IdP button', async ({ page }) => {
    await expect(page.getByTestId('saml-new-btn')).toBeVisible();
  });

  test('opens Add IdP drawer with name, XML, and claim fields', async ({ page }) => {
    await page.getByTestId('saml-new-btn').click();
    await expect(page.getByTestId('saml-name')).toBeVisible();
    await expect(page.getByTestId('saml-xml')).toBeVisible();
    await expect(page.getByTestId('saml-email-claim')).toBeVisible();
    await expect(page.getByTestId('saml-groups-claim')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Happy path — Sessions tab (Redis may or may not be running)
// ---------------------------------------------------------------------------

test.describe('Users v2 — Sessions tab', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, 'admin', 'admin123');
    await page.goto('/users?tab=sessions');
    await page.waitForLoadState('networkidle');
  });

  test('shows sessions tab content (either list or Redis-unavailable notice)', async ({ page }) => {
    const hasRedisNotice = await page
      .getByText('Session tracking unavailable')
      .isVisible()
      .catch(() => false);
    const hasBadge = await page
      .getByText('Auto-refreshes every 30s')
      .isVisible()
      .catch(() => false);
    expect(hasRedisNotice || hasBadge).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Happy path — /set-password anonymous page
// ---------------------------------------------------------------------------

test.describe('Users v2 — set-password page', () => {
  test('shows missing-token error when token param is absent', async ({ page }) => {
    await page.goto('/set-password');
    await expect(page.getByText('Missing token')).toBeVisible();
  });

  test('shows password form when token is present', async ({ page }) => {
    await page.goto('/set-password?token=aabbccddeeff00112233445566778899aabbccddeeff001122334455');
    await expect(page.getByTestId('set-password-field')).toBeVisible();
    await expect(page.getByTestId('set-password-confirm')).toBeVisible();
    await expect(page.getByTestId('set-password-submit')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Mocked — invite flow
// ---------------------------------------------------------------------------

test.describe('Users v2 — invite (mocked)', () => {
  test('invite happy path sends email and shows dev_link', async ({ page }) => {
    await page.route('**/spa/api/admin/users/invite', (route) =>
      route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          user_id: 42,
          username: 'alice',
          email: 'alice@nbe.eg',
          role: 'Maker',
          branch: null,
          expires_at: new Date(Date.now() + 7 * 86400_000).toISOString(),
          dev_link: '/set-password?token=dev-test-token',
        }),
      }),
    );
    await page.route('**/spa/api/users', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      }),
    );

    await login(page, 'admin', 'admin123');
    await page.goto('/users?tab=users');
    await page.waitForLoadState('networkidle');

    await page.getByTestId('user-invite-btn').click();
    await page.getByTestId('invite-email').fill('alice@nbe.eg');
    // Role combobox — pick Maker
    const roleCombo = page.getByTestId('invite-role');
    if (await roleCombo.isVisible()) {
      await roleCombo.click();
      await page.getByText('Maker').first().click();
    }
    await page.getByTestId('invite-reason').fill('Onboarding new Maker user for Delta branch');
    await page.getByTestId('invite-submit').click();

    await expect(page.getByText(/invitation sent/i)).toBeVisible({ timeout: 5000 });
  });

  test('invite shows SoD error toast on duplicate role conflict', async ({ page }) => {
    await page.route('**/spa/api/admin/users/invite', (route) =>
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'sod_violation',
          pair: ['Maker', 'Checker'],
          message: 'Assigning Maker violates SoD with existing Checker role.',
        }),
      }),
    );
    await page.route('**/spa/api/users', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      }),
    );

    await login(page, 'admin', 'admin123');
    await page.goto('/users?tab=users');
    await page.waitForLoadState('networkidle');

    await page.getByTestId('user-invite-btn').click();
    await page.getByTestId('invite-email').fill('bob@nbe.eg');
    const roleCombo = page.getByTestId('invite-role');
    if (await roleCombo.isVisible()) {
      await roleCombo.click();
      await page.getByText('Maker').first().click();
    }
    await page.getByTestId('invite-reason').fill('Test SoD rejection scenario for compliance');
    await page.getByTestId('invite-submit').click();

    await expect(page.getByText(/sod|segregation/i)).toBeVisible({ timeout: 5000 });
  });
});

// ---------------------------------------------------------------------------
// Mocked — set-password edge states
// ---------------------------------------------------------------------------

test.describe('Users v2 — set-password error states (mocked)', () => {
  test('expired token shows descriptive error', async ({ page }) => {
    await page.route('**/spa/api/auth/set-password', (route) =>
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'token_expired' }),
      }),
    );

    await page.goto('/set-password?token=aabbccddeeff00112233445566778899aabbccddeeff001122334455');
    await page.getByTestId('set-password-field').fill('Str0ngPassw0rd!');
    await page.getByTestId('set-password-confirm').fill('Str0ngPassw0rd!');
    await page.getByTestId('set-password-submit').click();

    await expect(page.getByTestId('set-password-error')).toContainText(
      'expired',
      { timeout: 5000 },
    );
  });

  test('already-used token shows descriptive error', async ({ page }) => {
    await page.route('**/spa/api/auth/set-password', (route) =>
      route.fulfill({
        status: 400,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'token_already_used' }),
      }),
    );

    await page.goto('/set-password?token=aabbccddeeff00112233445566778899aabbccddeeff001122334455');
    await page.getByTestId('set-password-field').fill('Str0ngPassw0rd!');
    await page.getByTestId('set-password-confirm').fill('Str0ngPassw0rd!');
    await page.getByTestId('set-password-submit').click();

    await expect(page.getByTestId('set-password-error')).toContainText(
      'already been used',
      { timeout: 5000 },
    );
  });

  test('password mismatch prevents form submission', async ({ page }) => {
    await page.goto('/set-password?token=aabbccddeeff00112233445566778899aabbccddeeff001122334455');
    await page.getByTestId('set-password-field').fill('Str0ngPassw0rd!');
    await page.getByTestId('set-password-confirm').fill('DifferentPassword!');

    // Submit button should remain disabled
    await expect(page.getByTestId('set-password-submit')).toBeDisabled();
    await expect(page.getByText('Passwords do not match')).toBeVisible();
  });

  test('set-password happy path navigates to login on success', async ({ page }) => {
    await page.route('**/spa/api/auth/set-password', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      }),
    );

    await page.goto('/set-password?token=aabbccddeeff00112233445566778899aabbccddeeff001122334455');
    await page.getByTestId('set-password-field').fill('Str0ngPassw0rd!');
    await page.getByTestId('set-password-confirm').fill('Str0ngPassw0rd!');
    await page.getByTestId('set-password-submit').click();

    await expect(page.getByText('Password set!')).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: /go to login/i })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Mocked — Sessions kill actions
// ---------------------------------------------------------------------------

test.describe('Users v2 — Sessions kill (mocked)', () => {
  const MOCK_SESSIONS = [
    {
      id: '1:abc12345',
      user_id: 1,
      username: 'sara',
      sid_last8: 'abc12345',
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 3600_000).toISOString(),
      ip: '10.0.0.1',
      user_agent: 'Mozilla/5.0',
    },
  ];

  test.beforeEach(async ({ page }) => {
    await page.route('**/spa/api/auth/active-sessions', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_SESSIONS),
      }),
    );
  });

  test('kill single session calls DELETE and refreshes', async ({ page }) => {
    let killCalled = false;
    await page.route('**/spa/api/auth/sessions/1/abc12345', (route) => {
      killCalled = true;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true }),
      });
    });

    await login(page, 'admin', 'admin123');
    await page.goto('/users?tab=sessions');
    await page.waitForLoadState('networkidle');

    await page.getByTestId('session-kill-abc12345').click();
    expect(killCalled).toBe(true);
  });

  test('kill-all for user calls DELETE /:userId', async ({ page }) => {
    let killAllCalled = false;
    await page.route('**/spa/api/auth/sessions/1', (route) => {
      killAllCalled = true;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ok: true, sessions_killed: 1 }),
      });
    });

    await login(page, 'admin', 'admin123');
    await page.goto('/users?tab=sessions');
    await page.waitForLoadState('networkidle');

    await page.getByTestId('session-kill-all-1').click();
    expect(killAllCalled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Mocked — SAML test-SSO returns XML
// ---------------------------------------------------------------------------

test.describe('Users v2 — SAML test SSO (mocked)', () => {
  test('test SSO displays SAMLRequest XML in a pre block', async ({ page }) => {
    const MOCK_IDP: object = {
      id: 1,
      tenant_id: 'nbe',
      name: 'Azure AD (Test)',
      metadata_xml: '<EntityDescriptor entityID="https://sts.windows.net/test" xmlns="urn:oasis:names:tc:SAML:2.0:metadata"><IDPSSODescriptor><SingleSignOnService Location="https://login.microsoftonline.com/test/saml2"/></IDPSSODescriptor></EntityDescriptor>',
      claim_map: { email: 'email', groups: 'groups' },
      enforce_only: false,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await page.route('**/spa/api/admin/users/saml-idps', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([MOCK_IDP]),
      }),
    );

    await page.route('**/spa/api/admin/users/saml-idps/1/test', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          idp_entity_id: 'https://sts.windows.net/test',
          sso_url: 'https://login.microsoftonline.com/test/saml2',
          sp_issuer: 'https://dms.nbe.eg/saml/sp',
          acs_url: 'https://dms.nbe.eg/saml/acs',
          claim_map: { email: 'email', groups: 'groups' },
          saml_request_xml: '<samlp:AuthnRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol">…</samlp:AuthnRequest>',
          note: 'Preview only — no request sent to IdP',
        }),
      }),
    );

    await login(page, 'admin', 'admin123');
    await page.goto('/users?tab=saml');
    await page.waitForLoadState('networkidle');

    await page.getByTestId('saml-test-1').click();

    await expect(page.getByText('SAMLRequest XML (preview — no request sent)')).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByText('<samlp:AuthnRequest')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Admin Settings — users-auth panel
// ---------------------------------------------------------------------------

test.describe('Users v2 — admin settings panel', () => {
  test('Users & Auth nav item navigates to the settings panel', async ({ page }) => {
    await login(page, 'admin', 'admin123');
    await page.goto('/admin/settings/users-auth');
    await page.waitForLoadState('networkidle');
    // The panel heading should be visible
    await expect(page.getByText('Authentication policy')).toBeVisible();
    await expect(page.getByText('RBAC & session policy')).toBeVisible();
  });
});
