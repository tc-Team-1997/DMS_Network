/**
 * Session store factory.
 *
 * When REDIS_URL is set: returns a connect-redis store backed by ioredis,
 * prefix "dms:sess:".  Also exports the raw ioredis client so other modules
 * (e.g. per-user session tracking in routes/spa-api/auth.js) can write keys
 * directly.
 *
 * When REDIS_URL is not set: logs a one-time warning and returns the default
 * MemoryStore so local dev without Redis continues to work.
 */
'use strict';

const session = require('express-session');
const { RedisStore } = require('connect-redis');

let _redis = null;  // ioredis client, or null when Redis is not configured

function createSessionStore() {
  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl) {
    console.warn(
      '[session-store] REDIS_URL not set — using in-process MemoryStore. ' +
      'Sessions will be lost on restart. Set REDIS_URL for durable sessions.'
    );
    // express-session's default MemoryStore — sufficient for local dev.
    return undefined; // express-session defaults to MemoryStore when store is not set
  }

  try {
    const Redis = require('ioredis');
    _redis = new Redis(redisUrl, {
      keyPrefix: 'dms:sess:',
      lazyConnect: false,
      enableOfflineQueue: true,
      maxRetriesPerRequest: 3,
    });

    _redis.on('connect', () => console.log('[session-store] Connected to Redis'));
    _redis.on('error', (err) => console.error('[session-store] Redis error:', err.message));

    const store = new RedisStore({
      client: _redis,
      prefix: 'dms:sess:',
    });

    console.log(`[session-store] Redis session store initialised (${redisUrl})`);
    return store;
  } catch (err) {
    console.error('[session-store] Failed to create Redis store:', err.message);
    console.warn('[session-store] Falling back to MemoryStore.');
    _redis = null;
    return undefined;
  }
}

/**
 * Thin wrapper: if Redis is not configured, all calls are no-ops that resolve
 * immediately.  Callers never need to check for null themselves.
 */
const redis = {
  /**
   * Proxy to ioredis.  Any method call (hset, expire, set, hdel, del, hgetall,
   * hget) on this object either delegates to the real client or resolves null.
   */
  _client() { return _redis; },

  async hset(key, field, value) {
    if (!_redis) return null;
    return _redis.hset(key, field, value);
  },

  async expire(key, seconds) {
    if (!_redis) return null;
    return _redis.expire(key, seconds);
  },

  async set(key, value, exMode, exSeconds) {
    if (!_redis) return null;
    if (exMode && exSeconds != null) {
      return _redis.set(key, value, exMode, exSeconds);
    }
    return _redis.set(key, value);
  },

  async hdel(key, field) {
    if (!_redis) return null;
    return _redis.hdel(key, field);
  },

  async del(key) {
    if (!_redis) return null;
    return _redis.del(key);
  },

  async hgetall(key) {
    if (!_redis) return null;
    return _redis.hgetall(key);
  },

  async hget(key, field) {
    if (!_redis) return null;
    return _redis.hget(key, field);
  },

  async keys(pattern) {
    if (!_redis) return [];
    return _redis.keys(pattern);
  },

  async get(key) {
    if (!_redis) return null;
    return _redis.get(key);
  },

  isConnected() {
    return _redis !== null;
  },
};

module.exports = { createSessionStore, redis };
