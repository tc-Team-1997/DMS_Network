# ZorDMS — Intelligent Document Processing (IDP) Design Specification

**Bank of Bhutan | Tender No. 000/BoB/Tender/2026/009**
**Version 1.0 | June 2026 | CONFIDENTIAL**
**Prepared by:** ZorFinotech Pvt. Ltd.

> **Status:** Authoritative design for the four IDP capabilities (Metadata Extraction, Auto
> Cataloging, Auto Directory Mapping, Auto Doc-Type Mapping). Binding for the **AI/IDP service
> (service #7)** and the related Core DMS components (indexing schemas, catalog rule engine,
> directory mapper, per-folder ACL inheritance) and Notify (expiry alert tiers). Cross-referenced
> by `2026-06-23-zordms-microservices-architecture-design.md`. Implementation lands primarily in
> **Plan 7 (AI/IDP)** and **Plan 2 (Core DMS)**.

---

## 1. Executive Summary

ZorFinotech Pvt. Ltd. has been awarded Tender No. 000/BoB/Tender/2026/009 for the Supply,
Delivery, and Commissioning of a DMS for Bank of Bhutan (BoB). This document defines the
technical design for four core IDP capabilities that underpin the ZorDMS platform:

| Capability | What it Does | BoB Tender Items |
|---|---|---|
| Document Metadata Extraction | AI-driven extraction of structured fields (Name, DOB, Document No, Expiry Date) from scanned/uploaded documents using VLM inference | 9, 10, 11, 13 |
| Auto Cataloging | Automatic assignment of every ingested document to a catalog category, populating mandatory index fields without human intervention | 8, 9, 12, 25 |
| Auto Directory Mapping | Rule-based routing of classified documents into the correct folder hierarchy (Customer → CID → KYC → Identity, etc.) | 15, 16 |
| Auto Doc Type Mapping | Two-stage AI pipeline that determines document type with confidence scoring before extraction proceeds | 9, 12 |

All capabilities run fully **on-premises inside BoB's air-gapped data centre** (Thimphu DC + DR
site), with no cloud dependency. The inference stack uses **vLLM on NVIDIA L40S GPU nodes**,
replacing the POC-phase Ollama-on-Mac approach. Data residency and RMA audit compliance are
first-class constraints. Taxonomy is sourced from the **India + Bhutan DMS Reference Pack**
(Excel: Document_Catalog, Metadata_Schema, Standard_Frameworks, Classification_Rules,
Retention_Compliance, Mapping_Template).

---

## 2. BoB Tender Requirements — Cross-Reference

| Item # | Category | Requirement Description | Addressed By | Status |
|---|---|---|---|---|
| 9 | Capture | OCR-based auto classification and metadata capture | Doc Type Mapping + Metadata Extraction | COVERED |
| 10 | Indexing | Unlimited metadata fields with multiple data types | Metadata Schema / Pydantic models | COVERED |
| 11 | Indexing | Mandatory, unique, searchable metadata configuration | Metadata Extraction + Catalog rules | COVERED |
| 12 | AI | AI-based classification of CID and Passport documents | Auto Doc Type Mapping — Stage 1 Classifier | COVERED |
| 13 | AI | Automatic extraction of Name, DOB, Document No, Expiry Date | Metadata Extraction — Stage 2 Extractor | COVERED |
| 14 | AI | Sends alerts before a document expires | Auto Cataloging — expiry-field trigger | COVERED |
| 15 | Repository | Folder-based document repository with permissions | Auto Directory Mapping | COVERED |
| 16 | Repository | Document version control with rollback support | Directory Mapping + DMS versioning layer | COVERED |
| 25 | Alerts | Identifies expiry dates during scanning/indexing; generates alerts | Auto Cataloging — expiry field population | COVERED |
| 27 | Integration | Open APIs: Core Banking, KYC, LOS, Digital Banking, ERP, CRM | Integration layer (BaNCS connector + REST) | IN SCOPE |

---

