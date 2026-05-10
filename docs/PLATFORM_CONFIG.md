# Platform Configuration — Tenant Config Namespaces

> **Quick reference for all 19 tenant_config namespaces.**
>
> Every configuration value in DocManager is stored in one of these key-value JSON namespaces. Admin engineers can look up "where do I configure X?" and find the right namespace + admin route in <30 seconds.

---

## Namespace Index

| Namespace | Module | Admin Route | Description |
|---|---|---|---|
| `branding` | Foundation (CC2) | `/admin/settings/branding` | Logo, colors, login banner, footer text |
| `integrations` | Foundation (CC6) | `/admin/settings/integrations` | Provider selection (ollama / aws / local / noop) for 14 kinds |
| `auth` | Wave B (Users v2) | `/admin/settings/auth` | MFA policy, magic-link TTL, password rules, SSO enforcement |
| `rbac` | Wave B (Users v2) | `/admin/settings/rbac` | Session TTL, SoD role pair enforcement |
| `notifications` | Wave B (Users v2) | `/admin/settings/notifications` | SMTP config, alert channels (email/SMS/WhatsApp), templates |
| `workflows` | Wave A (Workflows v2) | `/admin/settings/workflows` | Step-up enforcement thresholds (risk band, amount), bulk action limits |
| `workflows.templates` | Wave B (Templates) | `/admin/settings/workflow_templates` | Per-template SLA targets, business calendar holidays |
| `dashboard` | Wave A (Dashboard v2) | `/admin/settings/dashboard` | KPI targets, chart refresh intervals, tile catalog |
| `capture` | Wave A (Capture v2) | `/admin/settings/capture` | Dedup thresholds, camera/scanner/auto-classify flags, MIME types, file size |
| `ocr` | Foundation (CC4 placeholder) | `/admin/settings/ocr` | Confidence thresholds, language models, Tesseract config |
| `viewer` | Wave A (Viewer v2) | `/admin/settings/viewer` | Redaction policy, annotation tools, stamp library, version retention |
| `search` | Wave A (Search v2) | `/admin/settings/search` | FTS5 index fields, snippet length, facet config, Cmd-K enabled |
| `indexing` | Wave B (Indexing station) | `/admin/settings/indexing` | Claim/lock TTL, confidence band thresholds, keyboard shortcuts |
| `aml` | Wave B (AML v2) | `/admin/settings/aml` | Watchlist sources, hit scoring weights, FP suppression policy, SAR template |
| `customer_360` | Wave B (Customer-360) | `/admin/settings/customer_360` | PII fields (reveal TTL), tab catalog (Master/Accounts/Documents/etc.) |
| `abac` | Wave B (ABAC editor) | `/admin/settings/abac` | OPA policy rules (JSON-to-Rego compiled), priority, field allowlist |
| `retention` | Wave B (Retention admin) | `/admin/settings/retention` | Per-doctype retention days, WORM lock days, legal-hold policy, delete policy |
| `_user_meta` | Wave B (Users v2) | `/admin/settings/user_meta` | (Internal) User preference overrides, feature flags per role |
| `_tenant_meta` | Foundation (CC1) | `/admin/settings/tenants` | (Internal) Tenant soft-delete flag, created_at, last_config_version |
| `i18n` | Wave D (Dzongkha i18n pack) | `/admin/settings/i18n` | Default locale (en/dz), available locales, custom Tibetan font URL, date format |
| `mobile_ux` | Wave D (Mobile-first refactor) | `/admin/settings/mobile_ux` | Off-canvas sidebar breakpoints, DataTable card-mode default, touch target size, camera capture flag |
| `dsar` | Wave B (DSAR admin) | `/admin/settings/dsar` | DSAR request handling policy, retention on erasure, export formats |
| `regulator_reports` | Wave B (Regulator reports) | `/admin/settings/regulator_reports` | Report templates, submission endpoints, scheduling policy |

---

## Detailed Namespace Catalog

### 1. branding

**Schema file**: `schemas/tenant-config/branding.json`

**Admin route**: `/admin/settings/branding` (BrandingPanel)

