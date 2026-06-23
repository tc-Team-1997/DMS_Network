# Integration Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan builds **Plan 6** of the ZorDMS programme; it depends on the foundation packages delivered by Plan 1 (`@zordms/config`, `@zordms/db`, `@zordms/auth`, `@zordms/types`).

**Goal:** Stand up the ZorDMS **Integration Hub** Node service (`services/integration`) that connects the bank's core systems — TCS BaNCS (CBS), LOS, KYC engine, ERP, CRM, Contact Center, mBoB/goBoB/Internet Banking — through an interface-driven connector layer with a MOCK fallback (so tests need no external systems), HMAC-verified inbound webhooks that emit internal events, signed-and-retried outbound webhooks, request-log persistence, an API-management/status dashboard API, a React Integration Hub screen, and seeded `integration:read` / `integration:manage` permissions.

**Architecture:** A new Express service (`services/integration`) with a pure `createApp(deps)` factory (no `listen`), a `server.ts` entrypoint, and `routes/*`. It reuses the shared packages: `@zordms/config` (env), `@zordms/db` (Knex `pg|oracledb|sqlite3` schema-builder migrations), `@zordms/auth` (`requireAuth`, `requirePermission`, RBAC), and `@zordms/types`. Connectors implement a single `Connector` interface (`call(system, op, payload)`); a generic HTTP connector uses the platform `fetch`/`undici`, and a MOCK connector returns canned responses so the suite runs on sqlite with zero network. Every connector call is logged into `integration_logs`. Inbound webhooks verify HMAC-SHA256 with `crypto.timingSafeEqual` over the **raw request body** (never a re-serialized body), then emit events (`cbs.customer.updated`, `los.loan.created`, `kyc.result`) and write an alert/workflow hand-off row. Outbound webhooks are registered in `outbound_webhooks` and dispatched on internal events with HMAC signing and bounded retry.

**Tech Stack:** Node 20+ (built-in `fetch`/`undici` + `node:crypto`), TypeScript 5 (strict, ESM), Express 4, Knex 3 (`pg` / `oracledb` / `sqlite3`), Vitest + Supertest, `@zordms/{config,db,auth,types}`. React 18 + Vite 5 + `@testing-library/react` for the web screen.

## Global Constraints