## 3. Document Metadata Extraction

Stage 2 of the two-stage IDP pipeline. Fires after doc type is confirmed; receives the document
image + confirmed type label; returns a validated, typed JSON object persisted to the DMS index.

### 3.1 Pipeline Position

| Stage | Component | Model | Output |
|---|---|---|---|
| Stage 0 — Ingest | Scan / Upload gateway | — | Raw image / PDF page |
| Stage 1 — Classify | Doc Type Classifier | Granite 3.2 Vision 2B | doc_type label + confidence |
| Stage 2 — Extract | Metadata Extractor | Qwen2.5-VL 7B | Typed JSON + validation result |
| Stage 3 — Catalog | Catalog & Directory Router | Rule engine (Python) | Folder path + index entry |
| Stage 4 — Alert | Expiry Alert Engine | Scheduled job | Alert events (email/SMS/WhatsApp) |

### 3.2 Metadata Schema — BoB Document Types

JSON schema enforced at token level by vLLM's constrained decoding (eliminates hallucinated
field names). Fields derived from the Reference Pack Metadata_Schema sheet.

#### 3.2.1 Bhutan CID Card (4G) — Primary KYC Document

| Field | Type | Req | Indexed | PII | Source | Validation |
|---|---|---|---|---|---|---|
| doc_type | string | Yes | Yes | No | Classifier | ENUM: BT_CID_4G |
| cid_no | string | Yes | Yes | Yes | Zone B front face | `^[0-9]{11}$` |
| full_name | string | Yes | Yes | Yes | Zone B | Non-empty, Latin + Dzongkha |
| dob | date | Yes | Yes | Yes | Zone A lower band | ISO 8601, age 0–120 |
| sex | string | No | No | No | Zone A | ENUM: M / F / O |
| issue_date | date | Yes | Yes | No | Zone A bottom | ISO 8601, ≤ today |
| expiry_date | date | Yes | Yes | No | Zone A bottom | ISO 8601, > issue_date |
| dzongkhag | string | Yes | Yes | No | Zone B | ENUM: 20 Bhutan districts |
| village | string | No | No | No | Zone B address | Free text ≤ 100 chars |
| mrz_line1 | string | No | No | No | MRZ strip | IDNBT + 9 chars regex |
| mrz_line2 | string | No | No | No | MRZ strip | MRZ date + check digit regex |
| confidence | float | Yes | No | No | Extractor | 0.0–1.0 |
| review_flag | boolean | Yes | No | No | Pipeline | True if confidence < 0.85 |

#### 3.2.2 Bhutan Passport

| Field | Type | Req | Indexed | PII | Source | Validation |
|---|---|---|---|---|---|---|
| doc_type | string | Yes | Yes | No | Classifier | ENUM: BT_PASSPORT |
| passport_no | string | Yes | Yes | Yes | Page 2 data zone | `^[A-Z][0-9]{7}$` |
| surname | string | Yes | Yes | Yes | Data zone | Non-empty Latin |
| given_names | string | Yes | Yes | Yes | Data zone | Non-empty Latin |
| nationality | string | Yes | No | No | Data zone | Typically BTN |
| dob | date | Yes | Yes | Yes | Data zone | ISO 8601 |
| sex | string | No | No | No | Data zone | ENUM: M / F |
| place_of_birth | string | No | No | No | Data zone | Free text |
| issue_date | date | Yes | Yes | No | Data zone | ISO 8601 |
| expiry_date | date | Yes | Yes | No | Data zone | ISO 8601 |
| mrz_line1 | string | No | No | No | MRZ strip | `P<BTN` prefix regex |
| mrz_line2 | string | No | No | No | MRZ strip | 9-digit doc no regex |
| confidence | float | Yes | No | No | Extractor | 0.0–1.0 |

#### 3.2.3 BoB Banking Documents — Loan Application

