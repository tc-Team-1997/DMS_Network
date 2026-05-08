'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../../db');
const { publicUser, requirePermJson } = require('./_shared');
const { redis: sessionRedis } = require('../../services/session-store');

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
    user: {
      id:        user.id,
      username:  user.username,
      role:      user.role,
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
  res.json({ user: req.session.user ?? null });
});

// ---------------------------------------------------------------------------
// GET /session-status  — PUBLIC (no requireAuth): SPA polls even after expiry
// ---------------------------------------------------------------------------
router.get('/session-status', async (req, res) => {
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

module.exports = router;
