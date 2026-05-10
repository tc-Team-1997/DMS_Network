# DocManager — Documentation Index

> **Start here.** This is the map to the DocManager documentation set.

---

## 1. What is DocManager?

**DocManager is the document operating system for banks** — a SaaS platform that captures, understands, governs, and acts on every customer-facing document a bank handles, regardless of which core banking system that bank runs on.

We are **purely a Document Management System** for banking — not a core banking system, not a loan origination system, not an AML transaction-monitoring product. We are the specialist; we integrate with everyone else.

> **What's live on a laptop today (2026-05-10, post-Wave-D):** the platform is bank-agnostic, local-first, admin-controlled. First deployment: Bank of Bhutan (regulator: Royal Monetary Authority). **28 modules shipped across all four waves** — Foundation + Wave A + Wave B + Wave C + Wave D. Every business value resolves through one of **19 admin-governed `tenant_config` namespaces**. Local-first stack: Ollama (OCR/LLM/Translate) + Tesseract + dlib face-match + Jomolhari Tibetan font + per-tenant KEK envelope encryption + content-addressed FS storage; AWS adapter classes are registered but seeded off. One command brings it up: `./start.sh`.
>
> **Start here for current state:** [CHANGELOG.md](../CHANGELOG.md) (5 release sections covering Foundation, Wave A, Wave B, Wave C + integration fix, Wave D), [PLATFORM_CONFIG.md](./PLATFORM_CONFIG.md) (19-namespace catalog), [VISION.md "Shipping today"](./VISION.md), [ARCHITECTURE.md §10h–§10l](./ARCHITECTURE.md), and the [ADRs 0008–0017](./adr/) (10 ADRs capturing every cross-wave decision). The strategic docs below remain the planning frame; they are aware of all four waves and point readers at the canonical sources for what's actually live.
> The `docs/` set distinguishes **today's pilot architecture** ([ARCHITECTURE.md](./ARCHITECTURE.md), [TECHNICAL.md](./TECHNICAL.md)) from the **target multi-tenant SaaS** ([TARGET_ARCHITECTURE.md](./TARGET_ARCHITECTURE.md)). Don't confuse them.

## 2. The documentation set

Read in this order if you're new to the project.

### Strategy (why we exist)

| Document | One-line summary | Read if |
|---|---|---|
| **[VISION.md](./VISION.md)** | Product vision, positioning, anti-list, moat | You need to understand what we're building and why |
| **[PROJECT.md](./PROJECT.md)** | Where we are today, milestones shipped & next | You want the current state of play |
| **[ROADMAP.md](./ROADMAP.md)** | Quarterly execution plan Q2 2026 → Q4 2027 | You're planning work or hiring |

### Architecture (how it works)

| Document | One-line summary | Read if |
|---|---|---|
| **[ARCHITECTURE.md](./ARCHITECTURE.md)** | **Current** pilot architecture (NBE single-tenant) | You're writing code against the pilot |
| **[TARGET_ARCHITECTURE.md](./TARGET_ARCHITECTURE.md)** | **Target** SaaS architecture (multi-tenant, three deployment modes) | You're designing for the target state |
| **[TECHNICAL.md](./TECHNICAL.md)** | Tactical reference: stack, folder layout, design tokens, HTTP contract | You're onboarding as an engineer |

### Specialised tracks (deep dives)

| Document | One-line summary | Read if |
|---|---|---|
| **[INTEGRATION_STRATEGY.md](./INTEGRATION_STRATEGY.md)** | 10-adapter catalogue + integration hub architecture | You're building or selling adapters |
| **[AI_STRATEGY.md](./AI_STRATEGY.md)** | DocBrain: Ollama/Llama + Qdrant + LangChain + LangSmith | You're working on the AI layer |
| **[SECURITY_COMPLIANCE.md](./SECURITY_COMPLIANCE.md)** | Certifications, controls, threat model, DSAR/audit chain | You're on security or compliance |
| **[ENGINEERING_PRINCIPLES.md](./ENGINEERING_PRINCIPLES.md)** | How we build: module boundaries, testing, CI/CD, hiring signals | You're writing code or reviewing PRs |

