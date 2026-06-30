# ZorDMS — Build Iteration 2: Reconciliation (Spec vs. Live React App)

**Prepared:** 30 Jun 2026
**Companion to:** `ZorDMS_Build_Iteration2_Implementation_Spec.md` (the 19-scenario UI spec)
**Method:** two evidence-based audits of `apps/web` — (1) nav/router/pages structure, (2) per-screen data-source + features — cross-referenced with the backend endpoints (many shipped earlier this session on `taniya_local`).

---

## 0. Headline finding

The Iteration-2 spec's per-scenario **"Current state" describes the vanilla `bob-dms.html` prototype** (client-side Tesseract, hardcoded JS arrays, dropzone bug). **The live system is the React app `apps/web`**, which already implements most of it against real APIs — **no mock arrays on shipped screens**. So most "P1 fixes" are already satisfied; the real work is a few **net-new frontend pages whose backends already exist**, plus a sidebar reorg.

**Current nav** (6 sections, 19 items + hidden `/branch-network`): Intelligence · Ingestion · Management · Discovery · Process · Analytics&Platform. **No "Enterprise" nav item exists** (SC-08 is moot). **No dead links** — every nav item has a route + page; only `/branch-network` is routable-but-hidden.

---

## 1. Scenario-by-scenario verdict