| Field | Type | Req | Indexed | PII | Notes |
|---|---|---|---|---|---|
| doc_type | string | Yes | Yes | No | ENUM: BOB_LOAN_APPLICATION |
| application_no | string | Yes | Yes | No | BoB internal number regex |
| applicant_cid | string | Yes | Yes | Yes | CID format if BT citizen |
| applicant_name | string | Yes | Yes | Yes | Latin text |
| loan_type | string | Yes | Yes | No | ENUM: HOME / AUTO / AGRI / BUSINESS / PERSONAL |
| loan_amount | float | Yes | Yes | No | BTN amount |
| branch_code | string | Yes | Yes | No | BoB branch code |
| submission_date | date | Yes | Yes | No | ISO 8601 |
| officer_id | string | No | Yes | No | Staff ID |
| confidence | float | Yes | No | No | 0.0–1.0 |

### 3.3 System-Level Metadata (All Document Types)

Populated by the DMS ingest layer (not the AI extractor):

| Field | Source | Type | Notes |
|---|---|---|---|
| doc_id | UUID v4 on ingest | UUID | Primary key |
| file_hash_sha256 | Computed on raw file | string | Immutable audit anchor |
| ingest_timestamp | System clock | datetime | UTC, ISO 8601 |
| source_channel | API tag | string | ENUM: SCAN / UPLOAD / EMAIL / BaNCS_FEED |
| ingest_user_id | Auth context | string | BoB staff ID or SYSTEM |
| raw_file_path | Object storage | string | S3-compatible path (MinIO on-prem) |
| page_count | PDF parser | integer | 1 for images |
| file_size_bytes | OS stat | integer | Pre-compression |
| ocr_engine | Pipeline config | string | Tesseract 5.x / vLLM Qwen |
| processing_ms | Timer | integer | End-to-end IDP latency |
| retention_years | Catalog rule lookup | integer | From Retention_Compliance sheet |
| destruction_date | Computed | date | ingest_date + retention_years |

---

## 4. Auto Cataloging

Assigns every document to the correct catalog category, populates mandatory index fields, and
triggers downstream alert rules — without human intervention. Runs in Stage 3, consuming the
doc_type label (Stage 1) and extracted metadata (Stage 2).

### 4.1 Catalog Taxonomy — BoB Domain

| Catalog Category | Doc Types Covered | Mandatory Index Fields | Alert Rule |
|---|---|---|---|
| KYC / Identity | BT_CID_4G, BT_PASSPORT, BT_CITIZENSHIP, IN_PAN, FOREIGN_PASSPORT | cid_no / passport_no, full_name, dob, expiry_date | Alert 60/30/7 days before expiry_date |
| Account Opening | BOB_ACCOUNT_FORM, SEPA_MANDATE, NOMINEE_FORM | account_no, applicant_cid, branch_code, submission_date | None (point-in-time) |
| Loan & Credit | BOB_LOAN_APPLICATION, COLLATERAL_DEED, MORTGAGE_DEED | application_no, loan_type, loan_amount, applicant_cid | Alert if pending review > 5 days |
| Compliance & AML | SAR_REPORT, CTR, WIRE_TRANSFER_LOG | report_no, reporting_officer, filing_date, status | Restricted access — compliance role only |
| HR & Staff | EMPLOYMENT_CONTRACT, RCSC_CERT, PAYSLIP | staff_id, staff_name, contract_start, contract_end | Alert 90 days before contract_end |
| Procurement | PURCHASE_ORDER, INVOICE, GOODS_RECEIPT | po_no, vendor_id, amount_bnt, approval_status | Alert if invoice un-matched > 30 days |
| Legal & Audit | BOARD_RESOLUTION, RMA_INSPECTION_REPORT, RAA_AUDIT_REPORT | ref_no, issue_date, subject | Permanent retention — no destruction |
| General Corr. | LETTER, MEMO, CIRCULAR, FAX | from_org, to_org, ref_no, date | Default 7-year retention |

### 4.2 Cataloging Decision Logic (top-down, first match wins)

