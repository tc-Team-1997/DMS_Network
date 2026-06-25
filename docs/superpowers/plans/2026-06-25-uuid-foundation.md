# UUID Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay Phase 1 foundation for migrating ZorDMS from integer auto-increment IDs to UUIDv7 string primary keys by updating only the two shared packages: `@zordms/db` and `@zordms/auth`.

**Architecture:** Add a `newId()` UUIDv7 generator to `@zordms/db` and export it from the package index. Update `@zordms/auth` to use `string` instead of `number` for `TokenPayload.sub`, `AuthUser.id` — changing `Number(decoded.sub)` to `String(decoded.sub)` in both `tokens.ts` and `middleware.ts`. No services or frontend are touched.

**Tech Stack:** TypeScript 5.4, Vitest 1.6, `uuidv7` npm package (or inline node:crypto fallback), jsonwebtoken 9.

## Global Constraints

- Work ONLY in `packages/db` and `packages/auth`. DO NOT touch `services/*` or `apps/*`.
- No git commits.
- `pnpm install` is allowed.
- All tests must pass green.
- Target Node >= 20.
- UUIDv7 must be RFC 9562 canonical 36-char lowercase format.

---

### Task 1: Add `newId()` UUIDv7 generator to `@zordms/db`

**Files:**
- Modify: `packages/db/package.json`
- Create: `packages/db/src/id.ts`
- Modify: `packages/db/src/index.ts`
- Create: `packages/db/src/id.test.ts`

**Interfaces:**
- Produces: `export function newId(): string` — returns 36-char UUIDv7

- [ ] **Step 1: Add `uuidv7` as a dependency in `packages/db/package.json`**

Edit `packages/db/package.json` dependencies to add `"uuidv7": "^0.0.5"` (latest stable that provides named export `uuidv7`):

```json
"dependencies": {
  "knex": "^3.1.0",
  "@zordms/config": "workspace:*",
  "bcryptjs": "^2.4.3",
  "uuidv7": "^0.0.5"
}
```

- [ ] **Step 2: Install the new dependency**

Run from the monorepo root:
```bash
cd /Users/amitkatoch/Documents/DMS_Network && pnpm install
```
Expected: resolves and installs `uuidv7` with no errors.

- [ ] **Step 3: Write the failing test first**

Create `packages/db/src/id.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { newId } from "./id.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("newId", () => {
  it("returns a 36-char string", () => {
    expect(newId()).toHaveLength(36);
  });

  it("matches canonical UUID format with version nibble 7", () => {
    expect(newId()).toMatch(UUID_RE);
  });

  it("produces unique values over 1000 calls", () => {
    const ids = Array.from({ length: 1000 }, () => newId());
    expect(new Set(ids).size).toBe(1000);
  });

  it("is monotonically non-decreasing (lexicographic)", () => {
    const ids = Array.from({ length: 100 }, () => newId());
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i] >= ids[i - 1]).toBe(true);
    }
  });
});
```

- [ ] **Step 4: Run the test to confirm it fails (module not found)**

```bash
cd /Users/amitkatoch/Documents/DMS_Network && pnpm --filter @zordms/db test
```
Expected: FAIL — `Cannot find module './id.js'`

- [ ] **Step 5: Create `packages/db/src/id.ts`**

Try the `uuidv7` package first:

```typescript
import { uuidv7 } from "uuidv7";

export const newId: () => string = uuidv7;
```

If the import fails (wrong export shape), use the inline fallback:

```typescript
import { randomBytes } from "node:crypto";

export function newId(): string {
  const buf = randomBytes(16);
  const ms = BigInt(Date.now());
  // Bytes 0-5: 48-bit big-endian milliseconds
  buf[0] = Number((ms >> 40n) & 0xffn);
  buf[1] = Number((ms >> 32n) & 0xffn);
  buf[2] = Number((ms >> 24n) & 0xffn);
  buf[3] = Number((ms >> 16n) & 0xffn);
  buf[4] = Number((ms >> 8n) & 0xffn);
  buf[5] = Number(ms & 0xffn);
  // Version nibble = 7
  buf[6] = (buf[6] & 0x0f) | 0x70;
  // Variant bits = 10
  buf[8] = (buf[8] & 0x3f) | 0x80;
  const h = buf.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
```

- [ ] **Step 6: Export `newId` from the package index**

Edit `packages/db/src/index.ts` to add:

