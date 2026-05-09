# ADR-0009: Local-First Adapter Registry with AWS Phase-2 Slots

**Date**: 2026-05-09  
**Status**: Accepted (Foundation, commit ebae97e)  
**Deciders**: Platform team, SRE  
**Affects**: All integrations from Wave A onward

---

## Context

The platform supports 14 categories of integrations: OCR, embeddings, LLM, translation, face-match, SMS, email, storage, KMS, watchlist, BI, CDN, cache, and webhook bus. Each has multiple implementations:

- **Local** (on-prem, offline-capable): Tesseract OCR, dlib face-match, Ollama LLM, NLLB translation, local SMTP, MinIO storage, local KMS, OFAC JSON watchlist
- **AWS** (Phase 2, optional): Textract, Bedrock, Rekognition, SES, S3, AWS KMS, AWS Compliance Service
- **Other** (future): Azure Cognitive Services, GCP Vertex, etc.

Bank of Bhutan's mandate is **local-first**: no dependency on cloud vendors during the 90-day rollout window. However, the team knew AWS would be the Phase-2 upsell path.

Options:
1. **AWS-first** — hard-coded AWS SDKs, local fallbacks (vendor lock-in risk, not a good look)
2. **Local-only** — no AWS at all (misses growth opportunity, Phase 2 credibility)
3. **Adapter registry with provider abstraction** — both seeded, admins pick at runtime (cleanest)

---

## Decision

Implement a **provider registry pattern**:

- **13 abstract base classes** in `python-service/app/services/integrations/providers_base.py`: `Ocr`, `Embedding`, `Llm`, `Translate`, `FaceMatch`, `Sms`, `Email`, `Storage`, `Kms`, `Watchlist`, `Bi`, `Cdn`, `Cache`
- **13 local providers seeded ON**: `ollama_ocr`, `local_embedding`, `ollama_llm`, `ollama_translate`, `local_face_match`, `local_smtp`, `noop_sms`, `local_fs_storage`, `local_kms`, `ofac_json_watchlist`, `local_parquet_bi`, `noop_cdn`, `local_lru_cache`
- **13 AWS provider stubs seeded OFF**: `aws_textract_ocr`, `aws_bedrock_embedding`, `aws_bedrock_llm`, `aws_bedrock_translate`, `aws_rekognition_face`, `aws_sns_sms`, `aws_ses_email`, `aws_s3_storage`, `aws_kms`, `aws_compliance_watchlist`, `aws_quicksight_bi`, `aws_cloudfront_cdn`, `aws_elasticache_cache`
- **Runtime resolution** via `provider_registry.py`:
  - Reads `tenant_config.integrations.<kind>.provider` (e.g., `ocr.provider = "ollama"` vs `"aws"`)
  - Per-(tenant,kind,provider) instance cache (lazy-loaded, reused)
  - `invalidate()` and `reset()` contracts for config-change cache busts
  - If provider is OFF (AWS stub without credentials), raises `NotImplementedError` with helpful message
- **Config-driven switching**: Admin edits `/admin/settings/integrations`, selects provider, change takes effect on next request (cache-busted via `POST /api/v1/admin/integrations/_reset`)

---

## Consequences

### Positive

- **Zero vendor lock-in at go-live** — BoB launches entirely on local implementations; AWS is optional Phase 2
- **Admin choice at runtime** — no code changes needed to swap providers; tenant_config is the source of truth
- **Graceful fallbacks** — if a provider is off and code tries to use it, raises NotImplementedError (fail-fast, not silent)
- **Extensible** — adding a new provider (e.g., Azure) is a new class + enum in integrations.json schema
- **Testability** — easy to mock providers in tests; swap to `mock_ocr` provider in test env

### Negative

- **More abstraction** — 13 base classes + 26 implementations = larger codebase surface
- **Provider parity required** — each implementation must satisfy the base class contract (e.g., `Ocr.extract()` returns same shape for Tesseract vs Textract)
- **AWS Phase 2 not pre-validated** — AWS implementations are stubs; real validation deferred to Wave C/Phase 2

### Risk

- **Config drift** — admin selects `aws` provider but credentials are stale/missing; users see NotImplementedError mid-workflow (mitigated by explicit admin validation button on IntegrationsPanel)

---

## Alternatives Considered

1. **AWS-first with local fallbacks** — rejected (not local-first, vendor messaging is bad)
2. **Local-only, AWS as separate product** — rejected (loses operational continuity, harder to migrate tenants to Phase 2)
3. **Runtime detection** (try AWS SDK, fall back to local) — rejected (unpredictable performance, error messages confusing)

---

## Related

- [Commit ebae97e (Foundation CC6)](../../CHANGELOG.md#unreleased--commit-ebae97e--2026-05-09)
- [PLATFORM_CONFIG.md § integrations](../PLATFORM_CONFIG.md#2-integrations)
- Services: `python-service/app/services/integrations/providers_base.py`, `python-service/app/services/integrations/provider_registry.py`
- Local implementations: `python-service/app/services/integrations/providers/local/`
- AWS stubs: `python-service/app/services/integrations/providers/aws/`