**RBAC**: `requireNamespacePermJson('branding')` — typically Doc Admin only

**Keys** (Wave D expanded — 17 keys total):

| Key | Type | Default | Description |
|---|---|---|---|
| `primary_color` | string (hex) | `#1B3A6B` | Brand primary color. Wired to CSS custom property `--brand-primary`. |
| `monogram` | string | `BoB` | Sidebar / topbar initials (1–8 chars). Displayed in the tenant monogram chip. |
| `logo_path` | string | — | URL or asset path to tenant logo. Authenticated topbar left slot. |
| `favicon_path` | string | — | Legacy favicon URL. Applied to `<link rel=icon>`. Prefer `favicon_url`. |
| `login_banner` | string | — | Legacy banner text for the LoginPage hero panel. Shown when `tagline` is not set. |
| `footer_text` | string | — | Legacy footer text. Shown when `footer_copyright` is not set. |
| `product_name` | string | `DocManager` | Product name in browser tab title and sidebar header. No placeholders — must be a literal string. |
| `tagline` | string | — | Marketing tagline on login hero. Supports `{product_name}` and `{tenant_display_name}` placeholders. |
| `welcome_message` | string (max 120) | `Welcome to {product_name}` | Welcome heading on the login form. Supports `{product_name}` and `{tenant_display_name}` placeholders. |
| `subtitle` | string (max 200) | `{tenant_display_name} — Document Operations` | Sub-heading under welcome message on login. Supports same placeholders. |
| `login_logo_url` | string | — | Logo URL for login screen (hero panel + mobile header). Falls back to `logo_path`. |
| `login_background_color` | string (hex) | — | Solid hex background for login hero. Overrides default brand-navy gradient. |
| `login_background_image_url` | string | — | Background image URL for login hero. Covers gradient blobs when set. |
| `footer_copyright` | string (max 200) | `© {year} {tenant_display_name}. All rights reserved.` | Copyright line on login screen. Supports `{year}` and `{tenant_display_name}` placeholders. |
| `support_email` | string | — | Support contact email on login footer and error pages. |
| `support_phone` | string | — | Support phone number on login footer and error pages. |
| `favicon_url` | string | — | Favicon URL applied at runtime to `<link rel=icon>`. Takes precedence over `favicon_path`. |
| `theme_mode` | enum: `light`, `dark`, `auto` | `light` | UI color scheme preference. `auto` follows the OS setting. |

**Precedence chain**: `tenant_config.branding` values → seed defaults → app defaults (see ADR-0017).

**Notes**: All changes live-update the SPA via ConfigPanel → BRANDING_STORE_FIELDS allowlist → tenant Zustand store → CSS variable bridge (Wave D extension). Placeholders (`{product_name}`, `{tenant_display_name}`, `{year}`) are interpolated client-side in LoginPage.

---

### 2. integrations

**Schema file**: `schemas/tenant-config/integrations.json`

**Admin route**: `/admin/settings/integrations` (IntegrationsPanel)

**RBAC**: `requireNamespacePermJson('integrations')` — typically Doc Admin only

**Keys** (14 provider slots, each with `.provider` and some with additional config):

