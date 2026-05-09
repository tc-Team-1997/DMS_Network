/**
 * offline-outbox.ts — IndexedDB outbox for offline upload queue (BHU-57).
 *
 * DB: "dms-offline", store: "outbox".
 *
 * Sensitive fields (customer_cid, doc_number, customer_name) inside
 * request_body are encrypted with AES-GCM before being written to
 * IndexedDB. The encryption key is derived fresh each session from the
 * session token + a per-user salt stored in sessionStorage (volatile,
 * NOT localStorage). Neither the raw session token nor the raw key ever
 * touches IndexedDB.
 *
 * File blobs are NOT encrypted — they are content-addressed by sha256
 * and integrity-protected at the transport layer.
 */

import { z } from 'zod';

// ── Constants ────────────────────────────────────────────────────────────────

const IDB_NAME = 'dms-offline';
const IDB_VERSION = 1;
const OUTBOX_STORE = 'outbox';

// ── Zod schemas ──────────────────────────────────────────────────────────────

/** Fields stored encrypted inside IndexedDB. */
export const SensitivePayloadSchema = z.object({
  customer_cid: z.string().nullable(),
  doc_number: z.string().nullable(),
  customer_name: z.string().nullable(),
});
export type SensitivePayload = z.infer<typeof SensitivePayloadSchema>;

/**
 * The full outbox entry as stored in IndexedDB.
 * `encrypted_payload` is a base64-encoded AES-GCM ciphertext.
 * `iv` is a base64-encoded 12-byte initialisation vector (per-entry).
 * `endpoint` + `enqueued_at` are non-sensitive and stored plaintext.
 */
export const OutboxEntrySchema = z.object({
  id: z.string().uuid(),
  idempotency_key: z.string().uuid(),
  endpoint: z.string(),
  /** AES-GCM encrypted JSON of SensitivePayload, base64-encoded. */
  encrypted_payload: z.string(),
  /** Base64-encoded 12-byte IV (per entry). */
  iv: z.string(),
  /** Non-sensitive metadata kept plaintext for SW replay. */
  request_body: z.object({
    original_name: z.string(),
    doc_type: z.string().nullable(),
    metadata_json: z.string().nullable(),
    notes: z.string().nullable(),
  }),
  enqueued_at: z.string().datetime(),
  retry_count: z.number().int().min(0).max(5),
});
export type OutboxEntry = z.infer<typeof OutboxEntrySchema>;

/**
 * The public "enqueue" shape accepted by callers.
 * Callers supply the raw sensitive fields; this module encrypts them.
 */
export const EnqueueInputSchema = z.object({
  id: z.string().uuid(),
  idempotency_key: z.string().uuid(),
  endpoint: z.string(),
  sensitive: SensitivePayloadSchema,
  request_body: z.object({
    original_name: z.string(),
    doc_type: z.string().nullable(),
    metadata_json: z.string().nullable(),
    notes: z.string().nullable(),
  }),
  enqueued_at: z.string().datetime(),
});
export type EnqueueInput = z.infer<typeof EnqueueInputSchema>;

// ── AES-GCM key derivation ───────────────────────────────────────────────────

const SALT_KEY = 'dms-offline-salt';
const PBKDF2_ITERATIONS = 200_000;
const KEY_USAGE: KeyUsage[] = ['encrypt', 'decrypt'];

/**
 * Retrieve or generate the per-user per-session AES-GCM salt.
 * Salt is stored in sessionStorage (clears on tab close / logout).
 * It is NOT a secret — it merely ensures two different users on the
 * same device have distinct derived keys.
 */
function getOrCreateSalt(): Uint8Array<ArrayBuffer> {
  const stored = sessionStorage.getItem(SALT_KEY);
  if (stored !== null) {
    const binary = atob(stored);
    const buf = new ArrayBuffer(binary.length);
    const view = new Uint8Array(buf);
    for (let i = 0; i < binary.length; i++) {
      view[i] = binary.charCodeAt(i);
    }
    return view;
  }
  const buf = new ArrayBuffer(16);
  const fresh = new Uint8Array(buf);
  crypto.getRandomValues(fresh);
  sessionStorage.setItem(SALT_KEY, btoa(String.fromCharCode(...fresh)));
  return fresh;
}

let _derivedKey: CryptoKey | null = null;

/**
 * Derive (or return cached) AES-GCM CryptoKey for this session.
 * Key is derived via PBKDF2 from `sessionToken` + salt.
 * The key is cached in module scope (cleared on page unload) —
 * it is NEVER written to storage.
 *
 * @param sessionToken — opaque session identifier from the auth store.
 */
async function getDerivedKey(sessionToken: string): Promise<CryptoKey> {
  if (_derivedKey !== null) return _derivedKey;

  const enc = new TextEncoder();
  const rawKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(sessionToken),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  const salt = getOrCreateSalt();

  const key = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    rawKey,
    { name: 'AES-GCM', length: 256 },
    false,
    KEY_USAGE,
  );

  _derivedKey = key;
  return key;
}

