# ADR 0005 — Face-Match KYC: Encoding-Only Storage

**Date:** 2026-05-09  
**Status:** Accepted  
**Date accepted:** 2026-05-09  
**Deciders:** Python Engineer, Security Team, Compliance  
**Related:** `docs/contracts/face-match-kyc.md` (BHU-9)

---

## Context

Bhutan F#9 mandates offline face-match KYC for branch officers to verify customer identity during onboarding. Storing raw facial images creates acute regulatory exposure: under-retention (images linger indefinitely), cross-tenant leakage (shared storage), and amplified breach blast radius (every image is PII under GDPR, CCPA, Bhutan DPA).

Current state: no biometric KYC capability. Branch officers manually compare printed IDs with live photos (error-prone, subjective).

---

## Decision

We store **only 128-dimensional face encodings** (from dlib face_recognition library) in the `biometric_encodings` table. Raw photos are:

1. **Processed in-memory only** — Loaded into RAM, passed to dlib for encoding extraction, deleted immediately after.
2. **Never persisted** — No temporary files, no cache files. Live photo SHA-256 is computed and discarded (not stored).
3. **Consent-scoped matching** — Every match requires a valid JWT consent token (issued after user reads and signs consent modal):
   - Token claims: `sub=cif`, `tenant=tenant_id`, exp = 30 minutes (TTL).
   - Signature verified on every match. If sub/tenant mismatch, fail with 403 (defense against cross-tenant audit-spoof).
4. **Configurable opt-in storage** — If `tenant_settings.keep_face_images=true` (non-default), raw photos stored with explicit DPIA and 90-day TTL. Default = false (photos not retained).
5. **Encoding retention** — 128-dim float32 vectors cached for 90 days (performance optimization for re-matching same customer). Auto-delete via cron.

**Alternatives considered:**

- **Raw-image retention with encryption** — Rejected. Encrypted at rest, but breach decrypts all images; marginal forensic value does not justify the risk.
- **Cloud Rekognition** — Rejected. PII egress violates local-first mandate; latency and cost not justified.
- **Federated on-device matching** — Rejected. Branch officers don't have GPUs; latency unacceptable.

---

## Consequences

### Positive
- **One-way encoding** — 128 floats cannot be inverted to reconstruct a face. Encodings are mathematical, not PII in the visual sense (though treated as sensitive PII by regulators).
- **Breach impact minimized** — Attacker with database access gets encodings (useless without the original dlib model) + consent tokens (time-limited). Raw images never at risk.
- **GDPR compliant** — Consent is explicit, scoped, time-limited. DSAR erasure is straightforward: soft-delete encodings, hard-delete after 7 days.
- **Default-safe configuration** — Raw images not retained unless explicitly opted in. Compliance-first posture.

### Operating Costs
- **No spoof/liveness detection in v1** — Cannot detect deepfakes, printed photos, or video replays. Mitigated by branch officer visual judgment + audit trail.
- **Demographic bias in dlib** — Known disparities in false-negative rates across genders/ethnicities. Documented in DPIA; v1.1 to add fairness evaluation.
- **Consent token rotation** — Every customer match requires a fresh consent token. UX burden on branch officers (mitigated by 30-minute token TTL allowing multiple matches within a session).
- **Dual auth schemes** — Consent tokens are JWT-scoped; API key auth is global. Both must be validated; complexity of two auth layers.

### Limitations (v1)
- **No real-time liveness** — Static images only; no face-movement detection.
- **Single face per image** — If photo has 2+ faces, API returns error. User must retake.
- **No multilingual face data** — Encodings are language-agnostic, but consent UI is English/Dzongkha only.

---

## Status

**Accepted** (2026-05-09). Implementation shipped: dlib face encodings with 90-day cache, JWT consent tokens with sub/tenant scoping, optional raw-image retention, 7-year audit trail retention.

---

## Related Decisions

- **ADR 0001 (AML screening)** — Biometric consent tokens use same JWT library as AML watchlist auth.
- **ADR 0003 (WORM retention)** — KYC documents matched via face can be placed under retention after approval.
- **Engineering Principles § Tenant Isolation** — Consent token claims include tenant_id; cross-tenant matches fail explicitly (not silently).
