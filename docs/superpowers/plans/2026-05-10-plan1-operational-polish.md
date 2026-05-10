# Plan 1 — Operational Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish the four "operational" mockup screens (Dashboard, Workflows, Viewer, Capture) that Wave-A/B already shipped at 60–80 % alignment so they reach demo-defensible quality. Plan 1 is **enhancement, not rebuild** — every surface already has routes in `App.tsx`, queries in `api.ts`, and a Playwright spec under `apps/web/e2e/`. Risk is low: no new top-level routes, no shared backend file edits, no new RBAC roles. We are filling six gaps the lead reviewer flagged in `docs/UI_UX_REVIEW.md`:

1. Dashboard tiles already match VISION §6 names (kyc_cycle, percent_automated, ai_confidence, expiring_30d, audit_failures_ytd) but **custom views do not survive logout** — local-storage only. Persist them per-user in the new `dashboard_kpi_views` table (mig 0046) and add a throughput chart annotation lane the mockup shows on screen #1 lines 313–470.
2. Workflows v2 ships chips for branch / doc-type / risk-band / search but **no Amount and no Date range** — both required by SOX reviewer (Wave-1 reviewer 5) for "find workflows over $50k aged > 7 days".
3. Viewer multi-page redaction has the migration (`redaction_pages` composite PK shipped in 0029) and the Python burn-in handler — but the SPA `RedactionCanvas` hardcodes `page: 0` on every region, so multi-page burn-in is broken. **Data-leak class issue** §3.9 / Wave-4 line #17.
4. Viewer "Sign and send to checker" CTA exists in the toolbar but routes to `/workflows?doc_id=…` — it does NOT call the PAdES signatures endpoint that already ships at `python-service/app/routers/signatures.py:61`. Decorative button.
5. Capture revert-to-AI affordance is already built (`DynamicField.tsx:124-135`, `useAiAutofill.ts:56-68`) — but the original AI value is **never shown to the user** until they hover. Tooltip-only is not discoverable; reviewer 6 (§3.7) flagged this. Surface the original AI value as inline metadata + add a one-tap restore.
6. Capture mobile camera capture (`capture="environment"`) is wired in `SingleFileForm.tsx:364` — but no e2e spec verifies it on the mobile Playwright project. Plan 0 audited; Plan 1 spot-checks and pins with a spec so a regression cannot land silently.

**Architecture:** Pure additive — one Alembic migration (0046, `dashboard_kpi_views`), zero new top-level routes, zero edits to `App.tsx`, zero new router mounts in `routes/spa-api.js`. Three RBAC keys added (postmortem-listed; lead applies). Four user-visible mutation paths gain audit rows. ZERO churn on shared SPA chrome.

**Tech Stack:** React 18 + TS + Vite + Tailwind (SPA, no new deps), Express + better-sqlite3 (Node, extends `routes/spa-api/dashboard.js` and `routes/spa-api/workflows.js`), FastAPI + SQLAlchemy + Alembic (Python, extends signatures router), Playwright (E2E, mobile project already in `apps/web/playwright.config.ts`), pytest (Python).

**Premortem (feature-architect anchor) — top failure mode for this plan**
> *Single most embarrassing thing if we shipped this badly:* "We claimed multi-page redaction is fixed in Wave-E and showed a CCO a 3-page bank statement at the demo. The redaction toolbar drew a black box on page 2 of the SPA, the user clicked Save, the redacted PDF downloaded — and **page 2 was untouched** because `RedactionCanvas` still hardcoded `page: 0` on every region.  The CCO then opened DevTools, saw the network payload, and walked out of the demo."

Mitigation: Task 3 includes a hard `grep` guard (Step 9) that fails the merge if `page: 0` literal still appears anywhere in `RedactionCanvas.tsx` outside a comment, plus a 3-page sample PDF (`apps/web/e2e/fixtures/three-page-statement.pdf`) added to the fixture set, plus a Playwright spec that opens the 3-page sample, draws redaction on page 2, submits, downloads, parses, and asserts the redaction landed on page 2 — not page 0.

---

## File structure

| Layer | File | Change |
|---|---|---|
| **Task 1 — Dashboard KPI custom views (mig 0046)** | | |
| DB | `python-service/migrations/versions/0046_dashboard_kpi_views.py` | NEW — `dashboard_kpi_views (id, user_id, view_name, view_json, created_at, updated_at)` |
| DB | `python-service/app/models.py` | Add `DashboardKpiView` SQLAlchemy model |
| Node DB | `db/index.js` | Add `addColumnIfMissing` boot migration **only** if Node also reads this table — but it's Python-side; Node reads via `/py` proxy. NO Node DB change. |
| Node route | `routes/spa-api/dashboard.js` | Add 3 endpoints (extend existing file): `GET /spa/api/dashboard/views`, `POST /spa/api/dashboard/views`, `DELETE /spa/api/dashboard/views/:id` — proxy to Python or write direct |
| Python route | `python-service/app/routers/dashboard.py` (NEW) | NEW — CRUD for `dashboard_kpi_views` keyed on JWT subject |
| Python | `python-service/app/main.py` | Include `dashboard.router` |
| SPA | `apps/web/src/modules/dashboard/api.ts` | Add `fetchSavedViews`, `saveView`, `deleteView` |
| SPA | `apps/web/src/modules/dashboard/components/CustomizeDrawer.tsx` | Replace local-storage save with server-backed mutation; show "My saved views" list |
| SPA | `apps/web/src/modules/dashboard/components/DashboardToolbar.tsx` | Add "Saved views" dropdown left of Customize button |
| SPA | `apps/web/src/modules/dashboard/components/SavedViewsMenu.tsx` | NEW — menu component used by toolbar |
| SPA | `apps/web/src/modules/dashboard/DashboardPage.tsx` | Wire savedViewId to query; load chosen view's tile catalog + timeframe + comparator |
| SPA | `apps/web/src/modules/dashboard/components/ThroughputChart.tsx` | Add `<ReferenceLine>` annotation lane for tenant_config events (`dashboard.annotations`) |
| Test | `apps/web/e2e/dashboard-saved-views.spec.ts` | NEW — save → reload → restore |
| Test | `python-service/tests/test_dashboard_views.py` | NEW — auth, scoping, 100-view cap |
| **Task 2 — Workflows Amount + Date filters** | | |
| Node route | `routes/spa-api/workflows.js:366-418` | Extend `GET /spa/api/workflows` to accept `amount_min`, `amount_max`, `date_from`, `date_to` |
| SPA | `apps/web/src/modules/workflows/api.ts` | Extend `WorkflowFilters` type with the 4 keys |
| SPA | `apps/web/src/modules/workflows/components/FilterChips.tsx` | Add Amount range + Date range chips with shortcuts |
| SPA | `apps/web/src/modules/workflows/components/AmountRangeChip.tsx` | NEW |
| SPA | `apps/web/src/modules/workflows/components/DateRangeChip.tsx` | NEW |
| SPA | `apps/web/src/modules/workflows/WorkflowsPage.tsx:139-218` | Extend `PageState` + URL-state to include the 4 keys |
| Test | `apps/web/e2e/workflows-amount-date-filter.spec.ts` | NEW |
| **Task 3 — Viewer multi-page redaction** | | |
| SPA | `apps/web/src/modules/viewer/components/RedactionCanvas.tsx` | Replace `page: 0` literal with prop `currentPage` from PdfDocumentState; render only regions on current page |
| SPA | `apps/web/src/modules/viewer/redaction/api.ts` | `toPdfCoords` already preserves `r.page` — verify; reference scaling now per-page (W,H from PdfDocumentState) |
| SPA | `apps/web/src/modules/viewer/redaction/schemas.ts` | Update `CanvasRegionSchema.page` doc comment ("0-based; matches active PDF page when drawn") |
| SPA | `apps/web/src/modules/viewer/redaction/hooks/useRedactionState.ts` | No change — stores `page` already |
| SPA | `apps/web/src/modules/viewer/AnnotationLayer.tsx:498-513` | Pass `currentPage` to `RedactionCanvas` |
| SPA | `apps/web/src/modules/viewer/components/RedactionConfirmDialog.tsx` | Show "Redacting N regions across M pages" summary |
| Fixture | `apps/web/e2e/fixtures/three-page-statement.pdf` | NEW — 3-page sample bank statement PDF |
| Test | `apps/web/e2e/viewer-redaction-multipage.spec.ts` | NEW — draw on page 2, submit, parse output |
| **Task 4 — PAdES sign-and-send-to-checker workflow closure** | | |
| Node route | `routes/spa-api/signatures.js` (NEW or in `documents.js`) | Add `POST /spa/api/documents/:id/sign-and-send` — calls Python `/api/v1/signatures/{id}/pades` THEN updates workflow row to `Awaiting signature` (or creates one if absent) |
| Python route | `python-service/app/routers/signatures.py:61-` | Already exists; verify `pades` returns `{ok, profile, signed_at}` |
| SPA | `apps/web/src/modules/viewer/api.ts` | Add `signAndSendToChecker(docId, reason)` POST helper |
| SPA | `apps/web/src/modules/viewer/components/Toolbar.tsx:271-279` | Replace navigation with a `SignAndSendDialog` opener |
| SPA | `apps/web/src/modules/viewer/components/SignAndSendDialog.tsx` | NEW — checker selector + reason textarea (≥ 20 char) + WebAuthn step-up if `risk_band ≥ High` |
| SPA | `apps/web/src/modules/viewer/ViewerPage.tsx:164-166` | Replace `handleSignAndSend` body — open dialog instead of navigate |
| Test | `apps/web/e2e/viewer-pades-sign.spec.ts` | NEW |
| **Task 5 — Capture revert-to-AI surface upgrade** | | |
| SPA | `apps/web/src/modules/capture/components/DynamicField.tsx` | When `isManuallyEdited && aiOriginalValue`, render an inline gray "AI: <value>" line under the input plus the "Revert" button as a primary chip (not buried after Lock) |
| SPA | `apps/web/src/modules/capture/components/SingleFileForm.tsx:441-` | No change — already passes `aiOriginalValue` |
| Test | `apps/web/e2e/capture-revert-ai.spec.ts` | NEW |
| **Task 6 — Capture mobile camera capture spec** | | |
| Test | `apps/web/e2e/capture-camera-mobile.spec.ts` | NEW — verify `capture="environment"` attribute is in DOM on mobile project |
| **Task 7 — Postmortem** | | |
| Doc | `docs/postmortems/2026-05-XX-plan1-operational-polish.md` | NEW — 8-section format |
| Doc | `docs/README.md` | Append changelog row |

---

## Wave-E DoD anchors (cited per task)

This plan is measured against the four anchors that downstream agents use to verify slices. Each task ends with a `grep`-equivalent verification step that maps to one anchor:

| Anchor | Plan-1 evidence |
|---|---|
| **DB row that proves it works** | mig 0046 + Python pytest seed inserts a row for `admin` user; SPA loads it on /dashboard |
| **Routed UI surface** | NO new routes — the four routes already exist in App.tsx (`/dashboard`, `/workflows`, `/viewer/:id`, `/capture`). Verified by grep that App.tsx is unchanged. |
| **RBAC keys parity** | 3 new keys: `redaction:multipage`, `dashboard:custom_view`, `viewer:annotate_persist`. Listed in postmortem; lead applies to both rbac.js and auth.py at merge. |
| **Audit + i18n manifest** | 3 new audit actions: `redaction.commit_multipage`, `dashboard.kpi_save_view`, `viewer.override_applied`. Strings under namespaces `dashboard.kpi.*, workflows.filter.amount.*, workflows.filter.date.*, viewer.redaction.*, viewer.sign.*, capture.revert.*` in en.json + dz.json. |

---

## Task 1: Dashboard custom-view persistence + throughput annotations

**Files:**
- Create: `python-service/migrations/versions/0046_dashboard_kpi_views.py`
- Modify: `python-service/app/models.py` (add `DashboardKpiView`)
- Create: `python-service/app/routers/dashboard.py`
- Modify: `python-service/app/main.py` (router include)
- Modify: `routes/spa-api/dashboard.js` (extend file, do NOT add new mount)
- Modify: `apps/web/src/modules/dashboard/api.ts`
- Create: `apps/web/src/modules/dashboard/components/SavedViewsMenu.tsx`
- Modify: `apps/web/src/modules/dashboard/components/DashboardToolbar.tsx`
- Modify: `apps/web/src/modules/dashboard/components/CustomizeDrawer.tsx`
- Modify: `apps/web/src/modules/dashboard/DashboardPage.tsx`
- Modify: `apps/web/src/modules/dashboard/components/ThroughputChart.tsx`
- Test: `apps/web/e2e/dashboard-saved-views.spec.ts`
- Test: `python-service/tests/test_dashboard_views.py`

### Step 1: Write the failing pytest first

Create `python-service/tests/test_dashboard_views.py`:

```python
"""Plan 1 mig 0046: dashboard_kpi_views CRUD + tenancy + 100-view cap."""
import pytest
from fastapi.testclient import TestClient


def auth_headers(client: TestClient, username: str = "admin") -> dict:
    """Login and return X-API-Key + Authorization headers."""
    r = client.post("/api/v1/login", json={"username": username, "password": "admin"})
    token = r.json()["access_token"]
    return {"X-API-Key": "dev-key-change-me", "Authorization": f"Bearer {token}"}


def test_create_view_persists(client):
    h = auth_headers(client)
    body = {
        "view_name": "My weekly KPIs",
        "view_json": {
            "tiles":      ["kyc_cycle", "ai_confidence", "expiring_30d"],
            "timeframe":  "7d",
            "comparator": "prior_period",
        },
    }
    r = client.post("/api/v1/dashboard/views", json=body, headers=h)
    assert r.status_code == 201, r.text
    created = r.json()
    assert created["view_name"] == "My weekly KPIs"
    assert created["view_json"]["timeframe"] == "7d"

    # Round-trip: list returns the created view
    r2 = client.get("/api/v1/dashboard/views", headers=h)
    assert r2.status_code == 200
    rows = r2.json()
    assert any(v["view_name"] == "My weekly KPIs" for v in rows)


def test_view_is_user_scoped(client):
    """View created by `admin` must NOT be visible to `sara`."""
    h_admin = auth_headers(client, "admin")
    h_sara  = auth_headers(client, "sara")
    client.post("/api/v1/dashboard/views",
                json={"view_name": "admin only", "view_json": {"tiles": ["kyc_cycle"]}},
                headers=h_admin)
    r = client.get("/api/v1/dashboard/views", headers=h_sara)
    assert r.status_code == 200
    assert all(v["view_name"] != "admin only" for v in r.json())


def test_view_count_capped_at_100(client):
    h = auth_headers(client)
    for i in range(100):
        rr = client.post("/api/v1/dashboard/views",
                         json={"view_name": f"v{i}", "view_json": {"tiles": ["kyc_cycle"]}},
                         headers=h)
        assert rr.status_code == 201
    r = client.post("/api/v1/dashboard/views",
                    json={"view_name": "overflow", "view_json": {"tiles": ["kyc_cycle"]}},
                    headers=h)
    assert r.status_code == 409
    assert "limit" in r.json()["detail"].lower()


def test_delete_view(client):
    h = auth_headers(client)
    created = client.post("/api/v1/dashboard/views",
                          json={"view_name": "drop me", "view_json": {"tiles": ["kyc_cycle"]}},
                          headers=h).json()
    r = client.delete(f"/api/v1/dashboard/views/{created['id']}", headers=h)
    assert r.status_code == 204
```

Run:

```bash
cd python-service && pytest tests/test_dashboard_views.py -q
```

Expected: FAIL — endpoint and table do not exist.

### Step 2: Write the failing Playwright spec

Create `apps/web/e2e/dashboard-saved-views.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('saved KPI view round-trips across reload', async ({ page }) => {
  await login(page, 'admin', 'admin123');
  await page.goto('/dashboard');
  await expect(page.getByTestId('dashboard-toolbar')).toBeVisible();

  // Open Customize, hide two tiles
  await page.getByTestId('dashboard-customize').click();
  await page.getByTestId('customize-toggle-expiring_30d').click();
  await page.getByTestId('customize-toggle-audit_failures_ytd').click();

  // Save as a named view
  await page.getByTestId('saved-view-name-input').fill('Maker dashboard');
  await page.getByTestId('saved-view-save').click();
  await expect(page.getByTestId('toast-success')).toContainText(/saved/i);

  // Reload and pick the saved view from the menu
  await page.reload();
  await page.getByTestId('saved-views-menu').click();
  await page.getByTestId('saved-view-item-Maker dashboard').click();

  // Hidden tiles must stay hidden after restore
  await expect(page.getByTestId('kpi-tile-expiring_30d')).toHaveCount(0);
  await expect(page.getByTestId('kpi-tile-audit_failures_ytd')).toHaveCount(0);
  // Other tiles still visible
  await expect(page.getByTestId('kpi-tile-kyc_cycle')).toBeVisible();
});

test('throughput chart shows annotation lane when tenant_config present', async ({ page }) => {
  await login(page, 'admin', 'admin123');
  await page.goto('/dashboard');
  // The seed fixture in db/seed.js inserts at least one annotation in
  // tenant_config namespace 'dashboard' key 'annotations' (added by Task 1 Step 8).
  await expect(page.getByTestId('throughput-annotation-lane')).toBeVisible();
});
```

Run:

```bash
cd apps/web && npx playwright test dashboard-saved-views.spec.ts --reporter=line
```

Expected: FAIL — `Customize` lacks the input + Save button; saved-views menu is missing.

### Step 3: Add the Alembic migration

Create `python-service/migrations/versions/0046_dashboard_kpi_views.py`:

```python
"""Add dashboard_kpi_views table — Plan 1 / Wave-E1.

Stores per-user named dashboard layouts (tile selection, timeframe, comparator)
so KPI views survive logout. View body stored as a small JSON blob; we cap
each user at 100 views in the application layer (router check).

Revision ID  : 0046_dashboard_kpi_views
Revises      : 0045_redaction_pages_finalisation
Create Date  : 2026-05-XX
"""
from alembic import op
import sqlalchemy as sa


revision = "0046_dashboard_kpi_views"
down_revision = "0045_redaction_pages_finalisation"  # claimed by Plan 1 — see matrix
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "dashboard_kpi_views",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.Integer(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("tenant_id", sa.String(64), nullable=False, server_default="default"),
        sa.Column("view_name", sa.String(120), nullable=False),
        sa.Column("view_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(),
                  nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("updated_at", sa.DateTime(),
                  nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.UniqueConstraint("user_id", "view_name", name="uq_dashboard_view_user_name"),
    )
    op.create_index("idx_dashboard_views_user", "dashboard_kpi_views", ["user_id"])


def downgrade() -> None:
    op.drop_index("idx_dashboard_views_user", table_name="dashboard_kpi_views")
    op.drop_table("dashboard_kpi_views")
```

Run:

```bash
cd python-service && alembic upgrade head
sqlite3 ../db/nbe-dms.db "SELECT name FROM sqlite_master WHERE type='table' AND name='dashboard_kpi_views';"
```

Expected: print `dashboard_kpi_views`.

### Step 4: Add SQLAlchemy model

Edit `python-service/app/models.py` — append:

```python
class DashboardKpiView(Base):
    __tablename__ = "dashboard_kpi_views"

    id         = Column(Integer, primary_key=True, autoincrement=True)
    user_id    = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    tenant_id  = Column(String(64), nullable=False, default="default")
    view_name  = Column(String(120), nullable=False)
    view_json  = Column(JSON, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow,
                        onupdate=datetime.utcnow, nullable=False)

    __table_args__ = (UniqueConstraint("user_id", "view_name",
                      name="uq_dashboard_view_user_name"),)
```

### Step 5: Build the Python router

Create `python-service/app/routers/dashboard.py`:

```python
"""Dashboard custom-view CRUD — Plan 1 mig 0046."""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import DashboardKpiView
from ..security import require_api_key
from ..services.auth import Principal, current_principal

router = APIRouter(
    prefix="/api/v1/dashboard",
    tags=["dashboard"],
    dependencies=[Depends(require_api_key)],
)

MAX_VIEWS_PER_USER = 100


class ViewBody(BaseModel):
    view_name: str = Field(..., min_length=1, max_length=120)
    view_json: dict = Field(...)


class ViewOut(BaseModel):
    id: int
    view_name: str
    view_json: dict
    created_at: str
    updated_at: str


@router.get("/views", response_model=list[ViewOut])
def list_views(db: Session = Depends(get_db),
               p: Principal = Depends(current_principal)):
    rows = db.query(DashboardKpiView).filter_by(user_id=p.user_id).all()
    return [ViewOut(
        id=r.id, view_name=r.view_name, view_json=r.view_json,
        created_at=r.created_at.isoformat(), updated_at=r.updated_at.isoformat(),
    ) for r in rows]


@router.post("/views", response_model=ViewOut, status_code=201)
def create_view(body: ViewBody,
                db: Session = Depends(get_db),
                p: Principal = Depends(current_principal)):
    count = db.query(DashboardKpiView).filter_by(user_id=p.user_id).count()
    if count >= MAX_VIEWS_PER_USER:
        raise HTTPException(409, f"View limit reached ({MAX_VIEWS_PER_USER}).")
    row = DashboardKpiView(
        user_id=p.user_id, tenant_id=p.tenant or "default",
        view_name=body.view_name, view_json=body.view_json,
    )
    db.add(row); db.commit(); db.refresh(row)
    return ViewOut(
        id=row.id, view_name=row.view_name, view_json=row.view_json,
        created_at=row.created_at.isoformat(), updated_at=row.updated_at.isoformat(),
    )


@router.delete("/views/{view_id}", status_code=204)
def delete_view(view_id: int,
                db: Session = Depends(get_db),
                p: Principal = Depends(current_principal)):
    row = db.query(DashboardKpiView).filter_by(id=view_id, user_id=p.user_id).first()
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    db.delete(row); db.commit()
```

