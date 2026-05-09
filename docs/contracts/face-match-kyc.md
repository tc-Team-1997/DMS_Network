# Contract — Face Match KYC (biometric verification, fully offline)

> **Offline face verification matching customer ID photo vs. live capture using `face_recognition` (dlib-based).** No external APIs (replaces Amazon Rekognition). Closes Bhutan F#9.

## Header

| Field | Value |
| --- | --- |
| Feature | `face-match-kyc` |
| Spec ID | `BHU-9` |
| Owner | _assigned by team lead_ |
| Status | `shipped` |
| Risk class | `high` (PII — biometric data, requires DPIA, consent, retention policy, ADR) |
| Contract published | `2026-05-09` |
| Last updated | `2026-05-09` |
| Related ADR | `docs/adr/0010-biometric-data-handling.md` (required — covers consent, storage, erasure) |

---

## 1. Problem & user story

**Problem:** KYC onboarding requires branch officers to verify a customer's identity. Currently, officers manually compare a scanned national ID with a live photo; this is error-prone and subjective. Automated face matching reduces fraud risk and onboarding time.

**Why now:** Bhutan DMS mandate (F#9 — "Biometric KYC verification Q2 2026") + cost reduction (Amazon Rekognition charges per API call; offline library is free). NBLR (National Bank of Bhutan) regulation requires documented identity verification.

**Personas affected:**
- `Branch Officer (mobile)` — uses Expo app to scan national ID, take selfie, submit for onboarding. App shows match result + confidence.
- `Checker` — reviews match decision in DMS; can override if needed (audit-logged).
- `Doc Admin` — configures `face_match_threshold` per tenant (default 0.6 distance).
- `Auditor` — reviews biometric_match logs + consent records.

**Out of scope:**
- Liveness detection (e.g., detect if photo is a printout or video). Future work (requires additional model).
- Deepfake detection. Future work.
- Demographic bias analysis. Future work (requires evaluation dataset).
- Real-time stream matching. Only still images supported.
- Multi-face detection. If 2+ faces in image, API returns error.

---

## 2. Acceptance criteria

- **AC-1** — Given an ID photo and a live photo (both JPEG/PNG, ≤ 5MB each), when `POST /api/v1/face-match { id_photo, live_photo }`, the response contains `{ match: bool, distance: 0..1, confidence: 0..1, face_geometry_ok: bool }` within 2s p99.
- **AC-2** — Given a match distance (Euclidean distance between 128-dim encodings) ≤ tenant threshold (default 0.6), the response is `match=true`. Distance > threshold → `match=false`. Distance always returned (for manual override if needed).
- **AC-3** — Given images lacking proper face geometry (inter-eye distance < 20 pixels, head pose > 45°), the response is `{ match: false, distance: null, face_geometry_ok: false, detail: "poor_geometry: head_pose_42_degrees" }`. No encoding computed.
- **AC-4** — Given an ID photo, the face encoding is computed once and cached in `biometric_encodings` table for 90 days. If same ID photo (by SHA256) is used in subsequent matches, cached encoding is reused (≤ 50ms latency vs. ≤ 2s latency to recompute).
- **AC-5** — Given a match decision (true or false), audit entry is written: `biometric_match { doc_id, customer_cid, id_photo_sha256, live_photo_sha256, distance, match, threshold_used, decided_at }`. Live photo SHA and raw image are NOT stored (GDPR: don't retain facial images unless explicitly opted in).
- **AC-6** — Given `FF_FACE_MATCH_KYC=off`, the endpoint returns 501. When `FF_FACE_MATCH_KYC=on`, feature is active.
- **AC-7** — Every tenant has a `biometric_consent_required` flag. If true, API call must include `consent_token` (issued after user reads & signs consent). If consent token invalid or missing, return 403 "Biometric consent required".

---

## 3. End-to-end workflow

```
[Branch officer opens onboarding form on mobile (Expo)]
              │
              ├─ user selects "Scan National ID" → camera opens
              │
              ├─ officer captures ID photo (JPEG)
              │
              ├─ app requests ID_PHOTO_CAPTURE permission + consent modal appears:
              │   "This app will capture your face for identity verification.
              │    Your face data will be encrypted and deleted after verification."
              │
              ├─ user reads + taps "I Consent"
              │
              ├─ app requests consent_token from consent service
              │
              ├─ user selects "Take Selfie" → camera opens (front-facing)
              │
              ├─ officer takes live photo (JPEG)
              │
              ├─ app calls POST /api/v1/face-match { id_photo, live_photo, consent_token }
              │
              ▼
[Python routers/face_match.py]
              │
              ├─ validates tenant + consent_token (signature + expiry check)
              │
              ├─ if consent_token invalid → 403 "Biometric consent required"
              │
              ├─ validates photo MIME type (image/jpeg, image/png) + size (≤ 5 MB each)
              │
              ├─ calls await face_match_service.match_faces(id_photo_bytes, live_photo_bytes)
              │
              ▼
[FaceMatchService]
              │
              ├─ ID photo: compute SHA256, check cache
              │
              ├─ if cache hit: reuse encoding
              │
              ├─ if cache miss:
              │   ├─ run dlib face_recognition.face_encodings(image) → [encoding1]
              │   ├─ if len(encodings) != 1 → return {match: false, face_geometry_ok: false, detail: "id_photo_face_count_wrong"}
              │   ├─ extract face_geometry (eye distance, head pose)
              │   ├─ if head_pose > 45° or eye_distance < 20px → return {match: false, face_geometry_ok: false, ...}
              │   ├─ store { photo_sha256, encoding (128-dim float array), tenant_id, doc_id, created_at } in biometric_encodings
              │
              ├─ Live photo: same process (no cache for live photos — privacy-first)
              │
              ├─ Euclidean distance between two 128-dim vectors: distance(encoding1, encoding2)
              │
              ├─ read tenant.face_match_threshold (default 0.6)
              │
              ├─ match = (distance <= threshold)
              │
              ├─ confidence_estimate = 1.0 - (distance / 1.0) [normalized, capped 0..1]
              │
              ├─ audit_log entry: { action: "BIOMETRIC_MATCH", details: {cif, distance, match, threshold} }
              │
              ├─ write biometric_match row (for auditor review)
              │
              ├─ DELETE live_photo_sha256 encoding from cache (don't persist)
              │
              └─ return { match, distance, confidence, face_geometry_ok }
              │
              ▼
[Response 200]
{
  "match": true,
  "distance": 0.48,
  "confidence": 0.52,
  "face_geometry_ok": true,
  "decision_at": "2026-05-09T14:00:00Z"
}
              │
              ▼
[Mobile SPA]
              │
              ├─ if match=true → green checkmark, "Identity verified"
              │
              ├─ if match=false → red ✗, "Photos do not match. Try again."
              │
              ├─ show confidence bar (visual indicator of distance)
              │
              ├─ emit event: KYC_VERIFICATION_RESULT { match, customer_cid, consent_given_at }
              │
              └─ proceed to next onboarding step or retry
```

State machine (per customer):

```
onboarding_started
              │
              ├─ user grants consent
              │
              ▼
            kyc_pending
              │
              ├─ officer captures ID + selfie
              │
              ├─ calls face_match API
              │
              ▼
            face_matching (in-flight)
              │
              ├─ if match=true → kyc_verified
              │
              ├─ if match=false → kyc_retry_needed
              │
              ├─ if face_geometry_poor → kyc_photo_quality_issue
```

---

## 4. API contract — Python (`/api/v1/face-match/*`)

Owner: `python-engineer`. Files: `python-service/app/routers/face_match.py` + `python-service/app/services/face_match.py`.

| Method | Path | Auth | Idempotent | Purpose |
| --- | --- | --- | --- | --- |
| `POST` | `/api/v1/face-match` | `require_api_key` + JWT (mobile: no JWT required, use API key only) | Y (idempotency key) | Match ID photo vs. live photo |
| `GET` | `/api/v1/face-match/consent-template` | `require_api_key` | Y | Fetch biometric consent text + terms |
| `POST` | `/api/v1/face-match/consent-token` | `require_api_key` | Y | Issue consent token after user signature |
| `GET` | `/api/v1/face-match/{match_id}` | `require_api_key` + JWT(role≥auditor) | Y | Retrieve stored match decision (auditor only) |

### Request / response shapes

```jsonc
// POST /api/v1/face-match — request
{
  "id_photo": "file (multipart/form-data) — JPEG or PNG, ≤ 5 MB",
  "live_photo": "file (multipart/form-data) — JPEG or PNG, ≤ 5 MB",
  "consent_token": "string — JWT issued by /consent-token endpoint",
  "doc_id": "integer (optional — for audit linkage)"
}

// POST /api/v1/face-match — 200
{
  "match": true,
  "distance": 0.48,
  "confidence": 0.52,
  "face_geometry_ok": true,
  "id_photo_face_count": 1,
  "live_photo_face_count": 1,
  "decision_at": "2026-05-09T14:00:00Z",
  "idempotency_key": "abc123def456"
}

// POST /api/v1/face-match — 200 (poor geometry)
{
  "match": false,
  "distance": null,
  "confidence": null,
  "face_geometry_ok": false,
  "detail": "poor_geometry: head_pose_62_degrees > 45_threshold",
  "decision_at": "2026-05-09T14:00:00Z"
}

// POST /api/v1/face-match — 403 (consent required)
{
  "error": "consent_required",
  "message": "Biometric consent token required or expired"
}

// GET /api/v1/face-match/consent-template — 200
{
  "consent_text": "By proceeding, you consent to the capture and processing of your facial biometric data...",
  "tenant_id": "bhutan_nbe",
  "version": "1.0",
  "language": "en"
}

// POST /api/v1/face-match/consent-token — request
{
  "customer_cid": "CIF001",
  "signed_at": "2026-05-09T13:55:00Z",
  "signature": "base64-encoded-signature-or-approval-hash"
}

// POST /api/v1/face-match/consent-token — 201
{
  "consent_token": "eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...",
  "expires_at": "2026-05-09T14:25:00Z"
}

// GET /api/v1/face-match/{match_id} — 200 (auditor only)
{
  "id": 123,
  "customer_cid": "CIF001",
  "doc_id": 456,
  "match": true,
  "distance": 0.48,
  "confidence": 0.52,
  "face_geometry_ok": true,
  "id_photo_sha256": "abc123...",
  "live_photo_sha256": "def456...",
  "decided_at": "2026-05-09T14:00:00Z",
  "decided_by": "branch_officer_001"
}

// 4xx / 5xx error envelope
{
  "error": "consent_required | invalid_image | no_faces_detected | multiple_faces_detected | poor_geometry | image_too_large",
  "message": "human readable"
}
```

---

## 5. API contract — Node / Mobile (`/api/v1/face-match/*` direct to Python)

Mobile (Expo) calls Python API directly (no Node proxy). Uses API key auth only (no session JWT).

For web SPA (future), Node proxy would be:

| Method | Path | Session auth | RBAC perm |
| --- | --- | --- | --- |
| `POST` | `/spa/api/face-match` | required | `kyc:write` |

---

## 6. SPA module (mobile only for now)

Owner: `spa-engineer`. Folder: `apps/mobile/src/modules/kyc/` (Expo).

### 6.1 Files
- `FaceMatchScreen.tsx` — ID + selfie capture + match result
- `api.ts` — fetch wrappers + error handling
- `schemas.ts` — zod types
- `components/PhotoCapture.tsx` — reusable camera component
- `components/MatchResult.tsx` — displays match/no-match + confidence
- `hooks/useConsent.ts` — manages consent modal + token issuance
- `types/face.ts` — TypeScript types for biometric data

### 6.2 Schemas

```ts
import { z } from "zod";

export const FaceMatchResult = z.object({
  match: z.boolean(),
  distance: z.number().min(0).max(1).nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  face_geometry_ok: z.boolean(),
  detail: z.string().optional(),
  decision_at: z.string().datetime(),
});
export type FaceMatchResult = z.infer<typeof FaceMatchResult>;

export const ConsentTemplate = z.object({
  consent_text: z.string(),
  tenant_id: z.string(),
  version: z.string(),
  language: z.string(),
});
export type ConsentTemplate = z.infer<typeof ConsentTemplate>;

export const ConsentToken = z.object({
  consent_token: z.string(),
  expires_at: z.string().datetime(),
});
export type ConsentToken = z.infer<typeof ConsentToken>;
```

### 6.3 UI flow

**FaceMatchScreen (mobile):**
1. User lands on KYC screen. "Start verification" button.
2. Click → ConsentModal appears with consent text + "I Understand & Consent" checkbox + "Continue" button.
3. User reads (scrollable), checks box, clicks Continue.
4. App calls `POST /api/v1/face-match/consent-token { customer_cif, signed_at }` → receives JWT token.
5. Camera opens (back camera). Instructions: "Hold ID document flat in frame. Align face with corners." Shutter button.
6. Photo captured → preview shown. "Retake" or "Next" button.
7. Camera switches to front (selfie). Instructions: "Face the camera. Good lighting." Shutter button.
8. Photo captured → preview. "Retake" or "Match" button.
9. Click Match → loading spinner "Comparing photos…"
10. Response arrives → MatchResult screen:
    - If match=true: green checkmark, "Identity verified", progress bar to next step.
    - If match=false: red ✗, "Photos do not match. Please try again." "Retake" button to repeat from step 5.
    - If face_geometry_poor: yellow warning, "Photo quality issue: please ensure face is clearly visible and well-lit." "Retake" button.
11. User navigates to next KYC step (document upload) on match success.

### 6.4 Test IDs (for Playwright / Detox)

**Mobile (Expo — original):** `kyc-start-button`, `consent-modal`, `consent-checkbox`, `consent-continue-button`, `id-photo-capture-button`, `id-photo-retake-button`, `id-photo-next-button`, `selfie-capture-button`, `selfie-retake-button`, `selfie-match-button`, `match-result-success`, `match-result-failure`, `match-result-poor-geometry`, `confidence-bar`.

**Web SPA (`apps/web/src/modules/face-match/`) — added 2026-05-09:** `face-match-page`, `face-match-cid-input`, `face-match-id-slot`, `face-match-live-slot`, `face-match-id-preview`, `face-match-live-preview`, `face-match-submit`, `face-match-result-card`, `face-match-result-decision`, `face-match-result-confidence`, `face-match-quality-fail`, `consent-dialog`, `consent-accept-checkbox`, `consent-accept-button`.

---

## 7. Data model

Owner: `db-migrator`. Files: `db/schema.sql` (Node SQLite), `python-service/app/models.py` + Alembic revision.

### Node SQLite (db/schema.sql)

```sql
-- Biometric encodings cache (ID photos, face vectors, non-PII)
CREATE TABLE IF NOT EXISTS biometric_encodings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  photo_sha256 TEXT NOT NULL UNIQUE,
  photo_type TEXT NOT NULL,  -- 'id_photo' or 'live_photo'
  face_encoding BLOB NOT NULL,  -- 128-dim float array as binary (numpy pickle or msgpack)
  face_geometry JSON,  -- {eye_distance: pixels, head_pose: degrees, face_area: pixels}
  encoding_model TEXT NOT NULL DEFAULT 'face_recognition/dlib',
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT DEFAULT (datetime(datetime('now'), '+90 days'))
);
CREATE INDEX IF NOT EXISTS idx_biometric_encodings_tenant_sha256 
  ON biometric_encodings(tenant_id, photo_sha256);
CREATE INDEX IF NOT EXISTS idx_biometric_encodings_expires_at 
  ON biometric_encodings(expires_at);

-- Match decision log (audit trail, no raw images)
CREATE TABLE IF NOT EXISTS biometric_match (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  customer_cid TEXT NOT NULL,
  doc_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,
  id_photo_sha256 TEXT NOT NULL,
  live_photo_sha256 TEXT NOT NULL,
  distance REAL NOT NULL,
  confidence REAL NOT NULL,
  match_result BOOLEAN NOT NULL,
  face_geometry_ok BOOLEAN NOT NULL DEFAULT 1,
  threshold_used REAL NOT NULL,
  decided_at TEXT DEFAULT (datetime('now')),
  decided_by TEXT,
  decided_from TEXT,  -- 'mobile' or 'web'
  consent_token_id INTEGER REFERENCES biometric_consent(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_biometric_match_tenant_customer ON biometric_match(tenant_id, customer_cid);
CREATE INDEX IF NOT EXISTS idx_biometric_match_doc_id ON biometric_match(doc_id);
CREATE INDEX IF NOT EXISTS idx_biometric_match_decided_at ON biometric_match(decided_at);

-- Consent audit trail (GDPR compliance)
CREATE TABLE IF NOT EXISTS biometric_consent (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  customer_cid TEXT NOT NULL,
  consent_version TEXT NOT NULL,  -- e.g., "1.0"
  language TEXT NOT NULL DEFAULT 'en',
  given_at TEXT NOT NULL,
  signature_or_approval TEXT,  -- hash or token, not plaintext
  expires_at TEXT,  -- consent token TTL
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_biometric_consent_customer ON biometric_consent(customer_cid, given_at);
```

### Python SQLAlchemy (python-service/app/models.py)

```python
from sqlalchemy import Column, Integer, String, DateTime, Float, Boolean, LargeBinary, JSON, ForeignKey
from sqlalchemy.orm import declarative_base, relationship
from datetime import datetime, timedelta

Base = declarative_base()

class BiometricEncoding(Base):
    __tablename__ = "biometric_encodings"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(String(64), nullable=False, index=True)
    photo_sha256 = Column(String(64), nullable=False, unique=True, index=True)
    photo_type = Column(String(16), nullable=False)  # 'id_photo' or 'live_photo'
    face_encoding = Column(LargeBinary, nullable=False)  # 128-dim vector as bytes
    face_geometry = Column(JSON)  # {eye_distance, head_pose, face_area}
    encoding_model = Column(String(128), nullable=False, default="face_recognition/dlib")
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    expires_at = Column(DateTime, nullable=False, default=lambda: datetime.utcnow() + timedelta(days=90))

class BiometricMatch(Base):
    __tablename__ = "biometric_match"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(String(64), nullable=False, index=True)
    customer_cid = Column(String(64), nullable=False, index=True)
    doc_id = Column(Integer, ForeignKey("documents.id", ondelete="SET NULL"))
    id_photo_sha256 = Column(String(64), nullable=False)
    live_photo_sha256 = Column(String(64), nullable=False)
    distance = Column(Float, nullable=False)
    confidence = Column(Float, nullable=False)
    match_result = Column(Boolean, nullable=False)
    face_geometry_ok = Column(Boolean, nullable=False, default=True)
    threshold_used = Column(Float, nullable=False)
    decided_at = Column(DateTime, nullable=False, default=datetime.utcnow, index=True)
    decided_by = Column(String(128))
    decided_from = Column(String(16))  # 'mobile' or 'web'
    consent_token_id = Column(Integer, ForeignKey("biometric_consent.id", ondelete="SET NULL"))

class BiometricConsent(Base):
    __tablename__ = "biometric_consent"
    id = Column(Integer, primary_key=True)
    tenant_id = Column(String(64), nullable=False, index=True)
    customer_cid = Column(String(64), nullable=False, index=True)
    consent_version = Column(String(16), nullable=False)
    language = Column(String(2), nullable=False, default="en")
    given_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    signature_or_approval = Column(String(256))
    expires_at = Column(DateTime)
    revoked_at = Column(DateTime)

    matches = relationship("BiometricMatch", backref="consent")
```

**Tenant boundary:** Every query filters by `tenant_id` (Commandment #1).

**Encoding storage:** 128-dim float32 array (~512 bytes) serialized as binary (numpy.frombuffer or msgpack). Not compressed.

**Cache TTL:** 90 days. Cron job deletes expired rows daily.

**Consent audit:** Every biometric operation requires a valid `biometric_consent` row.

**Seed:** `db/seed.js` adds 1–2 pre-computed encodings for demo (sample ID + selfie).

---

## 8. Security & compliance

| Concern | Decision |
| --- | --- |
| RBAC | `kyc:write` required to call match API. `kyc:read` required for auditors to view match logs. Default deny. |
| ABAC (OPA) | Branch officer can only call face_match for customers in their branch. OPA rule: `kyc.face_match.allowed[tenant][branch]`. |
| Audit | Every match writes to `biometric_match` table + `audit_log` action `BIOMETRIC_MATCH_DECIDED`. Details logged: `{ customer_cif, distance, match_result, face_geometry_ok, threshold_used }`. No raw image data or encoding logged. |
| Encryption at rest | `biometric_encodings.face_encoding` (BLOB) encrypted by storage layer (AES-256). `biometric_consent` unencrypted (consent records are privacy-neutral). photo SHA256 fields are hashes, not reversible. |
| Encryption in transit | TLS 1.3 on all hops. Photos transmitted as multipart/form-data within TLS tunnel. |
| PII / DSAR | **High sensitivity:** Biometric data (face encodings + raw photos) are PII under GDPR, CCPA, and Bhutan law. **Erasure path:** On DSAR, soft-delete `biometric_encodings` rows (set `expires_at` to now, hard-delete after 7 days). Hard-delete `biometric_consent` row. Mark `biometric_match` rows as `requires_audit_review` (do not delete match records — keep for compliance history). **Retention:** Encodings 90 days max; consent records 7 years (regulatory); match logs 10 years (regulatory). |
| Retention | See above. Encoding table pruned daily by cron. No "indefinite" retention. |
| Input validation | Image size ≤ 5 MB, MIME type image/jpeg or image/png. Consent token validated: JWT signature + expiry check + not-revoked flag. Face count checked: must be exactly 1 (if 0 or 2+, reject). |
| OWASP top 10 | Injection (no user strings in SQL or commands), XSS (photos not displayed client-side except in preview, which is untrusted), CSRF (consent token acts as CSRF token), SSRF (n/a), broken auth (JWT + RBAC), insecure deserialisation (binary face encodings validated before unpickling), XXE (n/a), broken access control (RBAC + ABAC), security logging (biometric data never logged; only SHA256 and distance), dependency vulns (face_recognition pinned, scanned weekly). |
| Rate limit | Max 5 match calls per customer per day (DDoS prevention). Return 429 after limit. No per-IP rate limit (mobile users on same network). |
| Threat model delta | **New surface:** Raw facial images in memory (temporary, deleted after encoding). Facial encodings (128-dim vectors — not reversible to face, but are sensitive PII per GDPR). Consent tokens (JWT, but disclosed to client). **Attacks:** Image tampering (mitigated: SHA256 checksum), encoding poisoning (mitigated: model weights pinned, not user-uploaded), consent forgery (mitigated: JWT signature), timing attacks on distance (negligible risk). **Residual risk:** Poor photo quality could cause false negatives (requires branch officer override + audit trail). Demographic bias in dlib may cause disparities across ethnicities (noted in DPIA, remediation = multi-modal verification + human review). |

---

## 9. Performance & observability

### 9.1 Budget

| Layer | Budget |
| --- | --- |
| API p99 latency | `< 2 seconds` (dlib face detection + encoding is CPU-bound) |
| DB query cost | Encoding cache lookups by SHA256 are indexed; encoding retrieval ≤ 10ms. Match log writes are indexed by customer_cif. |
| SPA bundle delta | `< 12 KB gzipped` (mobile: PhotoCapture, MatchResult, ConsentModal) |
| Payload size | `< 2 MB` per request (images, multipart form-data) |
| Memory delta | dlib model ~200 MB in memory (singleton, shared). Per-request face encoding computation ~50 MB temporary. |

### 9.2 Observability contract

Each handler ships:

- **Trace** — span `kyc.face_match` with attributes `tenant_id`, `customer_cif`, `match_result`, `distance`, `latency_ms`
- **Metric (counter)** — `face_match_total{status="ok|error|poor_geometry", match="yes|no"}` (Prometheus)
- **Metric (histogram)** — `face_match_duration_seconds` (buckets: 100ms, 500ms, 1s, 2s)
- **Metric (gauge)** — `face_match_cache_hit_rate` (% of encoding cache hits)
- **Log** — structured line: `{ts, tenant_id, customer_cif, distance, match_result, face_geometry_ok, latency_ms, status}`
- **Audit log row** — for every match decision

Add Grafana dashboard row: "Face Match KYC" with panels:
- Match success rate (% match=true) over 24h.
- Distance distribution (histogram).
- Cache hit rate.
- `face_match_duration_seconds` p50/p95/p99.
- False positive / false negative rate (requires manual labeling feedback).

---

## 10. Accessibility & i18n

- **WCAG 2.1 AA** — PhotoCapture component is not traditional UI (camera view); accessibility is limited. Fallback: text instructions + audio cues (screen reader reads instructions). MatchResult screen keyboard-navigable; focus ring visible.
- **Screen reader** — Instructions read aloud before photo capture. MatchResult screen: "Identity verified" or "Photos do not match" announced. Confidence bar: `aria-label="Confidence 52 percent"`.
- **Reduced motion** — No animations on MatchResult. If `prefers-reduced-motion`, no loader spinners, just static "Processing…" text.
- **i18n** — All strings via `t()`: `t('kyc.consent_title')`, `t('kyc.take_id_photo')`, `t('kyc.match_success')`, `t('kyc.match_failure')`. Keys in `apps/mobile/src/i18n/{en,dz}.json`.
- **RTL** — MatchResult screen uses logical properties. Buttons positioned with `marginStart` / `marginEnd`.
- **Color contrast** — Green success (RGB 34, 197, 94) on white ≥ 4.5:1. Red failure (RGB 239, 68, 68) on white ≥ 4.5:1.

---

## 11. Error states & edge cases

| Case | Trigger | UX |
| --- | --- | --- |
| Consent not given | User skips consent modal, calls API directly | 403 "Biometric consent required. Please read and accept consent terms." |
| Consent expired | Consent token older than 30 min | 403 "Consent expired. Please re-read and accept consent." |
| No face in photo | Image has no detectible face (empty background, object photo) | 400 "No face detected in photo. Please ensure face is clearly visible." "Retake" button. |
| Multiple faces | Image has 2+ faces (e.g., selfie with someone else) | 400 "Multiple faces detected. Please ensure only your face is in the photo." "Retake" button. |
| Poor head pose | Face angle > 45° (profile, tilted back) | 200 response with `face_geometry_ok=false`, detail "head_pose_52_degrees > 45_threshold". UX shows yellow warning: "Please face the camera straight ahead." |
| Poor eye distance | Eyes too close (< 20 pixels apart — too far from camera) | 200 response with `face_geometry_ok=false`, detail "eye_distance_18_pixels < 20_threshold". Yellow warning: "Move closer to camera." |
| Poor lighting | Face very dark or overexposed (inferred from face area contrast) | 200 response with face_geometry_ok=false, detail "lighting_poor". Warning: "Ensure good lighting." |
| Image too large | Photo > 5 MB | 413 "Image too large (>5 MB). Please use a smaller file." |
| Image wrong format | PDF, TIFF, or other non-JPEG/PNG | 400 "Unsupported image format. Please use JPEG or PNG." |
| Network timeout | No internet / API unreachable | Error screen: "Network error. Please check your connection and try again." [Retry] button. |
| Rate limit exceeded | User called match 6 times in 1 day | 429 "Too many verification attempts. Please try again tomorrow." |
| Encoding cache miss with old threshold | Cached encoding computed with old threshold; threshold changed | Service re-computes with new threshold (no silent stale data). |
| Concurrent requests | Same customer calls match twice rapidly | Deduplicate: second request waits for first to complete, returns same result. |
| dlib model load failure | dlib / face_recognition import fails | 500 "Biometric service unavailable. Please try again later." Logs stack trace (no PII). |

---

## 12. Rollout & rollback

- **Feature flag** — `FF_FACE_MATCH_KYC` (env var or settings table). Default `off` for ≥ 2 releases (May–June 2026). When `off`, API returns 501; mobile UI hides face match button. When `on`, feature is active.
- **Stages** — (1) internal demo, (2) pilot with 1 branch (10 officers), (3) 10% of branches, (4) 100%. Promote on green: match success rate stable, false negative/positive rates acceptable, no privacy complaints.
- **Kill switch** — flip `FF_FACE_MATCH_KYC=off` → API disabled, mobile button hidden. No data loss. Biometric tables remain (audit trail).
- **Migration safety** — additive only: three new tables (biometric_encodings, biometric_match, biometric_consent). If rollback needed, tables remain benign.
- **Rollback steps** — (1) flip flag off, (2) revert deploy, (3) verify no 5xx in logs, (4) audit `biometric_match` entries to ensure no false positives were approved.

---

## 13. Test plan

| Layer | File | Owner | Coverage requirement |
| --- | --- | --- | --- |
| Unit (Python) | `python-service/tests/test_face_match_service.py` | `python-engineer` | Face encoding, distance calculation, geometry checks, cache hit/miss, consent validation |
| Unit (Python) | `python-service/tests/test_face_geometry.py` | `python-engineer` | Head pose estimation, eye distance check, edge cases (profile, tilted) |
| Integration (Python) | `python-service/tests/test_face_match_api.py` | `python-engineer` | End-to-end: upload ID + selfie, get match result, audit log written, consent token validated |
| Zod schema | `apps/mobile/src/modules/kyc/schemas.ts` | `spa-engineer` | Round-trip parse of FaceMatchResult, ConsentToken |
| E2E happy (mobile) | `apps/mobile/e2e/kyc.spec.ts` | `qa-engineer` | AC-1: capture ID + selfie, match succeeds, UX shows green checkmark. AC-2: photo cache reused on second match (latency < 50ms). |
| E2E errors (mobile) | `apps/mobile/e2e/kyc.errors.spec.ts` | `qa-engineer` | Poor geometry (head pose, eye distance), no face, multiple faces, consent required, image too large. |
| A11y (mobile) | `apps/mobile/e2e/a11y.spec.ts` extended | `qa-engineer` | Axe-core scan on MatchResult screen (camera view is exempt), keyboard nav on buttons, screen reader labels. |
| Load (smoke) | `loadtest/k6.js` extended | `qa-engineer` | 20 concurrent match requests (dlib CPU-bound, not I/O-bound), p99 < 2s, no dlib crashes. |
| Bias / fairness | Manual test with diverse face photos (internal dataset or public benchmark like Morph3D) | `qa-engineer` | False negative rate across gender/ethnicity cohorts differs < 5 percentage points (document disparities in DPIA). |

---

## 14. Telemetry & success metrics

- **Adoption** — 70% of onboarding customers complete face match without retry within week 1 (event: `kyc.face_match_completed`).
- **Latency** — p99 < 2s for cold inference; encoding cache hits ≤ 50ms p99.
- **Error rate** — `< 2%` 5xx errors. `< 5%` 4xx validation errors (poor geometry, no face).
- **Match accuracy** — On a labeled test set of 1000 pairs (500 match, 500 non-match), achieve >= 95% true positive rate and >= 98% true negative rate.
- **Business KPI** — 80% of onboarding documents successfully link to verified customer (no manual re-verification needed). Audit trail shows no unauthorized overrides (match=false but document approved anyway).

---

## 15. Definition of Done

- [ ] All 15 sections above filled
- [ ] `cd python-service && pytest -q python-service/tests/test_face_match_service.py` green (encoding, distance, geometry, cache, consent)
- [ ] `cd python-service && pytest -q python-service/tests/test_face_match_api.py` green (routes, multipart upload, audit log)
- [ ] `cd apps/mobile && npm run typecheck` green (Zod schemas)
- [ ] `cd apps/mobile && detox test e2e/kyc.spec.ts` green (capture ID + selfie, match success, UX render)
- [ ] `cd apps/mobile && detox test e2e/kyc.errors.spec.ts` green (poor geometry, no face, multiple faces, consent required)
- [ ] Mobile a11y scan green (no violations on MatchResult)
- [ ] audit_log entries land for every match (manual smoke: capture ID + selfie, verify BIOMETRIC_MATCH_DECIDED in logs with no image data)
- [ ] Metrics visible in local Grafana (`face_match_total`, `face_match_duration_seconds`, cache hit rate)
- [ ] Feature flag `FF_FACE_MATCH_KYC` default = `off` and verified
- [ ] `docs/README.md` changelog entry: `2026-05-DD — face-match-kyc — offline dlib face verification with 90-day encoding cache and GDPR consent audit trail`
- [ ] ADR `docs/adr/0010-biometric-data-handling.md` landed (covers DPIA, consent, retention, GDPR compliance)
- [ ] Security review completed: `/security-reviewer` run posted (focus on consent token, encoding privacy, DPIA)
- [ ] Bias / fairness evaluation completed on labeled test set (document in DPIA)
