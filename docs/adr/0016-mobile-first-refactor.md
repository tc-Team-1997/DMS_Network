# ADR-0016: Mobile-First Refactor (Wave D)

**Status**: Accepted  
**Date**: 2026-05-10  
**Author**: spa-engineer (Wave D)  
**Supersedes**: —  
**Related**: ADR-0008 (tenant-config spine), docs/UI_UX_REVIEW.md §3.20

---

## Context

The SPA scored **2/10** on the Mobile / Responsive axis (UI/UX Review §3.20). Concrete failures:

- Sidebar at 220 px occupied 53% of a Pixel 7 screen and was not off-canvas.
- `DataTable` always rendered the grid view; the `mobileCard` prop existed but required callers to opt in.
- Touch targets defaulted to ~32×32 px (CC4 sizes), failing Fitts's law and Apple HIG (≥44×44).
- Viewer right rail was a fixed 300 px aside; AI/annotation panel broke below 768 px.
- Capture file input lacked `capture="environment"`; phones showed a generic file picker.
- Topbar (64 px) was crowded with no compact mobile mode.

A `mobile` Playwright project (Pixel 7 emulation) existed in `playwright.config.ts` but was excluded from runs because specs failed.

---

## Decision

### 1. Breakpoint strategy: `lg` (1024 px) for sidebar, `md` (768 px) for everything else

Two breakpoints mirror the existing Tailwind `lg`/`md` tokens and align with Material Design / iOS canonical sizes.

- **Below `lg`**: sidebar becomes an off-canvas Drawer; hamburger appears in Topbar.
- **Below `md`**: DataTable auto-switches to card layout, Topbar enters compact mode, touch targets get `min-h-[44px] min-w-[44px]`, Viewer right rail becomes a bottom-sheet Drawer.

These breakpoints are tenant-configurable via the `mobile_ux` namespace (§7 below).

### 2. Off-canvas Drawer — CC4 `Drawer` primitive (not Headless UI)

We reuse `apps/web/src/components/ui/Drawer.tsx` (CC4) for both the sidebar drawer (`side="left"`) and the Viewer bottom-sheet (`side="bottom"`).

**Why CC4 and not Headless UI?**  
Headless UI is not yet a project dependency. Adding it for one feature would increase the bundle by ~8 KB gz. The CC4 Drawer already handles focus trapping, Escape dismissal, body-scroll locking, swipe-to-dismiss on bottom drawers, and ARIA roles. Extending it is zero-cost.

**Trade-off**: CC4 Drawer has no built-in slide animation. We accept this; a CSS `transform` transition can be added later without changing the API.

### 3. DataTable card mode — default on below `md`

`DataTable` gained a built-in fallback card renderer. When `isMobile` is true and no `mobileCard` prop is provided, each row renders as a `<div role="article" data-testid="row-card">` with column label/value pairs. Callers that already supply `mobileCard` continue to use their custom renderer.

This is backwards-compatible: the `mobileCard` prop still overrides the default.

### 4. Touch targets — Tailwind modifier pattern

`Button`, `BellButton`, nav links in `MobileSidebar`, and the logout button all add `min-h-[44px] min-w-[44px]` with a `md:min-h-0` override so desktop keeps compact targets:

```tsx
className="h-8 px-3 text-xs min-h-[44px] md:min-h-0"
```

No raw px values; all sizing uses Tailwind classes.

### 5. Capture — `capture="environment"` on dedicated camera input

The main `<input type="file" multiple>` keeps its generic picker so desktop workflows are unaffected. A second `<input type="file" accept="image/*" capture="environment">` opens the rear camera directly on mobile. It is rendered only when `cameraEnabled` is true (tenant config). A visual hint ("Tap to take a photo with your camera") is shown on mobile.

### 6. Viewer — fluid PDF + bottom-sheet AI panel

`PdfCanvas` adds `max-w-full` to the canvas wrapper, preventing horizontal overflow on narrow viewports.

Below `md`, the right rail (`RailTabs`) is moved out of the inline `<aside>` and into a `Drawer side="bottom"`. A floating trigger button ("Details") is absolutely positioned over the canvas to open it. On desktop the aside renders as before.

### 7. `mobile_ux` tenant-config namespace (namespace #18)

Five keys stored in `schemas/tenant-config/mobile_ux.json`:

| Key | Type | Default |
|---|---|---|
| `enable_capture_environment` | bool | true |
| `mobile_breakpoint_lg_px` | int | 1024 |
| `mobile_breakpoint_md_px` | int | 768 |
| `min_touch_target_px` | int | 44 |
| `default_card_mode_below_md` | bool | true |

Banks can change breakpoints (e.g. a bank deploying to tablet-only field officers might set `mobile_breakpoint_lg_px: 1280`) without a recode. The `useIsMobile` / `useIsBelowLg` hooks read these at runtime.

Write access is Doc Admin only (RBAC default). The namespace is registered in `services/rbac.js` `ADMIN_NAMESPACES`.

### 8. Playwright — mobile project enabled

`playwright.config.ts` now includes a `mobile` project using `devices['Pixel 7']`. It runs `mobile-ux.spec.ts` plus the six operational specs (dashboard, capture, repository, viewer, workflows). Specs mock `/spa/api/*` via `page.route` for edge/error states; the mobile-ux happy path stubs the API so no backend is required.

---

## Consequences

**Positive**:
- Mobile UX score rises from 2/10 to ~7/10 (sidebar usable, card mode auto-on, camera direct, no horizontal scroll, touch targets compliant).
- Zero breaking changes: desktop layout, DataTable callers, and existing Playwright specs are unaffected.
- `mobile_ux` namespace gives banks control over breakpoints and touch targets.

**Negative / trade-offs**:
- No CSS slide animation on the sidebar drawer (acceptable; addable later).
- Bottom-sheet Viewer panel requires an extra tap on mobile vs. always-visible rail on desktop.
- `useIsBelowLg` fires a re-render on resize. For the AppLayout (singleton) this is fine; high-frequency resize would need debouncing.

**Out of scope (Wave D)**:
- Responsive Topbar search that actually queries the backend (the overlay is a stub).
- Full Headless UI migration.
- Tablet-specific layouts (handled by the same lg/md breakpoints as a subset).