/** Clear the in-memory derived key (call on logout). */
export function clearDerivedKey(): void {
  _derivedKey = null;
  sessionStorage.removeItem(SALT_KEY);
}

// ── Crypto helpers ───────────────────────────────────────────────────────────

function bufferToBase64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function base64ToBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const buf = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    buf[i] = binary.charCodeAt(i);
  }
  return buf.buffer;
}

async function encryptPayload(
  payload: SensitivePayload,
  sessionToken: string,
): Promise<{ encrypted_payload: string; iv: string }> {
  const key = await getDerivedKey(sessionToken);
  const ivBuf = new ArrayBuffer(12);
  const iv = new Uint8Array(ivBuf);
  crypto.getRandomValues(iv);
  const enc = new TextEncoder();
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    enc.encode(JSON.stringify(payload)),
  );
  return {
    encrypted_payload: bufferToBase64(ciphertext),
    iv: bufferToBase64(ivBuf),
  };
}

export async function decryptPayload(
  encrypted_payload: string,
  iv: string,
  sessionToken: string,
): Promise<SensitivePayload> {
  const key = await getDerivedKey(sessionToken);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToBuffer(iv) },
    key,
    base64ToBuffer(encrypted_payload),
  );
  const dec = new TextDecoder();
  const parsed: unknown = JSON.parse(dec.decode(plaintext));
  return SensitivePayloadSchema.parse(parsed);
}

// ── IndexedDB helpers ────────────────────────────────────────────────────────

function openDb(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
        const store = db.createObjectStore(OUTBOX_STORE, { keyPath: 'id' });
        store.createIndex('by_queued_at', 'enqueued_at');
        store.createIndex('by_idempotency_key', 'idempotency_key', { unique: true });
      }
    };

    req.onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result);
    req.onerror = () => reject(req.error);
  });
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Enqueue an entry to the outbox. Encrypts sensitive fields before writing.
 *
 * @param input — validated EnqueueInput.
 * @param sessionToken — current session token used for key derivation.
 */
export async function enqueue(
  input: EnqueueInput,
  sessionToken: string,
): Promise<void> {
  const { encrypted_payload, iv } = await encryptPayload(input.sensitive, sessionToken);

  const entry: OutboxEntry = {
    id: input.id,
    idempotency_key: input.idempotency_key,
    endpoint: input.endpoint,
    encrypted_payload,
    iv,
    request_body: input.request_body,
    enqueued_at: input.enqueued_at,
    retry_count: 0,
  };

  // Validate before writing
  OutboxEntrySchema.parse(entry);

  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(OUTBOX_STORE, 'readwrite');
    const store = tx.objectStore(OUTBOX_STORE);
    const req = store.put(entry);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    tx.oncomplete = () => { db.close(); };
  });
}

/**
 * Return all entries from the outbox, ordered by enqueued_at ascending.
 */
export async function drain(): Promise<OutboxEntry[]> {
  const db = await openDb();
  return new Promise<OutboxEntry[]>((resolve, reject) => {
    const tx = db.transaction(OUTBOX_STORE, 'readonly');
    const store = tx.objectStore(OUTBOX_STORE);
    const index = store.index('by_queued_at');
    const results: OutboxEntry[] = [];
    const req = index.openCursor();

    req.onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
      if (!cursor) {
        resolve(results);
        db.close();
        return;
      }
      const parsed = OutboxEntrySchema.safeParse(cursor.value);
      if (parsed.success) results.push(parsed.data);
      cursor.continue();
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}

/**
 * Return the current count of queued entries.
 */
export async function count(): Promise<number> {
  const db = await openDb();
  return new Promise<number>((resolve, reject) => {
    const tx = db.transaction(OUTBOX_STORE, 'readonly');
    const store = tx.objectStore(OUTBOX_STORE);
    const req = store.count();
    req.onsuccess = () => {
      resolve(req.result);
      db.close();
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}

/**
 * Remove a single entry by idempotency key (after successful sync).
 */
export async function clear(idempotencyKey: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(OUTBOX_STORE, 'readwrite');
    const store = tx.objectStore(OUTBOX_STORE);
    const index = store.index('by_idempotency_key');
    const req = index.openCursor(IDBKeyRange.only(idempotencyKey));

    req.onsuccess = (e) => {
      const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
      if (!cursor) {
        resolve();
        db.close();
        return;
      }
      cursor.delete();
      resolve();
      db.close();
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}

/**
 * Remove ALL entries from the outbox (call on logout or after full drain).
 */
export async function clearAll(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(OUTBOX_STORE, 'readwrite');
    const store = tx.objectStore(OUTBOX_STORE);
    const req = store.clear();
    req.onsuccess = () => {
      resolve();
      db.close();
    };
    req.onerror = () => {
      db.close();
      reject(req.error);
    };
  });
}

/**
 * Check whether IndexedDB is available in this browser/context.
 */
export function isIndexedDbAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}