| Key | Type | Enum | Default | Description |
|---|---|---|---|---|
| `ocr.provider` | enum | `ollama`, `aws` | `ollama` | OCR backend. `ollama` → local Tesseract/qwen2.5vl; `aws` → Textract (Phase 2). |
| `ocr.confidence_floor` | integer | 0–100 | 70 | OCR confidence threshold below which vision fallback triggers (qwen2.5vl). |
| `embedding.provider` | enum | `local`, `aws` | `local` | Vector embedding. `local` → nomic-embed-text; `aws` → Bedrock (Phase 2). |
| `llm.provider` | enum | `ollama`, `aws` | `ollama` | LLM for chat/extract. `ollama` → llama3.2:3b or 8b; `aws` → Bedrock (Phase 2). |
| `llm.model` | string | — | `llama3.2:3b` | Ollama model name (ignored if `aws`). |
| `translate.provider` | enum | `ollama`, `aws` | `ollama` | Translation. `ollama` → NLLB-200-distilled; `aws` → (Phase 2). |
| `face_match.provider` | enum | `local`, `aws` | `local` | Face biometric. `local` → dlib; `aws` → Rekognition (Phase 2). |
| `sms.provider` | enum | `noop`, `aws` | `noop` | SMS delivery. `noop` → logs to console; `aws` → SNS (Phase 2). |
| `email.provider` | enum | `local`, `aws` | `local` | Email delivery. `local` → tenant_config.notifications.smtp_*; `aws` → SES (Phase 2). |
| `storage.provider` | enum | `local`, `aws` | `local` | File storage. `local` → MinIO/local FS; `aws` → S3 (Phase 2). |
| `kms.provider` | enum | `local`, `aws` | `local` | Key management. `local` → local_kms service; `aws` → AWS KMS (Phase 2). |
| `watchlist.provider` | enum | `ofac_json`, `aws` | `ofac_json` | Sanctions list. `ofac_json` → local JSON file; `aws` → AWS Compliance (Phase 2). |
| `watchlist.path` | string | — | `data/watchlists/ofac.json` | File path if using `ofac_json` provider. |
| `bi.provider` | enum | `local`, `aws` | `local` | Business intelligence. `local` → Parquet + DuckDB; `aws` → (Phase 2). |
| `cdn.provider` | enum | `noop`, `aws` | `noop` | CDN. `noop` → no acceleration; `aws` → CloudFront (Phase 2). |
| `cache.provider` | enum | `local`, `aws` | `local` | Cache. `local` → in-memory LRU; `aws` → ElastiCache (Phase 2). |

**Notes**: Changes trigger `POST /api/v1/admin/integrations/_reset` to invalidate provider instance cache. Selecting `aws` without credentials raises NotImplementedError at runtime.

---

### 3. auth

**Schema file**: `schemas/tenant-config/auth.json`

**Admin route**: `/admin/settings/auth` (panel in Wave B)

**RBAC**: `requireNamespacePermJson('auth')` — typically Doc Admin only

**Keys**:

| Key | Type | Min/Max | Default | Description |
|---|---|---|---|---|
| `magic_link_ttl_hours` | integer | 1–168 | 168 | Magic-link validity (hours). Used by db/tenant-init.js and Wave B Users v2 invite flow. |
| `password_min_length` | integer | 8–128 | 12 | Minimum password length enforced at `/set-password` and password change. |
| `password_history_count` | integer | 0–24 | 3 | Number of old passwords that may not be reused (0 = disabled). |
| `force_mfa_for_role` | JSON object | — | `{"Maker":true}` | Role → boolean map. If role is in map and value is true, user must enroll MFA before first action. |
| `force_sso_for_tenant` | enum | `"true"`, `"false"` | `"false"` | When `"true"`, password login disabled; only SAML SSO accepted. |

**Notes**: MFA enforcement is checked at `/spa/api/me` hydration. SSO enforcement gated at POST `/spa/api/login`.

---

### 4. rbac

**Schema file**: `schemas/tenant-config/rbac.json`

**Admin route**: `/admin/settings/rbac` (panel in Wave B)

**RBAC**: `requireNamespacePermJson('rbac')` — typically Doc Admin only

**Keys**:

| Key | Type | Min/Max | Default | Description |
|---|---|---|---|---|
| `session_ttl_minutes` | integer | 5–1440 | 120 | Session lifetime in minutes. express-session.cookie.maxAge reads this. |
| `sod_forbidden_pairs` | JSON array | — | `[["Maker","Checker"]]` | Array of role pairs that may not be held by the same user. Checked at PATCH `/spa/api/users/:id` role change. |

**Notes**: SoD enforcement in Wave B: if attempting to add a role that pairs with an existing role in `sod_forbidden_pairs`, returns 400 sod_violation.

---

### 5. notifications

**Schema file**: `schemas/tenant-config/notifications.json`

**Admin route**: `/admin/settings/notifications` (panel in Wave B)

**RBAC**: `requireNamespacePermJson('notifications')` — typically Doc Admin only

**Keys**:

| Key | Type | Default | Description |
|---|---|---|---|---|
| `smtp_host` | string | `localhost` | SMTP server hostname (used by services/invite-mailer.js). |
| `smtp_port` | integer | 587 | SMTP port (typically 587 or 25). |
| `smtp_user` | string | (empty) | SMTP username (if auth required). |
| `smtp_password` | string | (empty) | SMTP password (if auth required). Stored encrypted via tenant KEK. |
| `smtp_from_address` | string | `noreply@docmanager.local` | From: address for outbound email (magic-link, alerts). |
| `alert_channels` | JSON object | `{"email":true,"sms":false,"whatsapp":false}` | Per-channel enable flag. Each tenant can disable SMS/WhatsApp if not provisioned. |
| `alert_template_expiry_30d` | string | (default template) | i18n key or raw template for 30-day expiry alert. |
| `alert_template_expiry_7d` | string | (default template) | i18n key or raw template for 7-day expiry alert. |
| `alert_template_workflow_escalated` | string | (default template) | Template for workflow escalation notifications. |

**Notes**: SMTP config is per-tenant. Local SMTP (tenant_config.integrations.email.provider = 'local') reads all smtp_* keys.

---

### 6. workflows

**Schema file**: `schemas/tenant-config/workflows.json`

**Admin route**: `/admin/settings/workflows` (panel in Wave A)

**RBAC**: `requireNamespacePermJson('workflows')` — typically Doc Admin only

**Keys**:

| Key | Type | Default | Description |
|---|---|---|---|---|
| `step_up_risk_band` | enum | `"High"` | Minimum risk band that triggers WebAuthn step-up in Workflows v2. Values: Low / Medium / High / Critical. |
| `step_up_amount_threshold` | integer | 500000 | Amount threshold (in base currency) above which step-up is mandatory. |
| `bulk_action_max` | integer | 100 | Max documents per bulk action (approve/reject/escalate all-at-once). |

**Notes**: Step-up enforcement: server REJECTS 403 step_up_required when threshold met but assertion missing. Assertion is stored but not cryptographically validated (SOX debt Wave C).

---

### 7. workflows.templates

**Schema file**: `schemas/tenant-config/workflow_templates.json` (Node-only, not yet published)

**Admin route**: `/admin/settings/workflow_templates` (panel in Wave B)

**RBAC**: `requireNamespacePermJson('workflow_templates')` — typically Doc Admin only

**Keys**:

| Key | Type | Description |
|---|---|---|
| `sla_target_hours` | integer | SLA target for workflow completion (hours). Used in Dashboard SLA tile. |
| `business_calendar_holidays` | JSON array | Array of { date: "YYYY-MM-DD", name: "Holiday" } for per-tenant national holidays (e.g., BoB Nyilo). |
| `business_hours_start` | string | Start time (e.g., "09:00") for SLA calculations. |
| `business_hours_end` | string | End time (e.g., "17:00") for SLA calculations. |
| `business_hours_timezone` | string | Timezone for SLA (e.g., "Asia/Thimphu"). |

**Notes**: Business calendar is seeded with BoB holidays during foundation.

---

### 8. dashboard

**Schema file**: `schemas/tenant-config/dashboard.json`

**Admin route**: `/admin/settings/dashboard` (DashboardPanel in Wave A)

**RBAC**: `requireNamespacePermJson('dashboard')` — typically Doc Admin only

**Keys** (12 keys covering KPI targets, chart config):

| Key | Type | Default | Description |
|---|---|---|---|---|
| `kyc_cycle_time_target_hours` | integer | 72 | Target p50 KYC cycle time (hours). Tile shows value vs this target. |
| `automation_target_percent` | integer | 75 | Target % of documents auto-approved. |
| `ai_confidence_target_percent` | integer | 70 | Target AI confidence threshold for auto-approval. |
| `expiry_alert_days` | integer | 30 | Days-until-expiry threshold for Expiring tile. |
| `audit_failure_lookback_days` | integer | 30 | Days lookback for Audit failures YTD tile. |
| `refresh_interval_seconds` | integer | 300 | Auto-refresh interval for live KPI polling. |
| `chart_capture_funnel_steps` | JSON array | `["pending","submitted","approved","archived"]` | Stages to track in capture→approve funnel. |
| `branch_doctype_heatmap_enabled` | boolean | true | Show branch×doctype heatmap (performance impact >10k docs). |
| `default_timeframe_days` | integer | 90 | Default lookback period for charts (days). |
| `tile_catalog` | JSON array | (all tiles) | Which tiles to display; omit tile name to hide. |