- **Reuse, don't re-implement** — the DB layer (`@zordms/db` `buildKnexConfig`, migrations runner), env (`@zordms/config` `loadConfig`), and auth middleware (`@zordms/auth` `requireAuth`, `requirePermission`) are taken unchanged from Plan 1. No new DB factory, no new auth.
- **No external systems in tests** — connectors are interface-driven with a MOCK fallback (mirrors the existing Python service's mock-fallback pattern). The whole suite runs against in-memory SQLite with no network. The generic HTTP connector is exercised only via injected `fetch` doubles.
- **HMAC discipline** — inbound webhook verification computes HMAC-SHA256 over the **raw bytes** of the request body and compares with `crypto.timingSafeEqual`. Pitfall to avoid: do **not** `JSON.parse` then re-`JSON.stringify` and HMAC that — key ordering/whitespace differ and signatures will never match. A raw-body middleware captures `req.rawBody` for webhook routes only.
- **Events on inbound** — successful inbound webhooks emit `cbs.customer.updated`, `los.loan.created`, `kyc.result` through an injectable event sink (default in-memory; production swaps in the Redis-Streams `@zordms/events` client without touching route code).
- **DB switchable via env** — migrations use Knex schema-builder only (`increments()`, no SQLite-isms). SQLite is a test-only backend.
- **TypeScript everywhere**, ESM (`"type": "module"`), strict mode. Package names under `@zordms/`.
- **RBAC-gated** — management/read APIs require `integration:read` or `integration:manage`; inbound webhooks are unauthenticated by JWT but authenticated by HMAC.
- **Conventional commits**; commit after every passing step. End every commit message with the trailer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## File Structure

```
zordms/
  packages/
    db/
      src/migrations/20260623_0006_integration.ts   # NEW migration (this plan)
      src/seeds/0006_integration_perms.ts            # NEW seed (this plan)
    types/
      src/integration.ts                             # NEW shared contracts (this plan)
  services/
    integration/
      package.json
      tsconfig.json
      src/app.ts                       # express app factory (testable, no listen)
      src/server.ts                    # listen()
      src/middleware/rawBody.ts        # capture req.rawBody for webhook routes
      src/events/sink.ts               # EventSink interface + InMemoryEventSink
      src/connectors/types.ts          # Connector interface + ConnectorContext
      src/connectors/logger.ts         # withLogging() wrapper → integration_logs
      src/connectors/http.ts           # generic fetch/undici HTTP connector
      src/connectors/mock.ts           # MockConnector (canned responses)
      src/connectors/registry.ts       # buildConnector(system, config) + fallback
      src/adapters/cbs.ts              # TCS BaNCS: customerLookup + kycSync
      src/adapters/los.ts              # LOS: pushLoan + loanStatus
      src/adapters/kyc.ts              # KYC: verify
      src/webhooks/hmac.ts             # signBody + verifySignature (timingSafeEqual)
      src/routes/webhooks.ts           # inbound: cbs/los/kyc
      src/routes/outbound.ts           # register + dispatch outbound webhooks
      src/routes/management.ts         # request-logs list + connected-systems status
  apps/
    web/
      src/api/integration.ts           # typed client calls
      src/pages/IntegrationHub.tsx     # screen: systems + logs + webhook form
      src/components/StatusDot.tsx      # status indicator
```

---

## Task 1: Integration service scaffold + app factory + health + raw-body middleware

**Files:**
- Create: `services/integration/package.json`, `services/integration/tsconfig.json`, `services/integration/src/app.ts`, `services/integration/src/server.ts`, `services/integration/src/middleware/rawBody.ts`
- Test: `services/integration/src/app.test.ts`, `services/integration/src/middleware/rawBody.test.ts`

**Interfaces:**
- `createApp(deps: AppDeps): Express` — pure factory, no `listen`, mounts JSON parsing with raw-body capture and `GET /health`.
  - `AppDeps = { knex: Knex; config: AppConfig; events?: EventSink; connectorFor?: (system: string) => Connector }` (the optional fields are wired by later tasks; this task only needs `knex`, `config`).
- `captureRawBody(req, _res, buf): void` — Express `json()` `verify` hook that stores `req.rawBody = buf` (a `Buffer`).
- `GET /health` → `{ status: "ok", service: "integration" }`.

- [ ] **Step 1: Create `services/integration/package.json`**

```json
{
  "name": "@zordms/integration",
  "version": "0.0.0",
  "type": "module",
  "main": "dist/server.js",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "dev": "tsx watch src/server.ts",
    "start": "node dist/server.js",
    "test": "vitest run",
    "lint": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "express": "^4.19.2",
    "cors": "^2.8.5",
    "@zordms/auth": "workspace:*",
    "@zordms/db": "workspace:*",
    "@zordms/config": "workspace:*",
    "@zordms/types": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "vitest": "^1.6.0",
    "supertest": "^7.0.0",
    "tsx": "^4.15.0",
    "@types/express": "^4.17.21",
    "@types/cors": "^2.8.17",
    "@types/supertest": "^6.0.2",
    "@types/node": "^20.0.0",
    "knex": "^3.1.0",
    "sqlite3": "^5.1.7"
  }
}
```

- [ ] **Step 2: Create `services/integration/tsconfig.json`**

```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

Run `pnpm install` so the workspace links `@zordms/integration`.

- [ ] **Step 3: Write the failing raw-body test**

`services/integration/src/middleware/rawBody.test.ts`:
```ts
import { describe, it, expect, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { captureRawBody } from "./rawBody.js";

const app = express();
app.use(express.json({ verify: captureRawBody }));
app.post("/echo", (req, res) => {
  res.json({
    rawIsBuffer: Buffer.isBuffer((req as any).rawBody),
    raw: (req as any).rawBody?.toString("utf8"),
    parsed: req.body,
  });
});

describe("captureRawBody", () => {
  it("stores the exact raw bytes alongside the parsed body", async () => {
    const payload = '{"b":2,"a":1}'; // deliberately non-alphabetical to prove no re-serialization
    const res = await request(app).post("/echo").set("Content-Type", "application/json").send(payload);
    expect(res.status).toBe(200);
    expect(res.body.rawIsBuffer).toBe(true);
    expect(res.body.raw).toBe(payload);
    expect(res.body.parsed).toEqual({ b: 2, a: 1 });
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter @zordms/integration test rawBody`
Expected: FAIL — `./rawBody.js` not found.

- [ ] **Step 5: Write `middleware/rawBody.ts`**

```ts
import type { Request, Response } from "express";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express { interface Request { rawBody?: Buffer; } }
}

// Express json() `verify` hook: capture the exact bytes BEFORE parsing so that
// inbound webhook HMAC verification can hash the raw body (never a re-serialized one).
export function captureRawBody(req: Request, _res: Response, buf: Buffer): void {
  if (buf && buf.length) req.rawBody = Buffer.from(buf);
}
```

- [ ] **Step 6: Run raw-body test to verify it passes**

Run: `pnpm --filter @zordms/integration test rawBody`
Expected: PASS.

- [ ] **Step 7: Write the failing app/health test**

`services/integration/src/app.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import knexLib from "knex";
import { buildKnexConfig } from "@zordms/db";
import { loadConfig } from "@zordms/config";
import { createApp } from "./app.js";

const knex = knexLib(buildKnexConfig({
  client: "sqlite3", host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "",
}));
const app = createApp({ knex, config: loadConfig({ JWT_SECRET: "t" } as NodeJS.ProcessEnv) });

beforeAll(async () => { await knex.migrate.latest(); await knex.seed.run(); });
afterAll(async () => { await knex.destroy(); });

describe("integration health", () => {
  it("GET /health returns ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", service: "integration" });
  });
});
```

- [ ] **Step 8: Run test to verify it fails**

Run: `pnpm --filter @zordms/integration test app`
Expected: FAIL — `./app.js` not found.

- [ ] **Step 9: Write `app.ts`**

```ts
import express, { type Express } from "express";
import cors from "cors";
import type { Knex } from "knex";
import type { AppConfig } from "@zordms/config";
import { captureRawBody } from "./middleware/rawBody.js";
import type { EventSink } from "./events/sink.js";
import type { Connector } from "./connectors/types.js";

export interface AppDeps {
  knex: Knex;
  config: AppConfig;
  events?: EventSink;
  connectorFor?: (system: string) => Connector;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use(cors());
  // verify hook captures req.rawBody for every JSON request (used by webhook HMAC).
  app.use(express.json({ verify: captureRawBody }));
  app.locals.deps = deps;

  app.get("/health", (_req, res) => res.json({ status: "ok", service: "integration" }));
  return app;
}
```

Note: `./events/sink.js` and `./connectors/types.js` are created in Tasks 3–4. The `import type` lines compile against those files; if you implement strictly task-by-task, add the two files' type-only stubs now or reorder so Tasks 3–4 land before building. The test in this task does not exercise those imports.

- [ ] **Step 10: Write `server.ts`**

```ts
import { createApp } from "./app.js";
import { getKnex } from "@zordms/db";
import { loadConfig } from "@zordms/config";
import { InMemoryEventSink } from "./events/sink.js";
import { buildConnector } from "./connectors/registry.js";

const config = loadConfig();
const knex = getKnex();
await knex.migrate.latest();
await knex.seed.run();
const events = new InMemoryEventSink();
const app = createApp({
  knex,
  config,
  events,
  connectorFor: (system) => buildConnector(system, { knex }),
});
const port = Number(process.env.INTEGRATION_PORT ?? 4006);
app.listen(port, () => console.log(`ZorDMS integration hub on :${port}`));
```

- [ ] **Step 11: Run app test to verify it passes**

Run: `pnpm --filter @zordms/integration test app`
Expected: PASS.

- [ ] **Step 12: Commit**

```bash
git add services/integration/package.json services/integration/tsconfig.json services/integration/src/app.ts services/integration/src/server.ts services/integration/src/middleware
git commit -m "feat(integration): service scaffold, app factory, health, raw-body capture"
```

---

## Task 2: Migration — `integration_logs`, `integration_config`, `outbound_webhooks`

**Files:**
- Create: `packages/db/src/migrations/20260623_0006_integration.ts`
- Test: `packages/db/src/migrations/integration.test.ts`

**Interfaces:**
- Produces tables:
  - `integration_logs` — `id`, `system`, `endpoint`, `method`, `status` (int), `latency_ms` (int), `direction` (`outbound`|`inbound`), `success` (bool), `error`, `created_at`.
  - `integration_config` — `id`, `system` (unique), `base_url`, `auth_type` (`none`|`bearer`|`hmac`|`basic`), `secret`, `enabled` (bool), `created_at`.
  - `outbound_webhooks` — `id`, `url`, `events` (text, comma-joined), `auth_method` (`hmac`|`none`), `secret`, `enabled` (bool), `created_at`.

- [ ] **Step 1: Write the failing migration test (in-memory sqlite)**

`packages/db/src/migrations/integration.test.ts`:
```ts
import { describe, it, expect, afterAll } from "vitest";
import knexLib from "knex";
import { buildKnexConfig } from "../knexConfig.js";

const knex = knexLib(buildKnexConfig({
  client: "sqlite3", host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "",
}));

afterAll(async () => { await knex.destroy(); });

describe("integration migration", () => {
  it("creates integration_logs, integration_config, outbound_webhooks", async () => {
    await knex.migrate.latest();
    for (const t of ["integration_logs", "integration_config", "outbound_webhooks"]) {
      expect(await knex.schema.hasTable(t)).toBe(true);
    }
  });

  it("logs table has the expected columns", async () => {
    for (const c of ["system", "endpoint", "method", "status", "latency_ms", "created_at"]) {
      expect(await knex.schema.hasColumn("integration_logs", c)).toBe(true);
    }
  });

  it("enforces a unique system in integration_config", async () => {
    await knex("integration_config").insert({ system: "cbs", base_url: "http://x", auth_type: "hmac", enabled: true });
    await expect(
      knex("integration_config").insert({ system: "cbs", base_url: "http://y", auth_type: "none", enabled: true }),
    ).rejects.toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zordms/db test integration`
Expected: FAIL — table does not exist (migration missing).

- [ ] **Step 3: Write the migration**

`packages/db/src/migrations/20260623_0006_integration.ts`:
```ts
import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("integration_logs", (t) => {
    t.increments("id").primary();
    t.string("system", 60).notNullable();
    t.string("endpoint", 255).notNullable();
    t.string("method", 16).notNullable();
    t.integer("status").notNullable().defaultTo(0);
    t.integer("latency_ms").notNullable().defaultTo(0);
    t.string("direction", 16).notNullable().defaultTo("outbound"); // outbound | inbound
    t.boolean("success").notNullable().defaultTo(true);
    t.text("error");
    t.timestamp("created_at").defaultTo(knex.fn.now());
    t.index(["system", "created_at"], "idx_intlogs_system_time");
  });

  await knex.schema.createTable("integration_config", (t) => {
    t.increments("id").primary();
    t.string("system", 60).notNullable().unique();
    t.string("base_url", 255);
    t.string("auth_type", 20).notNullable().defaultTo("none"); // none | bearer | hmac | basic
    t.string("secret", 255);
    t.boolean("enabled").notNullable().defaultTo(true);
    t.timestamp("created_at").defaultTo(knex.fn.now());
  });

  await knex.schema.createTable("outbound_webhooks", (t) => {
    t.increments("id").primary();
    t.string("url", 500).notNullable();
    t.text("events").notNullable();          // comma-joined event names
    t.string("auth_method", 20).notNullable().defaultTo("hmac"); // hmac | none
    t.string("secret", 255);
    t.boolean("enabled").notNullable().defaultTo(true);
    t.timestamp("created_at").defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  for (const t of ["outbound_webhooks", "integration_config", "integration_logs"]) {
    await knex.schema.dropTableIfExists(t);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @zordms/db test integration`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/migrations/20260623_0006_integration.ts packages/db/src/migrations/integration.test.ts
git commit -m "feat(db): integration_logs, integration_config, outbound_webhooks migration"
```

---

## Task 3: Shared types + event sink

**Files:**
- Create: `packages/types/src/integration.ts`, `services/integration/src/events/sink.ts`
- Modify: `packages/types/src/index.ts` (re-export integration contracts)
- Test: `packages/types/src/integration.test.ts`, `services/integration/src/events/sink.test.ts`

**Interfaces:**
- `packages/types/src/integration.ts` produces:
  - `IntegrationLog`, `IntegrationConfigRow`, `OutboundWebhook`, `ConnectedSystem`, `ConnectorResult<T>` (`{ ok: boolean; status: number; data?: T; error?: string; mock?: boolean }`), and `INTEGRATION_EVENTS` (`["cbs.customer.updated","los.loan.created","kyc.result"]`).
- `services/integration/src/events/sink.ts` produces:
  - `interface EventSink { emit(event: string, payload: unknown): Promise<void>; }`
  - `class InMemoryEventSink implements EventSink` exposing `emitted: Array<{ event: string; payload: unknown }>` for assertions.

- [ ] **Step 1: Write the failing types test**

`packages/types/src/integration.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { INTEGRATION_EVENTS, isConnectorResult } from "./integration.js";

describe("integration types", () => {
  it("lists the inbound event names", () => {
    expect(INTEGRATION_EVENTS).toEqual(
      expect.arrayContaining(["cbs.customer.updated", "los.loan.created", "kyc.result"]),
    );
  });
  it("type-guards a connector result", () => {
    expect(isConnectorResult({ ok: true, status: 200 })).toBe(true);
    expect(isConnectorResult({ ok: "yes" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zordms/types test integration`
Expected: FAIL — `./integration.js` not found.

- [ ] **Step 3: Write `packages/types/src/integration.ts`**

```ts
export type IntegrationDirection = "outbound" | "inbound";

export interface IntegrationLog {
  id: number;
  system: string;
  endpoint: string;
  method: string;
  status: number;
  latency_ms: number;
  direction: IntegrationDirection;
  success: boolean;
  error?: string | null;
  created_at?: string;
}

export interface IntegrationConfigRow {
  id: number;
  system: string;
  base_url?: string | null;
  auth_type: "none" | "bearer" | "hmac" | "basic";
  secret?: string | null;
  enabled: boolean;
  created_at?: string;
}

export interface OutboundWebhook {
  id: number;
  url: string;
  events: string[];
  auth_method: "hmac" | "none";
  enabled: boolean;
  created_at?: string;
}

export interface ConnectedSystem {
  system: string;
  base_url?: string | null;
  enabled: boolean;
  status: "up" | "down" | "mock" | "disabled";
  lastCallAt?: string | null;
  recentErrors: number;
}

export interface ConnectorResult<T = unknown> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
  mock?: boolean;
}

export const INTEGRATION_EVENTS = [
  "cbs.customer.updated",
  "los.loan.created",
  "kyc.result",
] as const;

export type IntegrationEvent = (typeof INTEGRATION_EVENTS)[number];

export function isConnectorResult(x: unknown): x is ConnectorResult {
  const r = x as ConnectorResult;
  return !!r && typeof r.ok === "boolean" && typeof r.status === "number";
}
```

- [ ] **Step 4: Re-export from `packages/types/src/index.ts`**

Append:
```ts
export * from "./integration.js";
```

- [ ] **Step 5: Run types test to verify it passes**

Run: `pnpm --filter @zordms/types test integration`
Expected: PASS.

- [ ] **Step 6: Write the failing event-sink test**

`services/integration/src/events/sink.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { InMemoryEventSink } from "./sink.js";

describe("InMemoryEventSink", () => {
  it("records emitted events in order", async () => {
    const sink = new InMemoryEventSink();
    await sink.emit("cbs.customer.updated", { cid: "C1" });
    await sink.emit("kyc.result", { ok: true });
    expect(sink.emitted.map((e) => e.event)).toEqual(["cbs.customer.updated", "kyc.result"]);
    expect(sink.emitted[0].payload).toEqual({ cid: "C1" });
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `pnpm --filter @zordms/integration test sink`
Expected: FAIL — `./sink.js` not found.

- [ ] **Step 8: Write `services/integration/src/events/sink.ts`**

```ts
export interface EventSink {
  emit(event: string, payload: unknown): Promise<void>;
}

// Default in-memory sink. Production swaps in the @zordms/events Redis-Streams
// client with the same `emit` shape — route code never changes.
export class InMemoryEventSink implements EventSink {
  readonly emitted: Array<{ event: string; payload: unknown }> = [];
  async emit(event: string, payload: unknown): Promise<void> {
    this.emitted.push({ event, payload });
  }
}
```

- [ ] **Step 9: Run sink test to verify it passes**

Run: `pnpm --filter @zordms/integration test sink`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add packages/types/src/integration.ts packages/types/src/integration.test.ts packages/types/src/index.ts services/integration/src/events
git commit -m "feat(integration): shared connector/webhook contracts + event sink"
```

---

## Task 4: Connector interface + logging wrapper + MOCK connector

**Files:**
- Create: `services/integration/src/connectors/types.ts`, `services/integration/src/connectors/logger.ts`, `services/integration/src/connectors/mock.ts`
- Test: `services/integration/src/connectors/mock.test.ts`, `services/integration/src/connectors/logger.test.ts`

**Interfaces:**
- `connectors/types.ts`:
  - `interface ConnectorContext { knex: Knex; }`
  - `interface Connector { readonly system: string; call<T = unknown>(op: string, payload: unknown): Promise<ConnectorResult<T>>; }`
- `connectors/logger.ts`:
  - `withLogging(connector: Connector, knex: Knex): Connector` — wraps `call`, measures latency, writes one `integration_logs` row per call (`system`, `endpoint=op`, `method="CALL"`, `status`, `latency_ms`, `direction="outbound"`, `success`, `error`).
- `connectors/mock.ts`:
  - `class MockConnector implements Connector` — constructed with `system` and a `responses: Record<op, ConnectorResult>` map; unknown ops return `{ ok:false, status:501, error:"unhandled_mock_op", mock:true }`. Every result carries `mock:true`.

- [ ] **Step 1: Write the failing mock test**

`services/integration/src/connectors/mock.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { MockConnector } from "./mock.js";

describe("MockConnector", () => {
  it("returns the canned response for a known op and flags mock", async () => {
    const c = new MockConnector("cbs", {
      "customer.lookup": { ok: true, status: 200, data: { cid: "C1", name: "Dorji" } },
    });
    const res = await c.call("customer.lookup", { cid: "C1" });
    expect(res.ok).toBe(true);
    expect(res.mock).toBe(true);
    expect((res.data as any).name).toBe("Dorji");
  });

  it("returns 501 for an unhandled op", async () => {
    const c = new MockConnector("cbs", {});
    const res = await c.call("nope", {});
    expect(res.ok).toBe(false);
    expect(res.status).toBe(501);
    expect(res.error).toBe("unhandled_mock_op");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zordms/integration test mock`
Expected: FAIL — `./mock.js` not found.

- [ ] **Step 3: Write `connectors/types.ts`**

```ts
import type { Knex } from "knex";
import type { ConnectorResult } from "@zordms/types";

export type { ConnectorResult };

export interface ConnectorContext {
  knex: Knex;
}

export interface Connector {
  readonly system: string;
  call<T = unknown>(op: string, payload: unknown): Promise<ConnectorResult<T>>;
}
```

- [ ] **Step 4: Write `connectors/mock.ts`**

```ts
import type { Connector } from "./types.js";
import type { ConnectorResult } from "@zordms/types";

export class MockConnector implements Connector {
  constructor(
    public readonly system: string,
    private readonly responses: Record<string, ConnectorResult> = {},
  ) {}

  async call<T = unknown>(op: string, _payload: unknown): Promise<ConnectorResult<T>> {
    const canned = this.responses[op];
    if (canned) return { ...canned, mock: true } as ConnectorResult<T>;
    return { ok: false, status: 501, error: "unhandled_mock_op", mock: true };
  }
}
```

- [ ] **Step 5: Run mock test to verify it passes**

Run: `pnpm --filter @zordms/integration test mock`
Expected: PASS.

- [ ] **Step 6: Write the failing logging test**

`services/integration/src/connectors/logger.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import knexLib from "knex";
import { buildKnexConfig } from "@zordms/db";
import { MockConnector } from "./mock.js";
import { withLogging } from "./logger.js";

const knex = knexLib(buildKnexConfig({
  client: "sqlite3", host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "",
}));

beforeAll(async () => { await knex.migrate.latest(); });
afterAll(async () => { await knex.destroy(); });

describe("withLogging", () => {
  it("writes an integration_logs row for a successful call", async () => {
    const c = withLogging(new MockConnector("cbs", { ping: { ok: true, status: 200 } }), knex);
    const res = await c.call("ping", {});
    expect(res.ok).toBe(true);
    const row = await knex("integration_logs").where({ system: "cbs", endpoint: "ping" }).first();
    expect(row).toBeTruthy();
    expect(row.status).toBe(200);
    expect(row.success).toBeTruthy();
    expect(row.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it("records failures with success=false and the error text", async () => {
    const c = withLogging(new MockConnector("los", {}), knex);
    await c.call("missing", {});
    const row = await knex("integration_logs").where({ system: "los", endpoint: "missing" }).first();
    expect(row.success).toBeFalsy();
    expect(row.status).toBe(501);
    expect(row.error).toBe("unhandled_mock_op");
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `pnpm --filter @zordms/integration test logger`
Expected: FAIL — `./logger.js` not found.

- [ ] **Step 8: Write `connectors/logger.ts`**

```ts
import type { Knex } from "knex";
import type { Connector } from "./types.js";
import type { ConnectorResult } from "@zordms/types";

// Wrap any connector so every call is timed and persisted to integration_logs.
export function withLogging(inner: Connector, knex: Knex): Connector {
  return {
    system: inner.system,
    async call<T>(op: string, payload: unknown): Promise<ConnectorResult<T>> {
      const start = Date.now();
      let result: ConnectorResult<T>;
      try {
        result = await inner.call<T>(op, payload);
      } catch (err) {
        result = { ok: false, status: 0, error: (err as Error).message };
      }
      const latency = Date.now() - start;
      await knex("integration_logs").insert({
        system: inner.system,
        endpoint: op,
        method: "CALL",
        status: result.status ?? 0,
        latency_ms: latency,
        direction: "outbound",
        success: result.ok,
        error: result.ok ? null : (result.error ?? null),
      });
      return result;
    },
  };
}
```

- [ ] **Step 9: Run logger test to verify it passes**

Run: `pnpm --filter @zordms/integration test logger`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add services/integration/src/connectors/types.ts services/integration/src/connectors/mock.ts services/integration/src/connectors/logger.ts services/integration/src/connectors/mock.test.ts services/integration/src/connectors/logger.test.ts
git commit -m "feat(integration): connector interface, MOCK connector, request-logging wrapper"
```

---

## Task 5: Generic HTTP connector + registry with MOCK fallback

**Files:**
- Create: `services/integration/src/connectors/http.ts`, `services/integration/src/connectors/registry.ts`
- Test: `services/integration/src/connectors/http.test.ts`, `services/integration/src/connectors/registry.test.ts`

**Interfaces:**
- `connectors/http.ts`:
  - `interface HttpConnectorOptions { system: string; baseUrl: string; opMap: Record<string, { method: string; path: string }>; authHeader?: () => Record<string, string>; fetchImpl?: typeof fetch; }`
  - `class HttpConnector implements Connector` — maps `op` → `{method,path}`, calls `${baseUrl}${path}` via `fetchImpl ?? globalThis.fetch` (undici on Node 20), returns `ConnectorResult` from the HTTP status + parsed JSON. The injectable `fetchImpl` keeps tests offline.
- `connectors/registry.ts`:
  - `buildConnector(system: string, ctx: ConnectorContext): Connector` — reads `integration_config` synchronously is not possible in a sync signature, so the registry returns a **MockConnector by default** (fallback) wrapped in `withLogging`, and exposes `buildHttpConnector(...)` for when a real `base_url` is configured. The default ships canned mock responses per system so the service is fully functional without external systems (mirrors the Python mock-fallback).

- [ ] **Step 1: Write the failing HTTP-connector test (injected fetch, no network)**

`services/integration/src/connectors/http.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { HttpConnector } from "./http.js";

describe("HttpConnector", () => {
  it("maps an op to method+path and returns parsed JSON on 200", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 200, ok: true, json: async () => ({ cid: "C1", name: "Dorji" }),
    }) as unknown as typeof fetch;
    const c = new HttpConnector({
      system: "cbs",
      baseUrl: "http://bancs.local",
      opMap: { "customer.lookup": { method: "POST", path: "/customers/lookup" } },
      fetchImpl,
    });
    const res = await c.call("customer.lookup", { cid: "C1" });
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect((res.data as any).name).toBe("Dorji");
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://bancs.local/customers/lookup",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("returns ok=false for an unmapped op", async () => {
    const c = new HttpConnector({ system: "cbs", baseUrl: "http://x", opMap: {}, fetchImpl: vi.fn() as any });
    const res = await c.call("nope", {});
    expect(res.ok).toBe(false);
    expect(res.status).toBe(404);
  });

  it("surfaces a non-2xx status as ok=false", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 503, ok: false, json: async () => ({ message: "down" }),
    }) as unknown as typeof fetch;
    const c = new HttpConnector({
      system: "los", baseUrl: "http://los", opMap: { "loan.status": { method: "GET", path: "/loan" } }, fetchImpl,
    });
    const res = await c.call("loan.status", {});
    expect(res.ok).toBe(false);
    expect(res.status).toBe(503);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zordms/integration test http`
Expected: FAIL — `./http.js` not found.

- [ ] **Step 3: Write `connectors/http.ts`**

```ts
import type { Connector } from "./types.js";
import type { ConnectorResult } from "@zordms/types";

export interface HttpConnectorOptions {
  system: string;
  baseUrl: string;
  opMap: Record<string, { method: string; path: string }>;
  authHeader?: () => Record<string, string>;
  fetchImpl?: typeof fetch;
}

// Generic HTTP connector (httpx-equivalent via fetch/undici). The fetch impl is
// injectable so unit tests never touch the network.
export class HttpConnector implements Connector {
  readonly system: string;
  private readonly o: HttpConnectorOptions;
  private readonly doFetch: typeof fetch;

  constructor(options: HttpConnectorOptions) {
    this.o = options;
    this.system = options.system;
    this.doFetch = options.fetchImpl ?? globalThis.fetch;
  }

  async call<T = unknown>(op: string, payload: unknown): Promise<ConnectorResult<T>> {
    const mapped = this.o.opMap[op];
    if (!mapped) return { ok: false, status: 404, error: `unmapped_op:${op}` };
    const url = `${this.o.baseUrl}${mapped.path}`;
    const headers: Record<string, string> = { "Content-Type": "application/json", ...(this.o.authHeader?.() ?? {}) };
    const hasBody = mapped.method !== "GET" && mapped.method !== "HEAD";
    try {
      const res = await this.doFetch(url, {
        method: mapped.method,
        headers,
        body: hasBody ? JSON.stringify(payload ?? {}) : undefined,
      });
      const data = (await res.json().catch(() => undefined)) as T | undefined;
      return { ok: res.ok, status: res.status, data, error: res.ok ? undefined : `http_${res.status}` };
    } catch (err) {
      return { ok: false, status: 0, error: (err as Error).message };
    }
  }
}
```

- [ ] **Step 4: Run HTTP test to verify it passes**

Run: `pnpm --filter @zordms/integration test http`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing registry test**

`services/integration/src/connectors/registry.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import knexLib from "knex";
import { buildKnexConfig } from "@zordms/db";
import { buildConnector } from "./registry.js";

const knex = knexLib(buildKnexConfig({
  client: "sqlite3", host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "",
}));

beforeAll(async () => { await knex.migrate.latest(); });
afterAll(async () => { await knex.destroy(); });

describe("buildConnector", () => {
  it("falls back to a logging-wrapped MOCK connector for a known system", async () => {
    const c = buildConnector("cbs", { knex });
    expect(c.system).toBe("cbs");
    const res = await c.call("customer.lookup", { cid: "C1" });
    expect(res.ok).toBe(true);
    expect(res.mock).toBe(true);
    const row = await knex("integration_logs").where({ system: "cbs", endpoint: "customer.lookup" }).first();
    expect(row).toBeTruthy(); // logging wrapper fired
  });

  it("returns a connector even for an unknown system (empty mock)", async () => {
    const c = buildConnector("erp", { knex });
    const res = await c.call("anything", {});
    expect(res.status).toBe(501);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter @zordms/integration test registry`
Expected: FAIL — `./registry.js` not found.

- [ ] **Step 7: Write `connectors/registry.ts`**

```ts
import type { Connector, ConnectorContext } from "./types.js";
import { MockConnector } from "./mock.js";
import { HttpConnector, type HttpConnectorOptions } from "./http.js";
import { withLogging } from "./logger.js";

// Canned mock responses per system so the hub is fully functional with NO external
// systems present (mirrors the Python service's mock-fallback). Real deployments
// override via integration_config + buildHttpConnector.
const MOCK_RESPONSES: Record<string, Record<string, { ok: boolean; status: number; data?: unknown }>> = {
  cbs: {
    "customer.lookup": { ok: true, status: 200, data: { cid: "C1000", name: "Dorji Wangchuk", branch: "Thimphu", segment: "RETAIL" } },
    "kyc.sync": { ok: true, status: 200, data: { cid: "C1000", kycStatus: "VERIFIED", syncedAt: "2026-06-23T00:00:00Z" } },
  },
  los: {
    "loan.push": { ok: true, status: 201, data: { loanId: "L5000", state: "RECEIVED" } },
    "loan.status": { ok: true, status: 200, data: { loanId: "L5000", state: "UNDER_REVIEW" } },
  },
  kyc: {
    "verify": { ok: true, status: 200, data: { match: true, score: 0.97, decision: "PASS" } },
  },
};

export function buildConnector(system: string, ctx: ConnectorContext): Connector {
  const responses = MOCK_RESPONSES[system] ?? {};
  return withLogging(new MockConnector(system, responses), ctx.knex);
}

// Used when integration_config supplies a real base_url for a system.
export function buildHttpConnector(opts: HttpConnectorOptions, ctx: ConnectorContext): Connector {
  return withLogging(new HttpConnector(opts), ctx.knex);
}
```

- [ ] **Step 8: Run registry test to verify it passes**

Run: `pnpm --filter @zordms/integration test registry`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add services/integration/src/connectors/http.ts services/integration/src/connectors/registry.ts services/integration/src/connectors/http.test.ts services/integration/src/connectors/registry.test.ts
git commit -m "feat(integration): generic HTTP connector + registry with MOCK fallback"
```

---

## Task 6: CBS, LOS, KYC adapters (mock-tested)

**Files:**
- Create: `services/integration/src/adapters/cbs.ts`, `services/integration/src/adapters/los.ts`, `services/integration/src/adapters/kyc.ts`
- Test: `services/integration/src/adapters/adapters.test.ts`

**Interfaces:**
- `adapters/cbs.ts`:
  - `cbsCustomerLookup(connector: Connector, cid: string): Promise<ConnectorResult<{ cid: string; name: string; branch?: string; segment?: string }>>` → op `customer.lookup`.
  - `cbsKycSync(connector: Connector, cid: string): Promise<ConnectorResult<{ cid: string; kycStatus: string }>>` → op `kyc.sync`.
- `adapters/los.ts`:
  - `losPushLoan(connector, loan: { applicationId: string; cid: string; amount: number }): Promise<ConnectorResult<{ loanId: string; state: string }>>` → op `loan.push`.
  - `losLoanStatus(connector, loanId: string): Promise<ConnectorResult<{ loanId: string; state: string }>>` → op `loan.status`.
- `adapters/kyc.ts`:
  - `kycVerify(connector, subject: { cid: string; documentType: string; documentNo: string }): Promise<ConnectorResult<{ match: boolean; score: number; decision: string }>>` → op `verify`.

Each adapter is a thin typed wrapper over `connector.call(op, payload)`; all are tested through the MOCK connector (no external systems).

- [ ] **Step 1: Write the failing adapters test**

`services/integration/src/adapters/adapters.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { MockConnector } from "../connectors/mock.js";
import { cbsCustomerLookup, cbsKycSync } from "./cbs.js";
import { losPushLoan, losLoanStatus } from "./los.js";
import { kycVerify } from "./kyc.js";

const cbs = new MockConnector("cbs", {
  "customer.lookup": { ok: true, status: 200, data: { cid: "C1", name: "Dorji", branch: "Thimphu", segment: "RETAIL" } },
  "kyc.sync": { ok: true, status: 200, data: { cid: "C1", kycStatus: "VERIFIED" } },
});
const los = new MockConnector("los", {
  "loan.push": { ok: true, status: 201, data: { loanId: "L9", state: "RECEIVED" } },
  "loan.status": { ok: true, status: 200, data: { loanId: "L9", state: "UNDER_REVIEW" } },
});
const kyc = new MockConnector("kyc", {
  "verify": { ok: true, status: 200, data: { match: true, score: 0.97, decision: "PASS" } },
});

describe("adapters via mock connector", () => {
  it("CBS customer lookup", async () => {
    const r = await cbsCustomerLookup(cbs, "C1");
    expect(r.ok).toBe(true);
    expect(r.data?.name).toBe("Dorji");
  });
  it("CBS KYC sync", async () => {
    const r = await cbsKycSync(cbs, "C1");
    expect(r.data?.kycStatus).toBe("VERIFIED");
  });
  it("LOS push + status", async () => {
    const push = await losPushLoan(los, { applicationId: "A1", cid: "C1", amount: 50000 });
    expect(push.status).toBe(201);
    expect(push.data?.loanId).toBe("L9");
    const status = await losLoanStatus(los, "L9");
    expect(status.data?.state).toBe("UNDER_REVIEW");
  });
  it("KYC verify", async () => {
    const r = await kycVerify(kyc, { cid: "C1", documentType: "BT_CID_4G", documentNo: "10101000001" });
    expect(r.data?.decision).toBe("PASS");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zordms/integration test adapters`
Expected: FAIL — adapter modules not found.

- [ ] **Step 3: Write `adapters/cbs.ts`**

```ts
import type { Connector } from "../connectors/types.js";
import type { ConnectorResult } from "@zordms/types";

export interface CbsCustomer { cid: string; name: string; branch?: string; segment?: string; }
export interface CbsKycSyncResult { cid: string; kycStatus: string; syncedAt?: string; }

// TCS BaNCS customer lookup.
export function cbsCustomerLookup(connector: Connector, cid: string): Promise<ConnectorResult<CbsCustomer>> {
  return connector.call<CbsCustomer>("customer.lookup", { cid });
}

// TCS BaNCS KYC sync.
export function cbsKycSync(connector: Connector, cid: string): Promise<ConnectorResult<CbsKycSyncResult>> {
  return connector.call<CbsKycSyncResult>("kyc.sync", { cid });
}
```

- [ ] **Step 4: Write `adapters/los.ts`**

```ts
import type { Connector } from "../connectors/types.js";
import type { ConnectorResult } from "@zordms/types";

export interface LoanPush { applicationId: string; cid: string; amount: number; }
export interface LoanRef { loanId: string; state: string; }

export function losPushLoan(connector: Connector, loan: LoanPush): Promise<ConnectorResult<LoanRef>> {
  return connector.call<LoanRef>("loan.push", loan);
}

export function losLoanStatus(connector: Connector, loanId: string): Promise<ConnectorResult<LoanRef>> {
  return connector.call<LoanRef>("loan.status", { loanId });
}
```

- [ ] **Step 5: Write `adapters/kyc.ts`**

```ts
import type { Connector } from "../connectors/types.js";
import type { ConnectorResult } from "@zordms/types";

export interface KycSubject { cid: string; documentType: string; documentNo: string; }
export interface KycVerdict { match: boolean; score: number; decision: string; }

export function kycVerify(connector: Connector, subject: KycSubject): Promise<ConnectorResult<KycVerdict>> {
  return connector.call<KycVerdict>("verify", subject);
}
```

- [ ] **Step 6: Run adapters test to verify it passes**

Run: `pnpm --filter @zordms/integration test adapters`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add services/integration/src/adapters
git commit -m "feat(integration): CBS/LOS/KYC adapters tested via mock connector"
```

---

## Task 7: Webhook HMAC sign/verify (timingSafeEqual over raw body)

**Files:**
- Create: `services/integration/src/webhooks/hmac.ts`
- Test: `services/integration/src/webhooks/hmac.test.ts`

**Interfaces:**
- `signBody(rawBody: Buffer | string, secret: string): string` — returns `sha256=<hex>` HMAC-SHA256 of the raw bytes.
- `verifySignature(rawBody: Buffer | string, secret: string, header: string | undefined): boolean` — recomputes the HMAC and compares against `header` using `crypto.timingSafeEqual`; returns `false` (never throws) on missing/short/length-mismatched headers so a malformed signature can't crash the route.

- [ ] **Step 1: Write the failing HMAC test**

`services/integration/src/webhooks/hmac.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { signBody, verifySignature } from "./hmac.js";

const secret = "whsec_test";
const raw = '{"event":"cbs.customer.updated","cid":"C1"}';

describe("webhook hmac", () => {
  it("signs with the sha256= prefix and verifies its own signature", () => {
    const sig = signBody(raw, secret);
    expect(sig.startsWith("sha256=")).toBe(true);
    expect(verifySignature(raw, secret, sig)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const sig = signBody(raw, secret);
    expect(verifySignature(raw + " ", secret, sig)).toBe(false);
  });

  it("rejects a wrong secret", () => {
    const sig = signBody(raw, "other");
    expect(verifySignature(raw, secret, sig)).toBe(false);
  });

  it("returns false (no throw) for missing or malformed headers", () => {
    expect(verifySignature(raw, secret, undefined)).toBe(false);
    expect(verifySignature(raw, secret, "sha256=zz")).toBe(false);
    expect(verifySignature(raw, secret, "garbage")).toBe(false);
  });

  it("verifies against the exact raw bytes, not a re-serialized body", () => {
    // Keys deliberately out of alphabetical order; re-serialization would reorder/normalize.
    const weird = '{"z":1,"a":2}';
    const sig = signBody(weird, secret);
    // Simulate the pitfall: re-serialize the parsed object and sign THAT.
    const reserialized = JSON.stringify(JSON.parse(weird));
    expect(reserialized).not.toBe(weird);
    expect(verifySignature(reserialized, secret, sig)).toBe(false); // proves raw-body discipline matters
    expect(verifySignature(weird, secret, sig)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zordms/integration test hmac`
Expected: FAIL — `./hmac.js` not found.

- [ ] **Step 3: Write `webhooks/hmac.ts`**

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

// HMAC-SHA256 of the RAW request bytes, prefixed with "sha256=".
export function signBody(rawBody: Buffer | string, secret: string): string {
  const buf = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, "utf8");
  const digest = createHmac("sha256", secret).update(buf).digest("hex");
  return `sha256=${digest}`;
}

// Constant-time comparison against the provided header. Never throws: returns false
// for missing/malformed/length-mismatched signatures.
export function verifySignature(rawBody: Buffer | string, secret: string, header: string | undefined): boolean {
  if (!header) return false;
  const expected = signBody(rawBody, secret);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(header, "utf8");
  if (a.length !== b.length) return false; // timingSafeEqual requires equal length
  return timingSafeEqual(a, b);
}
```

- [ ] **Step 4: Run HMAC test to verify it passes**

Run: `pnpm --filter @zordms/integration test hmac`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add services/integration/src/webhooks/hmac.ts services/integration/src/webhooks/hmac.test.ts
git commit -m "feat(integration): HMAC-SHA256 sign/verify over raw body (timingSafeEqual)"
```

---

## Task 8: Inbound webhook routes (verify → emit events → workflow/alert hand-off)

**Files:**
- Create: `services/integration/src/routes/webhooks.ts`
- Modify: `services/integration/src/app.ts` (mount `/webhooks`)
- Test: `services/integration/src/routes/webhooks.test.ts`

**Interfaces:**
- `webhooksRouter(): Router` mounting:
  - `POST /webhooks/cbs/customer-updated` → on valid HMAC, emit `cbs.customer.updated`, write an `integration_logs` inbound row + a workflow/alert hand-off row in `integration_logs` (direction `inbound`), respond 202; on bad signature respond 401.
  - `POST /webhooks/los/loan-application` → emit `los.loan.created`.
  - `POST /webhooks/kyc/verification-result` → emit `kyc.result`.
- Secret resolution: each system's webhook secret is read from `integration_config.secret` (seeded in Task 11) by `system`; the signature header is `X-ZorDMS-Signature`.
- Hand-off: a successful inbound webhook also writes an `integration_logs` row with `endpoint` = the emitted event name and `direction="inbound"` (the durable hand-off record the Workflow/Notify services consume via the event sink; in production the sink is the Redis-Streams bus).

- [ ] **Step 1: Write the failing webhook test**

`services/integration/src/routes/webhooks.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import knexLib from "knex";
import { buildKnexConfig } from "@zordms/db";
import { loadConfig } from "@zordms/config";
import { createApp } from "../app.js";
import { InMemoryEventSink } from "../events/sink.js";
import { signBody } from "../webhooks/hmac.js";

const knex = knexLib(buildKnexConfig({
  client: "sqlite3", host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "",
}));
const events = new InMemoryEventSink();
const app = createApp({ knex, config: loadConfig({ JWT_SECRET: "t" } as NodeJS.ProcessEnv), events });
const SECRET = "whsec_cbs";

beforeAll(async () => {
  await knex.migrate.latest(); await knex.seed.run();
  await knex("integration_config").where({ system: "cbs" }).update({ secret: SECRET });
});
afterAll(async () => { await knex.destroy(); });

describe("inbound webhooks", () => {
  it("accepts a correctly signed CBS webhook and emits the event", async () => {
    const body = JSON.stringify({ cid: "C1", name: "Dorji" });
    const sig = signBody(body, SECRET);
    const res = await request(app)
      .post("/webhooks/cbs/customer-updated")
      .set("Content-Type", "application/json")
      .set("X-ZorDMS-Signature", sig)
      .send(body);
    expect(res.status).toBe(202);
    expect(events.emitted.some((e) => e.event === "cbs.customer.updated")).toBe(true);
    const handoff = await knex("integration_logs")
      .where({ system: "cbs", direction: "inbound", endpoint: "cbs.customer.updated" }).first();
    expect(handoff).toBeTruthy();
  });

  it("rejects a wrongly signed webhook with 401 and emits nothing", async () => {
    const before = events.emitted.length;
    const body = JSON.stringify({ cid: "C2" });
    const res = await request(app)
      .post("/webhooks/cbs/customer-updated")
      .set("Content-Type", "application/json")
      .set("X-ZorDMS-Signature", "sha256=deadbeef")
      .send(body);
    expect(res.status).toBe(401);
    expect(events.emitted.length).toBe(before);
  });

  it("routes LOS and KYC webhooks to their events", async () => {
    await knex("integration_config").where({ system: "los" }).update({ secret: "whsec_los" });
    await knex("integration_config").where({ system: "kyc" }).update({ secret: "whsec_kyc" });
    const losBody = JSON.stringify({ applicationId: "A1", cid: "C1", amount: 50000 });
    await request(app).post("/webhooks/los/loan-application")
      .set("Content-Type", "application/json").set("X-ZorDMS-Signature", signBody(losBody, "whsec_los")).send(losBody);
    const kycBody = JSON.stringify({ cid: "C1", decision: "PASS" });
    await request(app).post("/webhooks/kyc/verification-result")
      .set("Content-Type", "application/json").set("X-ZorDMS-Signature", signBody(kycBody, "whsec_kyc")).send(kycBody);
    expect(events.emitted.some((e) => e.event === "los.loan.created")).toBe(true);
    expect(events.emitted.some((e) => e.event === "kyc.result")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zordms/integration test routes/webhooks`
Expected: FAIL — `/webhooks/...` 404.

- [ ] **Step 3: Write `routes/webhooks.ts`**

```ts
import { Router, type Request, type Response } from "express";
import type { Knex } from "knex";
import type { EventSink } from "../events/sink.js";
import { verifySignature } from "../webhooks/hmac.js";

const SIGNATURE_HEADER = "x-zordms-signature";

interface Hook { system: string; event: string; }

async function handle(req: Request, res: Response, hook: Hook): Promise<void> {
  const deps = req.app.locals.deps as { knex: Knex; events?: EventSink };
  const { knex, events } = deps;
  const cfg = await knex("integration_config").where({ system: hook.system }).first();
  const secret = cfg?.secret as string | undefined;
  const raw = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}), "utf8");
  const header = req.headers[SIGNATURE_HEADER] as string | undefined;

  if (!secret || !verifySignature(raw, secret, header)) {
    await knex("integration_logs").insert({
      system: hook.system, endpoint: hook.event, method: "POST",
      status: 401, latency_ms: 0, direction: "inbound", success: false, error: "bad_signature",
    });
    res.status(401).json({ error: "invalid_signature" });
    return;
  }

  // emit the internal event for Workflow/Notify consumers
  await events?.emit(hook.event, req.body);
  // durable hand-off record (Workflow/Notify also read the event bus in production)
  await knex("integration_logs").insert({
    system: hook.system, endpoint: hook.event, method: "POST",
    status: 202, latency_ms: 0, direction: "inbound", success: true,
  });
  res.status(202).json({ accepted: true, event: hook.event });
}

export function webhooksRouter(): Router {
  const r = Router();
  r.post("/cbs/customer-updated", (req, res) => handle(req, res, { system: "cbs", event: "cbs.customer.updated" }));
  r.post("/los/loan-application", (req, res) => handle(req, res, { system: "los", event: "los.loan.created" }));
  r.post("/kyc/verification-result", (req, res) => handle(req, res, { system: "kyc", event: "kyc.result" }));
  return r;
}
```

- [ ] **Step 4: Mount in `app.ts`**

Add the import and mount inside `createApp` (after `app.locals.deps = deps;`):
```ts
import { webhooksRouter } from "./routes/webhooks.js";
// ...
app.use("/webhooks", webhooksRouter());
```

- [ ] **Step 5: Run webhook test to verify it passes**

Run: `pnpm --filter @zordms/integration test routes/webhooks`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add services/integration/src/routes/webhooks.ts services/integration/src/app.ts services/integration/src/routes/webhooks.test.ts
git commit -m "feat(integration): inbound webhooks with HMAC verify, event emit, workflow hand-off"
```

---

## Task 9: Outbound webhooks — register + dispatch with HMAC signing + retry

**Files:**
- Create: `services/integration/src/webhooks/dispatch.ts`, `services/integration/src/routes/outbound.ts`
- Modify: `services/integration/src/app.ts` (mount `/outbound`)
- Test: `services/integration/src/webhooks/dispatch.test.ts`, `services/integration/src/routes/outbound.test.ts`

**Interfaces:**
- `webhooks/dispatch.ts`:
  - `dispatchEvent(deps: { knex: Knex; fetchImpl?: typeof fetch; maxAttempts?: number }, event: string, payload: unknown): Promise<DispatchReport>` — selects enabled `outbound_webhooks` whose `events` includes `event`, signs the JSON body with the hook's `secret` (when `auth_method="hmac"`) into `X-ZorDMS-Signature`, POSTs via `fetchImpl ?? fetch`, retries up to `maxAttempts` (default 3) on non-2xx/throw with no real delay in tests, and logs each final outcome to `integration_logs` (direction `outbound`). Returns `{ delivered: number; failed: number; attempts: number }`.
- `routes/outbound.ts` (`requireAuth` + RBAC):
  - `POST /outbound` (`integration:manage`) body `{ url; events: string[]; auth_method?; secret? }` → 201 created webhook.
  - `GET /outbound` (`integration:read`) → list registered webhooks (secret redacted).
  - `POST /outbound/test` (`integration:manage`) body `{ event; payload? }` → triggers `dispatchEvent` and returns the report (uses the injected fetch in tests).

- [ ] **Step 1: Write the failing dispatch test**

`services/integration/src/webhooks/dispatch.test.ts`:
```ts
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import knexLib from "knex";
import { buildKnexConfig } from "@zordms/db";
import { dispatchEvent } from "./dispatch.js";
import { verifySignature } from "./hmac.js";

const knex = knexLib(buildKnexConfig({
  client: "sqlite3", host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "",
}));

beforeAll(async () => {
  await knex.migrate.latest();
  await knex("outbound_webhooks").insert({
    url: "http://consumer.local/hook", events: "cbs.customer.updated,kyc.result",
    auth_method: "hmac", secret: "out_secret", enabled: true,
  });
});
afterAll(async () => { await knex.destroy(); });

describe("dispatchEvent", () => {
  it("signs the body and delivers to subscribers of the event", async () => {
    let seenSig: string | undefined; let seenBody: string | undefined;
    const fetchImpl = vi.fn(async (_url: string, init: any) => {
      seenSig = init.headers["X-ZorDMS-Signature"]; seenBody = init.body;
      return { ok: true, status: 200, json: async () => ({}) };
    }) as unknown as typeof fetch;

    const report = await dispatchEvent({ knex, fetchImpl }, "cbs.customer.updated", { cid: "C1" });
    expect(report.delivered).toBe(1);
    expect(report.failed).toBe(0);
    expect(verifySignature(seenBody!, "out_secret", seenSig)).toBe(true); // valid HMAC over the exact sent body
  });

  it("retries up to maxAttempts then logs a failure", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })) as unknown as typeof fetch;
    const report = await dispatchEvent({ knex, fetchImpl, maxAttempts: 3 }, "kyc.result", { ok: true });
    expect(report.delivered).toBe(0);
    expect(report.failed).toBe(1);
    expect((fetchImpl as any).mock.calls.length).toBe(3);
    const row = await knex("integration_logs").where({ system: "outbound", endpoint: "kyc.result", success: false }).first();
    expect(row).toBeTruthy();
  });

  it("delivers nothing for an event with no subscribers", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const report = await dispatchEvent({ knex, fetchImpl }, "los.loan.created", {});
    expect(report.delivered + report.failed).toBe(0);
    expect((fetchImpl as any).mock.calls.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zordms/integration test dispatch`
Expected: FAIL — `./dispatch.js` not found.

- [ ] **Step 3: Write `webhooks/dispatch.ts`**

```ts
import type { Knex } from "knex";
import { signBody } from "./hmac.js";

export interface DispatchReport { delivered: number; failed: number; attempts: number; }

interface DispatchDeps { knex: Knex; fetchImpl?: typeof fetch; maxAttempts?: number; }

export async function dispatchEvent(deps: DispatchDeps, event: string, payload: unknown): Promise<DispatchReport> {
  const { knex } = deps;
  const doFetch = deps.fetchImpl ?? globalThis.fetch;
  const maxAttempts = deps.maxAttempts ?? 3;

  const hooks = await knex("outbound_webhooks").where({ enabled: true });
  const subscribers = hooks.filter((h) =>
    String(h.events).split(",").map((s) => s.trim()).includes(event),
  );

  const report: DispatchReport = { delivered: 0, failed: 0, attempts: 0 };
  const body = JSON.stringify({ event, payload });

  for (const hook of subscribers) {
    const headers: Record<string, string> = { "Content-Type": "application/json", "X-ZorDMS-Event": event };
    if (hook.auth_method === "hmac" && hook.secret) {
      headers["X-ZorDMS-Signature"] = signBody(body, hook.secret);
    }

    let ok = false; let lastStatus = 0; let attempt = 0;
    for (attempt = 1; attempt <= maxAttempts; attempt++) {
      report.attempts++;
      try {
        const res = await doFetch(hook.url, { method: "POST", headers, body });
        lastStatus = res.status;
        if (res.ok) { ok = true; break; }
      } catch {
        lastStatus = 0;
      }
    }

    await knex("integration_logs").insert({
      system: "outbound", endpoint: event, method: "POST",
      status: lastStatus, latency_ms: 0, direction: "outbound",
      success: ok, error: ok ? null : `delivery_failed_after_${attempt - 1}_attempts`,
    });
    if (ok) report.delivered++; else report.failed++;
  }

  return report;
}
```

- [ ] **Step 4: Run dispatch test to verify it passes**

Run: `pnpm --filter @zordms/integration test dispatch`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing outbound-routes test**

`services/integration/src/routes/outbound.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import knexLib from "knex";
import { buildKnexConfig } from "@zordms/db";
import { loadConfig } from "@zordms/config";
import { signToken } from "@zordms/auth";
import { createApp } from "../app.js";

const knex = knexLib(buildKnexConfig({
  client: "sqlite3", host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "",
}));
const app = createApp({ knex, config: loadConfig({ JWT_SECRET: "t" } as NodeJS.ProcessEnv) });
let adminToken = "";

beforeAll(async () => {
  await knex.migrate.latest(); await knex.seed.run();
  const admin = await knex("users").where({ username: "admin" }).first();
  adminToken = signToken({ sub: admin.id, username: "admin" }, "t");
});
afterAll(async () => { await knex.destroy(); });

describe("outbound webhook routes", () => {
  it("registers a webhook (integration:manage) and lists it with secret redacted", async () => {
    const create = await request(app).post("/outbound").set("Authorization", `Bearer ${adminToken}`)
      .send({ url: "http://c/hook", events: ["cbs.customer.updated"], auth_method: "hmac", secret: "s1" });
    expect(create.status).toBe(201);
    const list = await request(app).get("/outbound").set("Authorization", `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    expect(list.body.webhooks[0].url).toBe("http://c/hook");
    expect(list.body.webhooks[0].secret).toBeUndefined();
  });

  it("requires a token", async () => {
    expect((await request(app).get("/outbound")).status).toBe(401);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter @zordms/integration test routes/outbound`
Expected: FAIL — `/outbound` 404.

- [ ] **Step 7: Write `routes/outbound.ts`**

```ts
import { Router } from "express";
import type { Knex } from "knex";
import { requireAuth, requirePermission } from "@zordms/auth";
import { dispatchEvent } from "../webhooks/dispatch.js";

export function outboundRouter(): Router {
  const r = Router();
  r.use(requireAuth);

  r.post("/", requirePermission("integration:manage"), async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    const { url, events, auth_method, secret } = req.body as
      { url: string; events: string[]; auth_method?: string; secret?: string };
    const [id] = await knex("outbound_webhooks").insert({
      url, events: (events ?? []).join(","), auth_method: auth_method ?? "hmac",
      secret: secret ?? null, enabled: true,
    }).returning("id");
    const webhookId = typeof id === "object" ? (id as any).id : id;
    res.status(201).json({ webhook: { id: webhookId, url, events: events ?? [], auth_method: auth_method ?? "hmac" } });
  });

  r.get("/", requirePermission("integration:read"), async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    const rows = await knex("outbound_webhooks").select("id", "url", "events", "auth_method", "enabled");
    res.json({ webhooks: rows.map((w) => ({ ...w, events: String(w.events).split(",").filter(Boolean) })) });
  });

  r.post("/test", requirePermission("integration:manage"), async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    const { event, payload } = req.body as { event: string; payload?: unknown };
    const report = await dispatchEvent({ knex }, event, payload ?? {});
    res.json({ report });
  });

  return r;
}
```

Note: `requireAuth` and `requirePermission` must be exported from `@zordms/auth`. If Plan 1 left them inside `services/gateway`, promote them to `@zordms/auth` (they have no gateway-specific dependency) and re-export from the barrel, then update the gateway imports. This keeps all services on one shared middleware.

- [ ] **Step 8: Mount in `app.ts`**

```ts
import { outboundRouter } from "./routes/outbound.js";
// inside createApp:
app.use("/outbound", outboundRouter());
```

- [ ] **Step 9: Run outbound-routes test to verify it passes**

Run: `pnpm --filter @zordms/integration test routes/outbound`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add services/integration/src/webhooks/dispatch.ts services/integration/src/routes/outbound.ts services/integration/src/app.ts services/integration/src/webhooks/dispatch.test.ts services/integration/src/routes/outbound.test.ts
git commit -m "feat(integration): outbound webhooks register + signed dispatch with retry"
```

---

## Task 10: API management — request-logs list + connected-systems status dashboard

**Files:**
- Create: `services/integration/src/routes/management.ts`
- Modify: `services/integration/src/app.ts` (mount `/integration`)
- Test: `services/integration/src/routes/management.test.ts`

**Interfaces:**
- `managementRouter(): Router` (`requireAuth` + `integration:read`):
  - `GET /integration/logs?system=&limit=` → most-recent `integration_logs` rows (default limit 50, max 200), newest first.
  - `GET /integration/systems` → `ConnectedSystem[]` derived from `integration_config` joined with recent `integration_logs`: `status` is `disabled` when `!enabled`, else `down` if the most recent log for the system failed, else `up`; `recentErrors` counts failed logs in the last 50 rows; `lastCallAt` is the newest log time.

- [ ] **Step 1: Write the failing management test**

`services/integration/src/routes/management.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import knexLib from "knex";
import { buildKnexConfig } from "@zordms/db";
import { loadConfig } from "@zordms/config";
import { signToken } from "@zordms/auth";
import { createApp } from "../app.js";

const knex = knexLib(buildKnexConfig({
  client: "sqlite3", host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "",
}));
const app = createApp({ knex, config: loadConfig({ JWT_SECRET: "t" } as NodeJS.ProcessEnv) });
let adminToken = "";

beforeAll(async () => {
  await knex.migrate.latest(); await knex.seed.run();
  const admin = await knex("users").where({ username: "admin" }).first();
  adminToken = signToken({ sub: admin.id, username: "admin" }, "t");
  await knex("integration_logs").insert([
    { system: "cbs", endpoint: "customer.lookup", method: "CALL", status: 200, latency_ms: 12, direction: "outbound", success: true },
    { system: "los", endpoint: "loan.status", method: "CALL", status: 503, latency_ms: 30, direction: "outbound", success: false, error: "http_503" },
  ]);
});
afterAll(async () => { await knex.destroy(); });

describe("integration management", () => {
  it("lists recent request logs", async () => {
    const res = await request(app).get("/integration/logs").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.logs.length).toBeGreaterThanOrEqual(2);
  });

  it("filters logs by system", async () => {
    const res = await request(app).get("/integration/logs?system=los").set("Authorization", `Bearer ${adminToken}`);
    expect(res.body.logs.every((l: any) => l.system === "los")).toBe(true);
  });

  it("reports connected-system status (los down, cbs up, disabled flagged)", async () => {
    const res = await request(app).get("/integration/systems").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const bySystem = Object.fromEntries(res.body.systems.map((s: any) => [s.system, s]));
    expect(bySystem.cbs.status).toBe("up");
    expect(bySystem.los.status).toBe("down");
    expect(bySystem.los.recentErrors).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zordms/integration test routes/management`
Expected: FAIL — `/integration/...` 404.

- [ ] **Step 3: Write `routes/management.ts`**

```ts
import { Router } from "express";
import type { Knex } from "knex";
import { requireAuth, requirePermission } from "@zordms/auth";
import type { ConnectedSystem } from "@zordms/types";

export function managementRouter(): Router {
  const r = Router();
  r.use(requireAuth);

  r.get("/logs", requirePermission("integration:read"), async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    const system = req.query.system as string | undefined;
    const limit = Math.min(Number(req.query.limit ?? 50) || 50, 200);
    let q = knex("integration_logs").orderBy("id", "desc").limit(limit);
    if (system) q = q.where({ system });
    res.json({ logs: await q });
  });

  r.get("/systems", requirePermission("integration:read"), async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    const configs = await knex("integration_config").select("system", "base_url", "enabled");
    const systems: ConnectedSystem[] = [];
    for (const cfg of configs) {
      const recent = await knex("integration_logs").where({ system: cfg.system }).orderBy("id", "desc").limit(50);
      const recentErrors = recent.filter((l) => !l.success).length;
      const latest = recent[0];
      let status: ConnectedSystem["status"];
      if (!cfg.enabled) status = "disabled";
      else if (latest && !latest.success) status = "down";
      else status = "up";
      systems.push({
        system: cfg.system, base_url: cfg.base_url, enabled: !!cfg.enabled,
        status, recentErrors, lastCallAt: latest?.created_at ?? null,
      });
    }
    res.json({ systems });
  });

  return r;
}
```

- [ ] **Step 4: Mount in `app.ts`**

```ts
import { managementRouter } from "./routes/management.js";
// inside createApp:
app.use("/integration", managementRouter());
```

- [ ] **Step 5: Run management test to verify it passes**

Run: `pnpm --filter @zordms/integration test routes/management`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add services/integration/src/routes/management.ts services/integration/src/app.ts services/integration/src/routes/management.test.ts
git commit -m "feat(integration): request-logs list + connected-systems status dashboard API"
```

---

## Task 11: Seed `integration:read`/`integration:manage` permissions + system config

**Files:**
- Create: `packages/db/src/seeds/0006_integration_perms.ts`
- Test: `packages/db/src/seeds/integration_perms.test.ts`

**Interfaces:**
- Seed adds permissions `integration:read`, `integration:manage` (idempotent), grants them to the `CDO` role (full) and `integration:read` to `Supervisor` and `Auditor`, and seeds `integration_config` baseline rows for `cbs`, `los`, `kyc`, `erp`, `crm`, `contact_center`, `mbob`, `gobob`, `internet_banking` (all `enabled=true`, `auth_type` per system; `base_url`/`secret` left null so the MOCK fallback is used). Idempotent — safe to re-run.

- [ ] **Step 1: Write the failing seed test**

`packages/db/src/seeds/integration_perms.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import knexLib from "knex";
import { buildKnexConfig } from "../knexConfig.js";

const knex = knexLib(buildKnexConfig({
  client: "sqlite3", host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "",
}));

beforeAll(async () => { await knex.migrate.latest(); await knex.seed.run(); });
afterAll(async () => { await knex.destroy(); });

describe("integration permissions seed", () => {
  it("adds integration:read and integration:manage", async () => {
    const perms = await knex("permissions").pluck("key");
    expect(perms).toEqual(expect.arrayContaining(["integration:read", "integration:manage"]));
  });

  it("grants both to CDO", async () => {
    const rows = await knex("role_permissions as rp")
      .join("roles as r", "r.id", "rp.role_id")
      .join("permissions as p", "p.id", "rp.permission_id")
      .where("r.name", "CDO").whereIn("p.key", ["integration:read", "integration:manage"])
      .pluck("p.key");
    expect(rows).toEqual(expect.arrayContaining(["integration:read", "integration:manage"]));
  });

  it("seeds baseline connected-system config rows including cbs/los/kyc", async () => {
    const systems = await knex("integration_config").pluck("system");
    expect(systems).toEqual(expect.arrayContaining(["cbs", "los", "kyc", "mbob", "gobob", "internet_banking"]));
  });

  it("is idempotent on a second run", async () => {
    await knex.seed.run();
    const count = Number((await knex("permissions").where({ key: "integration:read" }).count<{ c: number }[]>("id as c"))[0].c);
    expect(count).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zordms/db test integration_perms`
Expected: FAIL — `integration:read` not present / `integration_config` empty.

- [ ] **Step 3: Write `packages/db/src/seeds/0006_integration_perms.ts`**

```ts
import type { Knex } from "knex";

const NEW_PERMISSIONS: Array<[string, string]> = [
  ["integration:read", "View integrations, request logs, and system status"],
  ["integration:manage", "Configure connectors and outbound webhooks"],
];

const GRANTS: Record<string, string[]> = {
  CDO: ["integration:read", "integration:manage"],
  Supervisor: ["integration:read"],
  Auditor: ["integration:read"],
};

const SYSTEMS: Array<{ system: string; auth_type: string }> = [
  { system: "cbs", auth_type: "hmac" },
  { system: "los", auth_type: "hmac" },
  { system: "kyc", auth_type: "hmac" },
  { system: "erp", auth_type: "bearer" },
  { system: "crm", auth_type: "bearer" },
  { system: "contact_center", auth_type: "bearer" },
  { system: "mbob", auth_type: "hmac" },
  { system: "gobob", auth_type: "hmac" },
  { system: "internet_banking", auth_type: "hmac" },
];

export async function seed(knex: Knex): Promise<void> {
  // permissions (idempotent)
  for (const [key, description] of NEW_PERMISSIONS) {
    const exists = await knex("permissions").where({ key }).first();
    if (!exists) await knex("permissions").insert({ key, description });
  }
  // grants (idempotent)
  for (const [roleName, keys] of Object.entries(GRANTS)) {
    const role = await knex("roles").where({ name: roleName }).first();
    if (!role) continue;
    for (const key of keys) {
      const perm = await knex("permissions").where({ key }).first();
      if (!perm) continue;
      const link = await knex("role_permissions").where({ role_id: role.id, permission_id: perm.id }).first();
      if (!link) await knex("role_permissions").insert({ role_id: role.id, permission_id: perm.id });
    }
  }
  // baseline connected-system config (idempotent; base_url/secret null → MOCK fallback)
  for (const s of SYSTEMS) {
    const exists = await knex("integration_config").where({ system: s.system }).first();
    if (!exists) await knex("integration_config").insert({ system: s.system, auth_type: s.auth_type, enabled: true });
  }
}
```

Note on seed ordering: Knex runs seed files alphabetically. `0006_integration_perms.ts` runs after Plan 1's `0001_default_rbac.ts`, so the `CDO`/`Supervisor`/`Auditor` roles already exist. No change to the Plan 1 seed is needed.

- [ ] **Step 4: Run seed test to verify it passes**

Run: `pnpm --filter @zordms/db test integration_perms`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/seeds/0006_integration_perms.ts packages/db/src/seeds/integration_perms.test.ts
git commit -m "feat(db): seed integration:read/manage perms + baseline system config"
```

---

## Task 12: React Integration Hub screen (systems + logs + webhook form)

**Files:**
- Create: `apps/web/src/api/integration.ts`, `apps/web/src/components/StatusDot.tsx`, `apps/web/src/pages/IntegrationHub.tsx`
- Modify: `apps/web/src/router.tsx` (add `/integration` route)
- Test: `apps/web/src/components/StatusDot.test.tsx`, `apps/web/src/pages/IntegrationHub.test.tsx`

**Interfaces:**
- `api/integration.ts`: `listSystems()`, `listLogs(system?)`, `registerWebhook(body)`, `listWebhooks()` over the shared `api` client.
- `StatusDot({ status })` — renders a colored dot (`up`→green, `down`→red, `mock`→amber, `disabled`→grey) with an accessible label.
- `IntegrationHub()` — three panels: connected systems (each with a `StatusDot`), the API request-logs table, and a webhook-registration form (`url`, comma-separated `events`, `secret`) that POSTs and refreshes the list.

- [ ] **Step 1: Write the failing StatusDot test**

`apps/web/src/components/StatusDot.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusDot } from "./StatusDot.js";

describe("StatusDot", () => {
  it("labels the status for accessibility", () => {
    render(<StatusDot status="down" />);
    expect(screen.getByLabelText(/down/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zordms/web test StatusDot`
Expected: FAIL — `./StatusDot.js` not found.

- [ ] **Step 3: Write `components/StatusDot.tsx`**

```tsx
const COLORS: Record<string, string> = { up: "#16a34a", down: "#dc2626", mock: "#d97706", disabled: "#94a3b8" };

export function StatusDot({ status }: { status: "up" | "down" | "mock" | "disabled" }) {
  return (
    <span
      role="img"
      aria-label={`status ${status}`}
      title={status}
      style={{ display: "inline-block", width: 10, height: 10, borderRadius: "50%", background: COLORS[status] ?? "#94a3b8" }}
    />
  );
}
```

- [ ] **Step 4: Run StatusDot test to verify it passes**

Run: `pnpm --filter @zordms/web test StatusDot`
Expected: PASS.

- [ ] **Step 5: Write `api/integration.ts`**

```ts
import { api } from "./client.js";
import type { ConnectedSystem, IntegrationLog, OutboundWebhook } from "@zordms/types";

export const listSystems = (): Promise<{ systems: ConnectedSystem[] }> => api.get("/integration/systems");
export const listLogs = (system?: string): Promise<{ logs: IntegrationLog[] }> =>
  api.get(`/integration/logs${system ? `?system=${encodeURIComponent(system)}` : ""}`);
export const listWebhooks = (): Promise<{ webhooks: OutboundWebhook[] }> => api.get("/outbound");
export const registerWebhook = (body: { url: string; events: string[]; secret?: string }): Promise<unknown> =>
  api.post("/outbound", { ...body, auth_method: "hmac" });
```

- [ ] **Step 6: Write the failing IntegrationHub test**

`apps/web/src/pages/IntegrationHub.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { IntegrationHub } from "./IntegrationHub.js";

vi.mock("../auth/AuthContext.js", () => ({
  useAuth: () => ({ user: { id: 1, username: "admin", roles: ["CDO"], permissions: ["integration:read", "integration:manage"] } }),
}));

describe("IntegrationHub", () => {
  it("renders systems with status dots and the request-logs table", async () => {
    globalThis.fetch = vi.fn((url: string) => {
      if (String(url).includes("/integration/systems"))
        return Promise.resolve({ ok: true, json: async () => ({ systems: [{ system: "cbs", enabled: true, status: "up", recentErrors: 0 }, { system: "los", enabled: true, status: "down", recentErrors: 2 }] }) });
      if (String(url).includes("/integration/logs"))
        return Promise.resolve({ ok: true, json: async () => ({ logs: [{ id: 1, system: "los", endpoint: "loan.status", method: "CALL", status: 503, latency_ms: 30, direction: "outbound", success: false }] }) });
      if (String(url).includes("/outbound"))
        return Promise.resolve({ ok: true, json: async () => ({ webhooks: [] }) });
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }) as any;

    render(<IntegrationHub />);
    await waitFor(() => expect(screen.getByText("cbs")).toBeInTheDocument());
    expect(screen.getByText("los")).toBeInTheDocument();
    expect(screen.getByText("loan.status")).toBeInTheDocument();
    expect(screen.getAllByLabelText(/status/i).length).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `pnpm --filter @zordms/web test IntegrationHub`
Expected: FAIL — `./IntegrationHub.js` not found.

- [ ] **Step 8: Write `pages/IntegrationHub.tsx`**

```tsx
import { useEffect, useState, type FormEvent } from "react";
import type { ConnectedSystem, IntegrationLog } from "@zordms/types";
import { StatusDot } from "../components/StatusDot.js";
import { listSystems, listLogs, registerWebhook } from "../api/integration.js";

export function IntegrationHub() {
  const [systems, setSystems] = useState<ConnectedSystem[]>([]);
  const [logs, setLogs] = useState<IntegrationLog[]>([]);
  const [form, setForm] = useState({ url: "", events: "", secret: "" });

  async function refresh() {
    setSystems((await listSystems()).systems);
    setLogs((await listLogs()).logs);
  }
  useEffect(() => { refresh(); }, []);

  async function onRegister(e: FormEvent) {
    e.preventDefault();
    await registerWebhook({
      url: form.url,
      events: form.events.split(",").map((s) => s.trim()).filter(Boolean),
      secret: form.secret || undefined,
    });
    setForm({ url: "", events: "", secret: "" });
    await refresh();
  }

  return (
    <div style={{ padding: 32 }}>
      <h2>Integration Hub</h2>

      <h3>Connected Systems</h3>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
        {systems.map((s) => (
          <div key={s.system} style={{ display: "flex", alignItems: "center", gap: 8, border: "1px solid var(--line)", borderRadius: 8, padding: "10px 14px" }}>
            <StatusDot status={s.status} />
            <span style={{ fontWeight: 600 }}>{s.system}</span>
            <span style={{ color: "var(--muted)", fontSize: 12 }}>{s.recentErrors > 0 ? `${s.recentErrors} recent errors` : "healthy"}</span>
          </div>
        ))}
      </div>

      <h3 style={{ marginTop: 28 }}>API Request Logs</h3>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr>{["System", "Endpoint", "Method", "Status", "Latency", "Dir"].map((h) => <th key={h} style={{ textAlign: "left", padding: 8 }}>{h}</th>)}</tr></thead>
        <tbody>
          {logs.map((l) => (
            <tr key={l.id} style={{ borderTop: "1px solid var(--line)" }}>
              <td style={{ padding: 8 }}>{l.system}</td>
              <td style={{ padding: 8 }}>{l.endpoint}</td>
              <td style={{ padding: 8 }}>{l.method}</td>
              <td style={{ padding: 8, color: l.success ? "#16a34a" : "#dc2626" }}>{l.status}</td>
              <td style={{ padding: 8 }}>{l.latency_ms} ms</td>
              <td style={{ padding: 8 }}>{l.direction}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 style={{ marginTop: 28 }}>Register Outbound Webhook</h3>
      <form onSubmit={onRegister} style={{ display: "flex", gap: 8, flexWrap: "wrap", maxWidth: 720 }}>
        <input className="field" style={{ width: 260 }} placeholder="https://consumer/hook" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
        <input className="field" style={{ width: 240 }} placeholder="cbs.customer.updated,kyc.result" value={form.events} onChange={(e) => setForm({ ...form, events: e.target.value })} />
        <input className="field" style={{ width: 160 }} placeholder="signing secret" value={form.secret} onChange={(e) => setForm({ ...form, secret: e.target.value })} />
        <button className="btn-primary" style={{ width: 140 }}>Register</button>
      </form>
    </div>
  );
}
```

- [ ] **Step 9: Add the route in `router.tsx`**

```tsx
import { IntegrationHub } from "./pages/IntegrationHub.js";
// add to the routes array:
{ path: "/integration", element: <ProtectedRoute permission="integration:read"><IntegrationHub /></ProtectedRoute> },
```

- [ ] **Step 10: Run web tests to verify they pass**

Run: `pnpm --filter @zordms/web test IntegrationHub StatusDot`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add apps/web/src/api/integration.ts apps/web/src/components/StatusDot.tsx apps/web/src/pages/IntegrationHub.tsx apps/web/src/router.tsx apps/web/src/components/StatusDot.test.tsx apps/web/src/pages/IntegrationHub.test.tsx
git commit -m "feat(web): Integration Hub screen — systems, request logs, webhook form"
```

---

## Task 13: Service-wide smoke test + CI note

**Files:**
- Create: `services/integration/src/integration.smoke.test.ts`
- Modify: `.github/workflows/ci.yml` (extend the migration job to run the integration migration+seed)
- Create: `docs/RUNBOOK-integration.md`

**Interfaces:**
- Produces: a single end-to-end smoke test that mounts `createApp`, drives a connector call (logged), an inbound webhook (event emitted), and a management read — proving the wired service works on sqlite with no external systems. CI note documents that the Plan 1 `migrations-postgres` job already applies the new `0006` migration (migrations run by directory), so the only addition is asserting the integration seed runs cleanly.

- [ ] **Step 1: Write the smoke test**

`services/integration/src/integration.smoke.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import knexLib from "knex";
import { buildKnexConfig } from "@zordms/db";
import { loadConfig } from "@zordms/config";
import { signToken } from "@zordms/auth";
import { createApp } from "./app.js";
import { InMemoryEventSink } from "./events/sink.js";
import { buildConnector } from "./connectors/registry.js";
import { cbsCustomerLookup } from "./adapters/cbs.js";
import { signBody } from "./webhooks/hmac.js";

const knex = knexLib(buildKnexConfig({
  client: "sqlite3", host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "",
}));
const events = new InMemoryEventSink();
const app = createApp({ knex, config: loadConfig({ JWT_SECRET: "t" } as NodeJS.ProcessEnv), events });
let adminToken = "";

beforeAll(async () => {
  await knex.migrate.latest(); await knex.seed.run();
  await knex("integration_config").where({ system: "cbs" }).update({ secret: "whsec_cbs" });
  const admin = await knex("users").where({ username: "admin" }).first();
  adminToken = signToken({ sub: admin.id, username: "admin" }, "t");
});
afterAll(async () => { await knex.destroy(); });

describe("integration hub smoke", () => {
  it("connector call is logged, webhook emits an event, management reads it back", async () => {
    const cbs = buildConnector("cbs", { knex });
    const lookup = await cbsCustomerLookup(cbs, "C1000");
    expect(lookup.ok).toBe(true);

    const body = JSON.stringify({ cid: "C1000", name: "Dorji" });
    const wh = await request(app).post("/webhooks/cbs/customer-updated")
      .set("Content-Type", "application/json").set("X-ZorDMS-Signature", signBody(body, "whsec_cbs")).send(body);
    expect(wh.status).toBe(202);
    expect(events.emitted.some((e) => e.event === "cbs.customer.updated")).toBe(true);

    const logs = await request(app).get("/integration/logs?system=cbs").set("Authorization", `Bearer ${adminToken}`);
    expect(logs.body.logs.length).toBeGreaterThanOrEqual(2); // connector call + inbound webhook

    const systems = await request(app).get("/integration/systems").set("Authorization", `Bearer ${adminToken}`);
    expect(systems.body.systems.find((s: any) => s.system === "cbs")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run the smoke test to verify it passes**

Run: `pnpm --filter @zordms/integration test smoke`
Expected: PASS (all prior tasks must be green first).

- [ ] **Step 3: Extend the CI migration job**

In `.github/workflows/ci.yml`, the `migrations-postgres` job already runs `node packages/db/dist/cli.js migrate && ... seed`, which now includes the `0006` migration and integration seed by directory discovery. Append an assertion step after the seed step:
```yaml
      - run: node -e "import('@zordms/db').then(async (m)=>{const k=m.getKnex();const r=await k('integration_config').count('id as c');if(Number(r[0].c)<3)process.exit(1);await m.destroyKnex();})"
        env:
          DB_CLIENT: pg
          DB_HOST: localhost
          DB_PORT: "5432"
          DB_USER: zordms
          DB_PASSWORD: zordms
          DB_NAME: zordms
```

- [ ] **Step 4: Write the runbook**

`docs/RUNBOOK-integration.md`:
```markdown
# ZorDMS Integration Hub — Run & Verify

## Local
1. Ensure foundation migrations+seed have run (`node packages/db/dist/cli.js migrate && ... seed`).
2. `pnpm --filter @zordms/integration build`
3. `pnpm --filter @zordms/integration dev`   # integration hub on :4006
4. With no external systems configured, every connector uses the MOCK fallback.

## Connectors
- Default: MOCK fallback (no network) — fully functional for demos/tests.
- Real target: set `integration_config.base_url` + `secret` for a system and switch
  the registry to `buildHttpConnector(...)`.
- Targets: TCS BaNCS (CBS), LOS, KYC engine, ERP, CRM, Contact Center, mBoB/goBoB/Internet Banking.

## Webhooks
- Inbound: `/webhooks/{cbs/customer-updated, los/loan-application, kyc/verification-result}`.
  Sign the RAW body with HMAC-SHA256 → header `X-ZorDMS-Signature: sha256=<hex>`.
  Secret comes from `integration_config.secret` for the system.
- Outbound: register via `POST /outbound` (`integration:manage`); dispatched on internal
  events with HMAC signing + bounded retry (3 attempts).

## Tests
`pnpm --filter @zordms/integration test` — all suites on in-memory SQLite, no network.
```

- [ ] **Step 5: Run the full service suite**

Run: `pnpm --filter @zordms/integration test && pnpm --filter @zordms/db test && pnpm --filter @zordms/types test`
Expected: all integration, db, and types suites PASS.

- [ ] **Step 6: Commit**

```bash
git add services/integration/src/integration.smoke.test.ts .github/workflows/ci.yml docs/RUNBOOK-integration.md
git commit -m "test(integration): end-to-end smoke + CI integration-seed assertion + runbook"
```

---

## Self-Review

**Spec coverage (Plan 6 — Integration Hub):**
- `services/integration` scaffold + `createApp` factory + `/health` + raw-body middleware for webhooks → Task 1. ✓
- Migration `integration_logs` / `integration_config` / `outbound_webhooks` (Knex schema-builder, dialect-neutral) → Task 2. ✓
- Connector interface `call(system, op, payload)` + generic HTTP connector (fetch/undici) + MOCK connector + request logging into `integration_logs` (unit-tested) → Tasks 4, 5. ✓
- CBS (BaNCS) customer lookup + KYC sync; LOS push + status; KYC verify — each mock-tested → Task 6. ✓
- Inbound webhooks (cbs/los/kyc) with HMAC verify via `timingSafeEqual` over the RAW body → emit events + workflow/alert hand-off; accept/reject tested → Tasks 7, 8. ✓
- Outbound webhooks register + dispatch on internal events with HMAC signing + retry; signing + payload unit-tested → Task 9. ✓
- API management: request-logs list + connected-systems status dashboard → Task 10. ✓
- React Integration Hub screen (status dots + logs table + webhook form) → Task 12. ✓
- Seed `integration:read` / `integration:manage` + baseline system config; CI note → Tasks 11, 13. ✓

**HMAC pitfall handled:** `captureRawBody` (Task 1) stores `req.rawBody` as a `Buffer` before parsing; `verifySignature` (Task 7) hashes those exact bytes and the Task 7 test explicitly proves a re-serialized body fails verification while the raw body passes. ✓

**Mock-fallback discipline:** every connector test and the smoke test run on in-memory SQLite with zero network; the registry returns a logging-wrapped `MockConnector` by default (mirrors the Python mock-fallback) so the service is fully functional without external systems. The HTTP connector is exercised only via an injected `fetch` double. ✓

**Reuse:** no new DB factory, env loader, or auth — `@zordms/db` `buildKnexConfig`/migrations, `@zordms/config` `loadConfig`, and `@zordms/auth` `requireAuth`/`requirePermission` are consumed unchanged. New shared contracts live in `@zordms/types` (Task 3). ✓

**Type consistency:** `Connector`/`ConnectorResult` (Tasks 3–4) flow unchanged through adapters (Task 6), registry (Task 5), and the smoke test (Task 13). `ConnectedSystem`/`IntegrationLog`/`OutboundWebhook` (Task 3) are reused by the management API (Task 10) and the React screen (Task 12). `signBody`/`verifySignature` (Task 7) are used by both inbound (Task 8) and outbound (Task 9). ✓

**Placeholder scan:** no TBD/TODO; every code step contains complete code; every test step has real assertions. ✓

**Dependency note for the executor:** Task 9 assumes `requireAuth`/`requirePermission` are exported from `@zordms/auth`. If Plan 1 left them inside `services/gateway`, promote them to `@zordms/auth` (they are gateway-agnostic) and re-export from the barrel before Task 9; update the gateway imports accordingly. This is the only cross-plan adjustment.

---

## Notes for later plans
- Workflow (Plan 3) and Notify (Plan 4) consume `cbs.customer.updated` / `los.loan.created` / `kyc.result` from the event bus; the `InMemoryEventSink` is replaced by the `@zordms/events` Redis-Streams client with the same `emit(event, payload)` shape — no route changes.
- Phase-2 connectors (ERP/CRM/Contact Center/mBoB/goBoB/Internet Banking) already have `integration_config` rows and the MOCK fallback; promoting one to live only requires a `base_url`+`secret` and switching the registry to `buildHttpConnector`.
- Add real delivery backoff/jitter and a dead-letter table when the BullMQ queue lands; the current retry loop is synchronous and bounded for testability.
