# E2E Legacy Spec Cleanup — Report

Branch: `amit_local`. Stack: `./start.sh` (web :5174, gateway :4000, in-memory SQLite, seeded admin/admin123).

## Final result
`cd e2e && npx playwright test` → **55 passed · 1 skipped · 0 failed** (stable across two consecutive fresh-stack runs).
The 1 skip is enterprise-flows' built-in *find-or-skip* guard (the "claim a Pending item" path) when the seeded queue isn't actionable — by design, not a failure.
Web unit suite still green: **521 passed / 38 files**.

## Root cause
The legacy specs (`visual`, `a11y`, `a11y-aaa`, `ui`, `api`) were written for the OLD static-HTML app: `window.showScreen`, `#kpiRow`, an Arabic/AAA toggle, `ZorDMS_Tour`, `.upload-btn`, and a Python API on :8000. None of that exists in the current React SPA (login-gated, navy chrome, gateway+core services, UUID ids). They were rewritten against the real app.

## Per-spec disposition
- **visual.spec.ts — RE-BASELINED.** Rewrote for the navy redesign (login + 5 authenticated screens). Confirmed each screen renders (content present, no error/TypeError) before capturing. Stabilised: fixed 1280×800 viewport, single font stack, animations disabled, and masked dynamic regions (charts, date inputs, sidebar version footer, live KPI values, rotating carousel). 6 fresh baseline PNGs committed under `tests/visual.spec.ts-snapshots/`. Deterministic on re-run.
- **a11y.spec.ts — A11Y-FIXED (real app fixes).** Now logs in and runs axe on the real login + dashboard. Animations frozen before scan so axe reads FINAL colours (mid-fade opacity was producing false contrast readings — a test artifact, not a real bug).
- **a11y-aaa.spec.ts — REWRITTEN + A11Y-FIXED.** Old AAA-toggle/`.upload-btn` removed. Now asserts AAA enhanced (7:1) contrast on the high-stakes login screen and 24×24 hit targets on the sign-out button + carousel dots.
- **ui.spec.ts — SELECTOR-FIXED.** Role/label/text queries for the navy sidebar nav, "Admin · CDO" identity, breadcrumb, RefId tokens, semantic sign-out. Asserts real outcomes (URL changes, identity text), not implementation details.
- **api.spec.ts — SELECTOR/CONTRACT-FIXED.** Retargeted to the real gateway+core via the Vite `/svc/*` proxy. Asserts JWT login (CDO role, UUIDv7 subject), 401 without token, and document upload→list→fetch with UUID ids + SHA-256, plus dashboard summary shape.

## Real app a11y / bug fixes (each is a genuine WCAG/contrast/structure fix)
- **Color contrast — `apps/web/src/theme.css`:** `.nav-label` was `rgba(255,255,255,.4)` (3.76:1 on navy) → `#9aa6b8` (≥4.5:1). Added text-safe semantic shades `--Gtx/--Rtx/--Wtx/--Btx/--Ptx` and pointed all `.tag` variants + `.tgold` at them (bright `--G/--R/...` failed 1.7–3.7:1 as tag text). Darkened `--sil` `#64748b`→`#5b6a80` (muted text was borderline-fail on light cards). Legend text `--sil`→`--mist`.
- **Color contrast — `apps/web/src/pages/Dashboard.tsx`:** inline trend/error text using bright `var(--G)`/`var(--R)` (2.07/3.81:1 on white) switched to the text-safe `--Gtx`/`--Rtx`.
- **Color contrast (AA + AAA) — `apps/web/src/pages/Login.tsx`:** footer version text `#94a3b8` (2.56:1) and subtitle `#64748b` → `#475569` (≥7:1) for the high-stakes sign-in screen.
- **Hit target (WCAG 2.5.8) — `apps/web/src/components/Carousel.tsx`:** slide dots were 8×8px buttons → 24×24 hit target (visual pill kept small via an inner span). Also gave them proper `role="tab"`/`aria-selected`/descriptive labels. (`Carousel.test.tsx` updated to the new accessible name.)
- **`svg-img-alt` — `apps/web/src/components/ui/charts.tsx`:** recharts donut emitted many unnamed `<path role="img">` sectors. Wrapped the chart in one labelled `role="img"` with a data summary; sectors marked `aria-hidden` and de-tabindexed.
- **`nested-interactive` — `apps/web/src/pages/Dashboard.tsx`:** the Branch Activity card (a `role="button"` wrapper) contained interactive BranchBar buttons. Replaced the wrapper with a plain `div` and moved the drill-down to its own labelled `aria-expanded` button.

## e2e-only stabilisations (no app change)
- **enterprise-flows `pickDocUuid`:** seed documents are metadata-only (no file on disk) so burn-in tools 500 on them. Now uploads the real fixture PNG (a guaranteed-loadable doc) for the Viewer stamp/redact tests — order-independent.
- **workflow-decision test:** the Review Decision card needs `workflowId && a loadable doc`; it now pairs any real workflow id with the uploaded doc (the seeded item's own doc_id can be consumed/unresolved after earlier claim/approve tests). Generous timeouts added for the single-connection in-memory SQLite under full-suite load.

## Residual
None failing. The single SKIP is an intentional data-availability guard in enterprise-flows; it is not a failure and disappears when the seeded queue is actionable.