**Notes**: Dashboard v2 endpoint GET `/spa/api/dashboard/kpis` returns all tile data in one request (bounded to LIMIT 5000 to prevent thrash).

---

### 9. capture

**Schema file**: `schemas/tenant-config/capture.json`

**Admin route**: `/admin/settings/capture` (CapturePanel in Wave A)

**RBAC**: `requireNamespacePermJson('capture')` — typically Doc Admin only

**Keys** (14 keys):

| Key | Type | Default | Description |
|---|---|---|---|---|
| `allowed_mime_types` | JSON array | `["application/pdf","image/jpeg","image/png","image/tiff"]` | MIME types accepted at upload. |
| `max_file_size_mb` | integer | 100 | Max file size per document (MB). |
| `max_batch_size` | integer | 25 | Max files in one batch upload. |
| `camera_capture_enabled` | boolean | true | Allow `<input capture="environment">` on mobile. |
| `scanner_enabled` | boolean | true | Allow WIA/TWAIN scanner API on desktop. |
| `auto_classify_enabled` | boolean | true | Auto-run OCR + classify pipeline on upload. |
| `auto_link_enabled` | boolean | true | Auto-link document to customer via CID match. |
| `dedup.sha_threshold` | float | 1.0 | Exact SHA-256 match threshold (1.0 = exact only). |
| `dedup.phash_distance` | float | 0.1 | pHash fuzzy threshold (0.1 = very strict; 0.5 = loose). |
| `dedup.fuzzy_threshold` | float | 0.8 | Levenshtein similarity threshold (metadata fuzzy match). |
| `confidence_floor_auto_approve` | integer | 85 | AI confidence floor for auto-approval (skip human review if ≥ this). |
| `confidence_floor_flag_review` | integer | 60 | AI confidence floor for manual review flagging (< this = red highlight). |

**Notes**: Dedup precedence: tenant_config > dedup_settings table (legacy) > DEFAULTS. Wave B cleanup: dedup_settings table dropped, migration 0036.

---

### 10. ocr

**Schema file**: `schemas/tenant-config/ocr.json` (placeholder, Foundation CC4)

**Admin route**: `/admin/settings/ocr` (OcrPanel)

**RBAC**: `requireNamespacePermJson('ocr')` — typically Doc Admin only

**Keys** (placeholder, to be filled by Wave C):

| Key | Type | Description |
|---|---|---|
| (reserved for Wave C DocBrain v1) | — | Vision model selection, Tesseract language packs, confidence tuning. |

---

### 11. viewer

**Schema file**: `schemas/tenant-config/viewer.json`

**Admin route**: `/admin/settings/viewer` (ViewerPanel in Wave A)

**RBAC**: `requireNamespacePermJson('viewer')` — typically Doc Admin only

**Keys** (16 keys):

| Key | Type | Default | Description |
|---|---|---|---|---|
| `annotation_tools_enabled` | JSON object | `{"pencil":true,"marker":true,"highlight":true,"stamp":true}` | Per-tool enable flag. |
| `redaction_tool_enabled` | boolean | true | Allow redaction in Viewer. |
| `annotation_role_allowlist` | JSON array | `["Doc Admin","Maker","Auditor"]` | Roles allowed to create/edit annotations. |
| `stamp_library` | JSON array | (default stamps) | Custom stamp definitions (e.g., { "name": "APPROVED", "icon": "✓" }). |
| `redaction_policy` | enum | `"irreversible"` | Redaction strategy: irreversible (pikepdf) or masked (visual only). |
| `version_compare_enabled` | boolean | true | Allow side-by-side version comparison. |
| `version_retention_days` | integer | 365 | How long to retain old document versions (days). 0 = forever. |
| `print_enabled` | boolean | true | Allow print button. |
| `download_enabled` | boolean | true | Allow download button. |
| `export_formats` | JSON array | `["pdf","jpeg","csv"]` | Export format options. |
| `thumbnail_cache_mb` | integer | 500 | In-memory cache for rendered thumbnails (MB). |
| `pdf_worker_timeout_seconds` | integer | 30 | Timeout for PDF.js worker (seconds). |