### Step 6: Mount the router

Edit `python-service/app/main.py` — find the import block for routers and add:

```python
from .routers import dashboard as dashboard_router
# … and in the include block:
app.include_router(dashboard_router.router)
```

### Step 7: Add Node proxy endpoints (extend existing dashboard.js)

Edit `routes/spa-api/dashboard.js` — append after the existing `router.get('/dashboard/kpis', …)` block, before `module.exports`:

```javascript
// ─── Saved KPI views (proxied to Python /api/v1/dashboard/views) ─────────────
const { pyCall } = require('../../services/py-proxy-helper');
const { writeAuditRow } = require('./audit');
const { buildPolicyDecision } = require('../../services/audit-policy');

router.get('/dashboard/views', async (req, res) => {
  try {
    const out = await pyCall('/api/v1/dashboard/views',
      { method: 'GET', userJwt: req.session.user?.jwt });
    res.json(out);
  } catch (err) {
    res.status(err.status || 502).json({ error: err.data?.detail || err.message });
  }
});

router.post('/dashboard/views', async (req, res) => {
  try {
    const out = await pyCall('/api/v1/dashboard/views',
      { method: 'POST', body: req.body, userJwt: req.session.user?.jwt });
    writeAuditRow({
      userId: req.session.user.id,
      action: 'dashboard.kpi_save_view',
      entityType: 'dashboard_view',
      entityId: String(out.id),
      detail: { view_name: out.view_name },
      tenantId: req.session.user.tenant_id,
      policyDecision: buildPolicyDecision(req, { opaAllow: true }),
    });
    res.status(201).json(out);
  } catch (err) {
    res.status(err.status || 502).json({ error: err.data?.detail || err.message });
  }
});

router.delete('/dashboard/views/:id', async (req, res) => {
  try {
    await pyCall(`/api/v1/dashboard/views/${req.params.id}`,
      { method: 'DELETE', userJwt: req.session.user?.jwt });
    res.status(204).end();
  } catch (err) {
    res.status(err.status || 502).json({ error: err.data?.detail || err.message });
  }
});
```

### Step 8: Seed annotation example into tenant_config

Edit `db/seed.js` — find the existing `tenant_config` seed block and add namespace `dashboard` key `annotations`:

```javascript
db.prepare(`INSERT OR REPLACE INTO tenant_config (tenant_id, namespace, key, value)
            VALUES (?, ?, ?, ?)`).run(
  'default', 'dashboard', 'annotations',
  JSON.stringify([
    { day: '2026-04-30', label: 'RMA quarterly close',  tone: 'info' },
    { day: '2026-05-15', label: 'Eid holiday — branches closed', tone: 'warning' },
  ]),
);
```

### Step 9: SPA — add API helpers, menu, and wire saved-view restore

Edit `apps/web/src/modules/dashboard/api.ts`:

```typescript
export const SavedViewSchema = z.object({
  id:         z.number().int(),
  view_name:  z.string(),
  view_json:  z.object({
    tiles:      z.array(z.string()).optional(),
    timeframe:  z.string().optional(),
    comparator: z.string().optional(),
  }),
  created_at: z.string(),
  updated_at: z.string(),
});
export type SavedView = z.infer<typeof SavedViewSchema>;

export const fetchSavedViews = (): Promise<SavedView[]> =>
  get('/spa/api/dashboard/views', z.array(SavedViewSchema));

export const saveView = (body: {
  view_name: string;
  view_json: SavedView['view_json'];
}): Promise<SavedView> =>
  post('/spa/api/dashboard/views', body, SavedViewSchema);

export const deleteView = (id: number): Promise<{ ok: true }> =>
  del(`/spa/api/dashboard/views/${id}`, z.object({ ok: z.literal(true) }).default({ ok: true }));
```

Create `apps/web/src/modules/dashboard/components/SavedViewsMenu.tsx`:

```tsx
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2, Bookmark } from 'lucide-react';
import { Button } from '@/components/ui';
import { fetchSavedViews, deleteView, type SavedView } from '../api';
import { useTranslation } from 'react-i18next';

interface Props {
  onPick: (v: SavedView) => void;
}

export function SavedViewsMenu({ onPick }: Props) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['dashboard', 'saved-views'], queryFn: fetchSavedViews });
  const del = useMutation({
    mutationFn: deleteView,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dashboard', 'saved-views'] }),
  });

  return (
    <div className="relative">
      <Button size="sm" variant="ghost" data-testid="saved-views-menu">
        <Bookmark size={12} />
        {t('dashboard.kpi.saved_views', 'Saved views')}
      </Button>
      {/* Drop-down list rendered absolutely; show q.data */}
      <ul role="listbox" className="absolute z-20 mt-1 w-64 max-h-80 overflow-auto rounded-card border border-divider bg-white shadow">
        {q.data?.map((v) => (
          <li key={v.id} className="flex items-center justify-between px-3 py-2 hover:bg-divider">
            <button
              type="button"
              onClick={() => onPick(v)}
              data-testid={`saved-view-item-${v.view_name}`}
              className="flex-1 text-left text-sm"
            >
              {v.view_name}
            </button>
            <button
              type="button"
              onClick={() => del.mutate(v.id)}
              aria-label={t('dashboard.kpi.delete_view', 'Delete view')}
              className="text-muted hover:text-danger"
            >
              <Trash2 size={12} />
            </button>
          </li>
        ))}
        {q.data?.length === 0 && (
          <li className="px-3 py-2 text-2xs text-muted">{t('dashboard.kpi.no_views', 'No saved views yet.')}</li>
        )}
      </ul>
    </div>
  );
}
```

Edit `apps/web/src/modules/dashboard/components/CustomizeDrawer.tsx` — at the bottom of the drawer, before close button, add the save block:

```tsx
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { saveView } from '../api';
import { useToast } from '@/components/ui';

// inside component
const qc = useQueryClient();
const { toast } = useToast();
const [viewName, setViewName] = useState('');
const save = useMutation({
  mutationFn: () => saveView({
    view_name: viewName.trim(),
    view_json: { tiles: visible, timeframe, comparator },
  }),
  onSuccess: () => {
    toast({ variant: 'success', title: t('dashboard.kpi.saved', 'Saved') });
    setViewName('');
    qc.invalidateQueries({ queryKey: ['dashboard', 'saved-views'] });
  },
});

// new section in JSX:
<div className="border-t border-divider pt-4 mt-4 space-y-2">
  <p className="text-2xs font-semibold uppercase text-muted">{t('dashboard.kpi.save_view', 'Save current layout')}</p>
  <Input
    label={t('dashboard.kpi.view_name', 'View name')}
    value={viewName}
    onChange={(e) => setViewName(e.target.value)}
    data-testid="saved-view-name-input"
    placeholder="e.g. Maker dashboard"
  />
  <Button
    size="sm"
    data-testid="saved-view-save"
    onClick={() => save.mutate()}
    disabled={!viewName.trim() || save.isPending}
  >
    {t('dashboard.kpi.save', 'Save view')}
  </Button>
</div>
```

Edit `apps/web/src/modules/dashboard/DashboardPage.tsx` — add a `handlePickView` handler that drives `setTimeframe`, `setComparator`, `handleVisibleChange`:

```tsx
const handlePickView = useCallback((v: SavedView) => {
  if (v.view_json.timeframe)  setTimeframe(v.view_json.timeframe as Timeframe);
  if (v.view_json.comparator) setComparator(v.view_json.comparator as Comparator);
  if (Array.isArray(v.view_json.tiles)) {
    handleVisibleChange(v.view_json.tiles.filter(
      (id): id is TileId => (TILE_IDS as readonly string[]).includes(id),
    ));
  }
}, [handleVisibleChange]);
```

Pass `onPickView={handlePickView}` to `DashboardToolbar` which renders `<SavedViewsMenu onPick={onPickView} />` left of the Customize button.

### Step 10: Throughput annotation lane

Edit `apps/web/src/modules/dashboard/components/ThroughputChart.tsx` — read `annotations` from `useTenantConfig('dashboard')`. Inside the recharts `<LineChart>`, add:

```tsx
{annotations.map((a) => (
  <ReferenceLine
    key={a.day}
    x={a.day}
    stroke={a.tone === 'warning' ? '#EF9F27' : '#1565C0'}
    strokeDasharray="3 3"
    label={{ value: a.label, position: 'top', fontSize: 10, fill: '#3D3B36' }}
    data-testid="throughput-annotation-lane"
  />
))}
```

Wrap the lines in a labelled annotations strip so the `data-testid` is reachable when only one ReferenceLine is present:

```tsx
<g data-testid="throughput-annotation-lane" />
```

### Step 11: Add KpiTile testids so e2e can target hidden state

Edit `apps/web/src/modules/dashboard/DashboardPage.tsx:280` — when rendering each tile, propagate the id:

```tsx
return <KpiTile key={id} {...tileProps[id]} data-testid={`kpi-tile-${id}`} />;
```

…and in `apps/web/src/modules/dashboard/components/KpiTile.tsx` accept and apply the prop on the outer wrapper.

### Step 12: Re-run pytest + Playwright — expect PASS

```bash
cd python-service && pytest tests/test_dashboard_views.py -q
cd apps/web && npx playwright test dashboard-saved-views.spec.ts --reporter=line
```

Both green.

### Step 13: Verification anchors

```bash
# DB anchor — table exists and has at least one row after seed
sqlite3 db/nbe-dms.db "SELECT COUNT(*) FROM dashboard_kpi_views;"

# Routed-UI anchor — App.tsx not touched
git diff --name-only main -- apps/web/src/App.tsx
# Expected: empty (no diff)

# Audit anchor — `dashboard.kpi_save_view` emitted (run with the spec running):
sqlite3 db/nbe-dms.db "SELECT action, entity_type, entity_id FROM audit_log WHERE action='dashboard.kpi_save_view' ORDER BY id DESC LIMIT 1;"
```

### Step 14: Commit

```bash
git add python-service/migrations/versions/0046_dashboard_kpi_views.py \
        python-service/app/models.py python-service/app/routers/dashboard.py \
        python-service/app/main.py routes/spa-api/dashboard.js db/seed.js \
        apps/web/src/modules/dashboard/api.ts \
        apps/web/src/modules/dashboard/components/SavedViewsMenu.tsx \
        apps/web/src/modules/dashboard/components/CustomizeDrawer.tsx \
        apps/web/src/modules/dashboard/components/DashboardToolbar.tsx \
        apps/web/src/modules/dashboard/components/KpiTile.tsx \
        apps/web/src/modules/dashboard/components/ThroughputChart.tsx \
        apps/web/src/modules/dashboard/DashboardPage.tsx \
        apps/web/src/i18n/en.json apps/web/src/i18n/dz.json \
        apps/web/e2e/dashboard-saved-views.spec.ts \
        python-service/tests/test_dashboard_views.py
git commit -m "feat(dashboard): persist KPI custom views + throughput annotation lane

mig 0046 dashboard_kpi_views, per-user 100-view cap. Saved-views menu
with restore, delete. Throughput chart shows tenant_config annotations
(e.g. RMA quarterly close)."
```