### Repo-level guides

| Document | Purpose |
|---|---|
| [../CLAUDE.md](../CLAUDE.md) | Guidance for Claude Code agents working in this repo |
| [../README.md](../README.md) | Quickstart for the current pilot |
| [../python-service/README.md](../python-service/README.md) | Python FastAPI service: running, extending |
| [../mobile/README.md](../mobile/README.md) | Mobile app: branch officer capture |

---

## 3. Who should read what

**Board / exec / investor**
- [VISION.md](./VISION.md) → [ROADMAP.md](./ROADMAP.md) → [PROJECT.md](./PROJECT.md)

**Product manager**
- [VISION.md](./VISION.md) → [ROADMAP.md](./ROADMAP.md) → [INTEGRATION_STRATEGY.md](./INTEGRATION_STRATEGY.md) → [AI_STRATEGY.md](./AI_STRATEGY.md)

**Engineer joining the team**
- [PROJECT.md](./PROJECT.md) → [ARCHITECTURE.md](./ARCHITECTURE.md) → [TECHNICAL.md](./TECHNICAL.md) → [ENGINEERING_PRINCIPLES.md](./ENGINEERING_PRINCIPLES.md)

**Architect / staff engineer**
- [ARCHITECTURE.md](./ARCHITECTURE.md) → [TARGET_ARCHITECTURE.md](./TARGET_ARCHITECTURE.md) → [ROADMAP.md](./ROADMAP.md) → all specialised tracks

