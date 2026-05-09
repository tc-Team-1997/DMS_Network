# ADR 0001 — AML Watchlist Screening Architecture

**Date:** 2026-05-09  
**Status:** Accepted  
**Date accepted:** 2026-05-09  
**Deciders:** Doc-Brain team  
**Related:** `docs/contracts/aml-screening.md` (BHU-67)

---

## Context

The National Bank of Egypt Document Management System must comply with international Anti-Money Laundering (AML) regulations: BCB (Central Bank of Brazil) guidelines, FATF (Financial Action Task Force) recommendations, and OFAC (U.S. Office of Foreign Assets Control) sanctions enforcement. Current state: AML router exists as a stub; no watchlist screening occurs. Compliance officers cannot attest to coverage, and the system has no defence against processing documents for high-risk parties.

**What "screening" means in this slice:**
- Name-based matching (customer name against published watchlists: OFAC SDN, EU Consolidated Sanctions List, UN Security Council designations)
- Fuzzy matching via Levenshtein distance with normalized names (lowercase, diacritics removed, tokens sorted)
- NOT transaction monitoring, NOT sanctions hierarchy enforcement, NOT KYC renewal reminders

**Trigger:** Screening fires on every customer **create** or **update** operation. Synchronous API responses immediately, but matching executes asynchronously via the task queue (enqueue-and-return pattern) so that large watchlists (~10k entries per list) don't block the customer endpoint.

---

## Decision

We will implement local-first AML watchlist screening with the following architecture:

### 1. Watchlist Loading & Management

- Watchlist data (OFAC SDN, EU Consolidated, UN) is loaded from **CSV files** into the database at startup or via an explicit admin refresh endpoint (`POST /api/v1/aml/watchlists/refresh`)
- Each watchlist entry is normalized at load time: customer name normalized to lowercase, diacritics removed (using `unidecode`), tokens sorted alphabetically
- A `aml_watchlists` table tracks source URL, last-updated timestamp, entry count, and tenant boundary
- A `aml_watchlist_entries` table stores normalized names, DOB, country, and original record (as JSON for audit)
- Watchlists are **tenant-scoped**: multi-tenant deployments cannot leak entries across tenants
- Refresh is rate-limited to 1 per hour to prevent watchlist-fetching DOS

### 2. Screening Process (Async Task Queue)

When a customer record is created or updated:

1. **Enqueue** — The customer mutation handler (Python `/api/v1/customers/*` endpoint) calls `TaskQueue.enqueue("aml_screen_customer", customer_id=X)`
2. **Worker picks up** — Background worker `aml_screen_customer` task handler loads the customer, normalizes their name, and iterates through all loaded watchlist entries
3. **Match scoring** — For each watchlist entry, compute `Levenshtein(norm_customer_name, norm_watchlist_name)`. If score ≥ threshold (0.85 default, configurable per watchlist), create an `aml_hits` row
4. **Record screening** — Create an `aml_screenings` row with `status = "pending_review"` and aggregate `hit_count`
5. **Emit event** — Emit `"aml.hits_found"` event so the compliance dashboard updates in real-time
6. **Assign workflow** — If hits exist, create a workflow task assigned to the compliance officer role; they see the hits in their workflow inbox
7. **Audit** — Log `AML_SCREENING_INITIATED` with customer_cid, hit_count, tenant

Expected latency per customer: **p99 ≤ 500ms** (including Levenshtein against 5k entries, database writes).

### 3. Hit Decision & Review

Compliance officer reviews hits in the workflow UI:

1. **See hit details** — For each `aml_hits` row: watchlist name, matched entry name, Levenshtein score, and original record data
2. **Decide** — Three outcomes:
   - `cleared` — False positive; name match is coincidental or verified as safe
   - `escalated` — Genuine concern; route to LAC (Legal / AML Committee) for investigation
   - `blocked` — (Reserved for future use; hits do not auto-block customer onboarding in v1)
3. **Record decision** — Update `aml_hits.status`, set `reviewed_by` and `reviewed_at`, add notes
4. **Update screening** — Recompute screening's `status` field based on all hits' decisions:
   - If all hits `cleared` → screening.status = `cleared_all` (pass)
   - If any hit `escalated` → screening.status = `escalated_some` (warn)
5. **Audit** — Log `AML_HIT_DECISION` with hit_id, decision, reviewer, notes

### 4. Storage & PII Handling

