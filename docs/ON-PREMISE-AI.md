# ZorDMS — Fully On-Premise AI (Replacing Claude / OpenAI)

**Status:** design + migration guide · **Owner:** AI/IDP (service #7) · **Last updated:** 2026-06-25

This document specifies how to make ZorDMS' AI **100% on-premise / air-gapped**, with
**no Anthropic (Claude) or OpenAI dependency**, using locally-served open-weight models
behind **vLLM**'s OpenAI-compatible API (Qwen Vision, IBM Granite, Qwen3 text, local
embeddings). It maps every current cloud call site, gives the target architecture,
the exact code/config changes, the model choices, and an end-to-end walkthrough of
parsing a sample document → classify → extract every field + metadata → further
processing (summarize, covenants, compliance).

---

## 1. TL;DR — what is already local vs. what to replace

| Capability | Where | Today | Action |
|---|---|---|---|
| **Document classify (Stage 1)** | `services/ai` `classify/classifier.py` → `inference/vllm_client.py` | **Already local** — Granite Vision via vLLM | Keep; optionally upgrade model |
| **Field extraction (Stage 2)** | `services/ai` `extract/extractor.py` → `vllm_client.py` | **Already local** — Qwen2.5-VL via vLLM, constrained `guided_json` | Keep; optionally upgrade model |
| **OCR fallback** | `services/ai` `ocr/tesseract.py` | **Already local** — Tesseract | Keep |
| **Embeddings / vector search** | `python-service` `services/vector.py` | **Already local** — `sentence-transformers` MiniLM (hashing fallback) | Keep; optional upgrade to BGE-M3 / Qwen3-Embedding |
| **Copilot RAG answer (text LLM)** | `services/ai` `copilot/llm_client.py` | ☁️ **Anthropic → OpenAI → extractive** | **Replace** with local vLLM text model |
| **Copilot (python-service)** | `python-service` `services/copilot.py` | ☁️ Anthropic / OpenAI (optional) | **Replace** |
| **Summarize** | `python-service` `services/summarize.py` | ☁️ Anthropic / OpenAI | **Replace** |
| **Loan covenant parsing** | `python-service` `services/covenants.py` | ☁️ Anthropic / OpenAI | **Replace** |
| **Compliance coach** | `python-service` `services/compliance_coach.py` | ☁️ Anthropic / OpenAI | **Replace** |
| **Retention NL rules** | `python-service` `services/retention_nl.py` | ☁️ Anthropic / OpenAI | **Replace** |
| **Workflow designer** | `python-service` `services/workflow_designer.py` | ☁️ Anthropic / OpenAI | **Replace** |

