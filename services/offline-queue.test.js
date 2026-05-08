/**
 * Unit tests for services/offline-queue.js — Req 58.
 *
 * Run with:  node --test services/offline-queue.test.js
 *
 * Uses node:test (Node 18+) and the in-process fallback store (no Redis
 * required).  The REDIS_URL env-var must NOT be set when running these tests.
 */
'use strict';

const { test, describe, before } = require('node:test');
const assert = require('node:assert/strict');

// Ensure we always exercise the in-process fallback.
delete process.env.REDIS_URL;

// session-store must be loaded AFTER unsetting REDIS_URL so it takes the
// MemoryStore branch.  Use a fresh require cycle.
const {
  enqueue,
  dequeue,
  size,
  peek,
  pushDeadLetter,
  getDeadLetterItems,
  recordSync,
  getSyncMeta,
} = require('./offline-queue');

const TENANT = 'test-tenant';

describe('offline-queue (in-process fallback)', () => {

  test('enqueue returns 1-based position', async () => {
    const pos1 = await enqueue({ file: { originalname: 'a.pdf' } }, TENANT);
    assert.equal(pos1, 1);
    const pos2 = await enqueue({ file: { originalname: 'b.pdf' } }, TENANT);
    assert.equal(pos2, 2);
  });

  test('size reflects queue depth', async () => {
    const s = await size(TENANT);
    assert.equal(s, 2);
  });

  test('peek returns items without consuming', async () => {
    const items = await peek(5, TENANT);
    assert.equal(items.length, 2);
    // size unchanged
    assert.equal(await size(TENANT), 2);
  });

  test('dequeue returns FIFO order', async () => {
    const first = await dequeue(TENANT);
    assert.equal(first.file.originalname, 'a.pdf');
    const second = await dequeue(TENANT);
    assert.equal(second.file.originalname, 'b.pdf');
  });

  test('dequeue on empty queue returns null', async () => {
    const result = await dequeue(TENANT);
    assert.equal(result, null);
  });

  test('size is 0 after draining', async () => {
    assert.equal(await size(TENANT), 0);
  });

  test('enqueue stamps _queued_at', async () => {
    await enqueue({ file: { originalname: 'c.pdf' } }, TENANT);
    const items = await peek(1, TENANT);
    assert.ok(items[0]._queued_at, '_queued_at should be set');
    // drain
    await dequeue(TENANT);
  });

  test('pushDeadLetter stores items retrievable via getDeadLetterItems', async () => {
    await pushDeadLetter({ file: { originalname: 'dead.pdf' }, _retry_count: 5 }, TENANT);
    const deadItems = await getDeadLetterItems(TENANT);
    assert.equal(deadItems.length, 1);
    assert.equal(deadItems[0].file.originalname, 'dead.pdf');
    assert.ok(deadItems[0]._dead_at, '_dead_at should be set');
  });

  test('recordSync + getSyncMeta round-trip', async () => {
    const now = new Date().toISOString();
    await recordSync({ last_sync_at: now, last_sync_result: 'drained=2 failed=0' }, TENANT);
    const meta = await getSyncMeta(TENANT);
    assert.equal(meta.last_sync_at, now);
    assert.equal(meta.last_sync_result, 'drained=2 failed=0');
  });

  test('items from different tenants are isolated', async () => {
    await enqueue({ file: { originalname: 'x.pdf' } }, 'tenant-A');
    await enqueue({ file: { originalname: 'y.pdf' } }, 'tenant-B');
    assert.equal(await size('tenant-A'), 1);
    assert.equal(await size('tenant-B'), 1);
    const a = await dequeue('tenant-A');
    assert.equal(a.file.originalname, 'x.pdf');
    // tenant-B unaffected
    assert.equal(await size('tenant-B'), 1);
    await dequeue('tenant-B'); // drain
  });

  test('retry_count is preserved on re-enqueue', async () => {
    const payload = { file: { originalname: 'retry.pdf' }, _retry_count: 3 };
    await enqueue(payload, TENANT);
    const item = await dequeue(TENANT);
    // The queue stamps _retry_count: 0 on the first enqueue if not present,
    // but here we supply 3 — confirm it is preserved.
    assert.equal(item._retry_count, 3);
  });

});