**Notes**: Viewer v2 uses PDF.js with lazy-loaded worker (0 KB first-paint impact). Redaction is multi-page destructive (pikepdf text destruction, post-redaction pdftotext verification).

---

### 12. search

**Schema file**: `schemas/tenant-config/search.json`

**Admin route**: `/admin/settings/search` (SearchPanel in Wave A)

**RBAC**: `requireNamespacePermJson('search')` — typically Doc Admin only

**Keys** (8 keys):

| Key | Type | Default | Description |
|---|---|---|---|---|
| `searchable_fields` | JSON array | `["original_name","customer_name","doc_number","ocr_text"]` | Columns included in FTS5 index. |
| `snippet_length_chars` | integer | 120 | Characters per FTS5 snippet() result. |
| `max_results_per_page` | integer | 50 | Server-side limit on search results (pagination). |
| `facet_fields` | JSON array | `["doc_type","branch","risk_band","created_at"]` | Fields with faceted counts in sidebar. |
| `facet_max_values` | integer | 20 | Max distinct values per facet before truncation. |
| `saved_search_scopes` | JSON array | `["private","team","tenant"]` | Scopes users can set when saving searches. |
| `default_operators` | JSON array | `["AND","OR","NOT"]` | Boolean operators user can use (disable NOT to prevent negation attacks). |
| `cmdk_enabled` | boolean | true | Enable Cmd-K global command palette. |

**Notes**: FTS5 rebuild is manual via admin button (no auto-rebuild on config change, to avoid table locks).

---

### 13. indexing

**Schema file**: `schemas/tenant-config/indexing.json`

**Admin route**: `/admin/settings/indexing` (IndexingPanel in Wave B)

**RBAC**: `requireNamespacePermJson('indexing')` — typically Doc Admin or Maker

**Keys**:

| Key | Type | Default | Description |
|---|---|---|---|---|
| `claim_lock_ttl_minutes` | integer | 15 | Time-to-live for document claim/lock in indexing station (minutes). |
| `confidence_red_floor` | integer | 40 | Confidence < this → red bbox overlay. |
| `confidence_amber_floor` | integer | 70 | Confidence < this → amber. 40–69 is amber range. |
| `confidence_blue_floor` | integer | 90 | Confidence < this → blue. 70–89 is blue range. Confidence ≥ 90 → green. |
| `keyboard_shortcuts_enabled` | boolean | true | Allow J/K/Tab/Shift+Enter/Esc shortcuts. |
| `autofocus_low_confidence` | boolean | true | Auto-focus first low-confidence field on station mount. |

**Notes**: Indexing station is 3-pane: claimable queue (left), PDF + bbox overlay (center), field form (right). Race-safe claim via INSERT-OR-FAIL + transaction. Beacon-release on tab close.

---

### 14. aml

**Schema file**: `schemas/tenant-config/aml.json`

**Admin route**: `/admin/settings/aml` (AmlPanel in Wave B)

**RBAC**: `requireNamespacePermJson('aml')` — typically Compliance Officer or Doc Admin

**Keys**:

| Key | Type | Default | Description |
|---|---|---|---|---|
| `scoring_weights` | JSON object | `{"name":0.5,"dob":0.25,"country":0.25}` | Weights for name / DOB / country in hit score calculation. |
| `watchlist_sources` | JSON array | `["OFAC"]` | Watchlist names to screen against. |
| `fp_suppression_enabled` | boolean | true | Auto-suppress future screenings of same subject×entry pair (false-positive memory). |
| `edd_escalation_enabled` | boolean | true | Allow EDD (Enhanced Due Diligence) escalation path. |
| `adverse_media_sources` | JSON array | `["Reuters","AP","Bloomberg"]` | Stub list of adverse-media news feeds to check. |
| `sar_template` | string | (default SAR form template) | Pre-filled SAR draft modal template. |
| `sar_submit_endpoint` | string | `https://...` | Endpoint to POST SAR submissions (stub, not wired). |