| Priority | Condition | Action |
|---|---|---|
| 1 — Blocked | confidence < 0.50 OR mandatory field missing | Route to HUMAN_REVIEW queue; suppress catalog assignment |
| 2 — Low Conf. | 0.50 ≤ confidence < 0.85 | Assign catalog tentatively; flag review_flag = true; notify supervisor |
| 3 — CID | doc_type IN (BT_CID_4G, BT_CITIZENSHIP) | Catalog → KYC/Identity; link to Customer by cid_no |
| 4 — Passport | doc_type IN (BT_PASSPORT, FOREIGN_PASSPORT) | Catalog → KYC/Identity; link by passport_no; check duplicate |
| 5 — Loan | doc_type LIKE BOB_LOAN_% | Catalog → Loan & Credit; link by application_no |
| 6 — Compliance | doc_type IN (SAR, CTR, WIRE_TRANSFER_LOG) | Catalog → Compliance & AML; apply restricted ACL |
| 7 — HR | doc_type LIKE STAFF_% OR EMPLOYMENT_% | Catalog → HR & Staff; link by staff_id |
| 8 — Default | No specific rule matched | Catalog → General Corr.; flag for manual review |

### 4.3 Expiry-Date Alert Population (BoB Tender Item 25)

| Alert Tier | Trigger (days before expiry) | Channel | Recipients | Covers |
|---|---|---|---|---|
| T-60 | 60 days | Email | Branch Manager + Relationship Officer | Passports, CID cards |
| T-30 | 30 days | Email + SMS | RM + Customer (if mobile on file) | Passports, CID cards |
| T-07 | 7 days | Email + SMS + WhatsApp | All above + Compliance | All expiry-tracked docs |
| T-00 | 0 (today) | Email + WhatsApp | Branch Head + IT-DMS Admin | Expired — immediate action |

---

## 5. Auto Directory Mapping

Translates catalog assignment + extracted metadata into a deterministic folder path within the
ZorDMS repository. Every document lands in exactly one logical folder based on type + linked
entity (CID, account no, loan no, or department).

### 5.1 Folder Hierarchy — Root: `/BoB/{Domain}/{Entity}/{SubDomain}/{DocType}/{Year}/`

| Domain | Entity Key | Sub-Domain Examples | Example Path |
|---|---|---|---|
| Customers | CID No. | KYC, Accounts, Loans, Cards | `/BoB/Customers/10112345678/KYC/Identity/2026/` |
| Customers | CID No. | Loans | `/BoB/Customers/10112345678/Loans/HOME/LN2026001/` |
| Customers | Account No. | Statements, Mandates | `/BoB/Customers/10112345678/Accounts/SB001234/2026/` |
| Operations | Branch Code | HR, Procurement, Audit | `/BoB/Operations/THI001/HR/Contracts/2026/` |
| Compliance | Report Type | AML, SAR, CTR, RMA Inspection | `/BoB/Compliance/AML/SAR/2026/Q2/` |
| Legal | Doc Category | Board Resolutions, RAA Reports | `/BoB/Legal/BoardResolutions/2026/` |
| IT | System Name | Audit Logs, Backups, Config | `/BoB/IT/ZorDMS/AuditLogs/2026/` |

### 5.2 Directory Mapping Rules

