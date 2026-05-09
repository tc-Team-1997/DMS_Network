# ADR 0006 — Offline Sync Queue Encryption

**Date:** 2026-05-09  
**Status:** Accepted  
**Date accepted:** 2026-05-09  
**Deciders:** SPA Engineer, Node Engineer, Security Team  
**Related:** `docs/contracts/offline-sync-queue.md` (BHU-57)

---

## Context

Bhutan F#57 — branch officers in low-connectivity regions need to capture documents offline and sync when reconnected. The IndexedDB outbox stores queued uploads (metadata + file blobs) on the device until reconnect. Sensitive fields (`customer_cid`, `doc_number`, `customer_name`) sit plaintext in browser storage, exposing them if:

- Device is physically compromised
- Browser storage is read via malware
- User is not logged out properly

Current state: offline capture queues data but provides no encryption at rest.

---

## Decision

We encrypt sensitive metadata fields in IndexedDB using **AES-GCM with PBKDF2 key derivation**:

1. **Key derivation** — PBKDF2 with 200,000 iterations (SHA-256) derives a key from:
   - Integer session user ID (guessable but salt-dependent)
   - Per-session random salt (stored in sessionStorage, cleared on tab close)
   - Result: 256-bit AES key

2. **Encryption scope** — Encrypt only PII-sensitive fields:
   - `customer_cid`, `customer_name`, `doc_number` → encrypted in IndexedDB
   - File blobs stay plaintext (content-addressed by SHA-256, integrity-protected by storage layer)
   - `original_name`, `doc_type` → encrypted (metadata leakage risk)

3. **Salt management** — Per-session salt:
   - Generated on app boot, stored in sessionStorage (not persistent)
   - Lost on tab close or logout (forces re-login, new salt)
   - Salt rotation per session bounds the blast radius of a single key compromise

4. **Failure modes**:
   - If sessionStorage is cleared mid-queue, decryption fails on sync. SPA shows "Session lost. Queued uploads require re-authentication." User logs in again (new salt).
   - If IndexedDB is corrupted, unencrypted blobs remain (no data loss, but metadata lost).

**Alternatives considered:**

- **Plaintext (no encryption)** — Rejected. Trivial PII leak.
- **Symmetric key from server** — Rejected. Offline client cannot reach server for key; defeats local-first mandate.
- **WebAuthn / FIDO key derivation** — Rejected. Too complex for v1; requires biometric or hardware token on every sync.
- **Password-derived key** — Rejected. UX hostile; branch officers re-prompted constantly during offline capture.

---

## Consequences

### Positive
- **Offline confidentiality** — Device theft doesn't immediately leak PII; attacker must brute-force PBKDF2.
- **Per-session isolation** — Each login session has a unique salt. Breach of one session's storage doesn't compromise future sessions.
- **No server dependency** — Client derives key locally; no network round-trip needed.
- **Acceptable UX** — Zero re-prompting during offline capture; decryption is transparent on reconnect.

### Operating Costs
- **Brute-force resistance depends on salt entropy** — If attacker has read access to IndexedDB, they see the ciphertext. With 200k PBKDF2 iterations, breaking one key takes ~3 seconds on a laptop (acceptable given salt + user_id entropy). For stronger guarantees, v1.1 planned to replace integer user_id with a server-issued short-lived token (raises the floor to sub-second attacks).
- **sessionStorage is not encrypted** — Salt is visible to browser devtools. Assumes device XSS/malware is out of scope (browser security responsibility).
- **Re-login clears queue** — If session expires during offline phase, user must re-login, generating a new salt. Queued uploads are orphaned (not lost, but unrecoverable without manual DB edit).

### Limitations (v1)
- **Single device per user** — Salt is device-local. If user switches devices, each device has its own salt (no cross-device sync).
- **No backup/recovery** — If sessionStorage is lost, queued uploads are unrecoverable without the original salt.
- **File blobs unencrypted** — Documents themselves are plaintext in IndexedDB. If confidentiality is needed beyond metadata, store layer must encrypt (future: add IndexedDB blob encryption).

---

## Status

**Accepted** (2026-05-09). Implementation shipped: PBKDF2 key derivation (200k iterations), AES-GCM encryption for sensitive fields, per-session salt in sessionStorage.

---

## Related Decisions

- **ADR 0002 (Temenos CBS adapter)** — Offline queues carry idempotency keys; the adapter's dedup logic applies equally to encrypted and plaintext metadata.
- **ADR 0001 (AML screening)** — Offline metadata (customer_cid) is encrypted before queueing; AML screening is deferred to online phase when decrypted payload is sent.
- **Engineering Principles § Encryption** — This complements storage-layer AES-256; both together form defense in depth.