```typescript
export { newId } from "./id.js";
```

Full file should look like:
```typescript
import knexLib, { type Knex } from "knex";
import { loadConfig, type AppConfig } from "@zordms/config";
import { buildKnexConfig } from "./knexConfig.js";

export { buildKnexConfig };
export { newId } from "./id.js";

let instance: Knex | undefined;

export function getKnex(db: AppConfig["db"] = loadConfig().db): Knex {
  if (!instance) instance = knexLib(buildKnexConfig(db));
  return instance;
}

export async function destroyKnex(): Promise<void> {
  if (instance) { await instance.destroy(); instance = undefined; }
}

export { buildServiceKnex } from "./serviceKnex.js";
```

- [ ] **Step 7: Build the package**

```bash
cd /Users/amitkatoch/Documents/DMS_Network && pnpm --filter @zordms/db build
```
Expected: exits 0, `dist/id.js` and `dist/id.d.ts` created.

- [ ] **Step 8: Run tests and confirm green**

```bash
cd /Users/amitkatoch/Documents/DMS_Network && pnpm --filter @zordms/db test
```
Expected: All tests PASS (knexConfig tests + 4 new id tests = ≥5 passing).

---

### Task 2: Change `@zordms/auth` token types from `number` to `string`

**Files:**
- Modify: `packages/auth/src/tokens.ts`
- Modify: `packages/auth/src/middleware.ts`
- Modify: `packages/auth/src/tokens.test.ts`
- Modify: `packages/auth/src/middleware.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1 (auth doesn't use newId itself)
- Produces:
  - `TokenPayload.sub: string`
  - `AuthUser.id: string`
  - `signToken(payload: TokenPayload, secret: string): string` — unchanged signature, just sub is string
  - `verifyToken(token: string, secret: string): TokenPayload` — unchanged, returns sub as string

- [ ] **Step 1: Update `packages/auth/src/tokens.ts` — change `sub: number` to `sub: string` and fix `verifyToken`**

Replace the entire file content:

```typescript
import jwt from "jsonwebtoken";

export interface TokenPayload {
  sub: string;
  username: string;
  // Optional RBAC claims embedded by the gateway at login so that downstream
  // microservices can authorize from the token without a shared user DB.
  roles?: string[];
  permissions?: string[];
  branch?: string;
  region?: string;
}

export function signToken(payload: TokenPayload, secret: string): string {
  return jwt.sign(payload, secret, { expiresIn: "1h", algorithm: "HS256" });
}

export function verifyToken(token: string, secret: string): TokenPayload {
  const raw = jwt.verify(token, secret, { algorithms: ["HS256"] });
  if (typeof raw === "string") {
    throw new Error("invalid token payload: string payload");
  }
  const decoded = raw as jwt.JwtPayload;
  if (decoded.sub == null || decoded.username == null) {
    throw new Error("invalid token payload: missing fields");
  }
  return { sub: String(decoded.sub), username: String(decoded.username) };
}
```

- [ ] **Step 2: Update `packages/auth/src/middleware.ts` — change `AuthUser.id: number` to `id: string` and fix `Number(decoded.sub)`**

Change line 18: `id: number;` → `id: string;`
Change line 93: `id: Number(decoded.sub),` → `id: String(decoded.sub),`

Full updated middleware.ts:

```typescript
/**
 * Shared Express claims-based auth middleware for @zordms/auth.
 *
 * Downstream microservices import these helpers instead of writing their own.
 * IMPORTANT: NO database lookup — JWT claims are the source of truth for
 * downstream services in the database-per-service architecture.
 */

import type { Request, Response, NextFunction, RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { can } from "./rbac.js";

// ---------------------------------------------------------------------------
// AuthUser — the decoded identity that middleware attaches to each request
// ---------------------------------------------------------------------------

export interface AuthUser {
  id: string;
  username: string;
  roles: string[];
  permissions: string[];
  branch?: string;
  region?: string;
}

// ---------------------------------------------------------------------------
// Express Request augmentation — adds req.authUser for all routes
// ---------------------------------------------------------------------------

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthUser;
    }
  }
}

// ---------------------------------------------------------------------------
// Viewer helper — branch-scope fail-closed logic
// ---------------------------------------------------------------------------

export interface ViewerScope {
  branch?: string;
  canCrossBranch: boolean;
}

export function makeViewer(req: Request): ViewerScope {
  return {
    branch: req.authUser?.branch,
    canCrossBranch:
      req.authUser?.permissions.includes("crossbranch:read") ?? false,
  };
}