| Doc Type / Group | Primary Key | Folder Path Template |
|---|---|---|
| BT_CID_4G, BT_CITIZENSHIP | cid_no | `/BoB/Customers/{cid_no}/KYC/Identity/{year}/` |
| BT_PASSPORT, FOREIGN_PASSPORT | cid_no or name | `/BoB/Customers/{cid_no_or_UNK}/KYC/Travel/{year}/` |
| BOB_ACCOUNT_FORM | cid_no + acct_no | `/BoB/Customers/{cid_no}/Accounts/{acct_no}/{year}/` |
| BOB_LOAN_APPLICATION | cid_no + loan_no | `/BoB/Customers/{cid_no}/Loans/{loan_type}/{loan_no}/` |
| COLLATERAL_DEED, MORTGAGE | loan_no | `/BoB/Customers/{cid_no}/Loans/{loan_no}/Security/` |
| EMPLOYMENT_CONTRACT | staff_id | `/BoB/Operations/{branch_code}/HR/Contracts/{year}/` |
| PURCHASE_ORDER, INVOICE | po_no | `/BoB/Operations/{branch_code}/Procurement/{year}/` |
| SAR_REPORT | report_no | `/BoB/Compliance/AML/SAR/{year}/{quarter}/` |
| CTR | report_no | `/BoB/Compliance/AML/CTR/{year}/{quarter}/` |
| RMA_INSPECTION_REPORT | ref_no | `/BoB/Compliance/RMA/{year}/` |
| RAA_AUDIT_REPORT | ref_no | `/BoB/Legal/RAA_Audit/{year}/` |
| BOARD_RESOLUTION | ref_no | `/BoB/Legal/BoardResolutions/{year}/` |
| LETTER, MEMO, CIRCULAR | ref_no | `/BoB/General/{from_org}/{year}/` |
| UNKNOWN / LOW CONFIDENCE | doc_id | `/BoB/_Review/Pending/{date}/` |

### 5.3 Permission Inheritance Model

Every folder node carries an ACL inherited by child nodes. Role assignments follow BoB's
existing LDAP/AD groups.

| Folder Domain | Read Access | Write / Classify | Delete / Reclassify |
|---|---|---|---|
| Customers — KYC | RM + Branch Manager + Compliance | DMS Operator | Compliance Manager only |
| Customers — Loans | Credit Officer + Branch Manager | Credit Officer | Head of Credit |
| Compliance — AML | Compliance Officer + Audit | Compliance Officer | CISO (RAA-audited) |
| Legal | Legal + Board Secretary | Legal | Legal + CEO approval |
| IT — Audit Logs | CISO + Internal Audit | SYSTEM only | Never (immutable) |
| General Corr. | Branch staff | Initiating officer | Supervisor |
| _Review/Pending | DMS Admin + Supervisor | DMS Admin | DMS Admin |

---

## 6. Auto Doc Type Mapping

Stage 1 of the IDP pipeline. A fast, lightweight VLM determines the document type before the
heavier extractor is invoked, keeping end-to-end latency under 8 s/page at >92% accuracy.

### 6.1 Two-Stage Model Architecture (Production — On-Prem BoB)

| Attribute | Stage 1 — Classifier | Stage 2 — Extractor |
|---|---|---|
| Model | Granite 3.2 Vision 2B (IBM) | Qwen2.5-VL 7B (Alibaba) |
| Quantization | INT4 via vLLM AWQ | Q4_K_M via vLLM GPTQ |
| VRAM | ~2.5 GB | ~5.5 GB |
| Latency | 300–700 ms/page | 2–5 s/page (structured JSON) |
| Inference | vLLM on NVIDIA L40S | vLLM on NVIDIA L40S |
| Output | doc_type label + confidence | Typed JSON — Pydantic-validated |
| Decoding | Token-level constrained JSON (format=schema) | Token-level constrained JSON (full schema) |
| Fallback | N/A — always returns a label | Partial extraction + review_flag=true |

### 6.2 Document Type Taxonomy — BoB Full Registry