**Notes**: AML hit-decide v2 Modal: 4 tabs (Compare / History / Adverse Media / Action). Reason ≥20 chars + WebAuthn step-up at risk≥High. Decision history auto-clears future screenings.

---

### 15. customer_360

**Schema file**: `schemas/tenant-config/customer_360.json`

**Admin route**: `/admin/settings/customer_360` (Customer360Panel in Wave B)

**RBAC**: `requireNamespacePermJson('customer_360')` — typically Maker or Doc Admin

**Keys**:

| Key | Type | Default | Description |
|---|---|---|---|---|
| `pii_fields` | JSON array | `["phone","email","national_id","dob"]` | Fields that are masked by default in Customer-360. |
| `pii_reveal_ttl_seconds` | integer | 60 | Countdown timer before PII auto-remasks (seconds). |
| `pii_reveal_audit_enabled` | boolean | true | Log all PII reveal events to customer_pii_reveals table. |
| `tab_catalog` | JSON array | `["Master","Accounts","Documents","Transactions","Workflows","Activity"]` | Tabs visible in right-drawer Customer-360 panel. |
| `accounts_tab_limit` | integer | 100 | Max accounts to show in Accounts tab (pagination). |
| `transactions_tab_days` | integer | 90 | Lookback days for Transactions tab. |

**Notes**: PII reveal pattern: phone/email/national-id/dob masked by default → click reveal (reason ≥20 chars) → 60s TTL countdown → auto-remask. Audited to customer_pii_reveals.

---

### 16. abac

**Schema file**: `schemas/tenant-config/abac.json`

**Admin route**: `/admin/settings/abac` (AbacPanel in Wave B)

**RBAC**: `requireNamespacePermJson('abac')` — typically Doc Admin only

**Keys**:

| Key | Type | Description |
|---|---|---|
| `rules` | JSON array | Array of ABAC rules. Each rule: { effect: "allow"/"deny", priority: N, resource: "document", actions: ["read","write"], conditions: [{ field: "subject.role", op: "eq", value: "Maker" }] }. Compiled to dms.rego via JSON-to-Rego compiler (scripts/abac-compile.js). Atomically pushed to OPA via PUT {OPA_URL}/v1/policies/dms_authz (fire-and-forget, 3s timeout). |

**Notes**: Closed enum of field paths (subject.role, resource.tenant_id, context.stepup_valid, etc.) — REJECTS unknown paths at schema validation. No free-form Rego authoring; visual rule builder only.

---

### 17. retention

**Schema file**: `schemas/tenant-config/retention.json`

**Admin route**: `/admin/settings/retention` (RetentionPanel in Wave B)

**RBAC**: `requireNamespacePermJson('retention')` — typically Doc Admin or Compliance Officer

**Keys** (per-doctype retention rules):

| Key | Type | Description |
|---|---|---|
| `{doctype_id}.retention_period_days` | integer | Number of days to retain documents of this type before purge (0 = indefinite). |
| `{doctype_id}.worm_lock_period_days` | integer | Number of days to WORM-lock documents (immutable, cannot modify or delete). |
| `{doctype_id}.legal_hold_eligible` | boolean | Whether this doctype can be placed on legal hold. |
| `{doctype_id}.delete_policy` | enum | Delete strategy: `archive` (move to cold storage), `cryptoshred` (decrypt + shred), `soft_delete` (mark deleted_at). |

**Notes**: Legal-hold flag per document with audit (applied_by/released_by/reason). Documents on legal hold excluded from retention sweep. WORM admin: list locked + extend lock (EXTEND only, never SHORTEN).

---

### 18. _user_meta (internal)

**Schema file**: `schemas/tenant-config/_user_meta.json`

**Admin route**: (internal, not exposed in UI)

**RBAC**: System only

**Keys**:

