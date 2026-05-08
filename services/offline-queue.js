/**
 * Offline queue — Redis-backed list of pending upload payloads.
 *
 * Redis keys (when REDIS_URL is set):
 *   dms:offline-queue:<tenantId>       — pending items (LPUSH / RPOP)
 *   dms:offline-queue-dead:<tenantId>  — dead-letter items (LPUSH)
 *   dms:offline-sync-meta:<tenantId>   — hash: last_sync_at, last_sync_result
 *
 * When REDIS_URL is not set the module falls back to an in-process Map of
 * arrays.  Items are lost on restart (dev-only behaviour).
 *
 * Public API:
 *   enqueue(payload, tenantId?)         → Promise<number>  queue position (1-based)
 *   dequeue(tenantId?)                  → Promise<object|null>
 *   size(tenantId?)                     → Promise<number>
 *   peek(n, tenantId?)                  → Promise<object[]>
 *   recordSync(meta, tenantId?)         → Promise<void>
 *   getSyncMeta(tenantId?)              → Promise<{last_sync_at, last_sync_result}>
 *   pushDeadLetter(payload, tenantId?)  → Promise<void>
 *   getDeadLetterItems(tenantId?)       → Promise<object[]>
 */
'use strict';

const { redis: sessionRedis } = require('./session-store');

// In-process fallback store (dev only, no-Redis path).
const _memQueues    = new Map(); // tenantId → Array<object>
const _memDead      = new Map(); // tenantId → Array<object>
const _memSyncMeta  = new Map(); // tenantId → {last_sync_at, last_sync_result}

function _memQueue(tenantId) {
  if (!_memQueues.has(tenantId)) _memQueues.set(tenantId, []);
  return _memQueues.get(tenantId);
}
function _memDeadQueue(tenantId) {
  if (!_memDead.has(tenantId)) _memDead.set(tenantId, []);
  return _memDead.get(tenantId);
}

function _queueKey(tenantId)    { return `dms:offline-queue:${tenantId}`; }
function _deadKey(tenantId)     { return `dms:offline-queue-dead:${tenantId}`; }
function _metaKey(tenantId)     { return `dms:offline-sync-meta:${tenantId}`; }

const useRedis = () => sessionRedis.isConnected();

/**
 * Push a payload onto the tail of the queue.
 * Returns the new depth (1-based position of the newly added item).
 */
async function enqueue(payload, tenantId = 'nbe') {
  const item = {
    ...payload,
    _queued_at: new Date().toISOString(),
    _retry_count: payload._retry_count ?? 0,
  };
  if (useRedis()) {
    const client = sessionRedis._client();
    // LPUSH so RPOP dequeues in FIFO order.
    await client.lpush(_queueKey(tenantId), JSON.stringify(item));
    return await client.llen(_queueKey(tenantId));
  }
  const q = _memQueue(tenantId);
  q.push(item);
  return q.length;
}

/**
 * Pop the oldest item from the front of the queue (FIFO).
 * Returns the parsed payload object, or null if empty.
 */
async function dequeue(tenantId = 'nbe') {
  if (useRedis()) {
    const client = sessionRedis._client();
    const raw = await client.rpop(_queueKey(tenantId));
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }
  const q = _memQueue(tenantId);
  return q.length ? q.shift() : null;
}

/**
 * Return the current depth of the queue without consuming items.
 */
async function size(tenantId = 'nbe') {
  if (useRedis()) {
    const client = sessionRedis._client();
    return await client.llen(_queueKey(tenantId));
  }
  return _memQueue(tenantId).length;
}

/**
 * Peek at the first n items without consuming them.
 */
async function peek(n = 5, tenantId = 'nbe') {
  if (useRedis()) {
    const client = sessionRedis._client();
    // Items are at the right (tail) end of the Redis list (RPOP pops from right).
    // LRANGE 0 (n-1) returns left-most items which were pushed last (newest).
    // To get oldest-first, use LRANGE -(n) -1.
    const raws = await client.lrange(_queueKey(tenantId), -n, -1);
    return raws.map(r => { try { return JSON.parse(r); } catch { return null; } }).filter(Boolean);
  }
  return _memQueue(tenantId).slice(0, n);
}

/**
 * Write sync metadata after a background sync pass.
 * @param {{ last_sync_at: string, last_sync_result: string }} meta
 */
async function recordSync(meta, tenantId = 'nbe') {
  if (useRedis()) {
    const client = sessionRedis._client();
    await client.hset(_metaKey(tenantId),
      'last_sync_at',     meta.last_sync_at || new Date().toISOString(),
      'last_sync_result', String(meta.last_sync_result ?? ''),
    );
    return;
  }
  _memSyncMeta.set(tenantId, {
    last_sync_at:     meta.last_sync_at || new Date().toISOString(),
    last_sync_result: String(meta.last_sync_result ?? ''),
  });
}

/**
 * Retrieve the last sync metadata.
 */
async function getSyncMeta(tenantId = 'nbe') {
  if (useRedis()) {
    const client = sessionRedis._client();
    const data = await client.hgetall(_metaKey(tenantId));
    return data || { last_sync_at: null, last_sync_result: null };
  }
  return _memSyncMeta.get(tenantId) || { last_sync_at: null, last_sync_result: null };
}

/**
 * Push an item that failed all retries to the dead-letter queue.
 */
async function pushDeadLetter(payload, tenantId = 'nbe') {
  const item = { ...payload, _dead_at: new Date().toISOString() };
  if (useRedis()) {
    const client = sessionRedis._client();
    await client.lpush(_deadKey(tenantId), JSON.stringify(item));
    return;
  }
  _memDeadQueue(tenantId).push(item);
}

/**
 * Return all items in the dead-letter queue (for admin review).
 */
async function getDeadLetterItems(tenantId = 'nbe') {
  if (useRedis()) {
    const client = sessionRedis._client();
    const raws = await client.lrange(_deadKey(tenantId), 0, -1);
    return raws.map(r => { try { return JSON.parse(r); } catch { return null; } }).filter(Boolean);
  }
  return [..._memDeadQueue(tenantId)];
}

module.exports = {
  enqueue,
  dequeue,
  size,
  peek,
  recordSync,
  getSyncMeta,
  pushDeadLetter,
  getDeadLetterItems,
};
