# DocManager — Documentation Index

> **Start here.** This is the map to the DocManager documentation set.

---

## 1. What is DocManager?

**DocManager is the document operating system for banks** — a SaaS platform that captures, understands, governs, and acts on every customer-facing document a bank handles, regardless of which core banking system that bank runs on.

We are **purely a Document Management System** for banking — not a core banking system, not a loan origination system, not an AML transaction-monitoring product. We are the specialist; we integrate with everyone else.

> **What's live on a laptop today (2026-04-17):** NBE pilot SPA (18 screens, 227 KB gzipped), Node session gateway, Python FastAPI service, MinIO content-addressed storage, and **DocBrain running 100% locally on Ollama** (`llama3.2:3b` + `nomic-embed-text`). 22/22 Playwright tests green in ~3s. One command brings it up: `./start.sh`.
> The `docs/` set distinguishes **today's pilot architecture** (see [ARCHITECTURE.md](./ARCHITECTURE.md), [TECHNICAL.md](./TECHNICAL.md)) from the **target multi-tenant SaaS** ([TARGET_ARCHITECTURE.md](./TARGET_ARCHITECTURE.md)). Don't confuse them.

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