// ---------------------------------------------------------------------------
// requireAuth — verifies JWT and populates req.authUser from claims
// ---------------------------------------------------------------------------

export const requireAuth: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const token = authHeader.slice(7); // strip "Bearer "
  const secret: string = req.app.locals.deps?.config?.jwtSecret ?? "";

  try {
    const raw = jwt.verify(token, secret, { algorithms: ["HS256"] });
    if (typeof raw === "string") {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const decoded = raw as jwt.JwtPayload & {
      username?: string;
      roles?: string[];
      permissions?: string[];
      branch?: string;
      region?: string;
    };

    if (decoded.sub == null || decoded.username == null) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    req.authUser = {
      id: String(decoded.sub),
      username: String(decoded.username),
      roles: decoded.roles ?? [],
      permissions: decoded.permissions ?? [],
      branch: decoded.branch,
      region: decoded.region,
    };

    next();
  } catch {
    res.status(401).json({ error: "unauthorized" });
  }
};

// ---------------------------------------------------------------------------
// requirePermission — authorizes based on JWT-embedded permissions
// ---------------------------------------------------------------------------

export function requirePermission(permission: string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.authUser) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    if (!can(req.authUser, permission)) {
      res.status(403).json({ error: "forbidden", required: permission });
      return;
    }
    next();
  };
}

// ---------------------------------------------------------------------------
// asyncHandler — wraps async route handlers to forward errors to next()
// ---------------------------------------------------------------------------

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}

// ---------------------------------------------------------------------------
// errorHandler — 4-arg Express error handler; returns 500 with no stack leak
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // next must be declared even if unused — Express requires 4 args to detect error handlers
  next: NextFunction,
): void {
  res.status(500).json({ error: "internal_error" });
}
```

- [ ] **Step 3: Update `packages/auth/src/tokens.test.ts` — replace numeric subs with UUID strings**

```typescript
import { describe, it, expect } from "vitest";
import jwt from "jsonwebtoken";
import { signToken, verifyToken } from "./tokens.js";

const ALICE_ID = "018f4e3a-1b2c-7d4e-8f5a-6b7c8d9e0f1a";
const BOB_ID   = "018f4e3a-1b2c-7d4e-8f5a-000000000001";