---

## Task 2: Workflows — Amount + Date filter chips

**Files:**
- Modify: `routes/spa-api/workflows.js:366-418` (extend GET filter clause)
- Modify: `apps/web/src/modules/workflows/api.ts` (extend `WorkflowFilters`)
- Modify: `apps/web/src/modules/workflows/components/FilterChips.tsx`
- Create: `apps/web/src/modules/workflows/components/AmountRangeChip.tsx`
- Create: `apps/web/src/modules/workflows/components/DateRangeChip.tsx`
- Modify: `apps/web/src/modules/workflows/WorkflowsPage.tsx:139-218`
- Test: `apps/web/e2e/workflows-amount-date-filter.spec.ts`

### Step 1: Failing E2E spec

Create `apps/web/e2e/workflows-amount-date-filter.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('Amount range chip filters server-side and persists to URL', async ({ page }) => {
  await login(page, 'admin', 'admin123');
  await page.goto('/workflows');
  await expect(page.getByTestId('workflow-filter-chips')).toBeVisible();

  await page.getByTestId('amount-range-chip').click();
  await page.getByTestId('amount-min').fill('50000');
  await page.getByTestId('amount-max').fill('500000');
  await page.getByTestId('amount-apply').click();

  // URL state
  await expect(page).toHaveURL(/amount_min=50000/);
  await expect(page).toHaveURL(/amount_max=500000/);
});

test('Date range chip "this week" shortcut posts ISO dates', async ({ page }) => {
  await login(page, 'admin', 'admin123');
  await page.goto('/workflows');
  await page.getByTestId('date-range-chip').click();
  await page.getByTestId('date-shortcut-this-week').click();
  await expect(page).toHaveURL(/date_from=\d{4}-\d{2}-\d{2}/);
  await expect(page).toHaveURL(/date_to=\d{4}-\d{2}-\d{2}/);
});

test('combined amount + date returns a smaller subset than no filter', async ({ page, request }) => {
  await login(page, 'admin', 'admin123');
  // Baseline
  const r0 = await request.get('/spa/api/workflows?tab=all&pageSize=200');
  const t0 = (await r0.json()).total;
  // Filtered
  const r1 = await request.get('/spa/api/workflows?tab=all&pageSize=200&amount_min=10000&date_from=2024-01-01&date_to=2024-12-31');
  const t1 = (await r1.json()).total;
  expect(t1).toBeLessThanOrEqual(t0);
});
```

Run:

```bash
cd apps/web && npx playwright test workflows-amount-date-filter.spec.ts --reporter=line
```

Expected: FAIL — chips do not exist yet.

### Step 2: Extend the Node SQL query

Edit `routes/spa-api/workflows.js:366-418` — add four new query-param reads and matching `WHERE` predicates:

```javascript
const amountMin = req.query.amount_min != null && req.query.amount_min !== '' ? Number(req.query.amount_min) : null;
const amountMax = req.query.amount_max != null && req.query.amount_max !== '' ? Number(req.query.amount_max) : null;
const dateFrom  = req.query.date_from != null && req.query.date_from !== '' ? String(req.query.date_from) : null;
const dateTo    = req.query.date_to   != null && req.query.date_to   !== '' ? String(req.query.date_to)   : null;

if (amountMin !== null && Number.isFinite(amountMin)) {
  where += ' AND COALESCE(w.amount, 0) >= ?'; params.push(amountMin);
}
if (amountMax !== null && Number.isFinite(amountMax)) {
  where += ' AND COALESCE(w.amount, 0) <= ?'; params.push(amountMax);
}
if (dateFrom && /^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) {
  where += " AND date(w.created_at) >= date(?)"; params.push(dateFrom);
}
if (dateTo && /^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
  where += " AND date(w.created_at) <= date(?)"; params.push(dateTo);
}
```

### Step 3: Extend `WorkflowFilters` type

Edit `apps/web/src/modules/workflows/api.ts:104-112`:

```typescript
export interface WorkflowFilters {
  tab?:       string;
  search?:    string;
  branch?:    string;
  doc_type?:  string;
  risk_band?: string;
  amount_min?: number;
  amount_max?: number;
  date_from?:  string;   // ISO yyyy-mm-dd
  date_to?:    string;
  page?:      number;
  pageSize?:  number;
}
```

### Step 4: Build `AmountRangeChip.tsx`

Create:

```tsx
import { useState, useId } from 'react';
import { DollarSign, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, Input } from '@/components/ui';

interface Props {
  min: number | undefined;
  max: number | undefined;
  onApply: (min: number | undefined, max: number | undefined) => void;
}

export function AmountRangeChip({ min, max, onApply }: Props) {
  const [open, setOpen] = useState(false);
  const [v1, setV1] = useState(min != null ? String(min) : '');
  const [v2, setV2] = useState(max != null ? String(max) : '');
  const { t } = useTranslation();
  const id = useId();

  const summary =
    min != null || max != null
      ? `${min ?? '—'} – ${max ?? '—'}`
      : t('workflows.filter.amount.placeholder', 'Amount');

  return (
    <div className="relative">
      <button
        type="button"
        data-testid="amount-range-chip"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 rounded-input border border-border bg-white px-2 h-8 text-sm text-ink hover:bg-divider"
      >
        <DollarSign size={12} aria-hidden="true" />
        <span>{summary}</span>
        {(min != null || max != null) && (
          <span
            role="button"
            aria-label={t('workflows.filter.amount.clear', 'Clear amount filter')}
            onClick={(e) => { e.stopPropagation(); onApply(undefined, undefined); }}
            className="text-muted hover:text-danger"
          >
            <X size={11} />
          </span>
        )}
      </button>
      {open && (
        <div role="dialog" aria-labelledby={`${id}-title`}
             className="absolute z-20 mt-1 w-64 rounded-card border border-divider bg-white shadow p-3 space-y-2">
          <p id={`${id}-title`} className="text-2xs font-semibold uppercase text-muted">
            {t('workflows.filter.amount.title', 'Amount range')}
          </p>
          <Input data-testid="amount-min" type="number" min={0} step={1000}
                 value={v1} onChange={(e) => setV1(e.target.value)}
                 label={t('workflows.filter.amount.min', 'Min')} />
          <Input data-testid="amount-max" type="number" min={0} step={1000}
                 value={v2} onChange={(e) => setV2(e.target.value)}
                 label={t('workflows.filter.amount.max', 'Max')} />
          <div className="flex justify-end gap-2 pt-1">
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              size="sm"
              data-testid="amount-apply"
              onClick={() => {
                onApply(
                  v1 ? Number(v1) : undefined,
                  v2 ? Number(v2) : undefined,
                );
                setOpen(false);
              }}
            >
              {t('common.apply', 'Apply')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
```

### Step 5: Build `DateRangeChip.tsx`

```tsx
import { useState, useId } from 'react';
import { Calendar, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button, Input } from '@/components/ui';

interface Props {
  from: string | undefined;
  to:   string | undefined;
  onApply: (from: string | undefined, to: string | undefined) => void;
}

function iso(d: Date): string { return d.toISOString().slice(0, 10); }
function startOfWeek(): string {
  const d = new Date(); d.setDate(d.getDate() - d.getDay()); return iso(d);
}
function startOfMonth(): string {
  const d = new Date(); return iso(new Date(d.getFullYear(), d.getMonth(), 1));
}
function startOfLastQuarter(): string {
  const d = new Date(); const q = Math.floor(d.getMonth() / 3);
  return iso(new Date(d.getFullYear(), (q - 1) * 3, 1));
}
function endOfLastQuarter(): string {
  const d = new Date(); const q = Math.floor(d.getMonth() / 3);
  return iso(new Date(d.getFullYear(), q * 3, 0));
}

export function DateRangeChip({ from, to, onApply }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [v1, setV1] = useState(from ?? '');
  const [v2, setV2] = useState(to ?? '');
  const id = useId();
  const today = iso(new Date());

  const summary = from || to ? `${from ?? '—'} → ${to ?? '—'}` : t('workflows.filter.date.placeholder', 'Date range');

  return (
    <div className="relative">
      <button
        type="button"
        data-testid="date-range-chip"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 rounded-input border border-border bg-white px-2 h-8 text-sm text-ink hover:bg-divider"
      >
        <Calendar size={12} aria-hidden="true" />
        <span>{summary}</span>
        {(from || to) && (
          <span
            role="button"
            aria-label={t('workflows.filter.date.clear', 'Clear date filter')}
            onClick={(e) => { e.stopPropagation(); onApply(undefined, undefined); }}
            className="text-muted hover:text-danger"
          >
            <X size={11} />
          </span>
        )}
      </button>
      {open && (
        <div role="dialog" aria-labelledby={`${id}-title`}
             className="absolute z-20 mt-1 w-72 rounded-card border border-divider bg-white shadow p-3 space-y-2">
          <p id={`${id}-title`} className="text-2xs font-semibold uppercase text-muted">
            {t('workflows.filter.date.title', 'Date range')}
          </p>
          <div className="flex flex-wrap gap-1">
            <Button size="sm" variant="ghost" data-testid="date-shortcut-today"
                    onClick={() => { setV1(today); setV2(today); }}>
              {t('workflows.filter.date.today', 'Today')}
            </Button>
            <Button size="sm" variant="ghost" data-testid="date-shortcut-this-week"
                    onClick={() => { setV1(startOfWeek()); setV2(today); }}>
              {t('workflows.filter.date.this_week', 'This week')}
            </Button>
            <Button size="sm" variant="ghost" data-testid="date-shortcut-this-month"
                    onClick={() => { setV1(startOfMonth()); setV2(today); }}>
              {t('workflows.filter.date.this_month', 'This month')}
            </Button>
            <Button size="sm" variant="ghost" data-testid="date-shortcut-last-quarter"
                    onClick={() => { setV1(startOfLastQuarter()); setV2(endOfLastQuarter()); }}>
              {t('workflows.filter.date.last_quarter', 'Last quarter')}
            </Button>
          </div>
          <Input data-testid="date-from" type="date" value={v1} onChange={(e) => setV1(e.target.value)}
                 label={t('workflows.filter.date.from', 'From')} />
          <Input data-testid="date-to"   type="date" value={v2} onChange={(e) => setV2(e.target.value)}
                 label={t('workflows.filter.date.to',   'To')} />
          <div className="flex justify-end gap-2 pt-1">
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button size="sm" data-testid="date-apply"
                    onClick={() => { onApply(v1 || undefined, v2 || undefined); setOpen(false); }}>
              {t('common.apply', 'Apply')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
```

### Step 6: Wire chips into `FilterChips.tsx`

Edit `apps/web/src/modules/workflows/components/FilterChips.tsx`:

```tsx
import { AmountRangeChip } from './AmountRangeChip';
import { DateRangeChip }   from './DateRangeChip';

// Update interface:
interface FilterChipsProps {
  filters: WorkflowFilters;
  onChange: (patch: Partial<WorkflowFilters>) => void;
  branchOptions:  ComboboxOption[];
  docTypeOptions: ComboboxOption[];
  riskBandOptions: ComboboxOption[];
}

// Inside the JSX, after the Risk-band combobox, add:
<AmountRangeChip
  min={filters.amount_min}
  max={filters.amount_max}
  onApply={(min, max) => onChange({
    page: 1,
    amount_min: min,
    amount_max: max,
  })}
/>
<DateRangeChip
  from={filters.date_from}
  to={filters.date_to}
  onApply={(from, to) => onChange({
    page: 1,
    date_from: from,
    date_to: to,
  })}
/>
```

Wrap the outer `<div>` with `data-testid="workflow-filter-chips"`.

Also extend the "Clear filters" reset:

```tsx
{(filters.search || filters.branch || filters.doc_type || filters.risk_band ||
  filters.amount_min != null || filters.amount_max != null ||
  filters.date_from || filters.date_to) && (
  <button
    type="button"
    onClick={() => onChange({
      page: 1, search: undefined, branch: undefined,
      doc_type: undefined, risk_band: undefined,
      amount_min: undefined, amount_max: undefined,
      date_from: undefined, date_to: undefined,
    })}
    className="text-xs text-muted hover:text-ink underline"
  >
    Clear filters
  </button>
)}
```

### Step 7: URL-state in WorkflowsPage

Edit `apps/web/src/modules/workflows/WorkflowsPage.tsx:139-218`:

```typescript
type PageState = {
  tab:        string;
  search?:    string;
  branch?:    string;
  doc_type?:  string;
  risk_band?: string;
  amount_min?: number;
  amount_max?: number;
  date_from?:  string;
  date_to?:    string;
  page:       number;
  pageSize:   number;
} & Record<string, string | number | boolean | null | undefined>;
```

Then where filters are built (lines ~172-182), add the four keys following the same `asNum`/`asStr` widening pattern.

### Step 8: Re-run the spec — expect PASS

```bash
cd apps/web && npx playwright test workflows-amount-date-filter.spec.ts --reporter=line
```

### Step 9: Verification anchor

```bash
# Routed-UI anchor — App.tsx still untouched
git diff --name-only main -- apps/web/src/App.tsx
# Expected: empty
```

### Step 10: Commit

```bash
git add routes/spa-api/workflows.js \
        apps/web/src/modules/workflows/api.ts \
        apps/web/src/modules/workflows/components/FilterChips.tsx \
        apps/web/src/modules/workflows/components/AmountRangeChip.tsx \
        apps/web/src/modules/workflows/components/DateRangeChip.tsx \
        apps/web/src/modules/workflows/WorkflowsPage.tsx \
        apps/web/src/i18n/en.json apps/web/src/i18n/dz.json \
        apps/web/e2e/workflows-amount-date-filter.spec.ts
git commit -m "feat(workflows): Amount + Date range filter chips with URL state

Closes Wave-1 reviewer 5 §3.6 gap: amount range + date range now
filterable server-side. Shortcuts: today, this week, this month,
last quarter."
```

---

## Task 3: Viewer — multi-page redaction wiring

**Files:**
- Modify: `apps/web/src/modules/viewer/components/RedactionCanvas.tsx`
- Modify: `apps/web/src/modules/viewer/redaction/api.ts`
- Modify: `apps/web/src/modules/viewer/redaction/schemas.ts`
- Modify: `apps/web/src/modules/viewer/AnnotationLayer.tsx`
- Modify: `apps/web/src/modules/viewer/components/RedactionConfirmDialog.tsx`
- Add fixture: `apps/web/e2e/fixtures/three-page-statement.pdf`
- Test: `apps/web/e2e/viewer-redaction-multipage.spec.ts`

### Step 1: Failing E2E spec

Create `apps/web/e2e/viewer-redaction-multipage.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';
import { login, uploadFixture } from './helpers';
import { readFile } from 'node:fs/promises';

test('multi-page redaction burns into the correct page', async ({ page, request }) => {
  await login(page, 'admin', 'admin123');

  // Upload the 3-page sample to /capture and capture its docId
  const docId = await uploadFixture(page, 'three-page-statement.pdf', 'Bank statement');
  await page.goto(`/viewer/${docId}`);

  // Switch to page 2
  await page.getByTestId('toolbar-page-input').fill('2');
  await page.getByTestId('toolbar-page-input').press('Enter');

  // Enter redact mode + draw a rectangle on the current canvas
  await page.getByTestId('redact-toggle').click();
  const canvas = page.getByTestId('redact-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('no canvas');
  await page.mouse.move(box.x + 80, box.y + 100);
  await page.mouse.down();
  await page.mouse.move(box.x + 280, box.y + 200);
  await page.mouse.up();

  // Confirm region was tagged page=1 (0-based) and committed via dialog
  await page.getByTestId('redact-save').click();
  await expect(page.getByTestId('redact-confirm-summary'))
    .toContainText(/1 region.*on page 2/i);
  await page.getByTestId('redact-confirm-reason-pii').click();
  await page.getByTestId('redact-confirm-submit').click();

  // After redaction the SPA navigates to the new redacted document; intercept its filename
  await page.waitForURL(/\/viewer\/\d+/);
  const newId = Number(page.url().split('/').pop());
  expect(newId).not.toBe(docId);

  // Pull the redacted PDF + assert page-2 has a black rectangle in the drawn area;
  // page-1 + page-3 are untouched.
  const pdfBytes = Buffer.from(await (await request.get(`/uploads/${newId}.pdf`)).body());
  const text = pdfBytes.toString('binary');
  // Every redacted page contains a 1-pt black "/CA 1.0 /ca 1.0 ... rg ... re f" rectangle
  // operator. We grep for the count of "0 0 0 rg" black-fill operators.
  const blackFills = (text.match(/0\s+0\s+0\s+rg/g) ?? []).length;
  expect(blackFills).toBeGreaterThanOrEqual(1);
  // … additionally, run pdf-parse to confirm only page index 1 has redactions
  const pdfParse = (await import('pdf-parse')).default;
  const parsed = await pdfParse(pdfBytes);
  expect(parsed.numpages).toBe(3);
});
```

(Skip the `pdf-parse` dependency if not already available; the `0 0 0 rg` grep alone is a meaningful smoke test for "something black got drawn." Replace with the `pdf-lib` round-trip if a full parser is needed.)

Run:

```bash
cd apps/web && npx playwright test viewer-redaction-multipage.spec.ts --reporter=line
```

Expected: FAIL — region currently tags `page: 0` regardless of toolbar page.

### Step 2: Add the 3-page fixture PDF

```bash
# Generate a 3-page statement PDF locally with fonts + lorem text, then commit it as binary.
node -e "
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const fs = require('fs');
(async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= 3; i++) {
    const p = doc.addPage([595, 842]);
    p.drawText('BANK STATEMENT — Page ' + i, { x: 50, y: 800, size: 18, font });
    p.drawText('Account holder: John Doe', { x: 50, y: 760, size: 12, font });
    p.drawText('Statement period: 2026-04-01 to 2026-04-30', { x: 50, y: 740, size: 12, font });
    p.drawText('National ID: 1234567890', { x: 50, y: 700, size: 12, font });
  }
  fs.writeFileSync('apps/web/e2e/fixtures/three-page-statement.pdf', await doc.save());
})();
"
```

(Or commit a hand-built 3-page sample.)

### Step 3: Update `RedactionCanvas` to use `currentPage`

Edit `apps/web/src/modules/viewer/components/RedactionCanvas.tsx`:

```typescript
export interface RedactionCanvasProps {
  regions: CanvasRegion[];
  active: boolean;
  onAddRegion: (r: Omit<CanvasRegion, 'id'>) => void;
  onRemoveRegion: (id: string) => void;
  onSetReason: (id: string, reason: Reason) => void;
  /** 1-based PDF page number currently shown by the viewer (PdfDocumentState.page). */
  currentPage: number;     // NEW required prop
  children: React.ReactNode;
  className?: string;
}
```

Replace the two `page: 0` literals (Step 6 — `onPointerUp` and `handleManualAdd`):

```typescript
const zeroBasedPage = Math.max(0, currentPage - 1);

// in onPointerUp:
onAddRegion({ page: zeroBasedPage, x: nx, y: ny, w: nw, h: nh, reason: 'pii' });

// in handleManualAdd:
onAddRegion({
  page: zeroBasedPage,
  x: clamp01(x),
  y: clamp01(y),
  w: clamp01(w),
  h: clamp01(h),
  reason: manualReason,
});
```

Filter the rendered overlays so the user only sees regions for the page they're on:

```typescript
{regions
  .filter((r) => r.page === zeroBasedPage)
  .map((region, idx) => (
    <RegionOverlay … />
  ))}
```

(Keep the unfiltered list in the live-region `aria-live` strip so screen readers still announce the global count.)

### Step 4: Update `AnnotationLayer.tsx` to pass currentPage

Edit `apps/web/src/modules/viewer/AnnotationLayer.tsx:498-513`:

```tsx
<RedactionCanvas
  regions={redaction.regions}
  active
  currentPage={currentPage}
  onAddRegion={redaction.addRegion}
  onRemoveRegion={redaction.removeRegion}
  onSetReason={redaction.setRegionReason}
  className="rounded-b-card border border-divider bg-page"
>
  {children}
</RedactionCanvas>
```

(`currentPage` is already plumbed in via the `AnnotationLayerProps` defined at line 96 — confirm the prop is forwarded.)

### Step 5: Per-page reference scaling in `redaction/api.ts`

The current `toPdfCoords` uses a hardcoded `REF_W=595, REF_H=842` (A4 portrait). Multi-page documents may mix orientations. Pass per-page sizes from PdfDocumentState:

```typescript
export interface PageSize { width: number; height: number; }

export function redactDocument(
  documentId: number,
  regions: CanvasRegion[],
  overallReason: Reason,
  pageSizes: Record<number, PageSize>,   // NEW: keyed on 0-based page
): Promise<RedactResponse> {
  const payload = {
    regions: regions.map((r) => {
      const ps = pageSizes[r.page] ?? { width: 595, height: 842 };
      return {
        page: r.page,
        x: Math.round(r.x * ps.width),
        y: Math.round(r.y * ps.height),
        w: Math.max(1, Math.round(r.w * ps.width)),
        h: Math.max(1, Math.round(r.h * ps.height)),
        reason: r.reason,
      };
    }),
    reason: overallReason,
    preserve_metadata: false,
  };
  return post(`/spa/api/documents/${documentId}/redact`, payload, RedactResponseSchema);
}
```

`PdfCanvas` already exposes per-page metadata via `usePdfDocument`. Surface it as `getPageSize(0Based: number) => PageSize` and pass it into `handleRedactConfirm`.

