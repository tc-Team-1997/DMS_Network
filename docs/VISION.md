# DocManager — Vision

> **What we're building, who it's for, what it is not, and why anyone would pay for it.**
>
> Companion docs: [ROADMAP.md](./ROADMAP.md) · [TARGET_ARCHITECTURE.md](./TARGET_ARCHITECTURE.md) · [INTEGRATION_STRATEGY.md](./INTEGRATION_STRATEGY.md) · [AI_STRATEGY.md](./AI_STRATEGY.md) · [SECURITY_COMPLIANCE.md](./SECURITY_COMPLIANCE.md) · [ENGINEERING_PRINCIPLES.md](./ENGINEERING_PRINCIPLES.md)

---

## 1. One-sentence pitch

**DocManager is the document operating system for banks** — a SaaS platform that captures, understands, governs, and acts on every customer-facing document in a bank's lifecycle, regardless of which core banking system that bank runs on.

## 2. What we are

A **vertical SaaS** purpose-built for the banking document lifecycle. Three primary verbs:

| Verb | Meaning |
|---|---|
| **Capture** | Multi-channel ingestion (branch scanner, mobile, email, portal, partner API) + pre-processing + OCR (multilingual, Arabic-aware) |
| **Understand** | AI classification, entity extraction, forgery detection, signature verification, face match, duplicate detection — all on-prem-capable |
| **Govern** | Maker-checker workflows, retention policies, WORM archival, cryptographic audit, DSAR automation, regulator reporting |

Around those three verbs sit: enterprise search, case management, customer-360 document views, e-signature, compliance dashboards, and an integration hub that speaks to every major core banking system, CRM, loan origination, AML, IFRS 9, and regulator endpoint in the world.

## 3. What we are NOT

This is the hardest and most important part of our positioning.

| We do NOT do | Who does |
|---|---|
| Core banking (account, ledger, transactions) | Temenos, FLEXCUBE, Finastra, Mambu, Thought Machine, 10x |
| Card issuing / acquiring / switching | ACI, Pismo, Marqeta, Adyen |
| Loan origination (the credit decision) | nCino, Loandisk, FIS LendingQB, Biz2X |
| AML transaction monitoring | Oracle FCCM, NICE Actimize, FICO TONBELLER, ComplyAdvantage |
| Payments rails (SWIFT, SEPA, real-time) | Volante, Finzly, Modern Treasury |
| General-purpose ECM (SharePoint, OpenText, M-Files) | Microsoft, OpenText, M-Files |
| DIY AI (train my own model for arbitrary docs) | Hugging Face, AWS SageMaker |

We are the **specialist**. A bank buying DocManager is not replacing their CBS. They are replacing: SharePoint + OpenText + a KYC vendor + a dozen point solutions + 200,000 lines of glue code, with **one product** that knows banking documents natively.

**Discipline:** every feature request that sounds like "… and also do X" is evaluated against "would a pure-DMS competitor do this?" If no, we punt and integrate. This is how niche leaders stay leaders.

## 4. Who buys this

### Primary buyer personas

| Persona | Title | What they want | What they fear |
|---|---|---|---|
| **The modernizer** | Chief Digital / Chief Transformation Officer | Retire 15-year-old DMS, reduce branch paper, cut onboarding time 50% | 18-month implementations, vendor lock-in, regulator pushback |
| **The compliance officer** | Chief Compliance Officer | Pass the next audit without heroics, automate CBE/SAMA/RBI reporting | Regulator fines, data-residency violations, auditable-chain breaks |
| **The operator** | Head of Branch Operations / Head of Retail | Branches stop losing documents, makers stop re-keying data | Training cost, staff resistance, downtime during migration |
| **The security officer** | CISO | No breach, no data exfiltration, on-prem control of sensitive docs | SaaS concentration risk, third-party LLMs leaking PII, supply-chain attacks |

### Organisations

| Tier | Profile | Examples | Annual contract |
|---|---|---|---|
| **Tier-1** | Central banks, top-5 national banks, regulators | CBE, SAMA, RBI, ECB, national banks | $1M – $5M+, dedicated deployment, air-gapped option |
| **Tier-2** | Large commercial banks (>$50B assets) | Attijariwafa, QNB, Emirates NBD, Alinma | $300K – $1M, silo SaaS + optional private region |
| **Tier-3** | Mid-market banks, digital banks, Islamic banks, microfinance | Wise, Revolut-tier, Bahrain neobanks | $50K – $300K, pooled multi-tenant SaaS |
| **Tier-4 (future)** | Fintechs that need KYC/doc operations | BNPL, lending startups, crypto onramps | $10K – $50K, self-serve, usage-based |

We start at **Tier-1 (NBE)**, prove the silo/on-prem story, then work down-market. Every tier uses the **same codebase**, differing only in deployment mode and feature packaging.

## 5. The moat — why we win