describe("tokens", () => {
  it("round-trips a payload", () => {
    const t = signToken({ sub: ALICE_ID, username: "alice" }, "secret");
    const p = verifyToken(t, "secret");
    expect(p.sub).toBe(ALICE_ID);
    expect(p.username).toBe("alice");
  });
  it("rejects a token signed with a different secret", () => {
    const t = signToken({ sub: BOB_ID, username: "x" }, "secret");
    expect(() => verifyToken(t, "other")).toThrow();
  });
  it("rejects a token with missing payload fields", () => {
    const t = jwt.sign({ sub: BOB_ID }, "secret"); // missing username
    expect(() => verifyToken(t, "secret")).toThrow();
  });
});
```

- [ ] **Step 4: Update `packages/auth/src/middleware.test.ts` — replace numeric `sub`/`id` values with UUID strings**

Replace every numeric `sub` and `id` with realistic UUIDv7-style strings. The full updated file:

```typescript
import { describe, it, expect, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { signToken } from "./tokens.js";
import {
  requireAuth,
  requirePermission,
  asyncHandler,
  errorHandler,
  makeViewer,
  type AuthUser,
} from "./middleware.js";

// Realistic UUIDv7 strings for test users
const ALICE_ID = "018f4e3a-1b2c-7d4e-8f5a-6b7c8d9e0f1a";
const BOB_ID   = "018f4e3a-1b2c-7d4e-8f5a-000000000002";
const CAROL_ID = "018f4e3a-1b2c-7d4e-8f5a-000000000003";
const USER_ID  = "018f4e3a-1b2c-7d4e-8f5a-000000000001";

// ---------------------------------------------------------------------------
// Minimal mocks for Express req / res / next
// ---------------------------------------------------------------------------

function makeReq(overrides: Partial<Request> = {}): Request {
  const req: Partial<Request> = {
    headers: {},
    app: {
      locals: { deps: { config: { jwtSecret: "test-secret" } } },
    } as unknown as Request["app"],
    ...overrides,
  };
  return req as Request;
}

function makeRes() {
  const body: { status?: number; json?: unknown } = {};
  const res = {
    _body: body,
    status(code: number) {
      body.status = code;
      return res;
    },
    json(data: unknown) {
      body.json = data;
      return res;
    },
  };
  return res as unknown as Response & { _body: typeof body };
}

const SECRET = "test-secret";

// ---------------------------------------------------------------------------
// requireAuth
// ---------------------------------------------------------------------------

describe("requireAuth", () => {
  it("sets req.authUser from a valid JWT with permissions", () => {
    const token = signToken(
      { sub: ALICE_ID, username: "alice", permissions: ["x"], roles: ["viewer"] },
      SECRET,
    );
    const req = makeReq({
      headers: { authorization: `Bearer ${token}` },
    });
    const res = makeRes();
    const next = vi.fn();

    requireAuth(req, res, next as unknown as NextFunction);

    expect(next).toHaveBeenCalledOnce();
    expect(req.authUser).toBeDefined();
    expect(req.authUser?.id).toBe(ALICE_ID);
    expect(req.authUser?.username).toBe("alice");
    expect(req.authUser?.permissions).toEqual(["x"]);
    expect(req.authUser?.roles).toEqual(["viewer"]);
  });

  it("returns 401 when Authorization header is missing", () => {
    const req = makeReq({ headers: {} });
    const res = makeRes();
    const next = vi.fn();

    requireAuth(req, res, next as unknown as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(res._body.status).toBe(401);
    expect(res._body.json).toEqual({ error: "unauthorized" });
  });

  it("returns 401 when token is signed with wrong secret", () => {
    const token = signToken({ sub: BOB_ID, username: "bob" }, "wrong-secret");
    const req = makeReq({
      headers: { authorization: `Bearer ${token}` },
    });
    const res = makeRes();
    const next = vi.fn();

    requireAuth(req, res, next as unknown as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(res._body.status).toBe(401);
  });

  it("returns 401 for a malformed token string", () => {
    const req = makeReq({
      headers: { authorization: "Bearer not.a.token" },
    });
    const res = makeRes();
    const next = vi.fn();

    requireAuth(req, res, next as unknown as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(res._body.status).toBe(401);
  });

  it("populates branch and region from claims", () => {
    const token = signToken(
      { sub: CAROL_ID, username: "carol", branch: "HQ", region: "NORTH" },
      SECRET,
    );
    const req = makeReq({ headers: { authorization: `Bearer ${token}` } });
    const res = makeRes();
    const next = vi.fn();

    requireAuth(req, res, next as unknown as NextFunction);

    expect(req.authUser?.branch).toBe("HQ");
    expect(req.authUser?.region).toBe("NORTH");
  });
});

// ---------------------------------------------------------------------------
// requirePermission
// ---------------------------------------------------------------------------

describe("requirePermission", () => {
  function makeAuthedReq(permissions: string[]): Request {
    const authUser: AuthUser = {
      id: USER_ID,
      username: "alice",
      roles: [],
      permissions,
    };
    return makeReq({ authUser } as unknown as Partial<Request>);
  }

  it("calls next when user has the required permission", () => {
    const req = makeAuthedReq(["docs:read"]);
    const res = makeRes();
    const next = vi.fn();

    requirePermission("docs:read")(req, res, next as unknown as NextFunction);

    expect(next).toHaveBeenCalledOnce();
    expect(res._body.status).toBeUndefined();
  });

  it("returns 403 when user lacks the required permission", () => {
    const req = makeAuthedReq(["docs:read"]);
    const res = makeRes();
    const next = vi.fn();

    requirePermission("admin:write")(
      req,
      res,
      next as unknown as NextFunction,
    );

    expect(next).not.toHaveBeenCalled();
    expect(res._body.status).toBe(403);
    expect(res._body.json).toEqual({
      error: "forbidden",
      required: "admin:write",
    });
  });

  it("returns 401 when req.authUser is not set", () => {
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();

    requirePermission("docs:read")(req, res, next as unknown as NextFunction);

    expect(next).not.toHaveBeenCalled();
    expect(res._body.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// asyncHandler
// ---------------------------------------------------------------------------

describe("asyncHandler", () => {
  it("calls next(err) when the async handler throws", async () => {
    const boom = new Error("async boom");
    const handler = asyncHandler(async () => {
      throw boom;
    });
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();

    handler(req, res, next as unknown as NextFunction);

    // Let microtasks flush
    await Promise.resolve();
    expect(next).toHaveBeenCalledWith(boom);
  });
});

// ---------------------------------------------------------------------------
// errorHandler
// ---------------------------------------------------------------------------

describe("errorHandler", () => {
  it("returns 500 with internal_error and no stack leak", () => {
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();

    errorHandler(
      new Error("db crashed"),
      req,
      res,
      next as unknown as NextFunction,
    );

    expect(res._body.status).toBe(500);
    expect(res._body.json).toEqual({ error: "internal_error" });
  });
});

// ---------------------------------------------------------------------------
// makeViewer
// ---------------------------------------------------------------------------

describe("makeViewer", () => {
  it("returns branch from authUser and canCrossBranch true when perm present", () => {
    const req = makeReq({
      authUser: {
        id: USER_ID,
        username: "u",
        roles: [],
        permissions: ["crossbranch:read"],
        branch: "BRANCH1",
      },
    } as unknown as Partial<Request>);

    const v = makeViewer(req);
    expect(v.branch).toBe("BRANCH1");
    expect(v.canCrossBranch).toBe(true);
  });

  it("returns canCrossBranch false when perm absent", () => {
    const req = makeReq({
      authUser: {
        id: USER_ID,
        username: "u",
        roles: [],
        permissions: ["docs:read"],
        branch: "B2",
      },
    } as unknown as Partial<Request>);

    const v = makeViewer(req);
    expect(v.canCrossBranch).toBe(false);
  });

  it("returns canCrossBranch false when authUser absent (fail-closed)", () => {
    const req = makeReq();
    const v = makeViewer(req);
    expect(v.canCrossBranch).toBe(false);
    expect(v.branch).toBeUndefined();
  });
});
```

- [ ] **Step 5: Build `@zordms/auth`**

```bash
cd /Users/amitkatoch/Documents/DMS_Network && pnpm --filter @zordms/auth build
```
Expected: exits 0, `dist/` updated.

- [ ] **Step 6: Run auth tests**

```bash
cd /Users/amitkatoch/Documents/DMS_Network && pnpm --filter @zordms/auth test
```
Expected: All tests PASS (tokens × 3, middleware × 10 = 13 passing).

---

### Task 3: Write the foundation report

**Files:**
- Create: `.superpowers/sdd/uuid-foundation-report.md`

- [ ] **Step 1: Create the report**

```markdown
# UUID Foundation Report — Phase 1

## newId() — `@zordms/db`

**Import:**
```typescript
import { newId } from "@zordms/db";
```

**Source:** `packages/db/src/id.ts`

**Signature:** `export function newId(): string`

**Sample output:** `"018f4e3a-1b2c-7d4e-8f5a-6b7c8d9e0f1a"` (36-char lowercase UUID v7)

**Implementation:** uses the `uuidv7` npm package (`^0.0.5`). Falls back to inline `node:crypto` implementation if the package export shape differs.

---

## Auth Type Changes — `@zordms/auth`

| Symbol | Before | After |
|--------|--------|-------|
| `TokenPayload.sub` | `number` | `string` |
| `AuthUser.id` | `number` | `string` |
| `verifyToken` return `.sub` | `Number(decoded.sub)` | `String(decoded.sub)` |
| `requireAuth` → `req.authUser.id` | `Number(decoded.sub)` | `String(decoded.sub)` |

**Files changed:**
- `packages/auth/src/tokens.ts` — `TokenPayload.sub: string`, `verifyToken` returns `String(decoded.sub)`
- `packages/auth/src/middleware.ts` — `AuthUser.id: string`, `req.authUser.id = String(decoded.sub)`

**No other behaviour changed** — `signToken`, `verifyToken`, `requireAuth`, `requirePermission`, `makeViewer`, `asyncHandler`, `errorHandler`, `can` all work identically.

---

## Test Counts (Phase 1, post-change)

| Package | Tests |
|---------|-------|
| `@zordms/db` | ≥ 7 (3 knexConfig + 4 id) |
| `@zordms/auth` | 13 (3 tokens + 10 middleware) |

---

## Per-service agents: what to rely on

- `import { newId } from "@zordms/db"` — generates a time-ordered UUID string for any new row
- `req.authUser.id` is now `string` — cast/compare to string UUIDs, not numbers
- JWT `sub` claim is now a UUID string — services that read `decoded.sub` should use `String(decoded.sub)`, not `Number(decoded.sub)`
```
