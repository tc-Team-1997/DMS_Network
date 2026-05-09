# ADR 0007 — Dzongkha Translation: Offline NLLB Model Loading

**Date:** 2026-05-09  
**Status:** Accepted  
**Date accepted:** 2026-05-09  
**Deciders:** Python Engineer, DevOps, Compliance  
**Related:** `docs/contracts/dzongkha-translation.md` (BHU-14)

---

## Context

Bhutan F#14 mandates Dzongkha translation for document review. Cloud translation services (Amazon Translate, Google Cloud Translation) leak document content over the wire, disqualifying them for the local-first build mandate. A self-contained translation model must run offline on branch infrastructure.

Current state: no translation capability. Officers manually translate or use external tools (PII egress risk).

---

## Decision

We lazy-load **Meta's NLLB-200-distilled-600M** from Hugging Face on first request:

1. **Singleton lazy-loading** — Model is loaded into memory on the first translate call. Subsequent calls reuse the in-memory model (double-checked locking prevents race conditions).
2. **Cold-load budget** — ~30 seconds on CPU for model download + initialization. Warmup script in `start.sh` recommended (optional for production).
3. **Caching strategy** — Translation results (not the model) are cached in the `translations` table:
   - Key: `(tenant_id, sha256(source_text), source_lang, target_lang)`
   - TTL: 7 days
   - Tenant-scoped (no cross-tenant leakage)
4. **Supported languages** — English ↔ Dzongkha, English ↔ Arabic. Configurable per tenant via `tenant_settings.supported_languages`.
5. **Model pinning** — NLLB-200-distilled-600M is pinned in `requirements.txt` (not `latest`). Dependency review on updates; no auto-upgrades.

**Alternatives considered:**

- **Amazon Translate / Google Cloud** — Rejected. PII egress violates local-first mandate. Cost per API call unjustified for offline-capable alternative.
- **Larger NLLB-200 (3.3B parameters)** — Rejected. 13GB RAM requirement unrealistic for branch deployment (servers typically 8–16GB).
- **Per-language smaller models** — Rejected. Operational complexity (separate model per pair); inconsistent quality.
- **Cloud-managed inference (Hugging Face Inference Endpoints)** — Rejected. Same PII egress problem as SaaS alternatives.

---

## Consequences

### Positive
- **No PII egress** — All processing local. No API calls, no third-party involvement.
- **Works offline** — No internet required after first model download. Branch can operate indefinitely offline.
- **Cost-free inference** — No per-API-call charges. Model license (CreativeML Open RAIL-M) permits commercial use.
- **Deterministic results** — Same input always produces same translation. No model variance between vendors.

### Operating Costs
- **Storage footprint** — ~6GB total (transformers library ~500MB + torch CPU ~2GB + NLLB model ~2.4GB + padding ~1.1GB). Requires persistent `/tmp` or custom cache volume.
- **Memory footprint** — ~2.5GB per Python process (model + inference working set). Shared across tenants (acceptable; no multi-tenancy memory bloat).
- **CPU-bound inference** — No GPU. 30-second cold load and 3–5 second translation latency on standard CPU. Acceptable for branch workflow (few docs/day).
- **Model quality variability** — NLLB-200-distilled is "good but not perfect." Low-confidence translations flagged to users; manual review required. English ↔ Arabic quality lower than Dzongkha (less training data).
- **Container restart penalty** — If pod restarts, TRANSFORMERS_CACHE (model cache) is wiped. Must set `TRANSFORMERS_CACHE=/persistent/huggingface` to avoid re-downloading on every restart.

### Limitations (v1)
- **No custom glossaries** — Bank-specific Dzongkha terminology not injected. Model uses base vocabulary.
- **No liveness check** — Cannot verify translation quality in real-time. Users must read and approve translations.
- **No back-translation** — Quality assurance via round-trip translation deferred (manual verification only).
- **Single model version** — No A/B testing or shadow inference. Production model is the only model.

---

## Status

**Accepted** (2026-05-09). Implementation shipped: lazy-load NLLB-200-distilled-600M from Hugging Face, 7-day translation result cache, tenant-scoped supported-languages config, confidence-band UI for low-confidence translations.

---

## Related Decisions

- **ADR 0001 (AML screening)** — Translation requests are logged to audit_log (no source/target text, only metadata). Separate from AML screening flow.
- **ADR 0006 (Offline sync encryption)** — Branch officers can request translation offline (within the sync queue); results are cached locally until reconnect.
- **Engineering Principles § Local-First** — This ADR exemplifies the local-first mandate: no cloud APIs, all processing on-device.