> **Key insight:** the heavy *vision* IDP path (the part that "parses information from the
> document") is **already on-prem**. The cloud lock-in is confined to **text-LLM** features
> that gate on `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`. Because vLLM exposes an
> **OpenAI-compatible** API, replacement is mostly *re-pointing a base URL and model name*,
> not rewriting logic.

---

## 2. Target architecture (air-gapped)

```
                         ┌───────────────────────── On-prem GPU cluster (RKE2 / k3s) ──────────────────────────┐
                         │                                                                                      │
  Core DMS / Gateway     │   vLLM #1 (vision)              vLLM #2 (text)            vLLM #3 (embeddings)        │
  python-service ───────►│   OpenAI-compatible             OpenAI-compatible         OpenAI-compatible /        │
  services/ai            │   :8001/v1                      :8002/v1                  TEI :8080                   │
                         │   • Granite 4.0 3B Vision       • Qwen3-30B-A3B-Instruct  • Qwen3-Embedding-0.6B/8B   │
                         │     (classify)                    (copilot, summarize,      or BGE-M3                  │
                         │   • Qwen2.5-VL / Qwen3-VL         covenants, coach, NL)                                │
                         │     (extract, guided_json)                                                            │
                         └──────────────────────────────────────────────────────────────────────────────────────┘
                                          ▲  all weights from offline HF bundle on NFS PVC · no egress
```

Principles:

- **One transport everywhere: the OpenAI Chat Completions schema.** vLLM (and HF
  Text-Embeddings-Inference for embeddings) speak it natively, so client code stays
  provider-agnostic. The existing `VLLMClient` (`services/ai/.../inference/vllm_client.py`)
  is already exactly this pattern — reuse it.
- **No API keys to a public provider.** `VLLM_API_KEY=EMPTY` (or an internal token).
- **Weights never leave the cluster.** Offline HuggingFace bundle on a shared NFS PVC,
  images from the offline Harbor registry — consistent with `python-service/docs/AIRGAP.md`
  and `services/ai/README.md` §"Inference stack (production, air-gapped)".

---

## 3. Model selection (2026 open-weight, all vLLM-served)

| Role | Recommended | Alt / smaller | Notes |
|---|---|---|---|
| **Vision — classify** | `ibm-granite/granite-4.0-3b-vision` (Apache-2.0, native vLLM, ~85% zero-shot doc classification) | current `granite-3.2-vision-2b` | Enterprise doc-tuned; charts/tables/KV. |
| **Vision — extract** | `Qwen/Qwen2.5-VL-7B-Instruct` (current) or `Qwen3-VL-*` | `Qwen2.5-VL-3B` for CPU/degraded | SOTA OCR/structured extraction; supports constrained JSON via vLLM `guided_json`. |
| **Text — copilot/RAG + aux** | `Qwen/Qwen3-30B-A3B-Instruct-2507` (MoE, ~3B active, 262K ctx) | `ibm-granite/granite-4.x` 8B, `Qwen3-8B-Instruct` (single-GPU) | Strong grounded RAG; long context for stitched snippets. |
| **Embeddings** | `Qwen/Qwen3-Embedding-0.6B`/`8B` (top MTEB) or `BAAI/bge-m3` (MIT) | keep `all-MiniLM-L6-v2` (384-dim) | If you change dim, re-index `vector_embeddings` (`EMBED_DIM`). |

Quantization for the L40S/air-gap targets: INT4/AWQ (Granite), Q4/GPTQ (Qwen-VL) per the
existing README. The 30B-A3B MoE text model fits comfortably on a single L40S at 4-bit and
serves the whole text workload (copilot + summarize + covenants + coach + retention + workflow).

---

## 4. Code changes

### 4.1 `services/ai` — copilot RAG (`copilot/llm_client.py`)

Today this file has three paths: **Anthropic → OpenAI → extractive fallback**
(`generate_answer`, lines ~166–193). Replace the two cloud paths with a single **local
vLLM** path; keep the grounded-extractive fallback (it's a good degraded mode).

**Settings** (`services/ai/src/zordms_ai/settings.py`) — drop the cloud keys, add a text model.
The service already has `vllm_base_url` / `vllm_api_key`:

```python
# REMOVE: anthropic_api_key, openai_api_key, anthropic_model, openai_model
# ADD:
copilot_model: str = "qwen3-30b-a3b-instruct"   # text model served by vLLM
copilot_vllm_base_url: str = ""                  # default "" → reuse vllm_base_url
```

**New local path** (reuses the OpenAI-compatible transport already in the repo):

```python
async def _local_answer(question, history, hits, settings) -> tuple[str, str]:
    import httpx
    system = _build_system_prompt(_build_context_block(hits))
    messages = [{"role": "system", "content": system}, *_build_messages(system, history, question)]
    base = (getattr(settings, "copilot_vllm_base_url", "") or settings.vllm_base_url).rstrip("/")
    model = getattr(settings, "copilot_model", "qwen3-30b-a3b-instruct")
    payload = {"model": model, "messages": messages, "max_tokens": 1024, "temperature": 0.2}
    headers = {"Authorization": f"Bearer {settings.vllm_api_key}"}
    try:
        async with httpx.AsyncClient(timeout=settings.request_timeout_s) as c:
            r = await c.post(f"{base}/chat/completions", json=payload, headers=headers)
            r.raise_for_status()
            answer = r.json()["choices"][0]["message"]["content"] or ""
        return answer, f"vllm/{model}"
    except Exception as exc:
        logger.warning("Local vLLM copilot error: %s", exc)
        return _extractive_answer(question, hits, False)


async def generate_answer(question, history, hits, degraded, settings):
    if degraded or not (getattr(settings, "vllm_base_url", "") or
                        getattr(settings, "copilot_vllm_base_url", "")):
        return _extractive_answer(question, hits, degraded)
    return await _local_answer(question, history, hits, settings)
```

Delete `_anthropic_answer` / `_openai_answer` and the `import anthropic` / `import openai`
branches. The system prompt and citation behavior are unchanged → the copilot still
answers **only** from retrieved context.

### 4.2 `python-service` — shared local LLM helper

These six files each inline an `if ANTHROPIC_API_KEY … elif OPENAI_API_KEY …` block:
`copilot.py`, `summarize.py`, `covenants.py`, `compliance_coach.py`, `retention_nl.py`,
`workflow_designer.py`. Replace all of them with **one** helper.

Create `python-service/app/services/llm.py`:

```python
"""Single on-prem LLM entry point. Talks to vLLM's OpenAI-compatible API.
No public-cloud provider. Returns None if the local endpoint is unset/unreachable
so every caller keeps its deterministic non-LLM fallback."""
import os, httpx

LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "http://vllm-text:8002/v1")
LLM_MODEL    = os.environ.get("LLM_MODEL", "qwen3-30b-a3b-instruct")
LLM_API_KEY  = os.environ.get("LLM_API_KEY", "EMPTY")
LLM_ENABLED  = os.environ.get("LLM_ENABLED", "1") == "1"

def complete(prompt: str, *, system: str | None = None, max_tokens: int = 400,
             temperature: float = 0.2) -> str | None:
    if not LLM_ENABLED:
        return None
    messages = ([{"role": "system", "content": system}] if system else []) + \
               [{"role": "user", "content": prompt}]
    try:
        r = httpx.post(f"{LLM_BASE_URL.rstrip('/')}/chat/completions",
                       json={"model": LLM_MODEL, "messages": messages,
                             "max_tokens": max_tokens, "temperature": temperature},
                       headers={"Authorization": f"Bearer {LLM_API_KEY}"}, timeout=30.0)
        r.raise_for_status()
        return r.json()["choices"][0]["message"]["content"]
    except Exception:
        return None
```

Then in each consumer, replace the provider block. Example — `copilot.py` `_llm_answer`
(currently lines ~91–124) collapses to:

```python
from . import llm

def _llm_answer(question: str, context: str) -> str | None:
    prompt = ("You are the ZorDMS assistant. Answer using only the context. "
              "If the answer is not in the context, say you don't know.\n\n"
              f"Context:\n{context}\n\nQuestion: {question}\nAnswer:")
    return llm.complete(prompt, max_tokens=400)
```

Apply the same swap in `summarize.py`, `covenants.py`, `compliance_coach.py`,
`retention_nl.py`, `workflow_designer.py` — replace the `from anthropic import Anthropic` /
`from openai import OpenAI` blocks with a single `llm.complete(...)` call. Each of these
already has a deterministic fallback when no key was set; that fallback now triggers when
`LLM_ENABLED=0` or the endpoint is down, so behavior is strictly safer.

### 4.3 Embeddings (optional upgrade)

`vector.py` already uses local `sentence-transformers` (`all-MiniLM-L6-v2`, 384-dim) with a
deterministic hashing fallback — **no cloud**. The header comment "Swap in OpenAI/Cohere…"
should be deleted to avoid implying a cloud path. To upgrade quality, point it at a local
**TEI** server or load `BAAI/bge-m3` in-process; if you change `EMBED_DIM`, drop and rebuild
the `vector_embeddings` table / Qdrant collection.

### 4.4 Remove provider SDKs

In `python-service/requirements-extras.txt`, delete the block:

```
# Optional LLM providers for the copilot (install the one you actually use).
anthropic==0.28.0
openai==1.30.5
```

(The `openai` *SDK* is not required to call vLLM — the helper above uses plain `httpx`. If you
prefer the SDK ergonomics you may keep `openai` and set `base_url=LLM_BASE_URL`, since vLLM is
OpenAI-compatible; that is still 100% on-prem.) Grep the tree to confirm zero remaining
imports:

```bash
grep -rinE 'anthropic|openai|claude|gpt-' --include='*.py' \
  python-service/app services/ai/src | grep -v '\.venv'
```

---

## 5. Configuration / environment

**`services/ai/.env`** — replace cloud keys:

```ini
VLLM_BASE_URL=http://vllm-vision:8001/v1     # Granite Vision + Qwen-VL
VLLM_API_KEY=EMPTY
CLASSIFIER_MODEL=granite-4.0-3b-vision
EXTRACTOR_MODEL=qwen2.5-vl-7b
INFERENCE_MODE=gpu                            # cpu_degraded → extractive copilot, smaller VL models
# Copilot text model (served by the text vLLM):
COPILOT_VLLM_BASE_URL=http://vllm-text:8002/v1
COPILOT_MODEL=qwen3-30b-a3b-instruct
# (deleted) ANTHROPIC_API_KEY / OPENAI_API_KEY / *_MODEL
```

**`python-service/.env`**:

```ini
LLM_ENABLED=1
LLM_BASE_URL=http://vllm-text:8002/v1
LLM_MODEL=qwen3-30b-a3b-instruct
LLM_API_KEY=EMPTY
# (deleted) ANTHROPIC_API_KEY / OPENAI_API_KEY
```

Set `LLM_ENABLED=0` (or `INFERENCE_MODE=cpu_degraded`) to force the deterministic/extractive
paths everywhere — useful for the pre-GPU validation window noted in the AI README.

---

## 6. Serving the models with vLLM (air-gapped)

```bash
# Vision endpoint (classify + extract share one server; or split for isolation)
vllm serve /models/granite-4.0-3b-vision \
  --served-model-name granite-4.0-3b-vision --port 8001 --quantization awq
vllm serve /models/qwen2.5-vl-7b \
  --served-model-name qwen2.5-vl-7b --port 8011   # constrained decoding via guided_json

# Text endpoint (copilot + all python-service aux features)
vllm serve /models/qwen3-30b-a3b-instruct \
  --served-model-name qwen3-30b-a3b-instruct --port 8002 --max-model-len 32768

# Embeddings (TEI or vLLM)
text-embeddings-router --model-id /models/bge-m3 --port 8080
```

Weights load from the **offline HF bundle on the NFS PVC**; images come from the **offline
Harbor registry**. Add these three model bundles to the air-gap build
(`python-service/docs/AIRGAP.md` "bundle contains" list) and to `verify.sh` health checks.
Scale via HPA (1–4 GPU pods) exactly as the vision pipeline already does.

---

## 7. End-to-end walkthrough — "parse a sample document"

Drop a sample (e.g. a scanned **passport** or **loan application** PNG/PDF) onto
`POST /idp/process` (multipart `file` + `doc_id`). This is the existing pipeline
(`services/ai` `pipeline/orchestrator.py`), now with **zero cloud calls**:

1. **Preprocess** (`pipeline/preprocess.py`) — PDF/image → 300 DPI PNG → base64.
2. **Pre-screen** (`classify/prescreen.py`) — deterministic regex hints from OCR text.
3. **Stage 1 — classify** (`classify/classifier.py`) — **Granite Vision** via vLLM returns
   strict JSON: `{doc_type, confidence, signals}` (schema enum = registered doc types).
4. **Confidence router** (`routing/confidence.py`) — bands from the README:
   ≥0.92 auto-approve · 0.85–0.91 auto-verified (10% sample) · 0.70–0.84 supervisor (48h) ·
   0.50–0.69 human (24h) · <0.50 reject.
5. **Stage 2 — extract** (`extract/extractor.py`) — **Qwen-VL** via vLLM with
   `response_format=json_schema` + `guided_json` = the Pydantic schema for that doc type
   (`schemas/passport.py`, `schemas/loan.py`, `schemas/cid.py`, …). **Every field is extracted
   with a per-doc `confidence`**; output is **Pydantic-validated** — invalid/low-confidence →
   `review_flag` → human-review queue (`/idp/review/*`).
6. **Metadata hand-off** — the validated object (each field + its value + confidence + the
   classification signals) becomes the **catalog payload** to Core DMS, which writes it as the
   document's searchable **metadata** (branch, CID, expiry_date, doc_type, status …).

> So "each piece of information can be extracted and metadata updated" is the existing
> Stage-1→router→Stage-2 flow — it just runs on **local Granite + Qwen** instead of any cloud
> model. Adding a new document type = add a Pydantic schema in `schemas/` and register it; the
> vision models are prompted with that schema's JSON at runtime (no retraining needed).

**Further processing** (now also local, via the text model on `:8002`):

- **Classify into business categories / route** — already done by Stage 1; for finer text-only
  tagging call `llm.complete(...)`.
- **Summarize** the extracted text → `summarize.py`.
- **Loan covenants / metrics + thresholds** → `covenants.py`.
- **Compliance checks / coaching** → `compliance_coach.py`.
- **Natural-language retention & workflow rules** → `retention_nl.py`, `workflow_designer.py`.
- **Ask questions over the corpus** (RAG copilot) → vector search (local embeddings) +
  `copilot/llm_client.py` local answer, grounded + cited.

---

## 8. Validation / acceptance

- [ ] `grep -rinE 'anthropic|openai|claude|gpt-' --include='*.py' python-service/app services/ai/src` → **no hits** (outside `.venv`).
- [ ] `services/ai` tests pass with the cloud paths removed (update `tests/test_copilot.py` to assert the `vllm/...` model label / extractive fallback instead of `anthropic/...`).
- [ ] `/idp/process` on the sample doc returns validated metadata with per-field confidence and correct review routing — endpoint behavior unchanged.
- [ ] Copilot answers are grounded + cited and labeled `vllm/<model>`; with `INFERENCE_MODE=cpu_degraded` it falls back to `grounded-extractive-fallback`.
- [ ] Block egress at the network policy; confirm the services run with **no outbound internet** (air-gap smoke test via `verify.sh`).
- [ ] Performance still meets IDP §7.3 targets (classifier P95 ≤700ms/page, extractor P95 ≤5s/page, end-to-end ≤8s/page).

---

## 9. Effort summary

| Change | Files | Size |
|---|---|---|
| Replace copilot cloud paths with local vLLM | `services/ai/.../copilot/llm_client.py`, `settings.py` | small |
| Shared `llm.py` helper + swap 6 call sites | `python-service/app/services/{llm,copilot,summarize,covenants,compliance_coach,retention_nl,workflow_designer}.py` | small/medium |
| Remove provider SDKs + comments | `requirements-extras.txt`, `vector.py` header | trivial |
| Env + vLLM serving + air-gap bundle | `.env*`, `AIRGAP.md`, deploy manifests | medium |
| Tests | `services/ai/tests/test_copilot.py` | small |

The vision IDP core (the actual "parse the document and extract every field as metadata"
engine) needs **no logic change** — it is already local. The work is removing the text-LLM
cloud lock-in and pointing everything at vLLM.

---

## 10. References (2026)

- Qwen3-VL (Alibaba) — multimodal, vLLM/transformers integration: <https://github.com/qwenlm/qwen3-vl> · Qwen2.5-VL report: <https://arxiv.org/pdf/2502.13923>
- IBM Granite 4.0 3B Vision (enterprise doc extraction, Apache-2.0, native vLLM): <https://huggingface.co/blog/ibm-granite/granite-4-vision> · <https://huggingface.co/ibm-granite/granite-4.0-3b-vision> · <https://www.ibm.com/granite/docs/models/vision>
- Open OCR models overview: <https://huggingface.co/blog/ocr-open-models>
- Best open-weight LLMs / embeddings for on-prem RAG 2026: <https://www.siliconflow.com/articles/en/best-open-source-LLMs-for-RAG> · <https://huggingface.co/blog/daya-shankar/open-source-llm-models-to-run-locally>
- Internal: `services/ai/README.md`, `services/ai/src/zordms_ai/inference/vllm_client.py`, `python-service/docs/AIRGAP.md`, `docs/superpowers/specs/2026-06-23-zordms-idp-design.md`
</content>
</invoke>