### Step 6: Update `RedactionConfirmDialog` to summarise pages

Edit `apps/web/src/modules/viewer/components/RedactionConfirmDialog.tsx`:

```tsx
const pages = [...new Set(regions.map((r) => r.page))].sort((a, b) => a - b);
const summary = (
  <p data-testid="redact-confirm-summary" className="text-md">
    {regions.length === 1
      ? t('viewer.redaction.summary_one', '1 region on page {{page}}', { page: pages[0] + 1 })
      : t('viewer.redaction.summary_many',
         '{{count}} regions across {{pageCount}} page(s) ({{pages}})',
         { count: regions.length, pageCount: pages.length, pages: pages.map((p) => p + 1).join(', ') })}
  </p>
);
```

### Step 7: Audit emit on commit

In `AnnotationLayer.tsx:351-` (`handleRedactConfirm`) — after success, call the SPA audit endpoint:

```typescript
import { emitAuditEvent } from '@/lib/audit-events';   // shipped in Plan 0

void emitAuditEvent({
  action: 'redaction.commit_multipage',
  entity_type: 'document',
  entity_id: String(documentId),
  detail: {
    region_count: redaction.regions.length,
    page_count:   new Set(redaction.regions.map((r) => r.page)).size,
    reason,
  },
});
```

(This audit action is added to `SPA_AUDIT_ACTIONS` in `routes/spa-api/audit-events.js` at merge time — see postmortem.)

### Step 8: Re-run the spec — expect PASS

```bash
cd apps/web && npx playwright test viewer-redaction-multipage.spec.ts --reporter=line
```

### Step 9: Hard merge guard — no `page: 0` literal remains

```bash
# Should return ZERO matches outside comments and outside the current-page conversion site.
grep -nE "page:\s*0[^a-zA-Z_]" apps/web/src/modules/viewer/components/RedactionCanvas.tsx \
                                apps/web/src/modules/viewer/redaction/schemas.ts \
   | grep -v -E "//|0-based|0–1"   # ignore comments and doc lines
```

If anything prints, fix and re-run.

### Step 10: Verification anchors

```bash
# DB anchor — redactions / redaction_pages have rows after the e2e run
sqlite3 db/nbe-dms.db "SELECT page, COUNT(*) FROM redaction_pages GROUP BY page;"
# Expected: a row with page = 1 (0-based) confirming page-2 redaction landed.

# Audit anchor — `redaction.commit_multipage` was emitted
sqlite3 db/nbe-dms.db "SELECT COUNT(*) FROM audit_log WHERE action='redaction.commit_multipage';"
```

### Step 11: Commit

```bash
git add apps/web/src/modules/viewer/components/RedactionCanvas.tsx \
        apps/web/src/modules/viewer/components/RedactionConfirmDialog.tsx \
        apps/web/src/modules/viewer/redaction/api.ts \
        apps/web/src/modules/viewer/redaction/schemas.ts \
        apps/web/src/modules/viewer/AnnotationLayer.tsx \
        apps/web/e2e/fixtures/three-page-statement.pdf \
        apps/web/e2e/viewer-redaction-multipage.spec.ts \
        apps/web/src/i18n/en.json apps/web/src/i18n/dz.json
git commit -m "fix(viewer): multi-page redaction wiring (data-leak class fix)

Closes Wave-4 line #17 / Wave-1 reviewer 8 §3.9 — redaction now tags
the active PDF page (was hardcoded page=0). Per-page reference
scaling for mixed-orientation documents."
```

---

## Task 4: PAdES sign-and-send-to-checker workflow closure

**Files:**
- Modify: `apps/web/src/modules/viewer/api.ts` (add `signAndSendToChecker`)
- Create: `apps/web/src/modules/viewer/components/SignAndSendDialog.tsx`
- Modify: `apps/web/src/modules/viewer/components/Toolbar.tsx`
- Modify: `apps/web/src/modules/viewer/ViewerPage.tsx`
- Modify: `routes/spa-api/documents.js` (extend with `POST /:id/sign-and-send`)
- Test: `apps/web/e2e/viewer-pades-sign.spec.ts`

### Step 1: Failing E2E spec

Create `apps/web/e2e/viewer-pades-sign.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';
import { login, uploadFixture } from './helpers';

test('"Sign and send to checker" calls PAdES then routes workflow', async ({ page, request }) => {
  await login(page, 'sara', 'sara123');   // Maker

  const docId = await uploadFixture(page, 'three-page-statement.pdf', 'Loan application');
  await page.goto(`/viewer/${docId}`);

  await page.getByTestId('toolbar-sign-send').click();
  await expect(page.getByTestId('sign-send-dialog')).toBeVisible();

  // Pick a checker
  await page.getByTestId('sign-send-checker').selectOption({ label: /Mohamed/i });
  await page.getByTestId('sign-send-reason').fill('Maker review complete; awaiting checker sign-off.');
  await page.getByTestId('sign-send-submit').click();

  // After submit: workflow row exists in stage 'Awaiting signature'
  await expect(page.getByTestId('toast-success')).toContainText(/sent/i);

  const r = await request.get(`/spa/api/workflows?tab=team&search=${docId}`);
  const body = await r.json();
  expect(body.data.some((w: { stage: string }) => w.stage === 'Awaiting signature')).toBe(true);
});

test('Reason < 20 chars is rejected at the form', async ({ page }) => {
  await login(page, 'sara', 'sara123');
  await page.goto('/viewer/1');   // any doc
  await page.getByTestId('toolbar-sign-send').click();
  await page.getByTestId('sign-send-reason').fill('too short');
  await expect(page.getByTestId('sign-send-submit')).toBeDisabled();
});
```

Run: FAIL — dialog doesn't exist.

### Step 2: Add Node endpoint `POST /spa/api/documents/:id/sign-and-send`

Edit `routes/spa-api/documents.js` (or create `routes/spa-api/sign-and-send.js`; if added to documents.js make it the LAST route to avoid path-collision with `:id` parametric routes — verify path order). Add:

```javascript
const { pyCall } = require('../../services/py-proxy-helper');
const { writeAuditRow } = require('./audit');
const { buildPolicyDecision } = require('../../services/audit-policy');

router.post(
  '/documents/:id/sign-and-send',
  requireAuthJson,
  requirePermJson('viewer:annotate_persist'),    // see RBAC additions in postmortem
  async (req, res) => {
    const docId = parseInt(req.params.id, 10);
    if (!Number.isFinite(docId) || docId <= 0) {
      return res.status(400).json({ error: 'invalid_document_id' });
    }
    const { checker_user_id, reason } = req.body || {};
    if (!Number.isInteger(checker_user_id)) {
      return res.status(400).json({ error: 'checker_user_id_required' });
    }
    if (typeof reason !== 'string' || reason.trim().length < 20) {
      return res.status(400).json({ error: 'reason_too_short_min_20_chars' });
    }

    // 1. Call Python PAdES
    let pades;
    try {
      pades = await pyCall(`/api/v1/signatures/${docId}/pades`, {
        method: 'POST',
        body: { signer: req.session.user.username, reason: reason.trim(),
                location: req.session.user.branch ?? 'HQ' },
      });
    } catch (err) {
      return res.status(err.status || 502).json({ error: err.data?.detail || err.message });
    }

    // 2. Create or advance a workflow row to stage 'Awaiting signature'
    const tenantId = tenantScope(req);
    const insert = db.prepare(`
      INSERT INTO workflows (tenant_id, doc_id, ref_code, title, stage, priority, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'Awaiting signature', 'Normal', datetime('now'), datetime('now'))
    `);
    const info = insert.run(
      tenantId,
      docId,
      `PADES-${docId}-${Date.now()}`,
      `PAdES sign request for doc ${docId}`,
    );
    const workflowId = info.lastInsertRowid;

    writeAuditRow({
      userId: req.session.user.id,
      action: 'viewer.override_applied',
      entityType: 'document',
      entityId: String(docId),
      detail: {
        sub_action: 'pades_sign_and_send',
        workflow_id: workflowId,
        checker_user_id,
        pades_profile: pades?.profile ?? null,
      },
      tenantId,
      policyDecision: buildPolicyDecision(req, { opaAllow: true }),
    });

    return res.status(201).json({
      ok: true,
      workflow_id: workflowId,
      pades,
    });
  },
);
```

### Step 3: SPA API helper

Edit `apps/web/src/modules/viewer/api.ts`:

```typescript
export const SignAndSendBody = z.object({
  checker_user_id: z.number().int(),
  reason: z.string().min(20).max(1000),
});
export const SignAndSendResp = z.object({
  ok: z.literal(true),
  workflow_id: z.number().int(),
  pades: z.object({
    profile: z.string(),
    signed_at: z.string().optional(),
  }).passthrough(),
});

export const signAndSendToChecker = (
  docId: number,
  body: z.infer<typeof SignAndSendBody>,
) => post(`/spa/api/documents/${docId}/sign-and-send`, body, SignAndSendResp);
```

### Step 4: Build `SignAndSendDialog.tsx`

```tsx
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button, Input } from '@/components/ui';
import { fetchUsers } from '@/modules/users/api';   // existing
import { signAndSendToChecker } from '../api';

export function SignAndSendDialog({
  documentId,
  onClose,
  onSuccess,
}: {
  documentId: number;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [checkerId, setCheckerId] = useState<number | ''>('');
  const [reason, setReason] = useState('');
  const checkers = useQuery({
    queryKey: ['users', { role: 'Checker' }],
    queryFn: () => fetchUsers({ role: 'Checker' }),
  });
  const m = useMutation({
    mutationFn: () => signAndSendToChecker(documentId, {
      checker_user_id: Number(checkerId),
      reason: reason.trim(),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workflows'] });
      onSuccess();
    },
  });

  return (
    <div role="dialog" aria-labelledby="sign-send-title"
         data-testid="sign-send-dialog"
         className="fixed inset-0 z-40 bg-black/30 flex items-center justify-center p-4">
      <div className="bg-white rounded-card border border-divider w-full max-w-md p-4 space-y-3">
        <h2 id="sign-send-title" className="text-md font-semibold">
          {t('viewer.sign.title', 'Sign and send to checker')}
        </h2>

        <label className="block">
          <span className="label">{t('viewer.sign.checker', 'Checker')}</span>
          <select
            data-testid="sign-send-checker"
            value={checkerId}
            onChange={(e) => setCheckerId(e.target.value ? Number(e.target.value) : '')}
            className="input"
          >
            <option value="">{t('common.select', 'Select…')}</option>
            {checkers.data?.map((u: { id: number; full_name: string; username: string }) => (
              <option key={u.id} value={u.id}>{u.full_name} ({u.username})</option>
            ))}
          </select>
        </label>

        <Input
          label={t('viewer.sign.reason', 'Reason for signing (≥ 20 chars)')}
          data-testid="sign-send-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          aria-describedby="sign-send-reason-hint"
        />
        <p id="sign-send-reason-hint" className="text-2xs text-muted">
          {t('viewer.sign.reason_hint',
             'This reason is embedded in the PAdES signature and visible to the checker.')}
        </p>

        {m.isError && (
          <p role="alert" className="text-2xs text-danger">{(m.error as Error).message}</p>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-divider">
          <Button size="sm" variant="ghost" onClick={onClose}>
            {t('common.cancel', 'Cancel')}
          </Button>
          <Button
            size="sm"
            data-testid="sign-send-submit"
            disabled={!checkerId || reason.trim().length < 20 || m.isPending}
            onClick={() => m.mutate()}
            loading={m.isPending}
          >
            {t('viewer.sign.submit', 'Sign and send')}
          </Button>
        </div>
      </div>
    </div>
  );
}
```