Banking DMS is not an unclaimed market. OpenText, Newgen, Kofax (Tungsten), Xerox DocuWare, Hyland OnBase, and a dozen local players sell here. Our durable advantages:

### 5.1 AI-native, not AI-bolted-on

Legacy incumbents bought OCR engines in 2005 and stapled "AI" on top in 2024. We're the opposite: a modern document AI pipeline is the **spine**, not the garnish. Every classification, extraction, summarization, search, and workflow action routes through **DocBrain** — our in-house stack of Llama 3.1 (on-prem via Ollama) + vector retrieval (Qdrant/pgvector) + LangChain orchestration + LangSmith observability. See [AI_STRATEGY.md](./AI_STRATEGY.md).

**Why this is defensible:**
- Banks refuse to send customer documents to OpenAI. Our on-prem Llama answers this. Silicon Valley SaaS cannot.
- Fine-tuning on bank-specific corpora (Arabic KYC, SWIFT MT, loan applications) produces classifiers 20+ points better than general-purpose LLMs. The incumbents don't have the data flywheel; we do, from day one.

### 5.2 Integration-first architecture

Every DMS vendor says "we integrate with anything." Almost none actually do. We commit to **10 pre-built, contract-tested adapters at GA** (Temenos T24, FLEXCUBE, Finastra, Mambu, Thought Machine, Salesforce FS, DocuSign, SWIFT, ISO 20022, Microsoft Fabric) with visual field-mapping and replay tooling. See [INTEGRATION_STRATEGY.md](./INTEGRATION_STRATEGY.md).

**Why this is defensible:**
- Every bank has a 10-year-old CBS. Implementation time is the #1 buying criterion. If we can onboard a Temenos bank in 30 days and OpenText takes 9 months, we win every deal — even at 3× the price.

### 5.3 Triple deployment, one codebase

Most SaaS competitors force "cloud or bust." Most on-prem competitors are stuck in 2015. We ship the same code as:

| Mode | Isolation | Who | Infrastructure |
|---|---|---|---|
| **Pooled SaaS** | Row-level (Postgres RLS) | Tier-3, Tier-4 | Our multi-region K8s |
| **Silo SaaS** | Schema-per-tenant + dedicated namespace | Tier-2 | Our K8s, customer-dedicated data stores |
| **Dedicated on-prem** | Entire stack in customer's datacenter / VPC | Tier-1, sovereign deployments | Customer's K8s or Nomad |

**Why this is defensible:**
- A central bank can never go pooled-SaaS. A digital bank never wants to manage on-prem. We address both without forking.
- Air-gapped option (see `scripts/build_airgap.sh` — infrastructure already stubbed) unlocks markets our competitors cannot enter.

### 5.4 Banking-grade compliance as a product feature, not a PDF

SOC 2 Type II + ISO 27001 + regional certs (NCA ECC for KSA, CBE for Egypt, RBI for India, PCI-DSS where relevant) are **entry tickets**. Our differentiator is **compliance automation in the product**:

- Data residency is a per-tenant config, not a contract addendum.
- DSAR (Data Subject Access Request) is a button — we have `/routers/dsar.py` already.
- Retention policies are enforced by the workflow engine, not a manual quarterly review.
- Every audit event is cryptographically chained and optionally anchored to an external ledger (see `/routers/anchor.py`).
- Regulator-specific report generation (CBE quarterly, SAMA monthly) is one-click from the UI.

**Why this is defensible:** building compliance-as-a-feature requires the audit chain and tenant isolation from day one. Retrofitting it into a legacy DMS is 18–24 months of rework.

### 5.5 Workflow engine that compliance officers actually edit

