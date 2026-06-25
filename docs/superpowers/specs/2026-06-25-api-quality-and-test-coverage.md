# API quality & test coverage — production-grade OpenAPI + deep-flow e2e

Date: 2026-06-25
Status: Implemented (branch `amit_local`)

This spec records the push to make the per-service **OpenAPI 3.1** contracts
production-grade (full per-route path coverage + boundary validation) and to
broaden the automated test suite with deep-flow Playwright end-to-end specs and
micro-level unit tests across the web app and the AI/IDP service.

---

## 1. OpenAPI coverage (before / after)

Each Node service generates its committed spec via `scripts/gen-openapi.ts`
(emitting to `docs/superpowers/specs/openapi/<svc>.json`). Coverage is now
enforced by a **route-coverage contract test** per service: the spec must
document **every mounted route** — no undocumented endpoints and no phantom
(documented-but-unmounted) ones — and every documented response code must carry
a JSON/binary schema.

| Service | Paths before | Paths after | Delta | Auth contract |
| --- | ---: | ---: | ---: | --- |
| core | 27 | 46 | +19 | Bearer JWT · `x-internal-token` |
| gateway | 7 | 13 | +6 | Bearer JWT |
| workflow | 6 | 11 | +5 | Bearer JWT |
| integration | 8 | 9 | +1 | Bearer JWT · HMAC inbound · `x-internal-token` |
| notify | 8 | 8 | 0 | Bearer JWT |
| search | 7 | 7 | 0 | Bearer JWT |
| ai (FastAPI) | 11 | 11 | 0 | Bearer JWT |
| **Total** | **74** | **105** | **+31** | |

Path counts are `len(spec.paths)` in each committed `openapi/*.json`. The four
services that gained paths (core, gateway, workflow, integration) had previously
under-documented mounted routes; the gap is now closed and locked by the
coverage contract. `notify`, `search`, and `ai` were already at full coverage
(committed specs unchanged).

### What "production-grade" means here
- **Full path coverage** — every mounted Express/FastAPI route appears in the
  spec (contract test asserts `undocumented == []` and `phantom == []`).
- **Response schemas** — every documented status code carries a schema
  (`200`/`201` payloads, `400 validation_error`, `401`, `403`, `404`,
  `409 conflict`, `422` where the handler emits it, binary for downloads).
- **Documented auth** — bearer JWT plus, where applicable, `x-internal-token`
  service-to-service and HMAC-signed inbound webhook security schemes.

## 2. Validation coverage

All mutating endpoints are **zod-validated at the boundary** and respond with
`400 { error: "validation_error", issues: [...] }` on bad input. Boundary cases
are now exercised by dedicated per-service tests:

- **core** — `src/openapi/openapi.test.ts`: route-coverage contract + missing
  required field → 400, response-schema presence, error-contract specifics
  (e.g. dedup-config PUT keeps `422`, not `400`).
- **gateway** — `src/openapi.test.ts` (spec/coverage) + `src/sso/sso.test.ts`
  (SSO provider config boundaries).
- **workflow** — `src/routes/validation.test.ts`: invalid transition / decision
  payloads rejected at the boundary.
- **integration** — `src/routes/p10_validation.test.ts`: connector/webhook
  payload validation.
- **notify / search** — `src/routes/openapi.test.ts`: spec correctness +
  request validation.

New service `schemas.ts` modules (gateway, workflow) and expanded
`core/src/openapi/schemas.ts` back these contracts; `core/src/openapi/routes.ts`
centralizes the route registry the coverage test reads.

## 3. Test inventory

### Node (Vitest) — `pnpm -r test`
Build first (`pnpm -r build`); tests depend on a clean build.

| Package | Tests |
| --- | ---: |
| `apps/web` | 521 |
| `services/core` | 198 |
| `services/search` | 77 |
| `services/integration` | 70 |
| `services/workflow` | 69 |
| `services/notify` | 59 |
| `services/gateway` | 48 |
| `packages/auth` | 24 |
| `packages/db` | 9 |
| `packages/types` | 3 |
| `packages/config` | 3 |
| **Total** | **1081** (152 files, 12 packages) |

New **micro unit tests** added this round:
- `apps/web/src/api/aiCopilot.test.ts` — copilot ask URL/body/history + error.
- `apps/web/src/api/docTypesApi.test.ts` — doc-types client.
- `apps/web/src/api/searchApi.test.ts` — search client query mapping.
- `apps/web/src/components/capture/ExtractionResultDrawer.test.tsx` — field
  normalization (FieldObject vs legacy string), mandatory checklist, save/patch.
- `apps/web/src/components/capture/FilePreview.test.tsx` — preview rendering.
- `apps/web/src/components/doctypes/FieldEditor.test.tsx` — field editor.
- `apps/web/src/store/uiStore.test.ts` — UI store reducers.

### Python (pytest) — `services/ai/.venv/bin/pytest services/ai -q`
**257 passed.** New micro unit tests:
- `tests/test_field_inference_unit.py`
- `tests/test_intent_unit.py`
- `tests/test_llm_client_unit.py`
- `tests/test_ollama_adapter_unit.py`
- `tests/test_search_client_unit.py`

### Playwright e2e — `cd e2e && npx playwright test`
67 tests across 7 spec files. Specs that drive the live React app +
microservices stack (`./start.sh`):

| Spec | Tests | Focus |
| --- | ---: | --- |
| `smoke.spec.ts` | 32 | login, dashboard, search, capture, AI copilot |
| `enterprise-flows.spec.ts` (new) | 14 | viewer stamp/redact burn-in, maker-checker workflow decision, capture→workflow handoff, cross-service deep flows |
| `a11y.spec.ts` | 4 | WCAG 2.2 AA (axe-core) |
| `a11y-aaa.spec.ts` | 3 | opt-in WCAG 2.2 AAA + ≥44×44 hit targets |

The new `enterprise-flows.spec.ts` is **data-aware**: steps requiring a specific
document or workflow state `test.skip` gracefully on a seedless local stack.

> Legacy specs `api.spec.ts`, `ui.spec.ts`, and `visual.spec.ts` predate the
> React rewrite and target the retired monolith DOM/`:8000 /api/v1` surface;
> they are not part of this initiative and fail against the current
> microservices + React stack until retired/rewritten.

## 4. How to run everything

```bash
pnpm -r build
pnpm -r test
services/ai/.venv/bin/pytest services/ai -q
./start.sh                          # bring up web :5174 + services :4000-:4005 + ai :8000
cd e2e && npx playwright test
```