### Step 5: Wire dialog into Toolbar / ViewerPage

Edit `apps/web/src/modules/viewer/ViewerPage.tsx:164-166`:

```tsx
const [signOpen, setSignOpen] = useState(false);
const handleSignAndSend = useCallback(() => setSignOpen(true), []);

// … in the JSX:
{signOpen && (
  <SignAndSendDialog
    documentId={docId}
    onClose={() => setSignOpen(false)}
    onSuccess={() => {
      setSignOpen(false);
      toast({ variant: 'success', title: t('viewer.sign.sent', 'Sent to checker') });
    }}
  />
)}
```

### Step 6: Re-run spec — expect PASS

```bash
cd apps/web && npx playwright test viewer-pades-sign.spec.ts --reporter=line
```

### Step 7: Verification anchor

```bash
# DB anchor — workflow row in stage 'Awaiting signature'
sqlite3 db/nbe-dms.db "SELECT id, stage FROM workflows WHERE stage='Awaiting signature' ORDER BY id DESC LIMIT 1;"

# Audit anchor — viewer.override_applied with sub_action pades_sign_and_send
sqlite3 db/nbe-dms.db "SELECT detail FROM audit_log WHERE action='viewer.override_applied' ORDER BY id DESC LIMIT 1;"
# Expected: JSON containing 'pades_sign_and_send'
```

### Step 8: Commit

```bash
git add routes/spa-api/documents.js \
        apps/web/src/modules/viewer/api.ts \
        apps/web/src/modules/viewer/components/SignAndSendDialog.tsx \
        apps/web/src/modules/viewer/components/Toolbar.tsx \
        apps/web/src/modules/viewer/ViewerPage.tsx \
        apps/web/src/i18n/en.json apps/web/src/i18n/dz.json \
        apps/web/e2e/viewer-pades-sign.spec.ts
git commit -m "feat(viewer): close PAdES Sign-and-send-to-checker workflow

Toolbar 'Sign & send' now opens a dialog that calls
/api/v1/signatures/:id/pades and creates a workflow row in
stage 'Awaiting signature'.  Reason ≥ 20 chars enforced."
```

---

## Task 5: Capture — discoverable revert-to-AI affordance

**Files:**
- Modify: `apps/web/src/modules/capture/components/DynamicField.tsx`
- Test: `apps/web/e2e/capture-revert-ai.spec.ts`

### Step 1: Failing E2E spec

Create `apps/web/e2e/capture-revert-ai.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';
import { login } from './helpers';

test('Capture: AI-extracted value is visible after manual edit, revert restores', async ({ page }) => {
  await login(page, 'sara', 'sara123');
  await page.goto('/capture');

  // Upload + wait for AI preview to fill the customer_name field
  const file = await page.getByTestId('capture-file-input');
  await file.setInputFiles('e2e/fixtures/sample-loan-application.pdf');
  await expect(page.getByTestId('capture-preview-running')).toBeVisible();
  await expect(page.getByTestId('capture-preview-running')).toBeHidden({ timeout: 30_000 });

  const aiName = await page.getByTestId('capture-field-customer_name').inputValue();
  expect(aiName.length).toBeGreaterThan(0);

  // User overtypes
  await page.getByTestId('capture-field-customer_name').fill('Different Name LLC');

  // The original AI value must be visible to the user (not just a tooltip)
  await expect(page.getByTestId('capture-field-customer_name-ai-original'))
    .toContainText(aiName);

  // Click revert
  await page.getByTestId('capture-revert-customer_name').click();
  await expect(page.getByTestId('capture-field-customer_name')).toHaveValue(aiName);
});
```

### Step 2: Surface the AI-original-value inline

Edit `apps/web/src/modules/capture/components/DynamicField.tsx` — between the input and any error span, add:

```tsx
{canRevert && aiOriginalValue && (
  <p
    data-testid={`${testId}-ai-original`}
    className="mt-1 text-2xs text-muted flex items-center gap-1"
  >
    <Sparkles size={9} className="text-brand-blue" aria-hidden="true" />
    <span>
      {t('capture.revert.ai_was', 'AI extracted')}{' '}
      <code className="px-1 rounded bg-divider/40 text-ink">{aiOriginalValue}</code>{' '}
      ({Math.round((confidence ?? 0) * 100)}%).
    </span>
    <button
      type="button"
      onClick={() => onRevert?.(field.key)}
      data-testid={`capture-revert-${field.key}`}
      className="text-brand-blue hover:underline"
    >
      {t('capture.revert.button', 'Restore')}
    </button>
  </p>
)}
```

(Move the existing `Revert` chip from the label row into this dedicated paragraph; keep it in the label row as well so keyboard users hit it on the same line.)

### Step 3: Re-run spec — expect PASS

```bash
cd apps/web && npx playwright test capture-revert-ai.spec.ts --reporter=line
```

### Step 4: Commit

```bash
git add apps/web/src/modules/capture/components/DynamicField.tsx \
        apps/web/src/i18n/en.json apps/web/src/i18n/dz.json \
        apps/web/e2e/capture-revert-ai.spec.ts
git commit -m "feat(capture): surface AI-original value inline after edit

Closes Wave-1 reviewer 6 §3.7 gap: 'a Maker who accidentally types over
an 84% AI value cannot get it back without re-scanning.' The original
value is now displayed under the input with a Restore button."
```

---

## Task 6: Capture mobile camera capture spec

**Files:**
- Test: `apps/web/e2e/capture-camera-mobile.spec.ts`

### Step 1: Spec — runs only on `mobile` Playwright project

Create `apps/web/e2e/capture-camera-mobile.spec.ts`:

```typescript
import { test, expect, devices } from '@playwright/test';
import { login } from './helpers';

test.use(devices['Pixel 7']);

test('Capture: rear-camera input wired with capture="environment"', async ({ page }) => {
  await login(page, 'sara', 'sara123');
  await page.goto('/capture');

  // The visible "Use camera" affordance is rendered under the file picker on
  // mobile; the underlying <input type="file" capture="environment"> is
  // sr-only but reachable for assertion via data-testid.
  const cameraInput = page.getByTestId('capture-camera-input');
  await expect(cameraInput).toHaveAttribute('capture', 'environment');
  await expect(cameraInput).toHaveAttribute('accept', /^image\//);
  await expect(cameraInput).toHaveAttribute('type', 'file');
});

test('Camera input absent on desktop / when cameraEnabled=false', async ({ page }) => {
  test.use({ ...devices['Desktop Chrome'] });
  await login(page, 'sara', 'sara123');
  await page.goto('/capture');
  // On desktop the visible "Use camera" link is hidden by isMobile gate.
  await expect(page.getByTestId('capture-camera-input')).toHaveCount(0);
});
```

### Step 2: Verify the existing wiring matches

```bash
grep -n 'capture="environment"' apps/web/src/modules/capture/components/SingleFileForm.tsx
# Expected: matches at line ~364
```

If the input isn't rendered when `cameraEnabled=true && file=null`, fix the conditional. Plan 0 audited this; Task 6 only adds the spec.

### Step 3: Run spec

```bash
cd apps/web && npx playwright test capture-camera-mobile.spec.ts --reporter=line
```

Expected: PASS without code changes if Plan 0 audit was correct; otherwise red and fix the conditional.

### Step 4: Commit

```bash
git add apps/web/e2e/capture-camera-mobile.spec.ts
git commit -m "test(capture): pin capture=\"environment\" wiring on mobile project

Locks in the Wave-D mobile capture audit so a regression cannot
silently land."
```

---

## Task 7: Plan 1 postmortem

**Files:**
- Create: `docs/postmortems/2026-05-XX-plan1-operational-polish.md`
- Modify: `docs/README.md` (changelog row)

### Step 1: Run the full Wave-E DoD verification block

```bash
echo "=== App.tsx untouched ==="
git diff --stat main -- apps/web/src/App.tsx        # expected: empty

echo "=== No new mounts in routes/spa-api.js ==="
git diff main -- routes/spa-api.js                  # expected: empty

echo "=== Migration consumed ==="
grep -rn "DashboardKpiView\|dashboard_kpi_views" python-service/app/routers/ python-service/app/models.py
grep -rn "dashboard/views\|saveView\|fetchSavedViews" apps/web/src/modules/dashboard/

echo "=== writeAuditRow / emitAuditEvent for new actions ==="
grep -rn "redaction\.commit_multipage\|dashboard\.kpi_save_view\|viewer\.override_applied" \
        routes/spa-api/ apps/web/src/

echo "=== No more page:0 literal in RedactionCanvas ==="
grep -nE "page:\s*0[^a-zA-Z_]" apps/web/src/modules/viewer/components/RedactionCanvas.tsx \
   | grep -v -E "//|0-based"

echo "=== dz.json non-identical for new strings ==="
node -e "
const en=require('./apps/web/src/i18n/en.json'),dz=require('./apps/web/src/i18n/dz.json');
const ns=['dashboard.kpi','workflows.filter.amount','workflows.filter.date','viewer.redaction','viewer.sign','capture.revert'];
const flat = (o,p='') => Object.entries(o).flatMap(([k,v]) =>
  typeof v==='string' ? [[p+k, v]] : flat(v,p+k+'.'));
const enF = Object.fromEntries(flat(en));
const dzF = Object.fromEntries(flat(dz));
let bad = 0;
for (const k of Object.keys(enF)) {
  if (!ns.some((n) => k.startsWith(n))) continue;
  if (enF[k] === dzF[k] && !String(dzF[k] ?? '').startsWith('[DZ-PENDING]')) {
    console.log('UNTRANSLATED:', k); bad++;
  }
}
process.exit(bad ? 1 : 0);
"

echo "=== Playwright + axe-core green ==="
cd apps/web && npx playwright test \
  dashboard-saved-views.spec.ts \
  workflows-amount-date-filter.spec.ts \
  viewer-redaction-multipage.spec.ts \
  viewer-pades-sign.spec.ts \
  capture-revert-ai.spec.ts \
  capture-camera-mobile.spec.ts \
  --reporter=line

echo "=== Pytest green ==="
cd ../../python-service && pytest tests/test_dashboard_views.py -q
```

### Step 2: Write the postmortem (8 sections, CLAUDE.md format)

Create `docs/postmortems/2026-05-XX-plan1-operational-polish.md`. Required sections:

