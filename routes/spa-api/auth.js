'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../../db');
const { publicUser, requirePermJson } = require('./_shared');
const { redis: sessionRedis } = require('../../services/session-store');
// Tenant loaders — attached as named properties on the tenant-public router so
// we reuse the module-level cache without a second DB hit for the default row.
const { loadTenant } = require('./tenant-public');
const { getNamespace } = require('../../db/tenant-config');

const router = express.Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function writeAudit({ userId, action, entity, entityId, details, tenantId }) {
  db.prepare(
    `INSERT INTO audit_log (user_id, action, entity, entity_id, details, tenant_id)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    userId,
    action,
    entity ?? 'user',
    entityId ?? null,
    typeof details === 'string' ? details : JSON.stringify(details ?? null),
    tenantId ?? 'nbe'
  );
}

/**
 * Write per-user session tracking keys to Redis.
 * No-op when Redis is not configured.
 */
async function writeSessionMeta(req, userId, ttlSeconds) {
  const sid = req.sessionID;
  if (!sid) return;
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  const now = new Date().toISOString();
  const meta = JSON.stringify({
    userId,
    createdAt: now,
    ip: req.ip,
    userAgent: req.headers['user-agent'] || '',
    last_active_at: now,
  });
  await Promise.all([
    sessionRedis.hset(`dms:user-sessions:${userId}`, sid, expiresAt),
    sessionRedis.expire(`dms:user-sessions:${userId}`, ttlSeconds + 300),
    sessionRedis.set(`dms:session-meta:${sid}`, meta, 'EX', ttlSeconds + 300),
  ]).catch(() => {});
}

/**
 * Read the cached session-meta object from Redis (or return null).
 */
async function readSessionMeta(sid) {
  try {
    const raw = await sessionRedis.get(`dms:session-meta:${sid}`);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Build the session-status response payload.
 * When `skipMetaUpdate` is true, last_active_at is NOT refreshed (polling).
 */
async function buildSessionStatus(req) {
  const { sessionConfig } = req.app.locals;
  const warningThreshold = sessionConfig ? sessionConfig.warning : 1800;

  if (!req.session || !req.session.user) {
    return { authenticated: false, warning_seconds_threshold: warningThreshold };
  }

  const user = req.session.user;
  const sid = req.sessionID;

  // Derive expires_at from the cookie. express-session stores _expires internally.
  const cookieExpires =
    req.session.cookie.expires ||
    req.session.cookie._expires ||
    new Date(Date.now() + (req.session.cookie.maxAge || 0));
  const expiresAt = cookieExpires instanceof Date ? cookieExpires : new Date(cookieExpires);
  const secondsRemaining = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));

  // Fetch metadata from Redis (created_at, last_active_at) — fall back to now.
  const meta = await readSessionMeta(sid);
  const createdAt    = meta?.createdAt    || new Date().toISOString();
  const lastActiveAt = meta?.last_active_at || new Date().toISOString();

  return {
    authenticated: true,
    // Flat aliases used by the SPA's auth polling.
    valid:     true,
    expiresAt: expiresAt.toISOString(),
    user: {
      id:        user.id,
      username:  user.username,
      role:      user.role,
      fullName:  user.full_name || null,
      full_name: user.full_name || null,
      branch:    user.branch || null,
      tenant_id: user.tenant_id || 'nbe',
    },
    session: {
      id:                sid ? sid.slice(-8) : 'n/a',
      created_at:        createdAt,
      expires_at:        expiresAt.toISOString(),
      seconds_remaining: secondsRemaining,
      last_active_at:    lastActiveAt,
      can_extend:        true,
      warning_threshold: warningThreshold,
    },
  };
}

// ---------------------------------------------------------------------------
// POST /login
// ---------------------------------------------------------------------------
router.post('/login', (req, res) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'invalid_body' });
  }
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  if (user.status === 'Locked') {
    return res.status(403).json({ error: 'account_locked' });
  }
  // MFA is enforced on the EJS /login path; SPA deliberately skips it for now.
  req.session.user = publicUser(user);
  db.prepare('INSERT INTO audit_log (user_id, action, entity) VALUES (?, ?, ?)')
    .run(user.id, 'SPA_LOGIN', 'user');

  // Write Redis tracking keys (fire-and-forget).
  const ttl = (req.app.locals.sessionConfig || {}).ttl || 7200;
  req.session.save(() => {
    writeSessionMeta(req, user.id, ttl).catch(() => {});
  });

  res.json({ ok: true, user: req.session.user });
});

// ---------------------------------------------------------------------------
// POST /logout
// ---------------------------------------------------------------------------
router.post('/logout', (req, res) => {
  const sid    = req.sessionID;
  const userId = req.session?.user?.id;

  if (sid && userId) {
    writeAudit({ userId, action: 'logout', entity: 'user', entityId: userId });
    sessionRedis.hdel(`dms:user-sessions:${userId}`, sid).catch(() => {});
    sessionRedis.del(`dms:session-meta:${sid}`).catch(() => {});
  }

  req.session.destroy(() => res.json({ ok: true }));
});

// ---------------------------------------------------------------------------
// GET /me
// ---------------------------------------------------------------------------
router.get('/me', (req, res) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'unauthenticated' });
  }
  const u = req.session.user;
  const tenantId = u.tenant_id || 'nbe';

  // Resolve the tenant row for this user. Falls back to the default active
  // tenant when tenant_id is absent or doesn't match any row.
  let tenant = loadTenant(tenantId);

  // CC7 fix: merge tenant_config branding overrides on top of the base tenant row.
  // This ensures that changes made via Settings → Branding panel reach the SPA
  // without requiring a server restart.
  if (tenant) {
    const brandingOverrides = getNamespace(tenant.tenant_id, 'branding') || {};
    tenant = { ...tenant, ...brandingOverrides };
  }

  // available_tenants: the users table has a single tenant_id column with no
  // many-to-many join table yet. Return only the current tenant.
  // TODO Wave B Users-v2: replace with a real user_tenants query.
  const available_tenants = tenant
    ? [{ tenant_id: tenant.tenant_id, slug: tenant.slug, display_name: tenant.display_name }]
    : [];

  const userPayload = {
    id:        u.id,
    username:  u.username,
    full_name: u.full_name || u.fullName || null,
    role:      u.role,
    branch:    u.branch || null,
    tenant_id: tenantId,
  };

  res.json({
    // New canonical shape consumed by the SPA tenant store.
    user:              userPayload,
    tenant:            tenant ?? null,
    available_tenants,
    // Legacy flat fields — kept for backward compat with older callers that
    // read top-level id/username/role/etc. directly from the /me response.
    id:        u.id,
    username:  u.username,
    role:      u.role,
    fullName:  u.full_name || u.fullName || null,
    full_name: u.full_name || u.fullName || null,
    branch:    u.branch || null,
    tenant_id: tenantId,
  });
});

// ---------------------------------------------------------------------------
// GET /session-status  — PUBLIC (no requireAuth): SPA polls even after expiry
// Also aliased as GET /status for SPA convenience.
// ---------------------------------------------------------------------------
router.get(['/session-status', '/status'], async (req, res) => {
  // Prevent this polling endpoint from bumping the rolling cookie TTL.
  // We do this by temporarily neutralising the rolling flag for this request.
  // express-session checks req.session._rollingDisabled (non-standard) before
  // deciding whether to re-save.  We use a simpler approach: reset the cookie
  // maxAge to what it already is so the save is a no-op from the browser's
  // perspective; the real guard is that we call session.save manually below
  // only for session-status — but since `rolling:true` will re-set the cookie
  // anyway, we mark a flag and intercept in the session `save` hook.
  //
  // Simplest portable approach: set req.session.rolling to false for this req.
  // express-session v1.18 does NOT expose a per-request rolling flag, so we
  // achieve the same result by not saving the session at all (saveUninitialized
  // is false and we won't modify anything in req.session here).
  try {
    const status = await buildSessionStatus(req);
    return res.json(status);
  } catch (err) {
    console.error('[auth] session-status error:', err);
    return res.status(500).json({ error: 'internal' });
  }
});

// ---------------------------------------------------------------------------
// POST /extend-session  — requires logged-in session
// ---------------------------------------------------------------------------
router.post('/extend-session', (req, res, next) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'unauthenticated' });
  }
  next();
}, async (req, res) => {
  const { sessionConfig } = req.app.locals;
  const extendSeconds = sessionConfig ? sessionConfig.extend : 3600;
  const ttlSeconds    = sessionConfig ? sessionConfig.ttl    : 7200;
  const userId = req.session.user.id;
  const sid    = req.sessionID;

  // Extend monotonically — never shrink. Take the larger of the current
  // remaining cookie lifetime and the configured extension window so a user
  // who still has 1h45m left never loses time by clicking "Extend".
  const remainingMs   = req.session.cookie.maxAge || 0;
  const nextMs        = Math.max(remainingMs, extendSeconds * 1000);
  req.session.cookie.maxAge = nextMs;

  // Update Redis meta + user-session hash to reflect new expiry.
  const newExpiresAt = new Date(Date.now() + nextMs).toISOString();
  const newTtlBuffer = Math.ceil(nextMs / 1000) + 300;

  await Promise.all([
    sessionRedis.hset(`dms:user-sessions:${userId}`, sid, newExpiresAt),
    sessionRedis.expire(`dms:user-sessions:${userId}`, newTtlBuffer),
    sessionRedis.expire(`dms:session-meta:${sid}`, newTtlBuffer),
  ]).catch(() => {});

  // Persist the bumped cookie to the store.
  req.session.save(async (err) => {
    if (err) {
      console.error('[auth] extend-session save error:', err);
      return res.status(500).json({ error: 'save_failed' });
    }

    writeAudit({
      userId,
      action:   'session_extend',
      entity:   'user',
      entityId: userId,
      details:  JSON.stringify({ extended_by_seconds: extendSeconds }),
    });

    try {
      const status = await buildSessionStatus(req);
      res.json(status);
    } catch (e) {
      res.status(500).json({ error: 'internal' });
    }
  });
});

// ---------------------------------------------------------------------------
// GET /active-sessions  — admin only
// ---------------------------------------------------------------------------
router.get('/active-sessions', (req, res, next) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'unauthenticated' });
  }
  next();
}, requirePermJson('admin'), async (req, res) => {
  if (!sessionRedis.isConnected()) {
    // Redis not configured: return empty list (graceful degradation).
    return res.json([]);
  }

  try {
    // Find all user-session hashes: dms:user-sessions:*
    // Note: connect-redis uses the prefix "dms:sess:" on the ioredis client, but
    // our tracking keys are written directly without prefix — so we use the raw
    // ioredis client from session-store.
    const keys = await sessionRedis.keys('dms:user-sessions:*');
    const results = [];

    for (const key of keys) {
      const sessions = await sessionRedis.hgetall(key);
      if (!sessions) continue;

      // Extract userId from key: "dms:user-sessions:<userId>"
      const userId = key.replace('dms:user-sessions:', '');
      const userRow = db.prepare('SELECT username FROM users WHERE id = ?').get(userId);

      for (const [sid, expiresAt] of Object.entries(sessions)) {
        const meta = await readSessionMeta(sid);
        results.push({
          user_id:      parseInt(userId, 10),
          username:     userRow ? userRow.username : 'unknown',
          sid_last8:    sid.slice(-8),
          created_at:   meta?.createdAt    || null,
          expires_at:   expiresAt,
          ip:           meta?.ip            || null,
          user_agent:   meta?.userAgent     || null,
        });
      }
    }

    res.json(results);
  } catch (err) {
    console.error('[auth] active-sessions error:', err);
    res.status(500).json({ error: 'internal' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /auth/sessions/:userId/:sid  — kill one session (admin only)
// ---------------------------------------------------------------------------
router.delete('/auth/sessions/:userId/:sid', requirePermJson('admin'), async (req, res) => {
  const targetUserId = parseInt(req.params.userId, 10);
  const targetSid    = req.params.sid;

  if (!sessionRedis.isConnected()) {
    return res.status(503).json({ error: 'session_store_unavailable' });
  }

  try {
    await Promise.all([
      sessionRedis.hdel(`dms:user-sessions:${targetUserId}`, targetSid),
      sessionRedis.del(`dms:session-meta:${targetSid}`),
      sessionRedis.del(`dms:sess:${targetSid}`),
    ]);

    writeAudit({
      userId:   req.session.user.id,
      action:   'SESSION_KILL',
      entity:   'user',
      entityId: targetUserId,
      details:  JSON.stringify({ sid_last8: targetSid.slice(-8) }),
      tenantId: req.session.user.tenant_id || 'nbe',
    });

    const { setConfig } = require('../../db/tenant-config');
    const tenant = req.session.user.tenant_id || 'nbe';
    try {
      setConfig(tenant, '_user_meta', 'last_kill_session_at', new Date().toISOString(), {
        actorUserId: req.session.user.id,
        reason: `Admin killed session for user ${targetUserId}`,
      });
    } catch (_) {}

    res.json({ ok: true });
  } catch (err) {
    console.error('[auth] kill-session error:', err);
    res.status(500).json({ error: 'internal' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /auth/sessions/:userId  — kill ALL sessions for a user (admin only)
// ---------------------------------------------------------------------------
router.delete('/auth/sessions/:userId', requirePermJson('admin'), async (req, res) => {
  const targetUserId = parseInt(req.params.userId, 10);

  if (!sessionRedis.isConnected()) {
    return res.status(503).json({ error: 'session_store_unavailable' });
  }

  try {
    const sessions = await sessionRedis.hgetall(`dms:user-sessions:${targetUserId}`);
    const sids = sessions ? Object.keys(sessions) : [];

    const delOps = [];
    for (const sid of sids) {
      delOps.push(sessionRedis.del(`dms:session-meta:${sid}`));
      delOps.push(sessionRedis.del(`dms:sess:${sid}`));
    }
    delOps.push(sessionRedis.del(`dms:user-sessions:${targetUserId}`));
    await Promise.all(delOps);

    writeAudit({
      userId:   req.session.user.id,
      action:   'SESSION_KILL_ALL',
      entity:   'user',
      entityId: targetUserId,
      details:  JSON.stringify({ sessions_killed: sids.length }),
      tenantId: req.session.user.tenant_id || 'nbe',
    });

    const { setConfig } = require('../../db/tenant-config');
    const tenant = req.session.user.tenant_id || 'nbe';
    try {
      setConfig(tenant, '_user_meta', 'last_kill_session_at', new Date().toISOString(), {
        actorUserId: req.session.user.id,
        reason: `Admin killed all sessions for user ${targetUserId} (${sids.length} sessions)`,
      });
    } catch (_) {}

    res.json({ ok: true, sessions_killed: sids.length });
  } catch (err) {
    console.error('[auth] kill-all-sessions error:', err);
    res.status(500).json({ error: 'internal' });
  }
});

// ---------------------------------------------------------------------------
// POST /auth/set-password  — anonymous (token-gated, no session required)
// Validates magic-link token and sets the user's first password.
// ---------------------------------------------------------------------------
router.post('/auth/set-password', async (req, res) => {
  const { token, password } = req.body ?? {};

  if (typeof token !== 'string' || token.length < 32) {
    return res.status(400).json({ error: 'invalid_token' });
  }
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'password_too_short', min: 8 });
  }

  const crypto    = require('crypto');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

  const invite = db.prepare(
    `SELECT * FROM user_invites
     WHERE token_hash = ? AND used_at IS NULL AND expires_at > datetime('now')`
  ).get(tokenHash);

  if (!invite) {
    const stale = db.prepare('SELECT used_at, expires_at FROM user_invites WHERE token_hash = ?').get(tokenHash);
    if (stale && stale.used_at) return res.status(409).json({ error: 'token_already_used' });
    if (stale)                  return res.status(410).json({ error: 'token_expired' });
    return res.status(404).json({ error: 'token_not_found' });
  }

  const { getConfig } = require('../../db/tenant-config');
  const tenant    = invite.tenant_id;
  const minLength = Number(getConfig(tenant, 'auth', 'password_min_length', 10));
  if (password.length < minLength) {
    return res.status(400).json({ error: 'password_too_short', min: minLength });
  }

  const bcrypt = require('bcryptjs');
  const hash   = bcrypt.hashSync(password, 12);
  const now    = new Date().toISOString();

  db.transaction(() => {
    db.prepare('UPDATE user_invites SET used_at = ? WHERE token_hash = ?').run(now, tokenHash);
    db.prepare('UPDATE users SET password = ? WHERE email = ? AND tenant_id = ?')
      .run(hash, invite.email, tenant);
  })();

  writeAudit({
    userId:   null,
    action:   'SET_PASSWORD',
    entity:   'user',
    entityId: null,
    details:  JSON.stringify({ email: invite.email, tenant_id: tenant }),
    tenantId: tenant,
  });

  res.json({ ok: true });
});

module.exports = router;