| Doc Type Code | Description | Jurisdiction | Issuer | Classification Signal |
|---|---|---|---|---|
| BT_CID_4G | Bhutan CID Card (4G, 2025+) | BT | DCRC | 11-digit CID / 'Kingdom of Bhutan' / NFC chip |
| BT_CITIZENSHIP | Bhutan Citizenship Certificate | BT | DCRC | 'Citizenship Certificate' / Dzongkha title |
| BT_PASSPORT | Bhutan Passport (biometric) | BT | DoI / MoFA | `P<BTN` MRZ prefix / maroon cover |
| FOREIGN_PASSPORT | Non-Bhutan passport | INT | Foreign state | `P<` MRZ + non-BTN nationality |
| IN_PAN | Indian PAN Card | IN | CBDT / NSDL | `^[A-Z]{5}[0-9]{4}[A-Z]$` / 'Income Tax Dept' |
| IN_AADHAAR | Indian Aadhaar Card | IN | UIDAI | `^[0-9]{4} [0-9]{4} [0-9]{4}$` / 'Unique Identification' |
| BOB_ACCOUNT_FORM | BoB Account Opening Form | BT | Bank of Bhutan | BoB logo + 'Account Opening Form' |
| BOB_LOAN_APPLICATION | BoB Loan Application | BT | Bank of Bhutan | BoB logo + 'Loan Application' / loan checkbox |
| COLLATERAL_DEED | Property/Collateral Deed | BT | NLCS / Notary | 'Deed of' / NLCS stamp / cadastral ref |
| BOB_INVOICE | BoB-related Invoice | BT | Vendor | TAX INVOICE / TPN `^[0-9]{9}$` |
| PURCHASE_ORDER | Bank Purchase Order | BT | Bank of Bhutan | BoB letterhead + 'Purchase Order No.' |
| SAR_REPORT | Suspicious Activity Report | BT | FIU / FID | 'Suspicious Activity' / FIU ref |
| CTR | Cash Transaction Report | BT | RMA / FIU | 'Cash Transaction' / threshold indicator |
| EMPLOYMENT_CONTRACT | Staff Employment Contract | BT | Bank of Bhutan HR | BoB HR letterhead + 'Employment Contract' |
| BOARD_RESOLUTION | Board Resolution | BT | BoB Board Sec. | 'Board Resolution No.' / meeting date + quorum |
| RMA_INSPECTION | RMA Inspection Report | BT | RMA | RMA letterhead + 'Inspection Report' + bank name |
| RAA_AUDIT_REPORT | RAA Audit Report | BT | RAA | RAA letterhead + 'Audit Report' / year suffix |
| GENERAL_LETTER | General Correspondence | ANY | Various | Fallback after specific types fail |
| UNKNOWN | Unclassified / Unreadable | ANY | — | Confidence < 0.50 OR no pattern match |

### 6.3 Classification Signal Priority

| Priority | Signal Type | Examples | Reliability |
|---|---|---|---|
| 1 — MRZ | Machine-Readable Zone (regex) | `P<BTN`, `IDNBT` formats | Very High (near-deterministic) |
| 2 — ID regex | Structured number patterns | CID 11 digits, TPN 9 digits | High |
| 3 — Logo | Issuing authority logo (vision) | BoB logo, DCRC seal, RMA logo | High |
| 4 — Header | Document title text (OCR) | 'Loan Application', 'SAR Report' | Medium |
| 5 — Layout | Spatial structure / form fields | Checkbox grids, table structure | Medium |
| 6 — Language | Dzongkha script detection | CID Dzongkha name zone | Medium |
| 7 — Fallback | Keyword bag-of-words | 'Invoice', 'Contract', 'Deed' | Low |

### 6.4 Confidence Threshold Policy

| Confidence Band | Action | Catalog Assignment | Review Queue |
|---|---|---|---|
| ≥ 0.92 | Auto-approve and proceed to extraction | Full assignment | No |
| 0.85–0.91 | Proceed; mark 'auto-verified' | Full assignment | Sampled (10%) |
| 0.70–0.84 | Proceed; flag for supervisor review | Tentative assignment | Yes — 48-hr SLA |
| 0.50–0.69 | Hold extraction; route to human review | Pending | Yes — 24-hr SLA |
| < 0.50 | Reject auto-processing; escalate | None | Yes — Immediate |

---

## 7. Production AI Pipeline Architecture — BoB Air-Gapped Deployment

### 7.1 Inference Stack (Replacing Ollama POC)