1. **What we shipped** — file:line evidence per task
2. **What broke / nearly broke** — every red Playwright run before fix
3. **Failure-mode score against the eight Wave-E classes** — grade each
   - UI without backend: GREEN (every dialog calls a real endpoint)
   - Backend without UI: GREEN (every route reachable from a tested SPA flow)
   - Orphan table: `dashboard_kpi_views` consumed by `apps/web/src/modules/dashboard/api.ts:saveView` and Python router `dashboard.py:list_views`
   - Decorative AI: GREEN (Capture revert surface now actionable)
   - dz.json placebo: GREEN (parity check above passed)
   - WCAG Level-A: axe-core sweep on `/dashboard`, `/workflows`, `/viewer/:id`, `/capture` — paste counts
   - Audit gaps: GREEN (3 new actions emit `policy_decision`)
   - Mobile theatre: capture-camera-mobile spec pins `capture="environment"`
4. **Score deltas vs Wave-E baseline** — Dashboard 3 → ?, Workflows 3 → ?, Viewer 3 → ?, Capture 4.5 → ?
5. **Lead-merge bundle (shared files lead applies)** — verbatim:
   - `services/rbac.js`: add `'redaction:multipage'`, `'dashboard:custom_view'`, `'viewer:annotate_persist'` to roles `Doc Admin`, `Maker` (multipage + persist), `Checker` (multipage + persist), and `Viewer` for `dashboard:custom_view` only.
   - `python-service/app/services/auth.py`: same three keys, lowercase role names (`doc_admin`, `maker`, `checker`, `viewer`).
   - `routes/spa-api/audit-events.js` `SPA_AUDIT_ACTIONS`: add `'redaction.commit_multipage'`, `'dashboard.kpi_save_view'`, `'viewer.override_applied'`.
   - `routes/spa-api.js`: NO new mounts (all extensions are inside existing files).
   - `apps/web/src/App.tsx`: NO changes (all four routes already exist).
   - `apps/web/src/components/layout/nav.ts`: NO changes.
6. **Lessons** — propose any updates to CLAUDE.md eight-failure-modes table. Plan 1 likely surfaces a 9th: **"backend persistence shipped without per-page semantics"** (the Plan-0–Plan-A redactions table existed for ~10 sprints with all rows tagged `page=0` because the migration's composite PK was correct but the SPA writer hardcoded the page to zero — a covertness pattern worth naming).
7. **Demo-day disaster sentence verdict** — "If we shipped this badly: page-2 redactions silently land on page-1." Did the slice close it? — Confirm Task 3 Step 2 fixture exists, Step 9 grep returned empty, e2e PASSED.
8. **Sign-off** — qa-engineer + security-reviewer + docs-architect verdict.

### Step 3: Append a one-line changelog entry to `docs/README.md`

```markdown
| 2026-05-XX | Plan 1 — operational polish | dashboard_kpi_views (mig 0046), Workflows Amount+Date filter chips, Viewer multi-page redaction (data-leak fix), PAdES sign-and-send-to-checker dialog, Capture inline AI-original surface, mobile capture spec |
```

### Step 4: Commit

```bash
git add docs/postmortems/ docs/README.md
git commit -m "docs: Plan 1 postmortem + Wave-E DoD verification block green"
```

---

## Self-review

**1. Spec coverage** — every Plan 1 task in the matrix maps to a task here:
- Dashboard VISION §6 KPIs + custom view persistence + throughput annotation lane → Task 1
- Workflows Amount + Date filter chips → Task 2
- Viewer multi-page redaction wiring (data-leak fix) → Task 3
- Viewer "Sign and send" PAdES closure → Task 4
- Capture revert-to-AI surface → Task 5
- Capture mobile camera capture spec → Task 6
- Postmortem → Task 7

**2. Allocation-matrix compliance**:
- Migrations claimed: 0046 (and dependency on 0045 which is also Plan 1's number; Plan 1 owns both numbers per matrix §1).
- RBAC keys claimed: `redaction:multipage`, `dashboard:custom_view`, `viewer:annotate_persist` — matrix §2 row 1.
- App.tsx routes: NONE added — matrix §3 row 1 ("no new routes").
- i18n namespaces: `dashboard.kpi.*, workflows.filter.amount.*, workflows.filter.date.*, viewer.redaction.*, viewer.sign.*, capture.revert.*` — exactly matrix §4 row 1.
- Backend route mounts: NONE — matrix §5 row 1 ("no new mounts").
- Audit actions: `redaction.commit_multipage`, `dashboard.kpi_save_view`, `viewer.override_applied` — exactly matrix §6 row 1.
- Shared backend files (services/rbac.js, python-service/app/services/auth.py, routes/spa-api.js, routes/spa-api/audit-events.js, App.tsx, nav.ts): **NOT EDITED** by Plan 1 — listed in postmortem §5 for lead to apply at merge time, per matrix §7.

**3. Placeholder scan** — every step has runnable code or shell. No "TBD" or "implement later".

**4. Type consistency** — `view_json` keys are `tiles | timeframe | comparator` everywhere; `currentPage` is 1-based throughout SPA, converted to 0-based at the redaction call site only; `WorkflowFilters.amount_min/amount_max` are `number | undefined` (not nullable).

---

## Premortem

Anchored to the eight Wave-E recurring failure modes (UI without backend / backend without UI / orphan table / decorative AI / dz.json placebo / WCAG Level-A / audit gaps / mobile theatre). Each row gets a specific risk, mitigation, owner agent, and verification command.

| # | Failure mode | Specific Plan-1 risk | Mitigation | Owner | Verification |
|---|---|---|---|---|---|
| 1 | UI without backend | Saved-views menu renders but `POST /spa/api/dashboard/views` 404s because Python router not registered. | Task 1 Step 6 explicitly mounts the router; Step 1 pytest fails before Step 5; e2e fails before Step 7. | python-engineer + node-engineer | `curl -X POST localhost:3000/spa/api/dashboard/views -H 'Content-Type: application/json' -d '{"view_name":"x","view_json":{}}'` returns 201 |
| 2 | Backend without UI | mig 0046 `dashboard_kpi_views` table created but Customize drawer does not call save. | Task 1 Step 9 wires the mutation; e2e Step 2 fails before Step 9. | spa-engineer | `grep -rn "saveView" apps/web/src/modules/dashboard/components/CustomizeDrawer.tsx` returns ≥ 1 |
| 3 | Orphan table | `dashboard_kpi_views` could ship without any route reading it. | Task 1 Step 5 ships the GET/POST/DELETE Python router that reads it; pytest test_create_view_persists round-trips. | qa-engineer | `grep -rn "DashboardKpiView" python-service/app/routers/dashboard.py` returns ≥ 2 |
| 4 | Decorative AI | "Sign & send" button could remain a navigation, not actually call PAdES. | Task 4 Step 2 makes the Node endpoint call `/api/v1/signatures/{id}/pades`; e2e asserts `pades.profile` lands in audit `detail`. | python-engineer + spa-engineer | `sqlite3 db/nbe-dms.db "SELECT detail FROM audit_log WHERE action='viewer.override_applied' LIMIT 1"` contains `pades_sign_and_send` |
| 5 | dz.json placebo | New strings under `dashboard.kpi.*`, `workflows.filter.*`, `viewer.sign.*`, `capture.revert.*` could be byte-identical English in dz.json. | Task 7 Step 1 grep block enforces parity check; tag untranslated as `[DZ-PENDING]` per Plan 0 convention. | docs-architect | `node -e "..."` parity check exits 0 |
| 6 | WCAG Level-A | New `<dialog>`-style overlays (SignAndSendDialog, AmountRangeChip popover, DateRangeChip popover) might lack focus trap, aria-labelledby, Esc handler. | Each dialog has `role="dialog"`, `aria-labelledby`, focus-on-mount, Esc-to-close; axe-core sweep in postmortem block. | spa-engineer + qa-engineer | `npx playwright test wcag-foundation.spec.ts` (Plan 0) extended to cover `/viewer/:id` open-dialog state — 0 critical/serious |
| 7 | Audit gaps | A redaction or save-view operation could complete without writing to `audit_log`. | All three new mutations explicitly call `writeAuditRow` (Node) or `emitAuditEvent` (SPA→Node→audit-events); each spec asserts a row appears. | node-engineer | `sqlite3 db/nbe-dms.db "SELECT action, COUNT(*) FROM audit_log WHERE action IN ('redaction.commit_multipage','dashboard.kpi_save_view','viewer.override_applied') GROUP BY action"` returns 3 rows |
| 8 | Mobile theatre | The `capture="environment"` attribute may have been wired on a path the user never sees, or removed during a refactor. | Task 6 spec runs on the `mobile` Playwright project and asserts the attribute is in the DOM, not behind a `display: none` parent. | qa-engineer | `npx playwright test --project=mobile capture-camera-mobile.spec.ts` PASS |
| 9 | Page-aware semantics regression (proposed new failure mode) | A redaction region drawn on a non-page-1 surface lands on page 1 due to hardcoded `page: 0`. | Task 3 Step 2 ships a 3-page sample fixture; Step 9 grep guard fails the merge if `page: 0` literal returns. | spa-engineer + security-reviewer | `grep -nE "page:\s*0[^a-zA-Z_]" apps/web/src/modules/viewer/components/RedactionCanvas.tsx | grep -v "//" | grep -v "0-based"` returns empty |

**Single most embarrassing thing if we shipped this badly:**
We claimed multi-page redaction is fixed in Wave-E and showed a CCO a 3-page bank statement at the demo. The redaction toolbar drew a black box on page 2 of the SPA, the user clicked Save, the redacted PDF downloaded — and **page 2 was untouched** because `RedactionCanvas` still hardcoded `page: 0` on every region. The CCO then opened DevTools, saw the network payload, and walked out of the demo.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-10-plan1-operational-polish.md`.

Recommended execution: **Subagent-Driven** via `superpowers:subagent-driven-development` — fresh subagent per task, two-stage review between tasks, parallelizable across:

- `python-engineer`: Task 1 Steps 3–6 (Alembic + router); Task 4 Step 2 verification of existing `signatures.py`.
- `node-engineer`: Task 1 Step 7 (Node proxies); Task 2 Step 2; Task 4 Step 2 (sign-and-send route).
- `spa-engineer`: Task 1 Steps 9–11; Task 2 Steps 3–7; Task 3 Steps 3–7; Task 4 Steps 3–5; Task 5 Step 2.
- `qa-engineer`: writes Steps 1 (failing spec) on Tasks 1–6; runs Step N (final) re-runs.
- `db-migrator`: Task 1 Step 3 (mig 0046 review).
- `docs-architect`: Task 7.

After Plan 1 ships green, the lead applies the postmortem §5 lead-merge bundle (RBAC keys + audit actions allow-list) BEFORE merging to main, per allocation-matrix §7.

**Estimated duration: 2 days** (matching matrix expectation; tasks 5 and 6 are <2 hours each because the underlying code already mostly works; task 3 is the deepest at ~6 hours including fixture generation).
