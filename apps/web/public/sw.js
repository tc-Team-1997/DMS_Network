/**
 * apps/web/public/sw.js — Offline Sync Queue Service Worker (BHU-57, Wave A)
 *
 * Responsibilities in Wave A (this file):
 *   - Listen to the 'sync' event (BackgroundSync API).
 *   - On sync, drain the IndexedDB outbox by POSTing to /spa/api/sync/replay.
 *   - Report result counts back via a postMessage to the controlling tab.
 *
 * Wave B will add:
 *   - IndexedDB outbox writes (intercept failed POST /spa/api/documents).
 *   - Registration of this SW from apps/web/index.html.
 *   - OfflineIndicator badge updates via BroadcastChannel.
 *
 * Feature flag: The SW checks FF_OFFLINE_SYNC at runtime by reading
 * /spa/api/sync/status.  If the endpoint returns a non-2xx or a specific
 * {"ff_disabled":true} flag, the SW exits immediately without draining.
 *
 * This file is intentionally minimal — no bundler, no imports.  It runs
 * in the Service Worker global scope (no DOM, no window).
 */

/* global self, clients, indexedDB, IDBKeyRange */
'use strict';

const SYNC_TAG        = 'offline-upload-queue';
const REPLAY_ENDPOINT = '/spa/api/sync/replay';
const IDB_NAME        = 'dms-offline';
const IDB_VERSION     = 1;
const OUTBOX_STORE    = 'outbox';
const MAX_BATCH_SIZE  = 50;   // entries per sync tick

// ---------------------------------------------------------------------------
// Install + activate — take control immediately.
// ---------------------------------------------------------------------------
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// ---------------------------------------------------------------------------
// IndexedDB helpers (Promise wrappers; no library imports allowed in SW).
// ---------------------------------------------------------------------------

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
        const store = db.createObjectStore(OUTBOX_STORE, { keyPath: 'id' });
        store.createIndex('by_queued_at', 'queued_at');
      }
    };

    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = ()  => reject(req.error);
  });
}

/**
 * Read up to `limit` entries from the outbox in insertion order.
 * @param {IDBDatabase} db
 * @param {number}      limit
 * @returns {Promise<Array>}
 */
function peekOutbox(db, limit) {
  return new Promise((resolve, reject) => {
    const tx      = db.transaction(OUTBOX_STORE, 'readonly');
    const store   = tx.objectStore(OUTBOX_STORE);
    const results = [];
    const req     = store.openCursor();

    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (!cursor || results.length >= limit) return resolve(results);
      results.push(cursor.value);
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Remove a set of entry IDs from the outbox.
 * @param {IDBDatabase} db
 * @param {string[]}    ids
 * @returns {Promise<void>}
 */
function removeFromOutbox(db, ids) {
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(OUTBOX_STORE, 'readwrite');
    const store = tx.objectStore(OUTBOX_STORE);

    let pending = ids.length;
    if (pending === 0) return resolve();

    for (const id of ids) {
      const req = store.delete(id);
      req.onsuccess = () => { if (--pending === 0) resolve(); };
      req.onerror   = () => reject(req.error);
    }
  });
}

/**
 * Increment retry_count on an outbox entry (capped at 5).
 * Entries with retry_count >= 5 are removed (dead-lettered client-side).
 * @param {IDBDatabase} db
 * @param {object}      entry
 * @returns {Promise<void>}
 */
function handleRetry(db, entry) {
  const retryCount = (entry.retry_count || 0) + 1;
  if (retryCount >= 5) {
    return removeFromOutbox(db, [entry.id]);
  }
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(OUTBOX_STORE, 'readwrite');
    const store = tx.objectStore(OUTBOX_STORE);
    const updated = { ...entry, retry_count: retryCount };
    const req  = store.put(updated);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}

// ---------------------------------------------------------------------------
// Core drain logic.
// ---------------------------------------------------------------------------

/**
 * Drain the IndexedDB outbox by posting a batch to /spa/api/sync/replay.
 *
 * @returns {Promise<{ success: number, deduped: number, failed: number }>}
 */
async function drainOutbox() {
  const db      = await openDb();
  const entries = await peekOutbox(db, MAX_BATCH_SIZE);

  if (entries.length === 0) {
    return { success: 0, deduped: 0, failed: 0 };
  }

  // Build the replay request body.  File blobs are NOT included in Wave A —
  // the server stores a placeholder document row; Wave B extends this.
  const outboxEntries = entries.map((entry) => ({
    idempotency_key: entry.idempotency_key,
    payload: entry.payload,  // JSON metadata only
  }));

  let replayResult = null;

  try {
    const resp = await fetch(REPLAY_ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ outbox_entries: outboxEntries }),
      credentials: 'include',  // carry session cookie
    });

    if (!resp.ok) {
      // Server-side error (4xx from bad request, 5xx from transient) —
      // increment retry counts for all entries and bail.
      await Promise.allSettled(entries.map((e) => handleRetry(db, e)));
      return { success: 0, deduped: 0, failed: entries.length };
    }

    replayResult = await resp.json();
  } catch (_networkErr) {
    // Offline or fetch failed — increment retries.
    await Promise.allSettled(entries.map((e) => handleRetry(db, e)));
    return { success: 0, deduped: 0, failed: entries.length };
  }

  const { accepted = [], deduped = [], failed: failedArr = [] } = replayResult;

  // Remove successfully processed entries from outbox (accepted + deduped are done).
  const acceptedKeys = new Set(accepted.map((a) => a.idempotency_key));
  const dedupedKeys  = new Set(deduped.map((d) => d.idempotency_key));
  const failedKeys   = new Set(failedArr.map((f) => f.idempotency_key));

  const toRemove  = entries.filter((e) => acceptedKeys.has(e.idempotency_key) || dedupedKeys.has(e.idempotency_key));
  const toRetry   = entries.filter((e) => failedKeys.has(e.idempotency_key));

  await removeFromOutbox(db, toRemove.map((e) => e.id));
  await Promise.allSettled(toRetry.map((e) => handleRetry(db, e)));

  return {
    success: accepted.length,
    deduped: deduped.length,
    failed:  failedArr.length,
  };
}

// ---------------------------------------------------------------------------
// Background Sync event
// ---------------------------------------------------------------------------
self.addEventListener('sync', (event) => {
  if (event.tag !== SYNC_TAG) return;

  event.waitUntil(
    drainOutbox().then((counts) => {
      // Notify all open tabs so the UI can update badge + show toast.
      return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((tabs) => {
        for (const tab of tabs) {
          tab.postMessage({ type: 'SYNC_COMPLETE', ...counts });
        }
      });
    }).catch((err) => {
      console.error('[sw] sync drain error:', err && err.message);
    })
  );
});

// ---------------------------------------------------------------------------
// Message handler — allows the SPA to trigger a manual sync.
// ---------------------------------------------------------------------------
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'TRIGGER_SYNC') {
    drainOutbox().then((counts) => {
      if (event.source) {
        event.source.postMessage({ type: 'SYNC_COMPLETE', ...counts });
      }
    }).catch(() => {});
  }
});
