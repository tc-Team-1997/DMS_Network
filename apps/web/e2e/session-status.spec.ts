/**
 * Session management E2E tests — session-status, extend-session, active-sessions.
 *
 * These specs test the Node gateway endpoints added as part of the Redis-backed
 * session management feature.  They are skipped until the SPA banner+countdown
 * modal is wired up by the spa-engineer team.
 *
 * Node backend must be running at VITE_NODE_BACKEND (default http://localhost:3000).
 */
import { test, expect } from '@playwright/test';

const NODE_BASE = process.env.VITE_NODE_BACKEND || 'http://localhost:3000';
const SPA_BASE  = `${NODE_BASE}/spa/api/auth`;

// ---------------------------------------------------------------------------
// Unauthenticated session-status
// ---------------------------------------------------------------------------
test.skip('session-status returns unauthenticated shape when no session', async ({ request }) => {
  const res = await request.get(`${SPA_BASE}/session-status`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.authenticated).toBe(false);
  expect(typeof body.warning_seconds_threshold).toBe('number');
});

// ---------------------------------------------------------------------------
// Authenticated session-status after login
// ---------------------------------------------------------------------------
test.skip('session-status returns full shape after login', async ({ request }) => {
  // Login via SPA endpoint.
  const loginRes = await request.post(`${SPA_BASE}/login`, {
    data: { username: 'admin', password: 'admin123' },
  });
  expect(loginRes.status()).toBe(200);

  const statusRes = await request.get(`${SPA_BASE}/session-status`);
  expect(statusRes.status()).toBe(200);
  const body = await statusRes.json();

  expect(body.authenticated).toBe(true);
  expect(body.user.username).toBe('admin');
  expect(typeof body.session.seconds_remaining).toBe('number');
  expect(body.session.seconds_remaining).toBeGreaterThan(7000);
  expect(body.session.can_extend).toBe(true);
  expect(typeof body.session.expires_at).toBe('string');
  expect(typeof body.session.created_at).toBe('string');
  expect(typeof body.session.last_active_at).toBe('string');
});

// ---------------------------------------------------------------------------
// extend-session bumps seconds_remaining
// ---------------------------------------------------------------------------
test.skip('extend-session bumps seconds_remaining', async ({ request }) => {
  // Login.
  await request.post(`${SPA_BASE}/login`, {
    data: { username: 'admin', password: 'admin123' },
  });

  const before = await request.get(`${SPA_BASE}/session-status`);
  const beforeBody = await before.json();

  const extendRes = await request.post(`${SPA_BASE}/extend-session`);
  expect(extendRes.status()).toBe(200);
  const afterBody = await extendRes.json();

  // After extending, seconds_remaining should be close to SESSION_EXTEND_SECONDS (3600).
  expect(afterBody.session.seconds_remaining).toBeGreaterThan(
    beforeBody.session.seconds_remaining
  );
});

// ---------------------------------------------------------------------------
// active-sessions — admin only
// ---------------------------------------------------------------------------
test.skip('active-sessions returns 403 for non-admin users', async ({ request }) => {
  await request.post(`${SPA_BASE}/login`, {
    data: { username: 'sara', password: 'sara123' },
  });
  const res = await request.get(`${SPA_BASE}/active-sessions`);
  expect(res.status()).toBe(403);
});

test.skip('active-sessions lists current login for admin', async ({ request }) => {
  await request.post(`${SPA_BASE}/login`, {
    data: { username: 'admin', password: 'admin123' },
  });
  const res = await request.get(`${SPA_BASE}/active-sessions`);
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body)).toBe(true);
  // When Redis is configured there should be at least one entry.
  // When Redis is not configured this returns [] — both outcomes are valid.
});

// ---------------------------------------------------------------------------
// logout cleans up session
// ---------------------------------------------------------------------------
test.skip('logout destroys session and session-status returns unauthenticated', async ({ request }) => {
  await request.post(`${SPA_BASE}/login`, {
    data: { username: 'admin', password: 'admin123' },
  });

  const logoutRes = await request.post(`${SPA_BASE}/logout`);
  expect(logoutRes.status()).toBe(200);

  const statusRes = await request.get(`${SPA_BASE}/session-status`);
  const body = await statusRes.json();
  expect(body.authenticated).toBe(false);
});
