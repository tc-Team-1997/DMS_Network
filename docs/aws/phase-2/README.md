# AWS Phase-2 — projections only, not the shipping path

> **Last updated:** 2026-05-10 · post-Wave-B docs sync

The platform that ships today is **local-first**. Every operational dependency runs in-process or on a local sidecar:

| Capability | Shipping today (seeded ON) | AWS adapter (registered, OFF) |
|---|---|---|
| OCR | `OllamaOcr` (qwen2.5vl + Tesseract fallback) | `aws_textract` |
| Embedding | `LocalEmbedding` | `aws_kendra` |
| LLM | `OllamaLlm` (llama3.x) | `aws_bedrock` |
| Translate | `OllamaTranslate` (Dzongkha-capable) | `aws_translate` |
| Face match | `LocalFaceMatch` (dlib) | `aws_rekognition` |
| Email | `LocalSmtp` | `aws_ses` |
| SMS | `NoopSms` | `aws_sns` |
| Storage | `LocalFsStorage` (content-addressed SHA-256) | `aws_s3` |
| KMS | `LocalKms` (per-tenant KEK envelope) | `aws_kms` |
| Watchlist | `OfacJsonWatchlist` (static file) | (none — Macie is a different shape) |
| BI | `LocalParquetBi` (filesystem export) | (QuickSight/CloudWatch — not modelled) |
| CDN | `NoopCdn` (relative URLs) | `aws_cloudfront` |
| Cache | `LocalLruCache` (in-process) | `aws_elasticache` |

The 13 AWS provider classes live at `python-service/app/services/integrations/providers/aws/` but every method raises `NotImplementedError("AWS adapter is registered but not enabled. Set integrations.<service>.provider='aws' in tenant_config and provide credentials.")`. Flipping a tenant's provider config to `'aws'` will surface that error until credentials and adapter implementations are wired.

Architectural rationale: **[ADR-0009 — local-first adapter registry](../../adr/0009-local-first-adapter-registry.md)**.

## What lives in this folder

The two cost-projection documents that previously sat at the top of `docs/` were modelling an AWS-first deployment. They remain useful as Phase-2 financial scaffolding but are **not** descriptive of the current shipping platform.

- `AWS_COST_CALCULATOR.md` — projected per-tenant monthly cost across 13 AWS services if all adapters were flipped on.
- `AWS_COST_OPTIMIZED_DEMO.md` — narrower projection for a single-tenant demo.

Treat these as input to a future commercial decision (e.g., a customer requests a managed-cloud variant), not as architecture documentation.

## How a Phase-2 flip would actually happen

1. Add credentials to a secrets backend the chosen tenant trusts.
2. Implement the adapter's methods inside the existing `aws_<service>.py` shell — keep the interface identical to the local provider.
3. Switch the tenant's `tenant_config.integrations.<kind>.provider` to `'aws'` via the admin Settings UI; provide a ≥20-char reason for the audit trail.
4. The `provider_registry` cache key changes; next call resolves to the AWS class. No restart required.
5. Roll back by flipping the same key back to its local value — same cache invalidation path.

This is the contract `tenant_config` was designed for. There is no platform code to rewrite when AWS becomes a customer requirement; only the 13 stub classes need bodies.