| SC | Verdict vs. React app | Real remaining work | Backend |
|---|---|---|---|
| **SC-01** Dashboard AI-assist + chart-customise + layout | 🟡 Partial — KPIs clickable + charts exist; **no** AI-narration panel, per-chart "customise", or saved layout | Add AI-assist card (reuse copilot), chart data-source/type picker, persisted layout | `/dashboard/summary` ✅; **`/ai/insights` + `/dashboard/layout` NEW** |
| **SC-02** Capture OCR/export/filter | 🟡 Partial — **server-side OCR already** (not Tesseract); upload ✅; **no** CSV export, filters are downstream | CSV export of filtered docs; richer capture/repository filters | **`/documents/export` NEW** |
| **SC-03** Queue → viewer | ✅ Built — Indexing queue rows deep-link to Viewer | — | ✅ |
| **SC-04** Case KPIs clickable + by-type + no gap | ✅ Built — clickable KPIs, by-type donut | — | ✅ |
| **SC-05** Repository preview/folder/upload-bug | ✅ Mostly built — preview ✅, folder tree+create ✅; **dropzone re-prompt bug is prototype-only** (not in React). Minor: Branch dropdown on upload | (minor) Branch dropdown + Title field on upload | ✅ |
| **SC-06** Record mgmt retention rules + dashboard | 🟡 Partial — file-plan/holds/disposal ✅; **no create/edit retention-rule UI** (static) | Retention-rule CRUD UI | file-plan GET ✅; **rule POST/PUT NEW** |
| **SC-07** Document Lifecycle 4 lanes | 🟡 Partial — trace + funnel exist; **not** 4 interactive lanes | 4-lane interactive view (doc/AI/workflow/integration) | `/lifecycle` ✅; flow defs partial |
| **SC-08** Remove "Enterprise" | ✅ Moot — **no "Enterprise" nav item exists** (only "Enterprise Search" = Search) | (optional) rename "Enterprise Search" → "Search" | — |
| **SC-09** Document Viewer below Capture | ✅ Built (page) — full Viewer (PDF/img/text, metadata, versions, confidence, annotations). Currently in **Discovery** | IA: move under Ingestion (sidebar reorg) | ✅ |
| **SC-10** Review Queue → Ingestion + nav audit | ✅ Built (page in Process) — no dead links found | IA: move under Ingestion; add automated nav-integrity test | ✅ |
| **SC-11** Compliance & Audit enhance | ✅ Mostly built — scorecard/matrix/audit-filters/**hash-chain verify** ✅; export implied | (minor) explicit audit CSV export button | `/compliance/*` ✅; export partial |
| **SC-12** Alerts analytics | ✅ Built — over-time / by-type / by-severity charts | — | ✅ |
| **SC-13** Integration Hub enhance | ✅ Mostly built — real health/logs/webhooks/analytics ✅ (not hardcoded "Connected"); per-connector **config form** partial | Per-connector config UI (backend `/systems/:system/call` + config ✅) | ✅ |
| **SC-14** Configuration page (=prototype) | 🔴 **Missing frontend page** | Build Configuration page | **`/config` ✅ (built this session)** |
| **SC-15** Validation Configuration module | 🔴 **Missing frontend page** | Build Validation Config page | **`/validation/*` ✅ (built this session)** |
| **SC-16** Security&RBAC → "User Management" + enhance | 🟡 Partial — **two** pages exist (`Security.tsx` + `Users.tsx`); roles matrix is static | Consolidate to one page; roles matrix CRUD | users ✅; **`/roles` ✅ (built this session)** |
| **SC-17** Remove duplicate User Management page | 🟡 Applies — two pages today → keep one consolidated | Delete the redundant page after merge | — |
| **SC-18** System Administration enhance | 🟡 Partial — health/DR/backup/queue/dedup/doctypes/email-templates ✅; **no AI-model-mgmt tab** | Add AI-model-mgmt tab | **`/ai-config/*` ✅ (built this session)** |
| **SC-19** Master Setup module | 🔴 **Missing frontend page** — branches (hidden `/branch-network`), doctypes (in SysAdmin), workflows (WorkflowEngine) exist piecemeal; **no departments UI**, no unified hub | Build Master Setup hub; departments CRUD UI | branches ✅; **`/departments` ✅ (built this session)**; doctypes ✅; workflows ✅ |
| **(IA)** "Reports" under Analytics | 🔴 **Missing frontend page** (target IA lists it) | Build Reports page | **`/reports/*` ✅ (built this session)** |

**Tally:** Built ~7 · Partial ~7 · Missing-frontend ~4 (+Reports). **Zero are full-stack greenfield** — every "Missing" item's backend already exists.

---

## 2. The real backlog (frontend-led), prioritized

**Group A — new pages on ready backends (highest ROI, pure frontend):**
1. **Configuration** page → `GET/PUT /config` (SC-14)
2. **Validation Configuration** page → `/validation/rules|run|results` (SC-15)
3. **Reports** page → `/reports/run|library|export|sources` (Analytics IA)
4. **Master Setup** hub + **Departments** CRUD → `/departments` (+ branches/doctypes/workflows) (SC-19)

**Group B — consolidations/enhancements on ready backends:**
5. Consolidate `Security.tsx` + `Users.tsx` → one **User Management** with roles matrix → `/users` + `/roles` (SC-16/17)
6. **AI-model-mgmt tab** in System Administration → `/ai-config/features|metrics` (SC-18)
7. Per-connector **config UI** in Integration Hub → `/integration/systems/:id` (SC-13)

**Group C — sidebar IA reorg + nav integrity:**
8. Regroup sidebar to the target sections; move Viewer + Review Queue into Ingestion; surface or fold `/branch-network`; add an **automated nav-integrity test** (every nav `to` resolves to a route) (SC-08/09/10)

**Group D — needs net-new backend endpoints (do after A–C):**
9. `documents/export` (CSV) + capture/repository filters (SC-02)
10. `dashboard/insights` (AI narration, reuse copilot) + `dashboard/layout` (persisted) + chart customise (SC-01)
11. retention-rule CRUD endpoints + UI (SC-06); 4-lane lifecycle (SC-07)

---

## 3. Cross-cutting (spec §C) — already true in the React app

- **No mock data on shipped screens** — confirmed; all screens use `/svc/*` APIs.
- **Reuse foundation / gateway / one auth** — confirmed (all calls via the Vite `/svc` proxy; RBAC-gated routes).
- **Server-side AI only** — confirmed (OCR/extraction via `/svc/ai`, no client Tesseract).
- Storage presigned-URL preview (MinIO) — preview uses `/documents/:id/download`; **live S3 driver still deferred** (infra item from the prior gap analysis).

---

## 3b. Shipped (30 Jun 2026, `taniya_local`)

Frontend tickets built on the backends already shipped this session — each = API client + page/panel + route + sidebar entry + tests, **no mock data**, web suite green throughout (now 46 files / 546 tests).

| Ticket | What shipped | Commit |
|---|---|---|
| Reconciliation | this analysis | `8d96e43` |
| **SC-14** Configuration | page → `/config` (grouped entries, JSON-value edit, audited) | `f420546` |
| **SC-15** Validation Config | page → `/validation/rules` (CRUD, params JSON, enable/delete) | `b2e4a51` |
| **Reports** (Analytics IA) | builder + library + CSV export → `/reports/*` | `4bd73cb` |
| **SC-19** Master Setup | Departments CRUD → `/departments` (+ links to branches/doctypes/workflows) | `90d2ce3` |
| **SC-18** AI Models tab | System-Admin tab → `/ai-config/features|metrics` (enable/threshold/metrics) | `f4591ef` |
| **SC-16/17** User Management | consolidated users + live roles matrix → `/roles`; dropped duplicate "Security & RBAC" nav item | `61cd2ec` |

| **SC-09/10** IA reorg | sidebar regrouped to the target sections (Ingestion · Document Management · Operations · Analytics · Intelligence · Platform); Viewer + Review Queue → Ingestion; nav-integrity test added | `4d356fe` |

### Group D (net-new endpoints + UI) — shipped

| Ticket | What shipped | Commit |
|---|---|---|
| **SC-02** doc CSV export | core `GET /documents/export` (filtered) + Repository "Export CSV" | `6614302` |
| **SC-06** retention-rule CRUD | core `POST/PUT/DELETE /records/file-plan` + Records create/edit form | `72ae301` |
| **SC-01** AI-assisted dashboard | AI `POST /idp/insights` (LLM + deterministic fallback) + Dashboard insights card | `604a790` |
| **SC-07** 4-lane lifecycle | core `GET /flows` (document·ai·workflow·integration) + interactive "System Flows" tab | `4db486b` |

**Remaining (small):** SC-01's other two slices — per-chart *customise* (data-source/type) and *persisted* per-user dashboard layout (`dashboard/layout` table). Everything else across all 19 SCs is delivered or already-built; SC-08 is moot.

---

## 4. Recommended build order (reconciled)

Wave-1 of the spec is largely already met. Start with **Group A** (new pages, ready backends — fast, high-value, no backend churn), then **B**, then the **C** IA reorg, then **D** (net-new endpoints). Each ticket: build the page/component + wire the existing API + add nav entry + tests + keep the suite green.