**Security / compliance**
- [SECURITY_COMPLIANCE.md](./SECURITY_COMPLIANCE.md) → [ENGINEERING_PRINCIPLES.md](./ENGINEERING_PRINCIPLES.md) → [AI_STRATEGY.md §6 (guardrails)](./AI_STRATEGY.md#6-guardrails-non-negotiable)

**SRE / platform**
- [TARGET_ARCHITECTURE.md](./TARGET_ARCHITECTURE.md) → [ENGINEERING_PRINCIPLES.md](./ENGINEERING_PRINCIPLES.md) → [SECURITY_COMPLIANCE.md](./SECURITY_COMPLIANCE.md)

**Sales / SE / customer-facing**
- [VISION.md](./VISION.md) → [INTEGRATION_STRATEGY.md](./INTEGRATION_STRATEGY.md) → [SECURITY_COMPLIANCE.md](./SECURITY_COMPLIANCE.md)

**AI / ML engineer**
- [AI_STRATEGY.md](./AI_STRATEGY.md) → [TARGET_ARCHITECTURE.md §7](./TARGET_ARCHITECTURE.md#7-ai-layer-docbrain) → [SECURITY_COMPLIANCE.md §4.4](./SECURITY_COMPLIANCE.md#44-information-disclosure)

**Partner / SI / ISV**
- [VISION.md](./VISION.md) → [INTEGRATION_STRATEGY.md §4](./INTEGRATION_STRATEGY.md#4-adapter-architecture) → [ROADMAP.md §6 (Q2 2027)](./ROADMAP.md#6-q2-2027--integration-hub-ga--5-more-adapters)

---

## 4. Document change process

These documents are **the contract** between the team and the business. Changes go through:

1. Open a small RFC: `docs/rfcs/NNN-short-title.md` describing the proposed change.
2. 5-business-day open review; anyone on the team can comment.
3. Pod leads sync approves or defers.
4. Approved → doc updated, RFC archived under `docs/rfcs/_archived/`.
5. Changelog entry at the bottom of the updated doc.

Trivial edits (typos, link fixes, formatting) can go in normal PRs without an RFC.

---

## 5. Changelog for the documentation set

| Date | Doc | Change |
|---|---|---|
| 2026-04-17 | All | Initial strategic document set: VISION, ROADMAP, TARGET_ARCHITECTURE, INTEGRATION_STRATEGY, AI_STRATEGY, SECURITY_COMPLIANCE, ENGINEERING_PRINCIPLES |
| 2026-04-17 | PROJECT.md, ARCHITECTURE.md, TECHNICAL.md | Pre-existing tactical docs — carried forward |
| 2026-04-17 | README, TECHNICAL, ARCHITECTURE, AI_STRATEGY | **DocBrain v0 shipped locally**: Ollama + `llama3.2:3b` + `nomic-embed-text`, MinIO CAS, numpy-cosine vector search, RAG with mandatory citations. 4 new Playwright specs green; docs annotated with "what's live today" sections. |
| 2026-05-09 | TECHNICAL.md, PROJECT.md, ARCHITECTURE.md, README.md | **AML document-screening router + retention scheduler shipped**. 81/81 Playwright tests passing (26 spec files, 25 skipped), ~159 pytest functions. Clarified AML scope: we do not build transaction-monitoring AML, but we DO provide document-level sanctions/watchlist screening as an integration surface. |
| 2026-05-09 | ocr-confidence-tuning | per-doctype dual-handle confidence slider (autofill_floor / high_confidence) with sample preview, in admin Document Types tab. Closes Bhutan F#11/12 and bidding §31. |
| 2026-05-09 | aml-screening | local OFAC/EU/UN watchlist screening pipeline with compliance officer review queue, hit decision audit, and Compliance card integration. Replaces stub aml.py. Risk class high; ADR docs/adr/0001-aml-screening-architecture.md. |
| 2026-05-09 | temenos-cbs-adapter | production Temenos T24 / TCS BaNCS integration with OAuth2, 5-min customer cache, 3-state circuit breaker, PII-masked logging, idempotent document linking. Mock-real adapter swap via env. Risk class high; ADR docs/adr/0002-temenos-cbs-adapter.md. |
| 2026-05-09 | worm-retention-lock | chflags / chattr OS-level immutable enforcement on documents under retention. Lock/unlock/verify endpoints + WormBadge in Repository + Viewer. Risk class high. Closes Bhutan F#32 and bidding §74. |
| 2026-05-09 | document-redaction | pikepdf-based PDF text destruction with post-redaction pdftotext verification. Pointer-draw + manual-numeric region picker, irreversibility checkbox. Risk class high. Closes bidding §46. |
| 2026-05-09 | face-match-kyc | offline biometric verification using face_recognition (dlib). Consent-gated, EXIF-stripped, encoding-only storage (no raw images). New /admin/kyc/face-match SPA route. Risk class high. Closes Bhutan F#9. |
| 2026-05-09 | offline-sync-queue | IndexedDB outbox with AES-GCM encryption + Service Worker BackgroundSync. 24h Idempotency-Key dedup at the server. Risk class medium. Closes Bhutan F#57. |
| 2026-05-09 | dzongkha-translation | fully offline NLLB-200-distilled-600M translation (en ↔ dz, en ↔ ar). 7-day SHA-256 cache, side-by-side viewer. Risk class medium. Closes Bhutan F#14. |
| 2026-05-10 | CHANGELOG.md, postmortems/, UI_UX_REVIEW.md | **Plan 0 — Wave-E1 cross-cutting foundation shipped**. audit_log.policy_decision column persisted on all mutations (Tasks 1–2, 9); SPA-emit audit events via /spa/api/audit/events allow-list (Task 3); 13 route writeAudit callers verified passing policyDecision (merge-guard green); 5 WCAG Level-A fixes + axe-core spec (Task 5); Topbar breadcrumbs + branch+role chip (Task 6); notifications 3-tab popover with severity-colored numeric badge (Task 7); Cmd-K operator-token hints (type:, branch:, customer:) (Task 8); forgot-password full flow Node + SPA + DB + spec (Task 9); PII reveal audit emission (Task 10); i18n parity script + 509 Dzongkha keys (Task 11). 13 commits, 8 Foundation Playwright specs green, 0 critical/serious axe violations. Postmortem includes DoD table, score deltas vs Fortune-50 peers, lessons on helper duplication + component refactor bugs. |
