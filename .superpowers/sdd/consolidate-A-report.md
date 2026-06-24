# Phase A Consolidation Report — @zordms/auth + @zordms/types

## Status
Both packages build clean and all tests pass (24 auth tests, 2 types tests).

---

## @zordms/auth — New Exports from `packages/auth/src/middleware.ts`

Import path: `@zordms/auth` (re-exported from index)

### Types / Interfaces

```ts
interface AuthUser {
  id: number;
  username: string;
  roles: string[];
  permissions: string[];
  branch?: string;
  region?: string;
}

interface ViewerScope {
  branch?: string;
  canCrossBranch: boolean;
}
```

Express global augmentation added:
```ts
declare global {
  namespace Express {
    interface Request {
      authUser?: AuthUser;
    }
  }
}
```

### Middleware Functions

```ts
// Verify Bearer JWT from Authorization header; populate req.authUser from claims.
// Uses req.app.locals.deps.config.jwtSecret. NO DB lookup.
// Returns 401 {error:"unauthorized"} if missing/invalid.
const requireAuth: RequestHandler

// Factory returning middleware that checks req.authUser.permissions.
// 401 if no req.authUser; 403 {error:"forbidden", required} if perm absent.
function requirePermission(permission: string): RequestHandler

// Wraps async route handlers to forward thrown errors to next(err).
function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
): RequestHandler

// 4-arg Express error handler. Returns 500 {error:"internal_error"}. No stack leak.
function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void

// Returns branch-scope viewer object for fail-closed branch logic.
function makeViewer(req: Request): ViewerScope
```

### Usage Pattern (downstream services)

```ts
import { requireAuth, requirePermission, asyncHandler, errorHandler, makeViewer } from "@zordms/auth";

// In route setup:
router.get("/docs", requireAuth, requirePermission("docs:read"), asyncHandler(async (req, res) => {
  const viewer = makeViewer(req);
  // viewer.branch — user's home branch (undefined if not set)
  // viewer.canCrossBranch — true iff token has "crossbranch:read" permission
  res.json({ ok: true });
}));

// At app level (after all routes):
app.use(errorHandler);
```

---

## @zordms/types — New Exports from `packages/types/src/index.ts`

### Search Domain

```ts
interface SearchDoc { doc_id, ocr_text, metadata_text, doc_type, branch, status, risk_band, legal_hold, expiry_status, uploaded_by, indexed_at }
type SearchMode = "fulltext" | "boolean" | "wildcard" | "fuzzy" | "semantic"
interface SearchFilters { doc_type?, status?, branch?, uploaded_by?, risk_band?, legal_hold?, expiry_status?, date_from?, date_to? }
interface SearchQuery { text, mode, filters?, page?, pageSize?, sort? }
interface SearchScope { branch?, region?, crossBranch }
interface SearchHit { doc_id, doc_type, branch, status, snippet, score, indexed_at }
interface SearchResults { hits, total, page, pageSize, tookMs, facets? }
type SavedSearchVisibility = "private" | "public"
interface SavedSearch { id, user_id, name, query_json, visibility }
interface SaveSearchRequest { name, query, visibility }
function isSearchQuery(x: unknown): x is SearchQuery
```

### Integration Domain

```ts
type IntegrationDirection = "outbound" | "inbound"
interface IntegrationLog { id, system, endpoint, method, status, latency_ms, direction, success, error?, created_at? }
interface IntegrationConfigRow { id, system, base_url?, auth_type, secret?, enabled, created_at? }
interface OutboundWebhook { id, url, events, auth_method, enabled, created_at? }
interface ConnectedSystem { system, base_url?, enabled, status, lastCallAt?, recentErrors }
interface ConnectorResult<T = unknown> { ok, status, data?, error?, mock? }
const INTEGRATION_EVENTS: readonly ["cbs.customer.updated", "los.loan.created", "kyc.result"]
type IntegrationEvent = typeof INTEGRATION_EVENTS[number]
function isConnectorResult(x: unknown): x is ConnectorResult
```

---

## Phase B Instructions

- Services can now `import { requireAuth, requirePermission, asyncHandler, errorHandler, makeViewer, AuthUser } from "@zordms/auth"` and remove their local auth middleware copies.
- Services can `import { SearchDoc, SearchQuery, SearchResults, ... ConnectorResult, ConnectedSystem, ... } from "@zordms/types"` and remove local type files.
- The service-local type files (`services/search/src/types.ts`, `services/integration/src/types.ts`) still exist — Phase B should migrate imports and then delete or reduce those files.
- `resolveUserAuthz` (DB-lookup auth for the gateway) is still exported from `@zordms/auth` — do NOT use it in downstream services.
