'use strict';
/**
 * Notification throttle — token-bucket per (channel, scope, id).
 *
 * Storage strategy:
 *   - When REDIS_URL is set: uses the ioredis client from services/session-store.js.
 *     Buckets are stored as Redis hashes with a TTL of 60 s.
 *     Multi-replica safe.
 *   - When Redis is not configured: in-process Map with monotonic clock.
 *     NOTE: in-process throttle is NOT shared across Node replicas.
 *     Set REDIS_URL for multi-replica deployments.
 *
 * Token-bucket algorithm:
 *   Each bucket has a `tokens` count and a `last_refill` timestamp.
 *   On check:
 *     1. Compute time elapsed since last_refill.
 *     2. Add elapsed * (rate / 60) tokens (capped at burst).
 *     3. If tokens >= 1: consume 1, allow.
 *     4. Else: deny, return retryAfter = ceil(1 / (rate / 60)) seconds.
 *
 * Config shape expected from tenant_config 'notifications' namespace:
 *   <channel>.throttle.per_user_per_minute   integer
 *   <channel>.throttle.per_tenant_per_minute integer
 *   <channel>.throttle.burst                 integer
 */

const { redis } = require('./session-store');

// In-process fallback: Map<key, {tokens: number, lastRefill: number}>
const _inProcess = new Map();

/**
 * @typedef {object} ThrottleConfig
 * @property {number} perUserPerMinute
 * @property {number} perTenantPerMinute
 * @property {number} burst
 */

/**
 * @typedef {object} ThrottleResult
 * @property {boolean} allowed
 * @property {number|undefined} retryAfter  — seconds until a token is available (only when denied)
 */

/**
 * Check and consume one token for both the user-level and tenant-level bucket.
 * Both buckets must allow the send; if either is exhausted the call is denied.
 *
 * @param {string} channel  — 'email' | 'sms' | 'whatsapp' | 'in_app'
 * @param {number|string} userId
 * @param {string} tenantId
 * @param {ThrottleConfig} config
 * @returns {Promise<ThrottleResult>}
 */
async function checkAndConsume(channel, userId, tenantId, config) {
  const { perUserPerMinute, perTenantPerMinute, burst } = config;
  const userKey   = `throttle:${channel}:user:${userId}`;
  const tenantKey = `throttle:${channel}:tenant:${tenantId}`;

  // Try user bucket first, then tenant bucket.
  // Both must pass — if user bucket is full, tenant is not consumed.
  const userResult   = await _consumeOne(userKey,   perUserPerMinute,   burst);
  if (!userResult.allowed) return userResult;
  const tenantResult = await _consumeOne(tenantKey, perTenantPerMinute, burst * 10);
  if (!tenantResult.allowed) {
    // Rollback the user token we already consumed (best-effort — we return one token).
    await _returnOne(userKey, perUserPerMinute, burst);
    return tenantResult;
  }
  return { allowed: true };
}

/**
 * Consume one token from the bucket identified by `key`.
 * Rate is tokens per minute; burst is max token ceiling.
 *
 * @param {string} key
 * @param {number} ratePerMinute
 * @param {number} burst
 * @returns {Promise<ThrottleResult>}
 */
async function _consumeOne(key, ratePerMinute, burst) {
  if (redis.isConnected()) {
    return _consumeRedis(key, ratePerMinute, burst);
  }
  return _consumeInProcess(key, ratePerMinute, burst);
}

/**
 * Return one token to the bucket (on rollback).
 *
 * @param {string} key
 * @param {number} ratePerMinute
 * @param {number} burst
 */
async function _returnOne(key, ratePerMinute, burst) {
  if (redis.isConnected()) {
    try {
      const raw = await redis.hgetall(key);
      if (raw) {
        const tokens = Math.min(parseFloat(raw.tokens || '0') + 1, burst);
        await redis.hset(key, 'tokens', String(tokens));
      }
    } catch { /* best-effort */ }
    return;
  }
  const bucket = _inProcess.get(key);
  if (bucket) {
    bucket.tokens = Math.min(bucket.tokens + 1, burst);
  }
}

/**
 * Token-bucket consume via Redis hash.
 * Key structure: hash with fields 'tokens' (float) and 'last_refill' (unix ms).
 */
async function _consumeRedis(key, ratePerMinute, burst) {
  try {
    const raw = await redis.hgetall(key);
    const now = Date.now();
    let tokens;
    let lastRefill;

    if (!raw || !raw.tokens) {
      tokens = burst;
      lastRefill = now;
    } else {
      tokens = parseFloat(raw.tokens);
      lastRefill = parseInt(raw.last_refill, 10) || now;
      const elapsedMs = now - lastRefill;
      const refill = (elapsedMs / 60_000) * ratePerMinute;
      tokens = Math.min(tokens + refill, burst);
      lastRefill = now;
    }

    if (tokens >= 1) {
      tokens -= 1;
      await redis.hset(key, 'tokens', String(tokens));
      await redis.hset(key, 'last_refill', String(lastRefill));
      await redis.expire(key, 120); // auto-expire stale buckets after 2 min
      return { allowed: true };
    }

    // Denied — compute retry-after
    const retryAfter = Math.ceil(60 / ratePerMinute);
    return { allowed: false, retryAfter };
  } catch (err) {
    // Redis error: fail open to avoid blocking notifications entirely.
    console.warn('[notification-throttle] Redis error, failing open:', err.message);
    return { allowed: true };
  }
}

/**
 * Token-bucket consume via in-process Map.
 */
function _consumeInProcess(key, ratePerMinute, burst) {
  const now = Date.now();
  let bucket = _inProcess.get(key);

  if (!bucket) {
    bucket = { tokens: burst, lastRefill: now };
    _inProcess.set(key, bucket);
  } else {
    const elapsedMs = now - bucket.lastRefill;
    const refill = (elapsedMs / 60_000) * ratePerMinute;
    bucket.tokens = Math.min(bucket.tokens + refill, burst);
    bucket.lastRefill = now;
  }

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return Promise.resolve({ allowed: true });
  }

  const retryAfter = Math.ceil(60 / ratePerMinute);
  return Promise.resolve({ allowed: false, retryAfter });
}

// Periodically evict stale in-process buckets (> 5 min old) to prevent unbounded growth.
setInterval(() => {
  const cutoff = Date.now() - 5 * 60_000;
  for (const [k, b] of _inProcess) {
    if (b.lastRefill < cutoff) _inProcess.delete(k);
  }
}, 5 * 60_000).unref();

module.exports = { checkAndConsume };
