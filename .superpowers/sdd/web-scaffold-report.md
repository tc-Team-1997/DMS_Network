# ZorDMS Web Scaffold Report — v4.2

Generated: 2026-06-23

---

## Design-System Components (`apps/web/src/components/ui/`)

All components are exported from `apps/web/src/components/ui/index.ts`.

### AppShell
**File:** `AppShell.tsx`

| Prop | Type | Description |
|------|------|-------------|
| `children` | `ReactNode` | Page content rendered in the main scrollable area |

Renders: Topbar (brand · branch-selector · global-search · notifications · user-pill) + Sidebar (6 grouped nav sections, RBAC-filtered) + main content area + sidebar footer with pulse status.

RBAC: Each nav item has an optional `permission` string. Items are hidden when `user.permissions` does not include that permission. Nav items with no `permission` always show.

Nav groups and their required permissions:
- **Intelligence**: `dashboard:read`, `branch:read`, `customer:read`
- **Ingestion**: `document:capture`, `document:index`, `ai:read`
- **Management**: `case:read`, `document:read`, `records:read`, `lifecycle:read`
- **Discovery**: `search:read`, `document:read`
- **Process**: `workflow:read`, `review:read`, `compliance:read`, `alerts:read`
- **Analytics & Platform**: `integration:read`, `security:read`, `user:read`, `admin:read`

---

### KpiCard
**File:** `KpiCard.tsx`

| Prop | Type | Description |
|------|------|-------------|
| `label` | `string` | Uppercase small label |
| `value` | `ReactNode` | Large serif number/value |
| `sub` | `ReactNode?` | Small subtext below value |
| `variant` | `"gold" \| "blue" \| "green" \| "red" \| "purple" \| "amber"` | Top border colour |
| `className` | `string?` | Extra CSS class |

---

### Card
**File:** `Card.tsx`

| Prop | Type | Description |
|------|------|-------------|
| `title` | `ReactNode?` | Card header left |
| `action` | `ReactNode?` | Card header right |
| `children` | `ReactNode` | Card body |
| `className` | `string?` | Extra CSS class |
| `style` | `CSSProperties?` | Inline styles |

---

### DataTable
**File:** `DataTable.tsx`

Generic typed table. Columns and rows inferred from type param `T`.

| Prop | Type | Description |
|------|------|-------------|
| `columns` | `Column<T>[]` | `{ key, header, render?, sortable?, width? }` |
| `rows` | `T[]` | Data rows |
| `rowKey` | `(row: T) => string \| number` | Unique key fn |
| `onRowClick` | `(row: T) => void` optional | Row click handler |
| `emptyMessage` | `string?` | Empty state text |

Sortable columns toggle asc/desc on click.

---

### Tag / Badge
**File:** `Tag.tsx`

`Tag` — inline coloured pill. Variants: `green | red | amber | blue | purple | gold`.

`Badge` — nav badge count. Variants: `red | gold | blue`.

---

### StatusDot
**File:** `StatusDot.tsx`

| Prop | Type |
|------|------|
| `color` | `"green" \| "red" \| "amber" \| "blue"` |
| `pulse` | `boolean?` — animated pulse (default false) |

---

### Tabs
**File:** `Tabs.tsx`

| Prop | Type |
|------|------|
| `items` | `TabItem[]` — `{ key: string; label: string }[]` |
| `active` | `string` |
| `onChange` | `(key: string) => void` |

---

### Modal
**File:** `Modal.tsx`

| Prop | Type |
|------|------|
| `open` | `boolean` |
| `onClose` | `() => void` |
| `title` | `string` |
| `children` | `ReactNode` |
| `width` | `number \| string` optional (default 520) |

Renders a backdrop overlay + centered modal-box with X button.

---

### FormField
**File:** `FormField.tsx`

Union type — renders `<input>`, `<textarea>`, or `<select>` depending on `as` prop.

```ts
// Input (default)
<FormField label="Username" placeholder="…" value={v} onChange={…} />

// Textarea
<FormField as="textarea" label="Notes" rows={4} value={v} onChange={…} />

// Select
<FormField as="select" label="Role" value={v} onChange={…}>
  <option>Maker</option>
</FormField>
```

All variants accept `error?: string` and `hint?: string`.

---

### Chart Wrappers (recharts)
**File:** `charts.tsx`

#### LineChartCard
| Prop | Type |
|------|------|
| `title` | `ReactNode` |
| `action` | `ReactNode?` |
| `data` | `Record<string, unknown>[]` |
| `xKey` | `string` — x-axis data key |
| `lines` | `{ key, color?, name? }[]` |
| `height` | `number?` default 200 |

#### BarChartCard
Same shape as LineChartCard but with `bars` instead of `lines`.

#### DonutChartCard
| Prop | Type |
|------|------|
| `title` | `ReactNode` |
| `data` | `{ name: string; value: number; color?: string }[]` |
| `height` | `number?` default 200 |

