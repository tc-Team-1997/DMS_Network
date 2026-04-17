# DocManager — AI Strategy (DocBrain)

> **In-house, on-prem-capable, banking-specialised document AI.**
>
> Implementation: [ROADMAP.md Q3 2026 → Q4 2026](./ROADMAP.md).
> Architecture context: [TARGET_ARCHITECTURE.md §7](./TARGET_ARCHITECTURE.md#7-ai-layer-docbrain).

---

## 0. What ships today (2026-04-17)

This document describes the **full target stack** (§1 onwards). Before reading it, anchor on what a developer can actually run right now on a laptop — the delta from the target is intentional, and every piece is designed to rotate without changing the contract the SPA sees.

| Capability | Shipped today | Target |
|---|---|---|
| Chat model | Ollama + **`llama3.2:3b`** (JSON-mode) | Llama 3.1 8B / 70B + Qwen-2 Arabic via vLLM |
| Embeddings | Ollama + **`nomic-embed-text`** (768-dim) | BGE-M3 (1024-dim, multilingual) via ONNX |
| Classification | 12 KYC classes, zero-shot JSON-mode | Fine-tuned head + LayoutLM verifier |
| Extraction | 8 entity fields with per-field confidence | LayoutLM v3 + NER + Llama verifier |
| Vector store | SQLite BLOB + numpy cosine (`docbrain_vectors`) | pgvector (pooled) / Qdrant (silo+) |
| Object store | MinIO bucket `docmanager` (S3-compatible, CAS by SHA-256) | S3 / Azure Blob / on-prem S3 (same client) |
| OCR | Tesseract + pdf2image | Tesseract default + LayoutLM + opt-in Textract/Azure FR |
| RAG guardrails | `has_evidence` flag · `_strip_unsupported_citations` · display gate | + Presidio PII pre/post + prompt-injection classifier + citation-alignment scoring |
| Observability | `.run/*.log` + structured request logs | LangSmith + Arize + Prometheus metrics |

**Locality guarantee, enforced:** the pilot runs with **zero outbound network calls to any AI provider**. No OpenAI, no Anthropic, no Azure OpenAI, no AWS Bedrock. This is not a stance we'll adopt at GA — it's the default the entire stack is already built against. The commercial claim "on-prem, air-gapped, no phone-home" is not a future marketing bullet; it is literally how the pilot boots today via `./start.sh`.

**Product surfaces already wired against DocBrain:**

- Viewer right-column **AI panel** — classification badge + 8 entity fields + confidence bars + OCR stats ([AIPanel.tsx](../apps/web/src/modules/docbrain/AIPanel.tsx)).
- Viewer left-column **RAG chat** — questions → grounded answer w/ citation pills · refuses and warns when no evidence ([RagChat.tsx](../apps/web/src/modules/docbrain/RagChat.tsx)).
- Capture → fire-and-forget `analyzeDocument(id)` on upload success; by the time the user opens the viewer, classification + high-confidence (≥0.7) fields are already populated on the document row.

**Test coverage:** [docbrain.spec.ts](../apps/web/e2e/docbrain.spec.ts) — 4 Playwright specs exercising empty-state panel, populated analysis, grounded answer with citation, and no-evidence refusal. Part of the 22-spec green suite.

Everything below is the **destination.** Every target-state row in the table above maps to a single-file swap in [`python-service/app/services/docbrain/`](../python-service/app/services/docbrain/); the SPA and the `/spa/api/docbrain/*` HTTP contract are stable across the migration.

---

## 1. Why we build our own AI layer

Banks reject third-party SaaS LLMs for three reasons: **data residency**, **regulator fear**, and **audit-chain continuity**. A document sent to OpenAI leaves the bank's jurisdiction, can't be traced through the bank's audit system, and cannot be guaranteed not to end up in training data.

Existing "AI-powered" DMS vendors either:
1. **Proxy OpenAI / Claude** — fine for retail SaaS, disqualified for banks.
2. **Use generic cloud OCR** (AWS Textract, Azure Form Recognizer) — great quality, wrong deployment shape for on-prem mandates.
3. **Ship 2010-era rule-based extractors** rebranded "AI" — fine for a demo, fails on Arabic, fails on handwriting, fails on any doc they didn't hardcode.

Our stance: **ship an AI layer that runs on the bank's own hardware, with models they can inspect, in languages their customers actually use.** The commercial proposition is "modern AI document processing, without the SaaS-AI risk."

---

## 2. The DocBrain stack

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                                 DocBrain                                     │
│                                                                              │
│  ┌─────────────────────────── Ingestion layer ─────────────────────────┐    │
│  │   Pre-processing: deskew · despeckle · binarisation · auto-crop     │    │
│  │   OCR engine router:                                                │    │
│  │     · Tesseract 5 (default, open source, on-prem-friendly)          │    │
│  │     · Cloud OCR fallback (Textract/Azure FR) — opt-in per tenant    │    │
│  │     · ABBYY FineReader SDK for on-prem tenants requiring the best   │    │
│  │   Language packs: English, Arabic, French, Urdu, Hindi, Swahili     │    │
│  │   Output: page-level text + bounding boxes + confidence             │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌─────────────────────────── Understanding layer ─────────────────────┐    │
│  │   Classification — Llama 3.1 8B fine-tuned on bank doc corpus       │    │
│  │                    (30 classes baseline, tenant-extensible)         │    │
│  │   Extraction   — Custom NER (CID, doc number, dates, names,         │    │
│  │                    addresses, issuing authority). LayoutLM v3 +     │    │
│  │                    Llama verifier for edge cases.                   │    │
│  │   Signature    — Siamese ConvNet comparing captured sig to KYC sig. │    │
│  │   Forgery      — ELA + noise residual + LayoutLM anomaly net.       │    │
│  │   Face match   — ArcFace on ID photo vs live selfie (mobile).       │    │
│  │   Duplicates   — SHA-256 exact + pHash near + embedding similarity. │    │
│  │   Language det — fastText model (precursor to OCR language pack).   │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌────────────────────────── Retrieval layer ──────────────────────────┐    │
│  │   Embeddings:      BGE-large (en) · bge-m3 (multilingual)           │    │
│  │   Vector DB:       Qdrant (silo/dedicated) · pgvector (pooled)      │    │
│  │   Keyword:         Postgres FTS (pooled) · OpenSearch (silo+)       │    │
│  │   Hybrid:          BM25 + dense RRF + bge-reranker-v2               │    │
│  │   Tenant-scoped:   collection per tenant, never cross-tenant match  │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌────────────────────── Reasoning / orchestration ────────────────────┐    │
│  │   LangChain / LangGraph — workflow graphs with checkpointing         │    │
│  │   Serving: vLLM (preferred for throughput), fallback Ollama          │    │
│  │   Models:                                                            │    │
│  │     · Llama 3.1 8B  → classification, routing, cheap tasks           │    │
│  │     · Llama 3.1 70B → RAG chat, summaries, policy reasoning          │    │
│  │     · Qwen-2 Arabic → Arabic-native long-form                        │    │
│  │   Tool use: SQL retriever · CBS lookup · policy lookup · calculator  │    │
│  │   Guardrails:                                                        │    │
│  │     · Presidio + custom banking PII redaction                        │    │
│  │     · Prompt-injection detector (classifier on input)                │    │
│  │     · Output citation check (answer ↔ source alignment scoring)      │    │
│  │     · Toxic / harmful output classifier                              │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ┌────────────────────── Observability & eval ─────────────────────────┐    │
│  │   LangSmith — every call traced · tenant-scoped buckets              │    │
│  │   Eval harness — per-prompt golden set, regression gate on deploy    │    │
│  │   A/B testing — traffic split by tenant segment                      │    │
│  │   Drift detection — Arize / Fiddler for embedding + output drift     │    │
│  │   Cost tracking — token count × model price → per-tenant bill line   │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Model catalogue & serving

### 3.1 Open-weight models we run (default)

| Model | Purpose | Serving | Size | Why it |
|---|---|---|---|---|
| **Llama 3.1 8B Instruct** | Classification, fast reasoning, tool-use for routing | vLLM on 1× A100 (40GB) or 2× L4 | ~16GB | Quality/speed sweet spot for non-chat tasks |
| **Llama 3.1 70B Instruct** | RAG chat, long-form summaries, complex reasoning | vLLM on 2× A100 (80GB) or 1× H100 | ~140GB | Tier-1 customers pay for this; tier-3 gets it on-demand |
| **Qwen-2 7B (Arabic-strong)** | Arabic-first reasoning | vLLM on 1× A100 | ~14GB | Arabic quality beats Llama in our evals |
| **BGE-M3** | Multilingual embeddings | ONNX runtime, CPU-feasible | ~2GB | State-of-the-art multilingual retrieval |
| **bge-reranker-v2-m3** | Retrieval reranking | ONNX runtime | ~0.5GB | Significant retrieval quality boost |
| **LayoutLM v3** | Document layout + OCR+layout understanding | Transformers, GPU preferred | ~500MB | Table extraction, form field detection |
| **fastText lid-176** | Language detection | CPU | ~1GB | Fast, accurate language routing |

### 3.2 Commercial/cloud fallbacks (opt-in per tenant)

For tenants whose compliance allows it (tier-3 SaaS, non-sensitive document classes):

- **AWS Textract** — excellent English table extraction; $1.50/1000 pages.
- **Azure Document Intelligence** — strong form extraction; integrates nicely with Azure-resident customers.
- **Anthropic Claude** / **OpenAI GPT-4o-mini** — for tenants who want quality over privacy for summarisation tasks.

Every cloud call is gated by a tenant-level policy flag; disabled by default for tier-1 / silo tenants. The gate is enforced in the DocBrain router — not trusted to the application layer.

### 3.3 Serving infrastructure

- **vLLM** on dedicated GPU nodes (Nvidia A100 / L4 / H100 depending on model).
- **Text Generation Inference** (TGI) as alternative if customer prefers Hugging Face's ecosystem.
- **Ollama** for dev / on-prem-simple deployments; switchable to vLLM in prod.
- **Dynamic batching** (vLLM default) for throughput.
- **Speculative decoding** with smaller draft model when GPU budget permits.
- **Autoscaling:** Keda with GPU utilisation metrics.

### 3.4 Hardware sizing (silo tier, 1M docs/month tenant)

Rough capacity planning (single silo customer):

| Workload | Volume | Hardware |
|---|---|---|
| OCR | 40k pages/day | 4 CPU workers (tesseract) + 1 GPU worker (LayoutLM) |
| Classification | 40k docs/day | Llama 3.1 8B on 1× A100 shared |
| NER / extraction | 40k docs/day | LayoutLM + Llama 8B on same A100 |
| Embeddings | 40k docs/day | BGE-M3 on 1× L4 (CPU fallback available) |
| RAG chat (staff Q&A) | ~500 sessions/day | Llama 3.1 70B on 2× A100 (shared across tenants in pooled; dedicated in silo+) |
| Re-ranking | per retrieval | CPU |
| Storage | 1M docs · ~500KB avg | ~500GB S3 · ~1GB vectors |

Total GPU footprint for a silo customer: **2–4 A100s + 1 L4**. Reasonable on-prem rack.

---

## 4. Fine-tuning pipeline

### 4.1 Training data

- **Public corpora:** DocLayNet, FUNSD, RVL-CDIP, CORD, XFUND (for Arabic/multilingual).
- **Synthetic:** generate bank-document templates + vary fields (passport, national ID, utility bill) — we have `python-service/scripts/train_doc_classifier.py` stub.
- **Tenant-contributed (opt-in):** anonymised, PII-scrubbed corrections feed back into shared baseline improvements. Tenants see this in their contract and can opt out.
- **Dedicated per-tenant fine-tune:** available at silo/dedicated tier — never crosses tenant boundary.

### 4.2 Fine-tuning compute

- LoRA / QLoRA for most fine-tunes — a single A100 can fine-tune a Llama 3.1 8B LoRA overnight.
- Full fine-tune rarely; only when architecture changes are needed.
- Per-tenant fine-tunes deployable as separate LoRA adapters; the base model is shared.

### 4.3 Model registry

- All models versioned in MLflow (or Weights & Biases if chosen at Q3 2026 decision point).
- Every deployment tagged with: model hash, training data hash, eval scores, approver.
- Rollback: any deployment can be reverted in <5 minutes.

---

## 5. Product surfaces powered by DocBrain

### 5.1 Capture (auto-fill)

- User uploads → OCR + classification → NER fills the metadata form.
- Confidence per field: green (>95%), yellow (80–95%), red (<80%).
- User confirms / corrects; corrections feed the retraining loop.

### 5.2 Viewer (AI panel)

- Classification badge.
- Extracted entities highlighted in the document overlay (click a field to see the source text).
- Forgery score with factor breakdown (ELA suspicion, noise anomaly, layout outlier).
- Signature match score vs KYC signature.
- "Related documents" — vector-similar documents in this customer's history.

### 5.3 Search (hybrid semantic)

- Natural-language query: "*show me passports expiring this month for customers in Giza*".
- Hybrid retrieval (BM25 + dense + rerank) returns documents; LLM composes the result list with a short summary.
- Every hit cites the source passage. No summarisation without citation.

### 5.4 "Ask the documents" (RAG chat)

- Scoped to: one document / one customer / one case / tenant-wide (with permission).
- Every answer carries citations (page + paragraph + document).
- Hallucination check before display: answer-source alignment scoring, flagged if low.
- Saved conversations contribute to the audit log.

### 5.5 Compliance copilot

- "Draft the CBE quarterly report for this portfolio" — LLM composes; compliance officer reviews; system fills the regulator's PDF.
- "What's this customer's risk band, and why?" — LLM traces the answer to specific documents and workflow decisions.
- "Is this customer's document set complete for a business loan?" — LLM checks against a rule set (DMN) and flags gaps.

### 5.6 Workflow auto-complete

- When a workflow step has a clear answer from the documents (e.g., "verify passport expiry > 6 months from today"), LLM proposes the decision with confidence.
- Below a threshold → human review. Above → auto-approve with maker-checker log entry noting "AI-proposed, auto-confirmed at 99.2% confidence."

### 5.7 Anomaly alerts

- Customer's documents that don't match their stated profile (address mismatch, income-doc inconsistency) → alert surface in compliance UI.
- Cross-document entity inconsistency detection — we have `/routers/customer_risk.py` stub; AI fills it out.

---

## 6. Guardrails (non-negotiable)

Every LLM call goes through a pre+post pipeline:

### 6.1 Pre-inference

- **Input PII redaction** (Presidio + custom banking rules) — CID, account numbers, full names, national IDs redacted before sending to LLM, restored before surfacing to user.
- **Prompt-injection classifier** — flags suspicious inputs that look like jailbreak attempts.
- **Context budget enforcement** — prevents runaway long contexts that blow cost.
- **Tenant policy check** — is this tenant allowed to use cloud LLMs for this operation? Allowed to use 70B?

### 6.2 Post-inference

- **Output PII check** — did the LLM leak anything that wasn't in its input?
- **Citation validation** — for RAG answers, verify every cited passage actually exists in the source. If none → mark as low-confidence, do not display.
- **Toxicity filter** — block inappropriate output (edge case, but required for compliance).
- **Schema validation** — for structured outputs (JSON), reject non-conforming responses and retry.

### 6.3 Human review paths

- Any decision below the auto-approve threshold → maker inbox.
- Any output marked low-confidence → displayed with "AI suggestion — please verify."
- Compliance officer has a "veto" — any AI decision can be recorded as overridden with a reason.

---

## 7. Observability

### 7.1 LangSmith

- Every LLM call: trace, prompt, tokens in/out, latency, cost, model, tenant, user, confidence.
- Tenant-scoped buckets: tier-1 tenants have their own LangSmith workspace.
- Query UI: "show me every RAG chat call last week where hallucination check flagged."

### 7.2 Eval harness

- Per-prompt golden sets (e.g., 200 passport scans labeled with correct extraction).
- Ran before every model deployment; regression > 2% fails the deployment.
- Ran weekly on production traffic samples to detect drift.

### 7.3 Cost telemetry

- Per-call: tokens × model price → cost.
- Per-tenant: rolled up to the tenant's invoice line.
- Per-surface: which product feature spends the most budget.
- Alerts if a tenant's AI spend exceeds N% of their subscription value (anomaly or cost-runaway indicator).

---

## 8. Data flow — typical document

```
  1. Capture       — user uploads passport.pdf
                      │
                      │ multer → S3 (sha256-addressed)
                      ▼
  2. OCR queue      — task.enqueue(ocr.process, doc_id)
                      │
                      │ worker: pdf2image → Tesseract (or Textract if opt-in)
                      │        → page-level text + boxes + confidence
                      ▼
  3. Classify       — Llama 3.1 8B: "what is this doc?"
                      │ → {type: "passport", confidence: 0.98}
                      ▼
  4. Extract        — LayoutLM + Llama: named entities
                      │ → {cid: "…", doc_number: "…", expiry: "2032-01-09", ...}
                      ▼
  5. Verify         — forgery score, signature score, duplicate check
                      │ → {forgery: 0.03, signature_match: 0.94, duplicates: []}
                      ▼
  6. Embed          — BGE-M3 → 1024-d vector
                      │ → upsert into tenant Qdrant collection
                      ▼
  7. Index          — Postgres FTS entry + OpenSearch doc
                      ▼
  8. Publish        — Kafka: tenant.X.documents.classified
                      │
                      ├─▶ workflow engine (advance expiry-renewal workflow)
                      ├─▶ audit log
                      └─▶ notify user: "auto-indexed, please review if any confidence < 95%"
```

Every step is traced; every tenant sees their own processing timeline in the admin UI.

---

## 9. Arabic-first (because MENA)

We treat Arabic as a **first-class product language**, not a translation afterthought.

- **OCR:** Tesseract Arabic language pack + our fine-tuned LayoutLM for Arabic forms + handwritten Arabic model (fine-tune of TrOCR-small-printed-handwritten).
- **NER:** Arabic-aware model (CAMeL Tools + custom fine-tune on bank-specific Arabic names, addresses, institution names).
- **LLM:** Qwen-2 7B is our Arabic workhorse; Llama 3.1 70B handles code-mixed Arabic-English.
- **UI RTL:** Already handled in Apex's Tailwind + our design tokens; we commit to a full Arabic translation at GA.
- **Names:** transliteration library (Aramaic/ANSI standard + bank-specific custom) — "محمد" ↔ "Mohamed" ↔ "Mohammad" mapping that bank staff actually see.

This is a MOAT: Silicon Valley AI companies treat Arabic as an afterthought; we treat it as a first language.

---

## 10. On-prem & air-gapped AI

For tier-1 customers, the entire DocBrain stack must run in their datacenter without any outbound connectivity.

- **Model bundling:** release artifacts include the quantised model weights (gguf or safetensors).
- **Registry mirror:** customers run their own container registry; our Helm chart pulls from it.
- **Scheduled upgrades:** every quarter, customer downloads a new model + code bundle; update is tested by their ops team.
- **Per-release signing:** cosign + sigstore; customer verifies signatures before deploying.
- **No phone-home:** observability routes to customer's internal Grafana / LangSmith self-hosted.
- **Compliance package:** shipped with a document trail of every model's training data provenance — essential for regulator inquiries.

---

## 11. Privacy & data handling

- **Opt-in for model improvement:** tenants opt in to share anonymised corrections (never raw documents).
- **Differential privacy** for any cross-tenant aggregation we do — we have `/routers/dp.py` stub.
- **Federated learning** as an optional path for silo/dedicated tenants — we have `/routers/federated.py` stub; exercise in Q1 2027.
- **Right to refuse training:** every tenant contract includes a "never in model training" clause they can exercise.
- **Retention:** LLM call logs retained 90 days (default), exportable, deletable.

---

## 12. Evaluation & benchmarking

We publish benchmarks per capability, per language, per release. No marketing-speak.

- OCR: character error rate (CER) on a held-out banking corpus.
- Classification: F1 per class, macro-averaged.
- Extraction: entity-level precision/recall.
- RAG: answer correctness (human-graded on a sampled set), citation accuracy, hallucination rate.
- Forgery detection: AUROC on curated tampered/non-tampered set.
- Signature match: EER on bank-specific signature set.

Targets in [VISION.md §6](./VISION.md#6-what-excellent-looks-like--the-north-star-metrics).

---

## 13. AI-specific risks & mitigations

| Risk | Mitigation |
|---|---|
| Hallucination in RAG | Mandatory citations + answer-source alignment check + display threshold |
| Prompt injection | Input classifier + sandboxed tool use + output policy filter |
| Training data leakage via inversion | No customer data in shared fine-tunes without explicit opt-in + anonymisation + DP |
| Model drift over time | Weekly eval on production samples + deployment regression gate |
| Adversarial inputs (forged docs) | Adversarial training + ensemble forgery scoring + human review queue |
| Bias in extraction (names, addresses) | Multilingual training + bias audit per major locale + compliance review |
| Cost runaway | Per-tenant spend alerts + automatic tier throttling + observability dashboards |
| Model provider outage (cloud path) | On-prem default; cloud-optional; fallback routing |

---

## 14. Anti-list

- **No black-box AI.** Every decision has a trace.
- **No cloud LLM by default.** On-prem default; cloud is opt-in.
- **No model we can't inspect.** Closed-weight models (GPT-4, Claude) only as opt-in fallback, never as the core.
- **No shared fine-tunes without opt-in.** Tenant data stays with the tenant unless they explicitly allow otherwise.
- **No AI decisions without a human path.** Every AI outcome can be overridden; the override is audited.
- **No silent degradation.** If the AI layer is down, the UI tells the user; we don't fake answers.

---

## 15. Decision log

| # | Question | Due | Status |
|---|---|---|---|
| A1 | vLLM vs TGI as primary serving engine | 2026-07-15 | Lean vLLM |
| A2 | MLflow vs W&B for model registry | 2026-07-15 | Lean MLflow (self-host-friendly) |
| A3 | Qwen-2 vs Aya-23 vs fine-tuned Llama for Arabic | 2026-08-01 | Bench all three on real KYC corpus |
| A4 | LangGraph vs raw LangChain for orchestrator | 2026-09-01 | Lean LangGraph for complex workflows |
| A5 | Presidio + custom rules vs Microsoft Purview for PII | 2026-09-01 | Presidio + custom; Purview too Azure-locked |
| A6 | Arize vs Fiddler vs OSS (evidently) for model obs | 2026-10-01 | Evaluate three; lean Arize for Enterprise, evidently for on-prem |