BPMN 2.0 + DMN decision tables, visual designer, versioning, simulation. Compliance changes a KYC rule in the UI; it deploys; old instances finish on the old rule; the change is audited. Incumbents still require a professional-services engagement for every workflow change. See `/routers/workflow_designer.py` (stub exists) + [TARGET_ARCHITECTURE.md §6](./TARGET_ARCHITECTURE.md#6-workflow-engine).

## 6. What "excellent" looks like — the north-star metrics

We measure ourselves on **customer outcomes**, not engineering output. The numbers we commit to:

| Metric | Year-1 target | Year-3 target |
|---|---|---|
| Document onboarding time (new bank, Temenos-based) | **≤ 45 days** | **≤ 14 days** |
| OCR accuracy on Arabic + English mixed docs | **≥ 96%** | **≥ 99%** |
| End-to-end KYC approval cycle time (p50) | **≤ 30 minutes** | **≤ 5 minutes** |
| Customer NPS | **≥ 50** | **≥ 65** |
| Uptime (SaaS) | **99.9%** | **99.95%** |
| First compliance audit failure rate (per customer) | **0** | **0** |
| Fully automated documents (no human review) | **35%** | **75%** |
| Annual contract value retention | **≥ 110%** (expansion) | **≥ 125%** |
| Cost per document processed | **< $0.05** | **< $0.01** |

## 7. Product principles (the ones we won't trade off)

1. **Customers own their data.** BYOK encryption, data residency, export-on-demand. Always.
2. **On-prem option is never second-class.** Every feature must ship on-prem in the same release cycle.
3. **AI is inspected, never blindly trusted.** Every AI decision produces citations, confidence, and a human-reviewable trace. No black boxes.
4. **The integration contract is code, not a wiki.** Adapters are tested against vendor sandboxes in CI. If we can't test it, we don't claim it.
5. **Compliance is a unit test, not a promise.** Every regulatory rule is a runnable check in our pipeline.
6. **No feature without observability.** Metrics, traces, logs — or it doesn't ship.
7. **No tenant leakage. Ever.** If there is one bug we must never ship, it's a tenant-isolation violation. We build the system so that leakage is impossible, not merely unlikely.

## 8. What a customer gets on day one

The minimum sellable unit at GA (Q3 2026):

- **DocManager web app** — apex-aligned UI, 15 screens (M1 + M2 + M3 shipped).
- **DocManager mobile** — branch officer capture, offline-first, biometric login.
- **DocBrain AI** — OCR + classification + NER + RAG + forgery detection (English + Arabic GA; French / Urdu Q1 2027).
- **Workflow engine** — BPMN designer + 20 pre-built banking workflow templates (onboarding, loan KYC, expiry renewal, trade finance, 10+ more).
- **Integration hub** — 10 adapters (see §5.2).
- **Compliance pack** — SOC 2 Type II report, ISO 27001 cert, DSAR automation, retention policy templates, regulator report templates (CBE, SAMA to start).
- **Tenant admin** — self-service user mgmt, SSO config, branding, data residency, encryption keys, audit viewer.
- **Developer portal** — API docs, SDKs (TS, Python, Java), sandbox tenant, webhooks.
- **SLAs** — 99.9% uptime, 24/7 support (tier-1), named CSM (tier-2+), 4-hour P1 response.

## 9. What we say no to — the anti-roadmap

To protect focus, these are things we deliberately do not build:

- **Ledger / accounting.** Every time we touch money movement, we become a CBS competitor. No.
- **Transaction monitoring.** AML vendors have this. We integrate and surface their output — we don't score transactions.
- **Customer-facing portal as our own product.** We provide embed-ready components; the bank owns the portal brand.
- **Our own signing certificate authority.** We integrate with DocuSign, Adobe Sign, and national eID schemes.
- **Our own MLOps platform.** We use LangSmith + Arize for AI observability. We don't build Weights & Biases.
- **Our own BI tool.** Superset / Metabase / customer's Tableau for exploration. We ship operational dashboards in-product; everything else goes out via CDC.
- **SMS / WhatsApp orchestration.** Twilio, Infobip, our workflow engine calls out.
- **Video KYC session management.** We integrate; we don't run the video infrastructure.

## 10. The commercial thesis in one diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│   Legacy DMS (Newgen, OnBase, DocuWare, SharePoint, OpenText)                │
│   └─ 12-month implementations · bolt-on AI · on-prem only or cloud only ·    │
│      generic ECM · no banking-native workflows · brittle integrations        │
│                                                                              │
│                    │                                                         │
│                    │    ▼  displaced by ▼                                    │
│                    │                                                         │
│   DocManager       │                                                         │
│   ├─ 30-45 day onboarding (adapter library)                                  │
│   ├─ AI-native, on-prem-capable (Llama + Qdrant + LangChain)                 │
│   ├─ BPMN workflow engine (compliance officers edit, no PS engagement)       │
│   ├─ Triple deployment (pooled / silo / dedicated)                           │
│   ├─ Compliance automation (DSAR, CBE/SAMA reports, retention, audit chain)  │
│   └─ Arabic + English from day one (MENA-first, English-world second)        │
│                                                                              │
│                    ▼                                                         │
│                                                                              │
│   ANY bank CBS (Temenos, FLEXCUBE, Finastra, Mambu, Thought Machine, …)      │
│   + CRM (Salesforce FS, Microsoft Dynamics)                                  │
│   + LOS (nCino, FIS, custom)                                                 │
│   + AML (Actimize, FCCM, ComplyAdvantage)                                    │
│   + Regulator endpoints (CBE, SAMA, RBI, ECB, …)                             │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

## 11. How we know we've won

- **30 bank logos** across MENA + Africa + South Asia + EU by end of year 3.
- **First central-bank reference** signed by end of year 2.
- **Top-2 analyst-ranked Banking DMS** (Gartner MQ / Forrester Wave) by end of year 3.
- **$10M+ ARR** end of year 2, **$50M+ ARR** end of year 4.
- **< 5% gross churn**; **≥ 125% net revenue retention**.

Not promises — targets. The rest of this document set explains how.