- Customer names are stored plaintext in `aml_screenings` and `aml_hits` tables (live data for operational review)
- Original watchlist entry records (including any DOB, country from source) are stored as JSON in `aml_watchlist_entries.original_record` (audit trail only, never displayed in UI)
- Data subject access requests (DSAR) and erasure requests do NOT hard-delete screening records; instead, set a `deleted_at` timestamp so auditors can still retrieve the record during an investigation
- Watchlist data itself (OFAC, EU lists) are public; no encryption overhead on watchlist tables

### 5. False Positive Cost & Thresholds

False positives are the operating cost of rule-based matching:

- **Initial screen (new customer):** ~3-8% hit rate expected (many common names naturally match watchlist entries)
- **Incremental screen (existing customer updated):** ~0.5% hit rate
- **False positive rate (cleared vs total decisions):** Target > 90% — indicates good tuning
- **Threshold:** 0.85 Levenshtein score is conservative (85% name similarity before flagging). We accept that we will **miss** sophisticated name variations (transposition, insertion, abbreviation) that a vendor system would catch; this is the trade-off for privacy (no PII egress to third parties)
- **Tunability:** Thresholds per watchlist are configurable via admin panel; operators can adjust 0.75 to 0.95 based on false positive rate

### 6. Why Local-First (Not Vendor SaaS)?

**Alternatives considered:**

1. **Vendor SaaS (LexisNexis WorldCompliance, Refinitiv World-Check, Dow Jones Risk Center)**
   - Pros: Sophisticated matching, phonetic matching, automatic updates
   - Cons: Network egress leaks customer PII to third party; compliance concerns (Bhutan data residency requirements); cost per screening; vendor uptime dependency; latency (500ms → 2-3s); no local audit trail control
   - **Decision: Rejected**

2. **Phonetic matching only (Soundex, Metaphone)**
   - Pros: Faster than Levenshtein; catches pronunciation variations
   - Cons: Soundex is English-only; fails on Arabic, Dzongkha, and CJK names (non-Latin character sets); too lossy for international watch lists
   - **Decision: Rejected for v1**

3. **Machine Learning classifier (fine-tuned BERT for name matching)**
   - Pros: Learns name patterns; handles multilingual input better
   - Cons: Explainability required by regulators ("Why did the system flag this?"); ML model drift; retraining burden; adds infrastructure
   - **Decision: Rejected for v1; consider for v2 if false positive rate > 5%**

---

## Consequences

### Positive

- **Privacy-first:** No PII leaves the local stack. Full control over data.
- **Explainability:** Compliance officer and auditor can see exactly why a match fired (Levenshtein score of 0.87 on normalized names).
- **Regulatory attestation:** We can prove to the Central Bank: "We screened 100% of customers against OFAC/EU/UN lists on creation; XXX hits, YYY cleared, ZZZ escalated."
- **Auditability:** Full screening history in database; decisions logged with reviewer + timestamp.
- **Offline resilience:** Watchlists loaded at startup; screening works even if external APIs are down.

### Operating Costs

- **False positives:** 3-8% on initial screen means compliance officers review ~30-80 false positives per 1,000 customers. SLA: decision within 4 hours. Staff cost: estimated 1 FTE for 5,000-customer branches.
- **Watchlist refresh:** Weekly from OFAC/EU/UN (manual or automated via cron). Bulk re-screen of 10k customers takes 5-10 minutes (500ms × 10k ÷ parallel workers).
- **Storage:** 5k entries per watchlist × 3 watchlists = 15k rows in `aml_watchlist_entries`; ~50 MB on disk.
- **Latency regression:** Customer create/update endpoints add 5-10 ms (enqueue task only; screening is async).

### Known Limitations (v1)

- **Phonetic similarity:** Won't catch "Mohammad" ↔ "Mohamed" variations unless they exceed Levenshtein 0.85; operators must tune threshold
- **DOB/passport matching:** Not implemented; name-only v1
- **Transaction screening:** Out of scope; this is onboarding/customer-master screening only
- **Sanctions hierarchy:** We treat all OFAC entries equally; no distinction between SDN, SSI, or secondary designations
- **Real-time updates:** Watchlists refreshed on schedule (weekly); daily updates not supported in v1

---

## Status

**Accepted** (2026-05-09). Phase 1 implementation complete and shipped: local OFAC/EU/UN watchlist screening, Levenshtein matching, compliance officer review workflow, audit trail.

---

## Deciders

- Doc-Brain engineering lead
- Product (Compliance)
- Security review (mandatory for high-risk)