| Key | Type | Description |
|---|---|---|
| (reserved for user preference overrides, feature flags per role) | — | Not directly editable by admins; written programmatically. |

---

### 19. _tenant_meta (internal)

**Schema file**: `schemas/tenant-config/_tenant_meta.json`

**Admin route**: (tenantsPanel reads/writes this via setConfig)

**RBAC**: `requireNamespacePermJson('_tenant_meta')` — Doc Admin only

**Keys**:

| Key | Type | Description |
|---|---|---|
| `is_active` | boolean | Soft-delete flag for tenant. |
| `created_at` | ISO-8601 | Tenant creation timestamp (read-only). |
| `display_name` | string | Human-readable tenant name (e.g., "Bank of Bhutan"). |
| `slug` | string | URL-safe slug (e.g., "bob"). |

**Notes**: Updated by TenantsPanel add/edit/delete flows. Alembic stamp to 0037 marks migration of dedup_settings into tenant_config at migration 0036.

---

## How to Add a New Namespace

1. **Create schema file**: `schemas/tenant-config/<ns>.json` with JSON Schema Draft 7 + `additionalProperties: false`.
2. **Register in Foundation CC1**: Add table migration `tenant_config_history` entry.
3. **Add RBAC permission**: Extend services/rbac.js + requireNamespacePermJson middleware for `<ns>`.
4. **Add admin panel**: Create `apps/web/src/modules/admin/settings/panels/<Ns>Panel.tsx` or use generic ConfigPanel.
5. **Mount route**: Add to `/admin/settings/*` route tree in SettingsLayout.
6. **Wire service layer**: Node GET/PUT `/spa/api/admin/config/<ns>` + Python GET `/api/v1/admin/config/<ns>`.
7. **Document here**: Add row to namespace table above + detailed section below.

---

## Checking Your Config at Runtime

**From SPA code**:
```typescript
const config = useTenantConfig('workflows');
console.log(config.step_up_risk_band); // "High"
```

**From Node (services/tenant-config.js)**:
```javascript
const config = await tenantConfig.getNamespace(tenantId, 'workflows');
console.log(config.step_up_risk_band);
```

**From Python (python-service/app/services/tenant_config/service.py)**:
```python
config = tenant_config_service.get_namespace(tenant_id, 'workflows')
print(config.get('step_up_risk_band'))
```

**From curl** (Doc Admin only):
```bash
curl -H "Cookie: connect.sid=..." \
  http://localhost:3000/spa/api/admin/config/workflows
```

Returns:
```json
{
  "namespace": "workflows",
  "version": 42,
  "data": { "step_up_risk_band": "High", "step_up_amount_threshold": 500000, "bulk_action_max": 100 },
  "reason": "Updated SLA thresholds for Q2 2026 pilot",
  "updated_at": "2026-05-10T09:34:12Z",
  "hash": "sha256:abc123..."
}
```

---

## RBAC Permissions

Every namespace is gated by `requireNamespacePermJson('<ns>')` middleware. Permissions are defined in `services/rbac.js`:

```javascript
hasNamespacePerm(userId, namespace, tenantId) → boolean
requireNamespacePermJson(namespace) → express middleware
```

Default role mappings:
- **Doc Admin**: all namespaces
- **Maker**: `capture`, `workflows`, `indexing`, `customer_360` (read-only)
- **Checker**: `workflows` (read-only)
- **Viewer / Auditor**: no namespace edit permissions

Override per tenant via tenant_config.rbac namespace.

---

## Reference

- **Shipped**: Foundation (CC1–CC7) + Wave A (Dashboard, Workflows, Viewer, Search, Capture) + Wave B (Users, DocTypes, Templates, Indexing, AML, Customer-360, ABAC, Retention)
- **Schema files**: `schemas/tenant-config/*.json` (16 total)
- **Service layer**: `db/tenant-config.js` (Node) + `python-service/app/services/tenant_config/service.py` (Python)
- **Admin routes**: `/admin/settings/*` mounted via SettingsLayout in Wave B
- **Related**: [PLATFORM.md](./ARCHITECTURE.md) · [CC1 tenant_config foundation](../CHANGELOG.md)