#### Heatmap
| Prop | Type |
|------|------|
| `cells` | `number[]` — 0–1 intensity values, row-major |
| `cols` | `number?` default 14 |
| `title` | `ReactNode?` |

CSS-grid layout, no recharts dependency.

---

## Proxy Scheme

Configured in `apps/web/vite.config.ts`. All dev-server requests to `/svc/*` are proxied to the appropriate microservice with the prefix stripped.

```
/svc/gateway   -> http://localhost:4000  (auth, users, authz, health)
/svc/core      -> http://localhost:4001  (documents, repository, indexing, records)
/svc/workflow  -> http://localhost:4002  (workflows, cases, review, lifecycle)
/svc/notify    -> http://localhost:4003  (alerts, notifications, events)
/svc/search    -> http://localhost:4004  (enterprise search / semantic)
/svc/integrate -> http://localhost:4005  (integrations, connectors)
/svc/ai        -> http://localhost:8000  (OCR / NLP / AI classification)
```

Legacy direct paths `/auth`, `/users`, `/authz`, `/health` still proxy to `:4000` for backwards compatibility.

### Usage in screen agents

```ts
import { http, SVC } from "../api/http.js";

// GET documents from core service
const docs = await http.get(`${SVC.core}/documents?status=pending`);

// POST to workflow service
await http.post(`${SVC.workflow}/workflows`, { type: "maker-checker", … });

// GET alerts from notify service
const alerts = await http.get(`${SVC.notify}/alerts?unread=true`);

// Search via semantic engine
const results = await http.get(`${SVC.search}/query?q=passport+expiry`);

// AI job status
const job = await http.get(`${SVC.ai}/jobs/${jobId}`);

// Auth (login still goes via legacy path for existing code)
await http.post("/auth/login", { username, password });
// OR via canonical path:
await http.post(`${SVC.gateway}/auth/login`, { username, password });
```

---

## Stub Page File Paths

All stubs are default exports. Screen agents replace them with full implementations.

| Screen | File Path |
|--------|-----------|
| Dashboard | `apps/web/src/pages/Dashboard.tsx` |
| Capture | `apps/web/src/pages/Capture.tsx` |
| Indexing | `apps/web/src/pages/Indexing.tsx` |
| Repository | `apps/web/src/pages/Repository.tsx` |
| Viewer | `apps/web/src/pages/Viewer.tsx` |
| Search | `apps/web/src/pages/Search.tsx` |
| WorkflowEngine | `apps/web/src/pages/WorkflowEngine.tsx` |
| CaseManagement | `apps/web/src/pages/CaseManagement.tsx` |
| ReviewQueue | `apps/web/src/pages/ReviewQueue.tsx` |
| Alerts | `apps/web/src/pages/Alerts.tsx` |
| IntegrationHub | `apps/web/src/pages/IntegrationHub.tsx` |
| AiEngine | `apps/web/src/pages/AiEngine.tsx` |
| Security | `apps/web/src/pages/Security.tsx` |
| BranchNetwork | `apps/web/src/pages/BranchNetwork.tsx` |
| Customer360 | `apps/web/src/pages/Customer360.tsx` |
| RecordsManagement | `apps/web/src/pages/RecordsManagement.tsx` |
| ComplianceAudit | `apps/web/src/pages/ComplianceAudit.tsx` |
| DocumentLifecycle | `apps/web/src/pages/DocumentLifecycle.tsx` |
| SystemAdministration | `apps/web/src/pages/SystemAdministration.tsx` |
| Users (existing) | `apps/web/src/pages/Users.tsx` |

## Router Routes

All routes are lazy-loaded via `React.lazy()`, wrapped in `<ProtectedRoute permission="…">` and rendered inside `<AppShell>`. The router is defined in `apps/web/src/router.tsx`.

| Path | Permission | Page |
|------|-----------|------|
| `/dashboard` | `dashboard:read` | Dashboard |
| `/branch-network` | `branch:read` | BranchNetwork |
| `/customer360` | `customer:read` | Customer360 |
| `/capture` | `document:capture` | Capture |
| `/indexing` | `document:index` | Indexing |
| `/ai-engine` | `ai:read` | AiEngine |
| `/case-management` | `case:read` | CaseManagement |
| `/repository` | `document:read` | Repository |
| `/records-management` | `records:read` | RecordsManagement |
| `/document-lifecycle` | `lifecycle:read` | DocumentLifecycle |
| `/search` | `search:read` | Search |
| `/viewer` | `document:read` | Viewer |
| `/workflow-engine` | `workflow:read` | WorkflowEngine |
| `/review-queue` | `review:read` | ReviewQueue |
| `/compliance-audit` | `compliance:read` | ComplianceAudit |
| `/alerts` | `alerts:read` | Alerts |
| `/integration-hub` | `integration:read` | IntegrationHub |
| `/security` | `security:read` | Security |
| `/users` | `user:read` | Users |
| `/system-administration` | `admin:read` | SystemAdministration |
| `/login` | (public) | Login |
| `/` and `*` | — | Redirect to `/dashboard` |