| Component | POC (Mac M5 Pro) | Production (BoB On-Prem) | Notes |
|---|---|---|---|
| Inference Server | Ollama 0.6.x | vLLM 0.6.x (self-hosted) | OpenAI-compatible REST API |
| GPU Hardware | Apple Silicon MPS | NVIDIA L40S × 2 (minimum) | 4–6 month lead time to Bhutan |
| Classifier Model | Granite 3.2 Vision 2B via Ollama | Granite 3.2 Vision 2B via vLLM AWQ | Offline HuggingFace bundle |
| Extractor Model | Qwen2.5-VL 7B via Ollama | Qwen2.5-VL 7B via vLLM GPTQ | Token-level JSON enforcement |
| Container Registry | Local | Offline Harbor registry | Air-gap requires image pre-bundling |
| Model Storage | ~/.ollama/models | NFS PVC on RKE2 cluster | Shared across GPU pods |
| Scaling | Single process | Kubernetes HPA (1–4 GPU pods) | Target: 12 pages/min burst |

### 7.2 IDP Processing Flow (End-to-End)

1. Document arrives via Scan Gateway, Web Upload, or BaNCS/LOS API feed.
2. Pre-processing: PDF → page images (300 DPI PNG) via Poppler / Pillow; deskew + denoise.
3. Stage 1: Classifier `POST /v1/completions` → `{doc_type, confidence, signals[]}`.
4. Confidence router: ≥ 0.85 → proceed; 0.50–0.84 → tentative; < 0.50 → human queue.
5. Stage 2: Extractor `POST /v1/completions` with doc_type + image → typed JSON.
6. Pydantic validation: field types, mandatory check, regex, business rules.
7. Catalog engine: rule evaluation → catalog_category + alert_schedule population.
8. Directory mapper: path template resolution → folder creation (if absent) + ACL inheritance.
9. DMS index write: PostgreSQL metadata + MinIO object storage.
10. Audit log entry: immutable record in Elasticsearch / ClickHouse (RAA-compliant).

### 7.3 Performance Targets

| Metric | Target | Basis |
|---|---|---|
| Classifier latency (P95) | ≤ 700 ms/page | Granite 3.2 Vision 2B INT4 on L40S |
| Extractor latency (P95) | ≤ 5 s/page | Qwen2.5-VL 7B Q4 on L40S |
| End-to-end IDP (P95) | ≤ 8 s/page | Incl. pre-processing + DB write |
| Batch throughput | ≥ 600 pages/hr | 2 × L40S nodes, pipeline parallelism |
| Classifier accuracy (CID) | ≥ 95% | POC results + MRZ determinism |
| Extractor field accuracy | ≥ 90% | Mandatory fields on clean 300 DPI scans |
| Human review queue rate | ≤ 8% | Target after 30-day warm-up |

---

## 8. Implementation Roadmap

| Phase | Duration | Deliverables | Dependencies |
|---|---|---|---|
| P0 — Foundation (parallel to GPU procurement) | Weeks 1–4 | Finalize metadata schemas with BoB IT; confirm BaNCS API; set up RKE2 cluster | BoB cross-questions response; GPU order placed |
| P1 — Model Setup & Local Testing | Weeks 5–8 | Bundle Granite 3.2 + Qwen2.5 offline; deploy vLLM on Harbor; validate classify+extract on BoB samples | GPU delivery OR CPU test (slower) |
| P2 — IDP Pipeline Integration | Weeks 9–12 | Connect pipeline to DMS ingest; directory mapper live; catalog rules configured; alert engine tested | P1 complete; BoB MinIO + PostgreSQL ready |
| P3 — BaNCS Integration & UAT | Weeks 13–16 | BaNCS feed connector; E2E UAT with BoB IT + Compliance; accuracy benchmarking vs 85% threshold | TCS BaNCS API access; ~500-doc test set |
| P4 — Go-Live & Handover | Weeks 17–18 (90-day SCC) | Production cutover; staff training; docs handover; RAA audit trail verified | All UAT sign-offs; RMA data residency confirmation |
