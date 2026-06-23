# Notification & Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This is **Plan 4** in the ZorDMS series; it depends on the foundation packages delivered by Plan 1 (`@zordms/config`, `@zordms/db`, `@zordms/auth`, `@zordms/types`) and reuses them unchanged.

**Goal:** Stand up the ZorDMS **Notification & Alerts** service (`services/notify`) — a data-driven alert-rule engine, interface-driven multi-channel dispatch (Email / SMS / WhatsApp / MS Teams / In-App), the BoB expiry alert tiers (T-60 / T-30 / T-07 / T-00 from IDP §4.3), escalation routing to named RBAC roles, a realtime WebSocket/SSE feed of `alert.raised` events, and the React **Alerts & Event Management** screen (severity feed + Configure Alert Rule form). All channel adapters are interface-driven so tests use a fake adapter with no real network I/O.

**Architecture:** pnpm + Turborepo monorepo. A new Express service `services/notify` with the same testable `createApp(deps)` factory pattern as the Gateway (Plan 1). Persistence via shared `@zordms/db` (Knex; `pg | oracledb` in prod, `sqlite3` in tests). RBAC enforced via `@zordms/auth` (`requireAuth`, `requirePermission`) and the Gateway `/authz/check` API for escalation-target resolution. The service consumes domain events (`document.expiring`, `workflow.escalated`) from the event bus and produces `alert.raised`; an in-process event bus interface is used so tests inject a fake. The alert-rule engine and expiry-tier computation are **pure functions** (no I/O) so they are exhaustively unit-tested in isolation.

**Tech Stack:** Node 20+, TypeScript 5 (strict, ESM), Express 4, Knex 3 (pg / oracledb / sqlite3), Vitest + Supertest, `ws` (WebSocket), `nodemailer` (Email; `jsonTransport` in tests), `twilio` (SMS + WhatsApp; injected client, stubbed when no creds), native `fetch` for the MS Teams incoming webhook, React 18 + Vite 5 (Alerts screen), `@testing-library/react`.

## Global Constraints

- **Reuse, do not fork** — `@zordms/config`, `@zordms/db`, `@zordms/auth`, `@zordms/types` are consumed as `workspace:*` packages. No new DB factory, no new RBAC engine.
- **RBAC-gated** — every alert/notification endpoint is behind `requireAuth`; listing/mutating alerts requires `resource:action` permissions (`alert:read`, `alert:manage`, `alert_rule:manage`). Escalation targets are RBAC role names resolved via the Gateway.
- **Interface-driven channels** — dispatch goes through a `ChannelAdapter` interface and a `ChannelRegistry`. Tests register a `FakeAdapter`; real adapters (Email/SMS/WhatsApp/Teams/In-App) take an **injected client**, so no real network call ever happens in a test.
- **Pure rule logic** — the alert-rule evaluator and the expiry-tier (T-60/T-30/T-07/T-00) milestone computation are pure functions returning plain data; the scheduled job is a thin shell around them.
- **DB switchable via env** — migrations use Knex schema-builder only (`increments()`, no SQLite-isms). SQLite is the test-only backend.
- **All code fully functional** — no mocks/stubs in production paths. Real nodemailer, real Twilio client, real webhook POST, real WebSocket broadcast. Test fakes are explicit and injected.
- **TypeScript everywhere**, ESM (`"type": "module"`), strict mode on. Package/service names under `@zordms/`.
- **Conventional commits**; commit after every passing step. End commit messages with:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## File Structure

```
zordms/
  packages/
    db/   src/migrations/20260623_0004_notify.ts   # NEW migration (this plan)
          src/seeds/0004_notify_permissions.ts      # NEW seed: alert permissions + sample rules
  services/
    notify/
      package.json
      tsconfig.json
      src/
        app.ts                      # express app factory (testable, no listen)
        server.ts                   # listen() + WS attach + bus wiring
        channels/
          types.ts                  # ChannelAdapter interface + Notification DTO
          registry.ts               # ChannelRegistry + dispatch()
          fake.ts                   # FakeAdapter (tests)
          email.ts                  # nodemailer adapter
          sms.ts                    # Twilio SMS adapter
          whatsapp.ts               # Twilio/Meta WhatsApp adapter
          teams.ts                  # MS Teams incoming-webhook adapter
          inapp.ts                  # In-App adapter (DB write + WS broadcast)
        engine/
          ruleEngine.ts             # pure: evaluateRule(rule, event) -> decision
          expiryTiers.ts            # pure: computeExpiryMilestones(expiryDate, today)
        realtime/
          hub.ts                    # RealtimeHub (WS clients + broadcast)
          sse.ts                    # SSE fallback handler
        bus/
          types.ts                  # EventBus interface + DomainEvent
          fake.ts                   # InMemoryBus (tests + single-box default)
        jobs/
          expiryScan.ts             # scheduled job: scan docs -> write alert schedule
        routes/
          health.ts                 # GET /health
          alerts.ts                 # list / mark-read / escalate
          rules.ts                  # alert-rule CRUD
          stream.ts                 # GET /alerts/stream (SSE)
        services/
          alertService.ts           # raiseAlert(): persist + dispatch + broadcast + emit
          escalation.ts             # resolveEscalationRecipients()
  apps/
    web/  src/pages/Alerts.tsx                 # Alerts & Event Management screen
          src/components/AlertRuleForm.tsx     # Configure Alert Rule form
          src/api/notify.ts                    # typed client helpers
```

---

## Task 1: Notify service scaffold + app factory + health route

**Files:**
- Create: `services/notify/package.json`, `services/notify/tsconfig.json`, `services/notify/src/app.ts`, `services/notify/src/server.ts`, `services/notify/src/routes/health.ts`
- Test: `services/notify/src/app.test.ts`

**Interfaces:**
- Produces: `createApp(deps: NotifyDeps): Express` — pure factory (no `listen`), where
  `NotifyDeps = { knex: Knex; config: AppConfig; registry: ChannelRegistry; bus: EventBus; hub: RealtimeHub }`. (The latter three are added in their own tasks; Task 1 declares the type but `createApp` only wires `/health` for now and reads the rest off `app.locals.deps`.)
- `GET /health` → `{ status: "ok", service: "notify" }`.

- [ ] **Step 1: Create `services/notify/package.json`**

```json
{
  "name": "@zordms/notify",
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
    "ws": "^8.18.0",
    "nodemailer": "^6.9.14",
    "twilio": "^5.3.0",
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
    "@types/ws": "^8.5.12",
    "@types/nodemailer": "^6.4.15",
    "knex": "^3.1.0",
    "sqlite3": "^5.1.7"
  }
}
```

- [ ] **Step 2: Create `services/notify/tsconfig.json`**

```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

- [ ] **Step 3: Write the failing test**

`services/notify/src/app.test.ts`:
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
const app = createApp({
  knex,
  config: loadConfig({ JWT_SECRET: "t" } as NodeJS.ProcessEnv),
  registry: undefined as any,
  bus: undefined as any,
  hub: undefined as any,
});

afterAll(async () => { await knex.destroy(); });

describe("notify health", () => {
  it("GET /health returns ok for the notify service", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.service).toBe("notify");
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter @zordms/notify test`
Expected: FAIL — `./app.js` / `./routes/health.js` not found.

- [ ] **Step 5: Write `routes/health.ts`**

```ts
import { Router } from "express";

export function healthRouter(): Router {
  const r = Router();
  r.get("/", (_req, res) => res.json({ status: "ok", service: "notify" }));
  return r;
}
```

- [ ] **Step 6: Write `app.ts`**

```ts
import express, { type Express } from "express";
import cors from "cors";
import type { Knex } from "knex";
import type { AppConfig } from "@zordms/config";
import type { ChannelRegistry } from "./channels/registry.js";
import type { EventBus } from "./bus/types.js";
import type { RealtimeHub } from "./realtime/hub.js";
import { healthRouter } from "./routes/health.js";

export interface NotifyDeps {
  knex: Knex;
  config: AppConfig;
  registry: ChannelRegistry;
  bus: EventBus;
  hub: RealtimeHub;
}

export function createApp(deps: NotifyDeps): Express {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.locals.deps = deps;

  app.use("/health", healthRouter());
  return app;
}
```

> Note: the imports for `ChannelRegistry`, `EventBus`, `RealtimeHub` are **types only**; they are created in Tasks 3, 4 (bus), and 9 respectively. To keep this task compiling on its own, create minimal placeholder type files now and flesh them out later:
> - `src/channels/registry.ts`: `export interface ChannelRegistry { dispatch(n: unknown): Promise<unknown>; }` (replaced in Task 3)
> - `src/bus/types.ts`: `export interface EventBus { publish(e: unknown): Promise<void>; subscribe(t: string, h: (e: unknown) => void): void; }` (replaced in Task 4)
> - `src/realtime/hub.ts`: `export interface RealtimeHub { broadcast(payload: unknown): void; }` (replaced in Task 9)

- [ ] **Step 7: Write `server.ts`** (boot shell; full bus/WS wiring lands in Tasks 4 & 9)

```ts
import http from "node:http";
import { createApp } from "./app.js";
import { getKnex } from "@zordms/db";
import { loadConfig } from "@zordms/config";
import { buildRegistry } from "./channels/registry.js";
import { InMemoryBus } from "./bus/fake.js";
import { RealtimeHub } from "./realtime/hub.js";

const config = loadConfig();
const knex = getKnex();
await knex.migrate.latest();

const hub = new RealtimeHub();
const bus = new InMemoryBus();
const registry = buildRegistry({ knex, config, hub });
const app = createApp({ knex, config, registry, bus, hub });

const port = Number(process.env.NOTIFY_PORT ?? 4003);
const httpServer = http.createServer(app);
hub.attach(httpServer); // WS upgrade handler
httpServer.listen(port, () => console.log(`ZorDMS notify on :${port}`));
```

> `server.ts` references symbols built in later tasks (`buildRegistry`, `InMemoryBus`, `RealtimeHub.attach`). It is the integration shell and is exercised by the Task 13 smoke test; do not run it until those tasks are complete. The Task 1 commit may leave `server.ts` referencing not-yet-existing exports — that is acceptable because `pnpm --filter @zordms/notify test` only compiles `src/app.ts` + its test. If your CI compiles the whole `src` tree, defer creating `server.ts` until Task 9 and create only `app.ts`, `routes/health.ts`, and the three placeholder files in this task.

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm --filter @zordms/notify test`
Expected: PASS (1 test).

- [ ] **Step 9: Commit**

```bash
git add services/notify
git commit -m "feat(notify): express app factory + health route + service scaffold

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Migration — `alert_rules`, `alerts`, `notifications` + permission seed

**Files:**
- Create: `packages/db/src/migrations/20260623_0004_notify.ts`
- Create: `packages/db/src/seeds/0004_notify_permissions.ts`
- Test: `packages/db/src/migrations/notify.test.ts`

**Interfaces:**
- Produces tables:
  - `alert_rules` — `id`, `name`, `trigger` (event name, e.g. `document.expiring`), `params_json` (text JSON), `channels` (text JSON array, e.g. `["email","sms"]`), `escalation_target` (RBAC role name, nullable), `scope` (branch/region scope string, nullable), `enabled`, `created_by`, `created_at`.
  - `alerts` — `id`, `level` (`info|warning|critical`), `title`, `meta` (text JSON), `is_read`, `rule_id` (nullable FK), `branch` (nullable), `created_at`.
  - `notifications` — `id`, `alert_id` (nullable FK), `user_id` (nullable), `channel`, `recipient`, `subject`, `body`, `status` (`pending|sent|failed`), `error`, `created_at`, `sent_at`.
- Seed produces permissions `alert:read`, `alert:manage`, `alert_rule:manage` (linked to CDO + Supervisor + Auditor as appropriate) and two sample `alert_rules` (one expiry, one escalation) only if `alert_rules` is empty.

- [ ] **Step 1: Write the failing test (runs migrations on in-memory sqlite)**

`packages/db/src/migrations/notify.test.ts`:
```ts
import { describe, it, expect, afterAll } from "vitest";
import knexLib from "knex";
import { buildKnexConfig } from "../knexConfig.js";

const knex = knexLib(buildKnexConfig({
  client: "sqlite3", host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "",
}));

afterAll(async () => { await knex.destroy(); });

describe("notify migration + seed", () => {
  it("creates the notify tables", async () => {
    await knex.migrate.latest();
    for (const t of ["alert_rules", "alerts", "notifications"]) {
      expect(await knex.schema.hasTable(t)).toBe(true);
    }
  });

  it("seeds alert permissions and sample rules", async () => {
    await knex.seed.run();
    const perms = await knex("permissions").pluck("key");
    expect(perms).toEqual(expect.arrayContaining(["alert:read", "alert:manage", "alert_rule:manage"]));
    const rules = await knex("alert_rules").pluck("trigger");
    expect(rules).toEqual(expect.arrayContaining(["document.expiring", "workflow.escalated"]));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zordms/db test notify`
Expected: FAIL — no `alert_rules` table / no migration file.

- [ ] **Step 3: Write the migration**

`packages/db/src/migrations/20260623_0004_notify.ts`:
```ts
import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("alert_rules", (t) => {
    t.increments("id").primary();
    t.string("name", 160).notNullable();
    t.string("trigger", 80).notNullable();        // event name: document.expiring | workflow.escalated | ...
    t.text("params_json").notNullable().defaultTo("{}");
    t.text("channels").notNullable().defaultTo("[]"); // JSON array of channel keys
    t.string("escalation_target", 80);             // RBAC role name (nullable)
    t.string("scope", 160);                        // branch/region scope (nullable)
    t.boolean("enabled").notNullable().defaultTo(true);
    t.string("created_by", 100);
    t.timestamp("created_at").defaultTo(knex.fn.now());
  });

  await knex.schema.createTable("alerts", (t) => {
    t.increments("id").primary();
    t.string("level", 20).notNullable().defaultTo("info"); // info | warning | critical
    t.string("title", 240).notNullable();
    t.text("meta").notNullable().defaultTo("{}");          // JSON
    t.boolean("is_read").notNullable().defaultTo(false);
    t.integer("rule_id").references("id").inTable("alert_rules").onDelete("SET NULL");
    t.string("branch", 120);
    t.timestamp("created_at").defaultTo(knex.fn.now());
  });

  await knex.schema.createTable("notifications", (t) => {
    t.increments("id").primary();
    t.integer("alert_id").references("id").inTable("alerts").onDelete("CASCADE");
    t.integer("user_id");                  // nullable: external recipients (customer) have no user row
    t.string("channel", 30).notNullable(); // email | sms | whatsapp | teams | inapp
    t.string("recipient", 240).notNullable();
    t.string("subject", 240);
    t.text("body");
    t.string("status", 20).notNullable().defaultTo("pending"); // pending | sent | failed
    t.text("error");
    t.timestamp("created_at").defaultTo(knex.fn.now());
    t.timestamp("sent_at");
  });
}

export async function down(knex: Knex): Promise<void> {
  for (const t of ["notifications", "alerts", "alert_rules"]) {
    await knex.schema.dropTableIfExists(t);
  }
}
```

- [ ] **Step 4: Write the seed**

`packages/db/src/seeds/0004_notify_permissions.ts`:
```ts
import type { Knex } from "knex";

const PERMISSIONS: Array<[string, string]> = [
  ["alert:read", "View alerts and notifications"],
  ["alert:manage", "Mark-read / escalate alerts"],
  ["alert_rule:manage", "Create and edit alert rules"],
];

// role name -> permission keys it should additionally hold
const GRANTS: Record<string, string[]> = {
  CDO: ["alert:read", "alert:manage", "alert_rule:manage"],
  Supervisor: ["alert:read", "alert:manage", "alert_rule:manage"],
  Auditor: ["alert:read"],
  Checker: ["alert:read"],
  Maker: ["alert:read"],
};

const SAMPLE_RULES = [
  {
    name: "KYC/ID expiry — 60/30/7/0 day campaign",
    trigger: "document.expiring",
    params_json: JSON.stringify({ tiers: ["T-60", "T-30", "T-07", "T-00"], catalog: "KYC/Identity" }),
    channels: JSON.stringify(["email", "sms", "whatsapp", "inapp"]),
    escalation_target: null as string | null,
    scope: null as string | null,
    enabled: true,
    created_by: "system",
  },
  {
    name: "Workflow SLA breach escalation",
    trigger: "workflow.escalated",
    params_json: JSON.stringify({ sla_hours: 24 }),
    channels: JSON.stringify(["email", "teams", "inapp"]),
    escalation_target: "Supervisor",
    scope: null as string | null,
    enabled: true,
    created_by: "system",
  },
];

export async function seed(knex: Knex): Promise<void> {
  // permissions (idempotent)
  for (const [key, description] of PERMISSIONS) {
    const exists = await knex("permissions").where({ key }).first();
    if (!exists) await knex("permissions").insert({ key, description });
  }
  // grant to roles (idempotent); skip if RBAC tables absent (db-only test contexts)
  if (await knex.schema.hasTable("roles")) {
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
  }
  // sample rules only if empty
  const count = Number((await knex("alert_rules").count<{ c: number }[]>("id as c"))[0].c);
  if (count === 0) {
    for (const rule of SAMPLE_RULES) await knex("alert_rules").insert(rule);
  }
}
```

> This seed coexists with Plan 1's `0001_default_rbac` seed (Knex runs seed files alphabetically; `0001…` before `0004…` guarantees roles exist before grants). The `hasTable("roles")` guard keeps the migration-only test (which does not run the RBAC migration) green; in a real stack both migrations are applied so `roles` exists.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @zordms/db test notify`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/migrations/20260623_0004_notify.ts packages/db/src/seeds/0004_notify_permissions.ts packages/db/src/migrations/notify.test.ts
git commit -m "feat(db): notify schema (alert_rules/alerts/notifications) + permission seed

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Channel adapter interface + FakeAdapter + ChannelRegistry

**Files:**
- Create: `services/notify/src/channels/types.ts`, `services/notify/src/channels/fake.ts`, `services/notify/src/channels/registry.ts`
- Test: `services/notify/src/channels/registry.test.ts`

**Interfaces:**
- `types.ts`:
  - `interface Notification { channel: ChannelKey; recipient: string; subject?: string; body: string; meta?: Record<string, unknown>; }`
  - `type ChannelKey = "email" | "sms" | "whatsapp" | "teams" | "inapp";`
  - `interface DeliveryResult { channel: ChannelKey; recipient: string; status: "sent" | "failed"; error?: string; providerId?: string; }`
  - `interface ChannelAdapter { readonly key: ChannelKey; send(n: Notification): Promise<DeliveryResult>; }`
- `fake.ts`:
  - `class FakeAdapter implements ChannelAdapter` — records every `send` into `this.sent: Notification[]`; returns `status: "sent"` unless constructed with `{ failOn?: (n) => boolean }`.
- `registry.ts`:
  - `class ChannelRegistry { register(a: ChannelAdapter): void; get(key: ChannelKey): ChannelAdapter | undefined; dispatch(channels: ChannelKey[], n: Omit<Notification,"channel">): Promise<DeliveryResult[]>; }` — `dispatch` fans one notification out across the requested channels; unknown channels yield a `failed` result rather than throwing.

- [ ] **Step 1: Write the failing test**

`services/notify/src/channels/registry.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { ChannelRegistry } from "./registry.js";
import { FakeAdapter } from "./fake.js";

describe("ChannelRegistry.dispatch", () => {
  it("routes a notification to every requested channel", async () => {
    const email = new FakeAdapter("email");
    const sms = new FakeAdapter("sms");
    const reg = new ChannelRegistry();
    reg.register(email);
    reg.register(sms);

    const results = await reg.dispatch(["email", "sms"], { recipient: "a@bob.bt", subject: "Hi", body: "Body" });

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.status === "sent")).toBe(true);
    expect(email.sent[0].recipient).toBe("a@bob.bt");
    expect(sms.sent[0].body).toBe("Body");
  });

  it("returns a failed result for an unregistered channel without throwing", async () => {
    const reg = new ChannelRegistry();
    reg.register(new FakeAdapter("email"));
    const results = await reg.dispatch(["email", "whatsapp"], { recipient: "x", body: "b" });
    const wa = results.find((r) => r.channel === "whatsapp")!;
    expect(wa.status).toBe("failed");
    expect(wa.error).toMatch(/no adapter/i);
  });

  it("propagates an adapter-level failure as a failed result", async () => {
    const reg = new ChannelRegistry();
    reg.register(new FakeAdapter("sms", { failOn: () => true }));
    const [r] = await reg.dispatch(["sms"], { recipient: "x", body: "b" });
    expect(r.status).toBe("failed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zordms/notify test channels/registry`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `channels/types.ts`** (replaces the Task 1 placeholder note for types only)

```ts
export type ChannelKey = "email" | "sms" | "whatsapp" | "teams" | "inapp";

export interface Notification {
  channel: ChannelKey;
  recipient: string;
  subject?: string;
  body: string;
  meta?: Record<string, unknown>;
}

export interface DeliveryResult {
  channel: ChannelKey;
  recipient: string;
  status: "sent" | "failed";
  error?: string;
  providerId?: string;
}

export interface ChannelAdapter {
  readonly key: ChannelKey;
  send(n: Notification): Promise<DeliveryResult>;
}
```

- [ ] **Step 4: Write `channels/fake.ts`**

```ts
import type { ChannelAdapter, ChannelKey, DeliveryResult, Notification } from "./types.js";

export class FakeAdapter implements ChannelAdapter {
  readonly key: ChannelKey;
  readonly sent: Notification[] = [];
  private readonly failOn?: (n: Notification) => boolean;

  constructor(key: ChannelKey, opts?: { failOn?: (n: Notification) => boolean }) {
    this.key = key;
    this.failOn = opts?.failOn;
  }

  async send(n: Notification): Promise<DeliveryResult> {
    this.sent.push(n);
    if (this.failOn?.(n)) {
      return { channel: this.key, recipient: n.recipient, status: "failed", error: "fake_failure" };
    }
    return { channel: this.key, recipient: n.recipient, status: "sent", providerId: `fake-${this.sent.length}` };
  }
}
```

- [ ] **Step 5: Write `channels/registry.ts`** (replaces the Task 1 placeholder interface)

```ts
import type { ChannelAdapter, ChannelKey, DeliveryResult, Notification } from "./types.js";

export class ChannelRegistry {
  private readonly adapters = new Map<ChannelKey, ChannelAdapter>();

  register(adapter: ChannelAdapter): void {
    this.adapters.set(adapter.key, adapter);
  }

  get(key: ChannelKey): ChannelAdapter | undefined {
    return this.adapters.get(key);
  }

  async dispatch(channels: ChannelKey[], base: Omit<Notification, "channel">): Promise<DeliveryResult[]> {
    return Promise.all(
      channels.map(async (channel) => {
        const adapter = this.adapters.get(channel);
        if (!adapter) {
          return { channel, recipient: base.recipient, status: "failed" as const, error: `no adapter for channel "${channel}"` };
        }
        try {
          return await adapter.send({ ...base, channel });
        } catch (err) {
          return { channel, recipient: base.recipient, status: "failed" as const, error: (err as Error).message };
        }
      }),
    );
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @zordms/notify test channels/registry`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add services/notify/src/channels/types.ts services/notify/src/channels/fake.ts services/notify/src/channels/registry.ts services/notify/src/channels/registry.test.ts
git commit -m "feat(notify): channel adapter interface + fake adapter + registry dispatch

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Event bus interface + InMemoryBus

**Files:**
- Create: `services/notify/src/bus/types.ts`, `services/notify/src/bus/fake.ts`
- Test: `services/notify/src/bus/fake.test.ts`

**Interfaces:**
- `types.ts`:
  - `interface DomainEvent<T = unknown> { type: string; payload: T; ts?: string; }`
  - `interface EventBus { publish(e: DomainEvent): Promise<void>; subscribe(type: string, handler: (e: DomainEvent) => void | Promise<void>): void; }`
- `fake.ts`:
  - `class InMemoryBus implements EventBus` — synchronous in-process pub/sub; awaits async handlers on `publish`. This is both the test double and the single-box default (Redis Streams is a drop-in later).

- [ ] **Step 1: Write the failing test**

`services/notify/src/bus/fake.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { InMemoryBus } from "./fake.js";

describe("InMemoryBus", () => {
  it("delivers a published event to subscribers of that type", async () => {
    const bus = new InMemoryBus();
    const received: string[] = [];
    bus.subscribe("document.expiring", (e) => { received.push((e.payload as any).docId); });
    await bus.publish({ type: "document.expiring", payload: { docId: "D-1" } });
    expect(received).toEqual(["D-1"]);
  });

  it("does not deliver to subscribers of other types", async () => {
    const bus = new InMemoryBus();
    let hits = 0;
    bus.subscribe("workflow.escalated", () => { hits++; });
    await bus.publish({ type: "document.expiring", payload: {} });
    expect(hits).toBe(0);
  });

  it("awaits async handlers", async () => {
    const bus = new InMemoryBus();
    let done = false;
    bus.subscribe("x", async () => { await Promise.resolve(); done = true; });
    await bus.publish({ type: "x", payload: {} });
    expect(done).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zordms/notify test bus/fake`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `bus/types.ts`** (replaces the Task 1 placeholder)

```ts
export interface DomainEvent<T = unknown> {
  type: string;
  payload: T;
  ts?: string;
}

export interface EventBus {
  publish(e: DomainEvent): Promise<void>;
  subscribe(type: string, handler: (e: DomainEvent) => void | Promise<void>): void;
}
```

- [ ] **Step 4: Write `bus/fake.ts`**

```ts
import type { DomainEvent, EventBus } from "./types.js";

export class InMemoryBus implements EventBus {
  private readonly handlers = new Map<string, Array<(e: DomainEvent) => void | Promise<void>>>();

  subscribe(type: string, handler: (e: DomainEvent) => void | Promise<void>): void {
    const list = this.handlers.get(type) ?? [];
    list.push(handler);
    this.handlers.set(type, list);
  }

  async publish(e: DomainEvent): Promise<void> {
    const event: DomainEvent = { ...e, ts: e.ts ?? new Date().toISOString() };
    const list = this.handlers.get(e.type) ?? [];
    for (const h of list) await h(event);
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @zordms/notify test bus/fake`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add services/notify/src/bus/types.ts services/notify/src/bus/fake.ts services/notify/src/bus/fake.test.ts
git commit -m "feat(notify): event bus interface + in-memory pub/sub implementation

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Email + SMS + WhatsApp + Teams adapters

**Files:**
- Create: `services/notify/src/channels/email.ts`, `services/notify/src/channels/sms.ts`, `services/notify/src/channels/whatsapp.ts`, `services/notify/src/channels/teams.ts`
- Test: `services/notify/src/channels/email.test.ts`, `services/notify/src/channels/sms.test.ts`, `services/notify/src/channels/whatsapp.test.ts`, `services/notify/src/channels/teams.test.ts`

**Interfaces:**
- `EmailAdapter` — ctor `(transport: nodemailer.Transporter, from: string)`; in tests the transport is `nodemailer.createTransport({ jsonTransport: true })`.
- `SmsAdapter` — ctor `(client: TwilioLike | null, from: string)` where `TwilioLike = { messages: { create(opts): Promise<{ sid: string }> } }`; when `client` is `null` (no creds) it returns a `failed` result with `error: "sms_not_configured"` and never throws (stub-safe).
- `WhatsAppAdapter` — ctor `(client: TwilioLike | null, from: string)`; same shape as SMS but prefixes `whatsapp:` on the to/from numbers.
- `TeamsAdapter` — ctor `(webhookUrl: string | null, fetchFn = fetch)`; posts a MessageCard JSON; `null` URL → `failed` `"teams_not_configured"`.

- [ ] **Step 1: Write the failing tests**

`services/notify/src/channels/email.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import nodemailer from "nodemailer";
import { EmailAdapter } from "./email.js";

describe("EmailAdapter", () => {
  it("sends via the injected transport (jsonTransport in test)", async () => {
    const transport = nodemailer.createTransport({ jsonTransport: true });
    const adapter = new EmailAdapter(transport, "dms@bob.bt");
    const res = await adapter.send({ channel: "email", recipient: "rm@bob.bt", subject: "Expiry", body: "CID expires soon" });
    expect(res.status).toBe("sent");
    expect(res.providerId).toBeTruthy();
  });
});
```

`services/notify/src/channels/sms.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { SmsAdapter } from "./sms.js";

describe("SmsAdapter", () => {
  it("sends via the injected twilio-like client", async () => {
    const create = vi.fn().mockResolvedValue({ sid: "SM123" });
    const adapter = new SmsAdapter({ messages: { create } }, "+97517000000");
    const res = await adapter.send({ channel: "sms", recipient: "+97517123456", body: "Expiring" });
    expect(res.status).toBe("sent");
    expect(res.providerId).toBe("SM123");
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ to: "+97517123456", from: "+97517000000" }));
  });

  it("is stub-safe when no client is configured", async () => {
    const adapter = new SmsAdapter(null, "+97517000000");
    const res = await adapter.send({ channel: "sms", recipient: "+97517123456", body: "x" });
    expect(res.status).toBe("failed");
    expect(res.error).toBe("sms_not_configured");
  });
});
```

`services/notify/src/channels/whatsapp.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { WhatsAppAdapter } from "./whatsapp.js";

describe("WhatsAppAdapter", () => {
  it("prefixes whatsapp: on to/from and sends", async () => {
    const create = vi.fn().mockResolvedValue({ sid: "WA9" });
    const adapter = new WhatsAppAdapter({ messages: { create } }, "+97517000000");
    const res = await adapter.send({ channel: "whatsapp", recipient: "+97517123456", body: "hi" });
    expect(res.status).toBe("sent");
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ to: "whatsapp:+97517123456", from: "whatsapp:+97517000000" }));
  });
});
```

`services/notify/src/channels/teams.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { TeamsAdapter } from "./teams.js";

describe("TeamsAdapter", () => {
  it("posts a card to the incoming webhook", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const adapter = new TeamsAdapter("https://outlook.office.com/webhook/abc", fetchFn as any);
    const res = await adapter.send({ channel: "teams", recipient: "compliance-channel", subject: "SLA breach", body: "Workflow escalated" });
    expect(res.status).toBe("sent");
    expect(fetchFn).toHaveBeenCalledWith("https://outlook.office.com/webhook/abc", expect.objectContaining({ method: "POST" }));
  });

  it("fails cleanly when no webhook url is set", async () => {
    const adapter = new TeamsAdapter(null);
    const res = await adapter.send({ channel: "teams", recipient: "c", body: "x" });
    expect(res.status).toBe("failed");
    expect(res.error).toBe("teams_not_configured");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @zordms/notify test channels/email channels/sms channels/whatsapp channels/teams`
Expected: FAIL — adapter modules not found.

- [ ] **Step 3: Write `channels/email.ts`**

```ts
import type { Transporter } from "nodemailer";
import type { ChannelAdapter, ChannelKey, DeliveryResult, Notification } from "./types.js";

export class EmailAdapter implements ChannelAdapter {
  readonly key: ChannelKey = "email";
  constructor(private readonly transport: Transporter, private readonly from: string) {}

  async send(n: Notification): Promise<DeliveryResult> {
    try {
      const info = await this.transport.sendMail({
        from: this.from, to: n.recipient, subject: n.subject ?? "ZorDMS Alert", text: n.body,
      });
      return { channel: this.key, recipient: n.recipient, status: "sent", providerId: (info as { messageId?: string }).messageId ?? "queued" };
    } catch (err) {
      return { channel: this.key, recipient: n.recipient, status: "failed", error: (err as Error).message };
    }
  }
}
```

- [ ] **Step 4: Write `channels/sms.ts`**

```ts
import type { ChannelAdapter, ChannelKey, DeliveryResult, Notification } from "./types.js";

export interface TwilioLike {
  messages: { create(opts: { to: string; from: string; body: string }): Promise<{ sid: string }> };
}

export class SmsAdapter implements ChannelAdapter {
  readonly key: ChannelKey = "sms";
  constructor(private readonly client: TwilioLike | null, private readonly from: string) {}

  async send(n: Notification): Promise<DeliveryResult> {
    if (!this.client) return { channel: this.key, recipient: n.recipient, status: "failed", error: "sms_not_configured" };
    try {
      const msg = await this.client.messages.create({ to: n.recipient, from: this.from, body: n.body });
      return { channel: this.key, recipient: n.recipient, status: "sent", providerId: msg.sid };
    } catch (err) {
      return { channel: this.key, recipient: n.recipient, status: "failed", error: (err as Error).message };
    }
  }
}
```

- [ ] **Step 5: Write `channels/whatsapp.ts`**

```ts
import type { ChannelAdapter, ChannelKey, DeliveryResult, Notification } from "./types.js";
import type { TwilioLike } from "./sms.js";

export class WhatsAppAdapter implements ChannelAdapter {
  readonly key: ChannelKey = "whatsapp";
  constructor(private readonly client: TwilioLike | null, private readonly from: string) {}

  async send(n: Notification): Promise<DeliveryResult> {
    if (!this.client) return { channel: this.key, recipient: n.recipient, status: "failed", error: "whatsapp_not_configured" };
    try {
      const msg = await this.client.messages.create({ to: `whatsapp:${n.recipient}`, from: `whatsapp:${this.from}`, body: n.body });
      return { channel: this.key, recipient: n.recipient, status: "sent", providerId: msg.sid };
    } catch (err) {
      return { channel: this.key, recipient: n.recipient, status: "failed", error: (err as Error).message };
    }
  }
}
```

- [ ] **Step 6: Write `channels/teams.ts`**

```ts
import type { ChannelAdapter, ChannelKey, DeliveryResult, Notification } from "./types.js";

type FetchFn = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number }>;

export class TeamsAdapter implements ChannelAdapter {
  readonly key: ChannelKey = "teams";
  constructor(private readonly webhookUrl: string | null, private readonly fetchFn: FetchFn = fetch as unknown as FetchFn) {}

  async send(n: Notification): Promise<DeliveryResult> {
    if (!this.webhookUrl) return { channel: this.key, recipient: n.recipient, status: "failed", error: "teams_not_configured" };
    const card = {
      "@type": "MessageCard", "@context": "https://schema.org/extensions",
      summary: n.subject ?? "ZorDMS Alert", themeColor: "0b2e6b",
      title: n.subject ?? "ZorDMS Alert", text: n.body,
    };
    try {
      const res = await this.fetchFn(this.webhookUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(card) });
      if (!res.ok) return { channel: this.key, recipient: n.recipient, status: "failed", error: `teams_http_${res.status}` };
      return { channel: this.key, recipient: n.recipient, status: "sent", providerId: "teams-ok" };
    } catch (err) {
      return { channel: this.key, recipient: n.recipient, status: "failed", error: (err as Error).message };
    }
  }
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm --filter @zordms/notify test channels/email channels/sms channels/whatsapp channels/teams`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add services/notify/src/channels/email.ts services/notify/src/channels/sms.ts services/notify/src/channels/whatsapp.ts services/notify/src/channels/teams.ts services/notify/src/channels/email.test.ts services/notify/src/channels/sms.test.ts services/notify/src/channels/whatsapp.test.ts services/notify/src/channels/teams.test.ts
git commit -m "feat(notify): email/sms/whatsapp/teams adapters with injected clients

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: In-App adapter + RealtimeHub + buildRegistry

**Files:**
- Create: `services/notify/src/realtime/hub.ts`, `services/notify/src/channels/inapp.ts`
- Modify: `services/notify/src/channels/registry.ts` (add `buildRegistry` factory)
- Test: `services/notify/src/channels/inapp.test.ts`, `services/notify/src/realtime/hub.test.ts`

**Interfaces:**
- `realtime/hub.ts` — `class RealtimeHub { add(client: SocketLike): void; remove(client: SocketLike): void; broadcast(payload: unknown): void; attach(server: http.Server): void; get size(): number; }` where `SocketLike = { send(data: string): void; readyState?: number; }`. `broadcast` JSON-stringifies once and sends to every client; `attach` wires a `ws` `WebSocketServer` on path `/ws/alerts`.
- `channels/inapp.ts` — `class InAppAdapter implements ChannelAdapter` ctor `(knex: Knex, hub: RealtimeHub)`; `send` is a no-op delivery confirmation at the adapter layer (the row is written by `alertService` — see Task 10) but it broadcasts the notification to connected clients and returns `sent`. (The In-App channel's persistence is the `notifications` row created by the dispatch loop; the adapter's job is the realtime push.)
- `registry.ts` — add `buildRegistry(deps: { knex: Knex; config: AppConfig; hub: RealtimeHub }): ChannelRegistry` that constructs every real adapter from `config` env (nodemailer transport from SMTP env or `jsonTransport` fallback; Twilio client when `TWILIO_*` present else `null`; Teams URL from env) and registers them.

- [ ] **Step 1: Write the failing tests**

`services/notify/src/realtime/hub.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { RealtimeHub } from "./hub.js";

describe("RealtimeHub", () => {
  it("broadcasts a JSON payload to all connected clients", () => {
    const hub = new RealtimeHub();
    const sent: string[] = [];
    const client = { send: (d: string) => sent.push(d), readyState: 1 };
    hub.add(client);
    hub.broadcast({ type: "alert.raised", alert: { id: 1, title: "X" } });
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0]).alert.title).toBe("X");
  });

  it("skips clients that are not open and supports removal", () => {
    const hub = new RealtimeHub();
    const sent: string[] = [];
    const closed = { send: (d: string) => sent.push(d), readyState: 3 };
    hub.add(closed);
    hub.broadcast({ a: 1 });
    expect(sent).toHaveLength(0);
    hub.remove(closed);
    expect(hub.size).toBe(0);
  });
});
```

`services/notify/src/channels/inapp.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { InAppAdapter } from "./inapp.js";
import { RealtimeHub } from "../realtime/hub.js";

describe("InAppAdapter", () => {
  it("broadcasts the notification and reports sent", async () => {
    const hub = new RealtimeHub();
    const sent: string[] = [];
    hub.add({ send: (d: string) => sent.push(d), readyState: 1 });
    const adapter = new InAppAdapter(undefined as any, hub);
    const res = await adapter.send({ channel: "inapp", recipient: "user:42", subject: "Hi", body: "B", meta: { alertId: 7 } });
    expect(res.status).toBe("sent");
    expect(JSON.parse(sent[0]).body).toBe("B");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @zordms/notify test realtime/hub channels/inapp`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `realtime/hub.ts`** (replaces the Task 1 placeholder)

```ts
import type { Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";

export interface SocketLike { send(data: string): void; readyState?: number; }
const OPEN = 1;

export class RealtimeHub {
  private readonly clients = new Set<SocketLike>();

  add(client: SocketLike): void { this.clients.add(client); }
  remove(client: SocketLike): void { this.clients.delete(client); }
  get size(): number { return this.clients.size; }

  broadcast(payload: unknown): void {
    const data = JSON.stringify(payload);
    for (const c of this.clients) {
      if (c.readyState === undefined || c.readyState === OPEN) c.send(data);
    }
  }

  attach(server: Server): void {
    const wss = new WebSocketServer({ server, path: "/ws/alerts" });
    wss.on("connection", (socket: WebSocket) => {
      this.add(socket);
      socket.on("close", () => this.remove(socket));
    });
  }
}
```

- [ ] **Step 4: Write `channels/inapp.ts`**

```ts
import type { Knex } from "knex";
import type { ChannelAdapter, ChannelKey, DeliveryResult, Notification } from "./types.js";
import type { RealtimeHub } from "../realtime/hub.js";

export class InAppAdapter implements ChannelAdapter {
  readonly key: ChannelKey = "inapp";
  constructor(private readonly knex: Knex, private readonly hub: RealtimeHub) {}

  async send(n: Notification): Promise<DeliveryResult> {
    // Persistence of the `notifications` row is handled by alertService's dispatch loop;
    // the in-app channel's job is the realtime push to connected clients.
    this.hub.broadcast({ type: "notification", channel: "inapp", recipient: n.recipient, subject: n.subject, body: n.body, meta: n.meta });
    return { channel: this.key, recipient: n.recipient, status: "sent", providerId: "inapp" };
  }
}
```

- [ ] **Step 5: Add `buildRegistry` to `channels/registry.ts`**

Append to `registry.ts`:
```ts
import type { Knex } from "knex";
import type { AppConfig } from "@zordms/config";
import nodemailer from "nodemailer";
import twilio from "twilio";
import type { RealtimeHub } from "../realtime/hub.js";
import { EmailAdapter } from "./email.js";
import { SmsAdapter } from "./sms.js";
import { WhatsAppAdapter } from "./whatsapp.js";
import { TeamsAdapter } from "./teams.js";
import { InAppAdapter } from "./inapp.js";

export function buildRegistry(deps: { knex: Knex; config: AppConfig; hub: RealtimeHub }): ChannelRegistry {
  const reg = new ChannelRegistry();
  const env = process.env;

  const transport = env.SMTP_HOST
    ? nodemailer.createTransport({ host: env.SMTP_HOST, port: Number(env.SMTP_PORT ?? 587), auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS ?? "" } : undefined })
    : nodemailer.createTransport({ jsonTransport: true });
  reg.register(new EmailAdapter(transport, env.SMTP_FROM ?? "dms@bob.bt"));

  const twilioClient = env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN
    ? twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN)
    : null;
  reg.register(new SmsAdapter(twilioClient as any, env.TWILIO_SMS_FROM ?? ""));
  reg.register(new WhatsAppAdapter(twilioClient as any, env.TWILIO_WA_FROM ?? ""));
  reg.register(new TeamsAdapter(env.TEAMS_WEBHOOK_URL ?? null));
  reg.register(new InAppAdapter(deps.knex, deps.hub));
  return reg;
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @zordms/notify test realtime/hub channels/inapp`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add services/notify/src/realtime/hub.ts services/notify/src/channels/inapp.ts services/notify/src/channels/registry.ts services/notify/src/realtime/hub.test.ts services/notify/src/channels/inapp.test.ts
git commit -m "feat(notify): realtime hub + in-app adapter + buildRegistry env wiring

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Alert-rule engine (pure)

**Files:**
- Create: `services/notify/src/engine/ruleEngine.ts`
- Test: `services/notify/src/engine/ruleEngine.test.ts`

**Interfaces:**
- `interface AlertRule { id: number; name: string; trigger: string; params: Record<string, unknown>; channels: ChannelKey[]; escalationTarget?: string | null; scope?: string | null; enabled: boolean; }`
- `interface RuleDecision { fire: boolean; level: "info" | "warning" | "critical"; channels: ChannelKey[]; recipients: Recipient[]; title: string; reason: string; }`
- `interface Recipient { kind: "role" | "user" | "external"; value: string; }`
- `evaluateRule(rule: AlertRule, event: DomainEvent): RuleDecision` — **pure**. Logic:
  - If `!rule.enabled` or `rule.trigger !== event.type` → `{ fire: false, … reason: "trigger_mismatch" }`.
  - If `scope` is set and the event payload `branch` does not match → `fire: false, reason: "out_of_scope"`.
  - `document.expiring`: level by `daysToExpiry` (≤0 critical, ≤7 critical, ≤30 warning, else info); recipients from event payload (`branchManager`, `relationshipOfficer`, `customerMobile`) as `role`/`external`; title from doc + days.
  - `workflow.escalated`: level `critical`; recipients = the `escalationTarget` role plus any payload `assignees`; title names the workflow.
  - `parseRule(row)` helper converts a DB row (`channels`/`params_json` as JSON text) into an `AlertRule`.

- [ ] **Step 1: Write the failing test**

`services/notify/src/engine/ruleEngine.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { evaluateRule, parseRule, type AlertRule } from "./ruleEngine.js";

const expiryRule: AlertRule = {
  id: 1, name: "expiry", trigger: "document.expiring",
  params: {}, channels: ["email", "sms"], escalationTarget: null, scope: null, enabled: true,
};

describe("evaluateRule", () => {
  it("does not fire when the trigger does not match the event", () => {
    const d = evaluateRule(expiryRule, { type: "workflow.escalated", payload: {} });
    expect(d.fire).toBe(false);
    expect(d.reason).toBe("trigger_mismatch");
  });

  it("fires critical for an expiry within 7 days and collects recipients", () => {
    const d = evaluateRule(expiryRule, {
      type: "document.expiring",
      payload: { docId: "D1", docType: "BT_CID_4G", daysToExpiry: 5, branchManager: "BranchManager", customerMobile: "+97517123456" },
    });
    expect(d.fire).toBe(true);
    expect(d.level).toBe("critical");
    expect(d.channels).toEqual(["email", "sms"]);
    expect(d.recipients).toEqual(expect.arrayContaining([
      { kind: "role", value: "BranchManager" },
      { kind: "external", value: "+97517123456" },
    ]));
  });

  it("fires warning for an expiry 30 days out", () => {
    const d = evaluateRule(expiryRule, { type: "document.expiring", payload: { docId: "D1", daysToExpiry: 30 } });
    expect(d.level).toBe("warning");
  });

  it("respects scope: skips events from other branches", () => {
    const scoped: AlertRule = { ...expiryRule, scope: "Thimphu" };
    const d = evaluateRule(scoped, { type: "document.expiring", payload: { daysToExpiry: 1, branch: "Paro" } });
    expect(d.fire).toBe(false);
    expect(d.reason).toBe("out_of_scope");
  });

  it("escalation rule fires critical to the escalation target role", () => {
    const escRule: AlertRule = { id: 2, name: "esc", trigger: "workflow.escalated", params: {}, channels: ["teams"], escalationTarget: "Supervisor", scope: null, enabled: true };
    const d = evaluateRule(escRule, { type: "workflow.escalated", payload: { workflowId: "WF7", assignees: ["alice"] } });
    expect(d.fire).toBe(true);
    expect(d.level).toBe("critical");
    expect(d.recipients).toEqual(expect.arrayContaining([
      { kind: "role", value: "Supervisor" },
      { kind: "user", value: "alice" },
    ]));
  });

  it("parseRule decodes a DB row into an AlertRule", () => {
    const rule = parseRule({ id: 9, name: "r", trigger: "document.expiring", params_json: '{"a":1}', channels: '["email"]', escalation_target: null, scope: null, enabled: 1 });
    expect(rule.channels).toEqual(["email"]);
    expect(rule.params).toEqual({ a: 1 });
    expect(rule.enabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zordms/notify test engine/ruleEngine`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `engine/ruleEngine.ts`**

```ts
import type { ChannelKey } from "../channels/types.js";
import type { DomainEvent } from "../bus/types.js";

export interface AlertRule {
  id: number;
  name: string;
  trigger: string;
  params: Record<string, unknown>;
  channels: ChannelKey[];
  escalationTarget?: string | null;
  scope?: string | null;
  enabled: boolean;
}

export interface Recipient { kind: "role" | "user" | "external"; value: string; }

export interface RuleDecision {
  fire: boolean;
  level: "info" | "warning" | "critical";
  channels: ChannelKey[];
  recipients: Recipient[];
  title: string;
  reason: string;
}

function noFire(reason: string): RuleDecision {
  return { fire: false, level: "info", channels: [], recipients: [], title: "", reason };
}

export function evaluateRule(rule: AlertRule, event: DomainEvent): RuleDecision {
  if (!rule.enabled) return noFire("rule_disabled");
  if (rule.trigger !== event.type) return noFire("trigger_mismatch");

  const payload = (event.payload ?? {}) as Record<string, any>;
  if (rule.scope && payload.branch && payload.branch !== rule.scope) return noFire("out_of_scope");

  if (event.type === "document.expiring") {
    const days = Number(payload.daysToExpiry ?? Infinity);
    const level: RuleDecision["level"] = days <= 7 ? "critical" : days <= 30 ? "warning" : "info";
    const recipients: Recipient[] = [];
    if (payload.branchManager) recipients.push({ kind: "role", value: String(payload.branchManager) });
    if (payload.relationshipOfficer) recipients.push({ kind: "role", value: String(payload.relationshipOfficer) });
    if (payload.customerMobile) recipients.push({ kind: "external", value: String(payload.customerMobile) });
    const docType = payload.docType ?? "document";
    return {
      fire: true, level, channels: rule.channels, recipients,
      title: `${docType} expiring in ${days} day(s)`,
      reason: "expiry_match",
    };
  }

  if (event.type === "workflow.escalated") {
    const recipients: Recipient[] = [];
    if (rule.escalationTarget) recipients.push({ kind: "role", value: rule.escalationTarget });
    for (const a of (payload.assignees as string[] | undefined) ?? []) recipients.push({ kind: "user", value: a });
    return {
      fire: true, level: "critical", channels: rule.channels, recipients,
      title: `Workflow ${payload.workflowId ?? "?"} escalated`,
      reason: "escalation_match",
    };
  }

  // generic match: fire info-level with no extra recipients
  return { fire: true, level: "info", channels: rule.channels, recipients: [], title: `Event ${event.type}`, reason: "generic_match" };
}

export function parseRule(row: {
  id: number; name: string; trigger: string; params_json: string; channels: string;
  escalation_target: string | null; scope: string | null; enabled: number | boolean;
}): AlertRule {
  return {
    id: row.id, name: row.name, trigger: row.trigger,
    params: JSON.parse(row.params_json || "{}"),
    channels: JSON.parse(row.channels || "[]") as ChannelKey[],
    escalationTarget: row.escalation_target, scope: row.scope,
    enabled: Boolean(row.enabled),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @zordms/notify test engine/ruleEngine`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add services/notify/src/engine/ruleEngine.ts services/notify/src/engine/ruleEngine.test.ts
git commit -m "feat(notify): pure alert-rule evaluation engine + DB row parser

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Expiry alert tiers (IDP §4.3) — pure milestone computation

**Files:**
- Create: `services/notify/src/engine/expiryTiers.ts`
- Test: `services/notify/src/engine/expiryTiers.test.ts`

**Interfaces:**
- The IDP §4.3 channel/recipient matrix is encoded as a constant `EXPIRY_TIERS`:
  - T-60 → 60 days, `["email"]`, recipients `["BranchManager","RelationshipOfficer"]`, covers `["BT_PASSPORT","BT_CID_4G"]`.
  - T-30 → 30 days, `["email","sms"]`, recipients `["RelationshipOfficer","Customer"]`.
  - T-07 → 7 days, `["email","sms","whatsapp"]`, recipients `["BranchManager","RelationshipOfficer","Customer","Compliance"]`.
  - T-00 → 0 days, `["email","whatsapp"]`, recipients `["BranchHead","ITDMSAdmin"]`.
- `interface ExpiryMilestone { tier: "T-60"|"T-30"|"T-07"|"T-00"; fireDate: string; daysBefore: number; channels: ChannelKey[]; recipients: string[]; }`
- `computeExpiryMilestones(expiryDate: string, today?: string): ExpiryMilestone[]` — **pure**. For an ISO `expiryDate`, returns the four milestones with `fireDate = expiryDate - daysBefore` (ISO date). Past milestones (fireDate < today) are excluded. Result is sorted by `fireDate` ascending.

- [ ] **Step 1: Write the failing test**

`services/notify/src/engine/expiryTiers.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { computeExpiryMilestones, EXPIRY_TIERS } from "./expiryTiers.js";

describe("computeExpiryMilestones", () => {
  it("produces the four IDP §4.3 milestones with correct fire dates", () => {
    // expiry 2026-12-31; today well before T-60
    const ms = computeExpiryMilestones("2026-12-31", "2026-01-01");
    expect(ms.map((m) => m.tier)).toEqual(["T-60", "T-30", "T-07", "T-00"]);
    const t60 = ms.find((m) => m.tier === "T-60")!;
    expect(t60.fireDate).toBe("2026-11-01"); // 60 days before 2026-12-31
    expect(t60.channels).toEqual(["email"]);
    const t00 = ms.find((m) => m.tier === "T-00")!;
    expect(t00.fireDate).toBe("2026-12-31");
    expect(t00.channels).toEqual(["email", "whatsapp"]);
  });

  it("encodes the exact channel matrix from IDP 4.3", () => {
    expect(EXPIRY_TIERS.find((t) => t.tier === "T-30")!.channels).toEqual(["email", "sms"]);
    expect(EXPIRY_TIERS.find((t) => t.tier === "T-07")!.channels).toEqual(["email", "sms", "whatsapp"]);
    expect(EXPIRY_TIERS.find((t) => t.tier === "T-07")!.recipients).toContain("Compliance");
  });

  it("excludes milestones whose fire date is already in the past", () => {
    // today is between T-30 and T-07 of a 2026-12-31 expiry
    const ms = computeExpiryMilestones("2026-12-31", "2026-12-28");
    expect(ms.map((m) => m.tier)).toEqual(["T-07", "T-00"]);
  });

  it("sorts milestones ascending by fire date", () => {
    const ms = computeExpiryMilestones("2026-12-31", "2026-01-01");
    const dates = ms.map((m) => m.fireDate);
    expect([...dates].sort()).toEqual(dates);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zordms/notify test engine/expiryTiers`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `engine/expiryTiers.ts`**

```ts
import type { ChannelKey } from "../channels/types.js";

export type ExpiryTier = "T-60" | "T-30" | "T-07" | "T-00";

export interface TierSpec {
  tier: ExpiryTier;
  daysBefore: number;
  channels: ChannelKey[];
  recipients: string[];
}

// Exact matrix from IDP design §4.3 (expiry alert tiers).
export const EXPIRY_TIERS: TierSpec[] = [
  { tier: "T-60", daysBefore: 60, channels: ["email"], recipients: ["BranchManager", "RelationshipOfficer"] },
  { tier: "T-30", daysBefore: 30, channels: ["email", "sms"], recipients: ["RelationshipOfficer", "Customer"] },
  { tier: "T-07", daysBefore: 7, channels: ["email", "sms", "whatsapp"], recipients: ["BranchManager", "RelationshipOfficer", "Customer", "Compliance"] },
  { tier: "T-00", daysBefore: 0, channels: ["email", "whatsapp"], recipients: ["BranchHead", "ITDMSAdmin"] },
];

export interface ExpiryMilestone {
  tier: ExpiryTier;
  fireDate: string;   // ISO yyyy-mm-dd
  daysBefore: number;
  channels: ChannelKey[];
  recipients: string[];
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function shiftDays(iso: string, minusDays: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - minusDays);
  return isoDate(d);
}

export function computeExpiryMilestones(expiryDate: string, today: string = isoDate(new Date())): ExpiryMilestone[] {
  return EXPIRY_TIERS
    .map((t) => ({
      tier: t.tier,
      daysBefore: t.daysBefore,
      channels: t.channels,
      recipients: t.recipients,
      fireDate: shiftDays(expiryDate, t.daysBefore),
    }))
    .filter((m) => m.fireDate >= today)
    .sort((a, b) => (a.fireDate < b.fireDate ? -1 : a.fireDate > b.fireDate ? 1 : 0));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @zordms/notify test engine/expiryTiers`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add services/notify/src/engine/expiryTiers.ts services/notify/src/engine/expiryTiers.test.ts
git commit -m "feat(notify): expiry tier milestone computation (IDP 4.3 T-60/30/07/00)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: alertService.raiseAlert — persist + dispatch + broadcast + emit

**Files:**
- Create: `services/notify/src/services/escalation.ts`, `services/notify/src/services/alertService.ts`
- Test: `services/notify/src/services/alertService.test.ts`

**Interfaces:**
- `escalation.ts` — `resolveEscalationRecipients(recipients: Recipient[], deps: { knex: Knex }): Promise<Array<{ channel: "email"|"sms"; address: string; userId?: number }>>`. For `kind:"role"` it queries `users` joined to `user_roles`/`roles` where role name matches and returns each member's email/mobile; for `kind:"user"` it looks up by username; for `kind:"external"` it returns the literal value as an SMS/WhatsApp address. (Roles map to RBAC role names — the single source of truth from Plan 1.)
- `alertService.ts` — `raiseAlert(deps: AlertDeps, input: { decision: RuleDecision; ruleId?: number; branch?: string; meta?: Record<string,unknown> }): Promise<{ alertId: number; results: DeliveryResult[] }>`. Steps: insert an `alerts` row (`level`, `title`, `meta`, `rule_id`, `branch`); resolve recipients; for each recipient × each channel, call `registry.dispatch` and insert a `notifications` row with the resulting status; `hub.broadcast({ type: "alert.raised", alert })`; `bus.publish({ type: "alert.raised", payload: alert })`. Returns the alert id + aggregated delivery results.
  - `AlertDeps = { knex: Knex; registry: ChannelRegistry; hub: RealtimeHub; bus: EventBus }`.

- [ ] **Step 1: Write the failing test**

`services/notify/src/services/alertService.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import knexLib from "knex";
import { buildKnexConfig } from "@zordms/db";
import { ChannelRegistry } from "../channels/registry.js";
import { FakeAdapter } from "../channels/fake.js";
import { RealtimeHub } from "../realtime/hub.js";
import { InMemoryBus } from "../bus/fake.js";
import { raiseAlert } from "./alertService.js";

const knex = knexLib(buildKnexConfig({
  client: "sqlite3", host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "",
}));

beforeAll(async () => { await knex.migrate.latest(); await knex.seed.run(); });
afterAll(async () => { await knex.destroy(); });

describe("raiseAlert", () => {
  it("persists an alert, dispatches notifications, broadcasts and emits alert.raised", async () => {
    const email = new FakeAdapter("email");
    const sms = new FakeAdapter("sms");
    const registry = new ChannelRegistry();
    registry.register(email); registry.register(sms);

    const hub = new RealtimeHub();
    const broadcasts: string[] = [];
    hub.add({ send: (d: string) => broadcasts.push(d), readyState: 1 });

    const bus = new InMemoryBus();
    const emitted: string[] = [];
    bus.subscribe("alert.raised", (e) => { emitted.push((e.payload as any).title); });

    const out = await raiseAlert(
      { knex, registry, hub, bus },
      {
        decision: {
          fire: true, level: "critical", channels: ["email", "sms"],
          recipients: [{ kind: "external", value: "+97517123456" }],
          title: "CID expiring in 5 day(s)", reason: "expiry_match",
        },
        branch: "Thimphu",
        meta: { docId: "D1" },
      },
    );

    expect(out.alertId).toBeGreaterThan(0);
    const alert = await knex("alerts").where({ id: out.alertId }).first();
    expect(alert.level).toBe("critical");
    expect(alert.title).toBe("CID expiring in 5 day(s)");

    const notifs = await knex("notifications").where({ alert_id: out.alertId });
    expect(notifs.length).toBe(2); // email + sms for the one external recipient
    expect(notifs.every((n: any) => n.status === "sent")).toBe(true);

    expect(email.sent[0].recipient).toBe("+97517123456");
    expect(broadcasts.some((b) => JSON.parse(b).type === "alert.raised")).toBe(true);
    expect(emitted).toContain("CID expiring in 5 day(s)");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zordms/notify test services/alertService`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `services/escalation.ts`**

```ts
import type { Knex } from "knex";
import type { Recipient } from "../engine/ruleEngine.js";

export interface ResolvedRecipient { channel: "email" | "sms"; address: string; userId?: number; }

export async function resolveEscalationRecipients(recipients: Recipient[], deps: { knex: Knex }): Promise<ResolvedRecipient[]> {
  const out: ResolvedRecipient[] = [];
  for (const r of recipients) {
    if (r.kind === "external") {
      out.push({ channel: "sms", address: r.value });
      continue;
    }
    if (r.kind === "user") {
      const u = await deps.knex("users").where({ username: r.value }).first();
      if (u?.email) out.push({ channel: "email", address: u.email, userId: u.id });
      continue;
    }
    // role: every active member of the RBAC role
    const members = await deps.knex("users as u")
      .join("user_roles as ur", "ur.user_id", "u.id")
      .join("roles as ro", "ro.id", "ur.role_id")
      .where("ro.name", r.value)
      .andWhere("u.status", "Active")
      .select("u.id as id", "u.email as email");
    for (const m of members) {
      if (m.email) out.push({ channel: "email", address: m.email, userId: m.id });
    }
  }
  return out;
}
```

- [ ] **Step 4: Write `services/alertService.ts`**

```ts
import type { Knex } from "knex";
import type { ChannelRegistry } from "../channels/registry.js";
import type { DeliveryResult } from "../channels/types.js";
import type { RealtimeHub } from "../realtime/hub.js";
import type { EventBus } from "../bus/types.js";
import type { RuleDecision } from "../engine/ruleEngine.js";

export interface AlertDeps { knex: Knex; registry: ChannelRegistry; hub: RealtimeHub; bus: EventBus; }

export interface RaiseInput {
  decision: RuleDecision;
  ruleId?: number;
  branch?: string;
  meta?: Record<string, unknown>;
}

export async function raiseAlert(deps: AlertDeps, input: RaiseInput): Promise<{ alertId: number; results: DeliveryResult[] }> {
  const { knex, registry, hub, bus } = deps;
  const { decision } = input;

  const [alertId] = await knex("alerts").insert({
    level: decision.level,
    title: decision.title,
    meta: JSON.stringify(input.meta ?? {}),
    rule_id: input.ruleId ?? null,
    branch: input.branch ?? null,
  }).returning("id");
  const id = typeof alertId === "object" ? (alertId as { id: number }).id : (alertId as number);

  const results: DeliveryResult[] = [];
  for (const recipient of decision.recipients) {
    const delivered = await registry.dispatch(decision.channels, { recipient: recipient.value, subject: decision.title, body: decision.title, meta: input.meta });
    for (const d of delivered) {
      results.push(d);
      await knex("notifications").insert({
        alert_id: id,
        user_id: recipient.kind === "user" ? null : null,
        channel: d.channel,
        recipient: d.recipient,
        subject: decision.title,
        body: decision.title,
        status: d.status,
        error: d.error ?? null,
        sent_at: d.status === "sent" ? knex.fn.now() : null,
      });
    }
  }

  const alert = await knex("alerts").where({ id }).first();
  hub.broadcast({ type: "alert.raised", alert });
  await bus.publish({ type: "alert.raised", payload: { ...alert, alertId: id, title: decision.title, level: decision.level } });

  return { alertId: id, results };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @zordms/notify test services/alertService`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/notify/src/services/escalation.ts services/notify/src/services/alertService.ts services/notify/src/services/alertService.test.ts
git commit -m "feat(notify): raiseAlert persists/dispatches/broadcasts/emits + escalation resolver

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Expiry-scan scheduled job → writes the alert schedule

**Files:**
- Create: `services/notify/src/jobs/expiryScan.ts`
- Test: `services/notify/src/jobs/expiryScan.test.ts`

**Interfaces:**
- `runExpiryScan(deps: { knex: Knex; bus: EventBus; today?: string }, docs: ExpiringDoc[]): Promise<{ scheduled: number }>` where
  `ExpiringDoc = { docId: string; docType: string; expiryDate: string; branch?: string }`. For each doc it calls `computeExpiryMilestones(expiryDate, today)`; for every milestone whose `fireDate === today` it publishes a `document.expiring` event (which the rule consumer turns into an alert) AND upserts an `alert_schedule` bookkeeping row to avoid duplicate sends. Returns the count of milestones whose fireDate is today (i.e. fired now). Milestones in the future are recorded but not fired.
- A tiny `alert_schedule` table (`doc_id`, `tier`, `fire_date`, `fired`) is created **inside this task's migration addition** (extend the Task 2 migration is avoided — instead create a follow-on migration `20260623_0005_alert_schedule.ts`).

- [ ] **Step 1: Add the schedule migration**

`packages/db/src/migrations/20260623_0005_alert_schedule.ts`:
```ts
import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("alert_schedule", (t) => {
    t.increments("id").primary();
    t.string("doc_id", 80).notNullable();
    t.string("tier", 10).notNullable();      // T-60 | T-30 | T-07 | T-00
    t.date("fire_date").notNullable();
    t.boolean("fired").notNullable().defaultTo(false);
    t.timestamp("created_at").defaultTo(knex.fn.now());
    t.unique(["doc_id", "tier"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("alert_schedule");
}
```

- [ ] **Step 2: Write the failing test**

`services/notify/src/jobs/expiryScan.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import knexLib from "knex";
import { buildKnexConfig } from "@zordms/db";
import { InMemoryBus } from "../bus/fake.js";
import { runExpiryScan } from "./expiryScan.js";

const knex = knexLib(buildKnexConfig({
  client: "sqlite3", host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "",
}));

beforeAll(async () => { await knex.migrate.latest(); });
afterAll(async () => { await knex.destroy(); });

describe("runExpiryScan", () => {
  it("publishes document.expiring for milestones due today and records the schedule", async () => {
    const bus = new InMemoryBus();
    const fired: number[] = [];
    bus.subscribe("document.expiring", (e) => { fired.push(Number((e.payload as any).daysToExpiry)); });

    // today is exactly 7 days before expiry -> the T-07 milestone fires
    const out = await runExpiryScan(
      { knex, bus, today: "2026-12-24" },
      [{ docId: "D1", docType: "BT_CID_4G", expiryDate: "2026-12-31", branch: "Thimphu" }],
    );

    expect(out.scheduled).toBe(1);
    expect(fired).toContain(7);
    const rows = await knex("alert_schedule").where({ doc_id: "D1" });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.some((r: any) => r.tier === "T-07" && r.fired)).toBe(true);
  });

  it("is idempotent: re-running the same day does not double-fire", async () => {
    const bus = new InMemoryBus();
    let count = 0;
    bus.subscribe("document.expiring", () => { count++; });
    await runExpiryScan({ knex, bus, today: "2026-12-24" }, [{ docId: "D1", docType: "BT_CID_4G", expiryDate: "2026-12-31" }]);
    expect(count).toBe(0); // already fired in the previous test
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @zordms/notify test jobs/expiryScan`
Expected: FAIL — module not found (and migration not yet picked up).

- [ ] **Step 4: Write `jobs/expiryScan.ts`**

```ts
import type { Knex } from "knex";
import type { EventBus } from "../bus/types.js";
import { computeExpiryMilestones } from "../engine/expiryTiers.js";

export interface ExpiringDoc { docId: string; docType: string; expiryDate: string; branch?: string; }

export async function runExpiryScan(
  deps: { knex: Knex; bus: EventBus; today?: string },
  docs: ExpiringDoc[],
): Promise<{ scheduled: number }> {
  const { knex, bus } = deps;
  const today = deps.today ?? new Date().toISOString().slice(0, 10);
  let scheduled = 0;

  for (const doc of docs) {
    const milestones = computeExpiryMilestones(doc.expiryDate, today);
    for (const m of milestones) {
      const existing = await knex("alert_schedule").where({ doc_id: doc.docId, tier: m.tier }).first();
      if (existing?.fired) continue;

      const dueToday = m.fireDate === today;
      if (!existing) {
        await knex("alert_schedule").insert({ doc_id: doc.docId, tier: m.tier, fire_date: m.fireDate, fired: dueToday });
      } else if (dueToday) {
        await knex("alert_schedule").where({ id: existing.id }).update({ fired: true });
      }

      if (dueToday) {
        scheduled += 1;
        await bus.publish({
          type: "document.expiring",
          payload: { docId: doc.docId, docType: doc.docType, daysToExpiry: m.daysBefore, branch: doc.branch, tier: m.tier },
        });
      }
    }
  }
  return { scheduled };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @zordms/notify test jobs/expiryScan`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/migrations/20260623_0005_alert_schedule.ts services/notify/src/jobs/expiryScan.ts services/notify/src/jobs/expiryScan.test.ts
git commit -m "feat(notify): expiry-scan job writes the tiered alert schedule + fires due milestones

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Alert routes — list (RBAC) + mark-read + escalate

**Files:**
- Create: `services/notify/src/routes/alerts.ts`
- Modify: `services/notify/src/app.ts` (mount `/alerts`)
- Test: `services/notify/src/routes/alerts.test.ts`

**Interfaces:**
- All under `requireAuth` (from `@zordms/auth`, identical to Plan 1's Gateway middleware — copy the two middleware files into `services/notify/src/middleware/` OR import from a shared location; this plan copies them to keep the service self-contained, mirroring Plan 1 Task 11).
- `GET /alerts` (`alert:read`) query `?level=&unread=true` → `{ alerts: Alert[] }`, newest first, optionally filtered.
- `POST /alerts/:id/read` (`alert:read`) → marks `is_read = true`.
- `POST /alerts/:id/escalate` (`alert:manage`) body `{ target: string }` → resolves the role's members via `resolveEscalationRecipients`, dispatches an `email` notification per member, writes an audit-style `notifications` rows, returns `{ escalatedTo: number }`.

- [ ] **Step 1: Copy the auth middleware into the notify service**

Create `services/notify/src/middleware/requireAuth.ts` and `services/notify/src/middleware/requirePermission.ts` with the **exact contents** from Plan 1 Task 11 (they read `req.app.locals.deps.{knex,config}`, call `verifyToken` + `resolveUserAuthz`, set `req.authUser`). No changes needed because `NotifyDeps` also exposes `knex` and `config`.

- [ ] **Step 2: Write the failing test**

`services/notify/src/routes/alerts.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import knexLib from "knex";
import { buildKnexConfig } from "@zordms/db";
import { loadConfig } from "@zordms/config";
import { signToken } from "@zordms/auth";
import { ChannelRegistry } from "../channels/registry.js";
import { FakeAdapter } from "../channels/fake.js";
import { RealtimeHub } from "../realtime/hub.js";
import { InMemoryBus } from "../bus/fake.js";
import { createApp } from "../app.js";

const knex = knexLib(buildKnexConfig({
  client: "sqlite3", host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "",
}));
const registry = new ChannelRegistry();
registry.register(new FakeAdapter("email"));
const app = createApp({ knex, config: loadConfig({ JWT_SECRET: "t" } as NodeJS.ProcessEnv), registry, bus: new InMemoryBus(), hub: new RealtimeHub() });

let adminToken = "";
beforeAll(async () => {
  await knex.migrate.latest(); await knex.seed.run();
  const admin = await knex("users").where({ username: "admin" }).first();
  adminToken = signToken({ sub: admin.id, username: "admin" }, "t");
  await knex("alerts").insert([
    { level: "critical", title: "Expiry A", meta: "{}", is_read: false },
    { level: "info", title: "Info B", meta: "{}", is_read: false },
  ]);
});
afterAll(async () => { await knex.destroy(); });

describe("alert routes", () => {
  it("401 without a token", async () => {
    expect((await request(app).get("/alerts")).status).toBe(401);
  });

  it("lists alerts for an authorised user (admin has alert:read via CDO)", async () => {
    const res = await request(app).get("/alerts").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.alerts.length).toBeGreaterThanOrEqual(2);
  });

  it("filters by level", async () => {
    const res = await request(app).get("/alerts?level=critical").set("Authorization", `Bearer ${adminToken}`);
    expect(res.body.alerts.every((a: any) => a.level === "critical")).toBe(true);
  });

  it("marks an alert read", async () => {
    const a = await knex("alerts").where({ title: "Info B" }).first();
    const res = await request(app).post(`/alerts/${a.id}/read`).set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const after = await knex("alerts").where({ id: a.id }).first();
    expect(Boolean(after.is_read)).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @zordms/notify test routes/alerts`
Expected: FAIL — `/alerts` 404.

- [ ] **Step 4: Write `routes/alerts.ts`**

```ts
import { Router } from "express";
import type { Knex } from "knex";
import { requireAuth } from "../middleware/requireAuth.js";
import { requirePermission } from "../middleware/requirePermission.js";
import { resolveEscalationRecipients } from "../services/escalation.js";

export function alertsRouter(): Router {
  const r = Router();
  r.use(requireAuth);

  r.get("/", requirePermission("alert:read"), async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    let q = knex("alerts").orderBy("id", "desc");
    if (req.query.level) q = q.where({ level: String(req.query.level) });
    if (req.query.unread === "true") q = q.where({ is_read: false });
    res.json({ alerts: await q });
  });

  r.post("/:id/read", requirePermission("alert:read"), async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    const n = await knex("alerts").where({ id: req.params.id }).update({ is_read: true });
    if (!n) { res.status(404).json({ error: "not_found" }); return; }
    res.json({ ok: true });
  });

  r.post("/:id/escalate", requirePermission("alert:manage"), async (req, res) => {
    const { knex, registry } = req.app.locals.deps as any;
    const alert = await knex("alerts").where({ id: req.params.id }).first();
    if (!alert) { res.status(404).json({ error: "not_found" }); return; }
    const target = String(req.body.target ?? "");
    const recipients = await resolveEscalationRecipients([{ kind: "role", value: target }], { knex });
    for (const rcpt of recipients) {
      const [d] = await registry.dispatch(["email"], { recipient: rcpt.address, subject: `Escalated: ${alert.title}`, body: alert.title });
      await knex("notifications").insert({
        alert_id: alert.id, user_id: rcpt.userId ?? null, channel: "email",
        recipient: rcpt.address, subject: `Escalated: ${alert.title}`, body: alert.title,
        status: d.status, error: d.error ?? null,
      });
    }
    res.json({ escalatedTo: recipients.length });
  });

  return r;
}
```

- [ ] **Step 5: Mount in `app.ts`**

```ts
import { alertsRouter } from "./routes/alerts.js";
// inside createApp, after /health:
app.use("/alerts", alertsRouter());
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @zordms/notify test routes/alerts`
Expected: PASS (4 tests).

- [ ] **Step 7: Commit**

```bash
git add services/notify/src/middleware services/notify/src/routes/alerts.ts services/notify/src/app.ts services/notify/src/routes/alerts.test.ts
git commit -m "feat(notify): alert list/mark-read/escalate routes (RBAC-gated)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Alert-rule CRUD routes + SSE stream + bus consumer wiring

**Files:**
- Create: `services/notify/src/routes/rules.ts`, `services/notify/src/routes/stream.ts`, `services/notify/src/realtime/sse.ts`, `services/notify/src/services/consumer.ts`
- Modify: `services/notify/src/app.ts` (mount `/rules`, `/alerts/stream`), `services/notify/src/server.ts` (subscribe the consumer)
- Test: `services/notify/src/routes/rules.test.ts`, `services/notify/src/services/consumer.test.ts`

**Interfaces:**
- `routes/rules.ts` (under `requireAuth`):
  - `GET /rules` (`alert:read`) → `{ rules }` (parsed).
  - `POST /rules` (`alert_rule:manage`) body `{ name, trigger, params, channels, escalationTarget?, scope? }` → 201 created.
  - `PATCH /rules/:id` (`alert_rule:manage`) → partial update (incl. `enabled`).
- `realtime/sse.ts` — `sseHandler(hub: RealtimeHub)` returns an Express handler that sets `text/event-stream` headers, registers an `SocketLike` that writes `data: …\n\n` frames on `hub.broadcast`, and cleans up on `close`. Provides the SSE fallback to WebSocket.
- `routes/stream.ts` — `GET /alerts/stream` → `sseHandler(hub)`.
- `services/consumer.ts` — `attachConsumer(deps: { knex; registry; hub; bus }): void` subscribes to every distinct rule `trigger` (and the wildcard `document.expiring`/`workflow.escalated`); on each event it loads enabled rules for that trigger, runs `evaluateRule`, and calls `raiseAlert` for those that fire. This is the glue that turns bus events into alerts.

- [ ] **Step 1: Write the failing tests**

`services/notify/src/routes/rules.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import knexLib from "knex";
import { buildKnexConfig } from "@zordms/db";
import { loadConfig } from "@zordms/config";
import { signToken } from "@zordms/auth";
import { ChannelRegistry } from "../channels/registry.js";
import { FakeAdapter } from "../channels/fake.js";
import { RealtimeHub } from "../realtime/hub.js";
import { InMemoryBus } from "../bus/fake.js";
import { createApp } from "../app.js";

const knex = knexLib(buildKnexConfig({
  client: "sqlite3", host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "",
}));
const registry = new ChannelRegistry(); registry.register(new FakeAdapter("email"));
const app = createApp({ knex, config: loadConfig({ JWT_SECRET: "t" } as NodeJS.ProcessEnv), registry, bus: new InMemoryBus(), hub: new RealtimeHub() });
let adminToken = "";

beforeAll(async () => {
  await knex.migrate.latest(); await knex.seed.run();
  const admin = await knex("users").where({ username: "admin" }).first();
  adminToken = signToken({ sub: admin.id, username: "admin" }, "t");
});
afterAll(async () => { await knex.destroy(); });

describe("alert-rule CRUD", () => {
  it("creates a rule and lists it back parsed", async () => {
    const res = await request(app).post("/rules").set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Loan SLA", trigger: "workflow.escalated", params: { sla: 24 }, channels: ["email", "teams"], escalationTarget: "Supervisor" });
    expect(res.status).toBe(201);
    const list = await request(app).get("/rules").set("Authorization", `Bearer ${adminToken}`);
    const created = list.body.rules.find((r: any) => r.name === "Loan SLA");
    expect(created.channels).toEqual(["email", "teams"]);
    expect(created.escalationTarget).toBe("Supervisor");
  });

  it("toggles a rule with PATCH", async () => {
    const rule = await knex("alert_rules").where({ name: "Loan SLA" }).first();
    const res = await request(app).patch(`/rules/${rule.id}`).set("Authorization", `Bearer ${adminToken}`).send({ enabled: false });
    expect(res.status).toBe(200);
    const after = await knex("alert_rules").where({ id: rule.id }).first();
    expect(Boolean(after.enabled)).toBe(false);
  });
});
```

`services/notify/src/services/consumer.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import knexLib from "knex";
import { buildKnexConfig } from "@zordms/db";
import { ChannelRegistry } from "../channels/registry.js";
import { FakeAdapter } from "../channels/fake.js";
import { RealtimeHub } from "../realtime/hub.js";
import { InMemoryBus } from "../bus/fake.js";
import { attachConsumer } from "./consumer.js";

const knex = knexLib(buildKnexConfig({
  client: "sqlite3", host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "",
}));

beforeAll(async () => { await knex.migrate.latest(); await knex.seed.run(); });
afterAll(async () => { await knex.destroy(); });

describe("attachConsumer", () => {
  it("turns a document.expiring event into a persisted alert via the seeded rule", async () => {
    const email = new FakeAdapter("email");
    const registry = new ChannelRegistry(); registry.register(email);
    registry.register(new FakeAdapter("sms")); registry.register(new FakeAdapter("whatsapp")); registry.register(new FakeAdapter("inapp"));
    const bus = new InMemoryBus();
    const hub = new RealtimeHub();

    attachConsumer({ knex, registry, hub, bus });
    await bus.publish({ type: "document.expiring", payload: { docId: "D9", docType: "BT_CID_4G", daysToExpiry: 5, branchManager: "Supervisor" } });

    const alert = await knex("alerts").where({ title: "BT_CID_4G expiring in 5 day(s)" }).first();
    expect(alert).toBeTruthy();
    expect(alert.level).toBe("critical");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @zordms/notify test routes/rules services/consumer`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write `routes/rules.ts`**

```ts
import { Router } from "express";
import type { Knex } from "knex";
import { requireAuth } from "../middleware/requireAuth.js";
import { requirePermission } from "../middleware/requirePermission.js";
import { parseRule } from "../engine/ruleEngine.js";

export function rulesRouter(): Router {
  const r = Router();
  r.use(requireAuth);

  r.get("/", requirePermission("alert:read"), async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    const rows = await knex("alert_rules").orderBy("id", "desc");
    res.json({ rules: rows.map(parseRule) });
  });

  r.post("/", requirePermission("alert_rule:manage"), async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    const b = req.body as { name: string; trigger: string; params?: object; channels?: string[]; escalationTarget?: string; scope?: string };
    const [id] = await knex("alert_rules").insert({
      name: b.name, trigger: b.trigger,
      params_json: JSON.stringify(b.params ?? {}),
      channels: JSON.stringify(b.channels ?? []),
      escalation_target: b.escalationTarget ?? null, scope: b.scope ?? null,
      enabled: true, created_by: req.authUser?.username ?? "system",
    }).returning("id");
    res.status(201).json({ id: typeof id === "object" ? (id as any).id : id });
  });

  r.patch("/:id", requirePermission("alert_rule:manage"), async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    const patch: Record<string, unknown> = {};
    const b = req.body as Record<string, unknown>;
    if (b.name !== undefined) patch.name = b.name;
    if (b.trigger !== undefined) patch.trigger = b.trigger;
    if (b.params !== undefined) patch.params_json = JSON.stringify(b.params);
    if (b.channels !== undefined) patch.channels = JSON.stringify(b.channels);
    if (b.escalationTarget !== undefined) patch.escalation_target = b.escalationTarget;
    if (b.scope !== undefined) patch.scope = b.scope;
    if (b.enabled !== undefined) patch.enabled = b.enabled;
    const n = await knex("alert_rules").where({ id: req.params.id }).update(patch);
    if (!n) { res.status(404).json({ error: "not_found" }); return; }
    res.json({ ok: true });
  });

  return r;
}
```

- [ ] **Step 4: Write `realtime/sse.ts` and `routes/stream.ts`**

`realtime/sse.ts`:
```ts
import type { Request, Response } from "express";
import type { RealtimeHub, SocketLike } from "./hub.js";

export function sseHandler(hub: RealtimeHub) {
  return (req: Request, res: Response): void => {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
    res.write(": connected\n\n");
    const client: SocketLike = { send: (d: string) => res.write(`data: ${d}\n\n`), readyState: 1 };
    hub.add(client);
    req.on("close", () => hub.remove(client));
  };
}
```

`routes/stream.ts`:
```ts
import { Router } from "express";
import type { RealtimeHub } from "../realtime/hub.js";
import { sseHandler } from "../realtime/sse.js";

export function streamRouter(hub: RealtimeHub): Router {
  const r = Router();
  r.get("/stream", sseHandler(hub));
  return r;
}
```

- [ ] **Step 5: Write `services/consumer.ts`**

```ts
import type { AlertDeps } from "./alertService.js";
import { raiseAlert } from "./alertService.js";
import { evaluateRule, parseRule } from "../engine/ruleEngine.js";
import type { DomainEvent } from "../bus/types.js";

const TRIGGERS = ["document.expiring", "workflow.escalated"];

export function attachConsumer(deps: AlertDeps): void {
  const handler = async (event: DomainEvent): Promise<void> => {
    const rows = await deps.knex("alert_rules").where({ trigger: event.type, enabled: true });
    for (const row of rows) {
      const rule = parseRule(row);
      const decision = evaluateRule(rule, event);
      if (decision.fire) {
        await raiseAlert(deps, {
          decision, ruleId: rule.id,
          branch: (event.payload as any)?.branch,
          meta: event.payload as Record<string, unknown>,
        });
      }
    }
  };
  for (const t of TRIGGERS) deps.bus.subscribe(t, handler);
}
```

- [ ] **Step 6: Mount routes in `app.ts` and wire the consumer in `server.ts`**

In `app.ts`:
```ts
import { rulesRouter } from "./routes/rules.js";
import { streamRouter } from "./routes/stream.js";
// inside createApp:
app.use("/rules", rulesRouter());
app.use("/alerts", streamRouter(deps.hub)); // exposes GET /alerts/stream alongside /alerts
```
> Mount `streamRouter` after `alertsRouter` so `/alerts/stream` resolves before `/alerts/:id`. (Express matches in mount order; `/alerts/:id/read` is a POST and `/alerts/stream` is a GET, so there is no collision, but keep both under `/alerts`.)

In `server.ts` (add after `const registry = …`):
```ts
import { attachConsumer } from "./services/consumer.js";
// ...
attachConsumer({ knex, registry, hub, bus });
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm --filter @zordms/notify test routes/rules services/consumer`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add services/notify/src/routes/rules.ts services/notify/src/routes/stream.ts services/notify/src/realtime/sse.ts services/notify/src/services/consumer.ts services/notify/src/app.ts services/notify/src/server.ts services/notify/src/routes/rules.test.ts services/notify/src/services/consumer.test.ts
git commit -m "feat(notify): rule CRUD + SSE stream + bus->alert consumer glue

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: React — Alerts & Event Management screen + Configure Alert Rule form

**Files:**
- Create: `apps/web/src/api/notify.ts`, `apps/web/src/components/AlertRuleForm.tsx`, `apps/web/src/pages/Alerts.tsx`
- Modify: `apps/web/src/router.tsx` (add `/alerts` route)
- Test: `apps/web/src/pages/Alerts.test.tsx`, `apps/web/src/components/AlertRuleForm.test.tsx`

**Interfaces:**
- `api/notify.ts` — `listAlerts(level?)`, `markRead(id)`, `listRules()`, `createRule(rule)` using the shared `api` client from Plan 1 Task 15 (`apps/web/src/api/client.ts`).
- `AlertRuleForm({ onSubmit })` — fields: name; **trigger** select (`document.expiring`, `workflow.escalated`, `document.captured`, `workflow.approved`); **channel checkboxes** (Email/SMS/WhatsApp/Teams/In-App); **escalation target** select (RBAC roles). Calls `onSubmit({ name, trigger, channels, escalationTarget })`.
- `Alerts()` — severity-grouped feed (critical → warning → info) fetched from `GET /alerts`, each with a "Mark read" button (`POST /alerts/:id/read`); a side panel renders `AlertRuleForm` (visible with `alert_rule:manage`) wired to `POST /rules`.

- [ ] **Step 1: Write the failing AlertRuleForm test**

`apps/web/src/components/AlertRuleForm.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AlertRuleForm } from "./AlertRuleForm.js";

describe("AlertRuleForm", () => {
  it("collects name, trigger, channels and escalation target", () => {
    const onSubmit = vi.fn();
    render(<AlertRuleForm onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText(/Rule name/i), { target: { value: "Passport expiry" } });
    fireEvent.change(screen.getByLabelText(/Trigger/i), { target: { value: "document.expiring" } });
    fireEvent.click(screen.getByLabelText(/Email/i));
    fireEvent.click(screen.getByLabelText(/WhatsApp/i));
    fireEvent.change(screen.getByLabelText(/Escalation target/i), { target: { value: "Supervisor" } });
    fireEvent.click(screen.getByRole("button", { name: /Save rule/i }));
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      name: "Passport expiry", trigger: "document.expiring",
      channels: expect.arrayContaining(["email", "whatsapp"]), escalationTarget: "Supervisor",
    }));
  });
});
```

- [ ] **Step 2: Write the failing Alerts test**

`apps/web/src/pages/Alerts.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { Alerts } from "./Alerts.js";

vi.mock("../auth/AuthContext.js", () => ({
  useAuth: () => ({ user: { id: 1, username: "admin", roles: ["CDO"], permissions: ["alert:read", "alert:manage", "alert_rule:manage"] }, logout: () => {} }),
}));

describe("Alerts screen", () => {
  it("renders a severity-grouped feed from the API", async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (String(url).startsWith("/alerts")) {
        return Promise.resolve({ ok: true, json: async () => ({ alerts: [
          { id: 1, level: "critical", title: "CID expiring", is_read: false },
          { id: 2, level: "info", title: "Captured", is_read: false },
        ] }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ rules: [] }) });
    }) as any;
    render(<Alerts />);
    await waitFor(() => expect(screen.getByText("CID expiring")).toBeInTheDocument());
    expect(screen.getByText(/Critical/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @zordms/web test AlertRuleForm Alerts`
Expected: FAIL — modules not found.

- [ ] **Step 4: Write `api/notify.ts`**

```ts
import { api } from "./client.js";

export interface AlertRow { id: number; level: "info" | "warning" | "critical"; title: string; is_read: boolean; created_at?: string; }
export interface RuleInput { name: string; trigger: string; channels: string[]; escalationTarget?: string; params?: Record<string, unknown>; scope?: string; }

export const notify = {
  listAlerts: (level?: string) => api.get(`/alerts${level ? `?level=${level}` : ""}`) as Promise<{ alerts: AlertRow[] }>,
  markRead: (id: number) => api.post(`/alerts/${id}/read`),
  listRules: () => api.get("/rules"),
  createRule: (rule: RuleInput) => api.post("/rules", rule),
};
```

- [ ] **Step 5: Write `components/AlertRuleForm.tsx`**

```tsx
import { useState, type FormEvent } from "react";
import type { RuleInput } from "../api/notify.js";

const TRIGGERS = ["document.expiring", "workflow.escalated", "document.captured", "workflow.approved"];
const CHANNELS: Array<{ key: string; label: string }> = [
  { key: "email", label: "Email" }, { key: "sms", label: "SMS" }, { key: "whatsapp", label: "WhatsApp" },
  { key: "teams", label: "MS Teams" }, { key: "inapp", label: "In-App" },
];
const ROLES = ["", "Supervisor", "CDO", "Checker", "Auditor", "Compliance"];

export function AlertRuleForm({ onSubmit }: { onSubmit: (rule: RuleInput) => void }) {
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState(TRIGGERS[0]);
  const [channels, setChannels] = useState<string[]>([]);
  const [escalationTarget, setEscalationTarget] = useState("");

  function toggle(key: string) {
    setChannels((c) => (c.includes(key) ? c.filter((x) => x !== key) : [...c, key]));
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    onSubmit({ name, trigger, channels, escalationTarget: escalationTarget || undefined });
  }

  return (
    <form onSubmit={submit} style={{ maxWidth: 360 }}>
      <h3>Configure Alert Rule</h3>
      <label className="label" htmlFor="rule-name">Rule name</label>
      <input id="rule-name" className="field" value={name} onChange={(e) => setName(e.target.value)} />

      <label className="label" htmlFor="rule-trigger" style={{ marginTop: 12, display: "block" }}>Trigger</label>
      <select id="rule-trigger" className="field" value={trigger} onChange={(e) => setTrigger(e.target.value)}>
        {TRIGGERS.map((t) => <option key={t} value={t}>{t}</option>)}
      </select>

      <fieldset style={{ marginTop: 12, border: "1px solid var(--line)", borderRadius: 8, padding: 12 }}>
        <legend className="label">Channels</legend>
        {CHANNELS.map((c) => (
          <label key={c.key} style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
            <input type="checkbox" aria-label={c.label} checked={channels.includes(c.key)} onChange={() => toggle(c.key)} />
            {c.label}
          </label>
        ))}
      </fieldset>

      <label className="label" htmlFor="rule-esc" style={{ marginTop: 12, display: "block" }}>Escalation target</label>
      <select id="rule-esc" className="field" value={escalationTarget} onChange={(e) => setEscalationTarget(e.target.value)}>
        {ROLES.map((r) => <option key={r || "none"} value={r}>{r || "— none —"}</option>)}
      </select>

      <button className="btn-primary" style={{ marginTop: 16 }}>Save rule</button>
    </form>
  );
}
```

- [ ] **Step 6: Write `pages/Alerts.tsx`**

```tsx
import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext.js";
import { notify, type AlertRow, type RuleInput } from "../api/notify.js";
import { AlertRuleForm } from "../components/AlertRuleForm.js";

const ORDER: Array<AlertRow["level"]> = ["critical", "warning", "info"];
const LABEL: Record<AlertRow["level"], string> = { critical: "Critical", warning: "Warning", info: "Info" };
const COLOR: Record<AlertRow["level"], string> = { critical: "#b91c1c", warning: "#b45309", info: "#0b2e6b" };

export function Alerts() {
  const { user } = useAuth();
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const canManageRules = user?.permissions.includes("alert_rule:manage");

  async function refresh() { setAlerts((await notify.listAlerts()).alerts); }
  useEffect(() => { refresh(); }, []);

  async function read(id: number) { await notify.markRead(id); await refresh(); }
  async function createRule(rule: RuleInput) { await notify.createRule(rule); }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 32, padding: 32 }}>
      <div>
        <h2>Alerts & Event Management</h2>
        {ORDER.map((level) => {
          const group = alerts.filter((a) => a.level === level);
          if (group.length === 0) return null;
          return (
            <section key={level} style={{ marginTop: 16 }}>
              <h3 style={{ color: COLOR[level] }}>{LABEL[level]} ({group.length})</h3>
              {group.map((a) => (
                <div key={a.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: 12, borderLeft: `4px solid ${COLOR[level]}`, background: "#fff", border: "1px solid var(--line)", borderRadius: 8, marginTop: 8, opacity: a.is_read ? 0.6 : 1 }}>
                  <span>{a.title}</span>
                  {!a.is_read && <button className="btn-primary" style={{ width: "auto", padding: "6px 12px" }} onClick={() => read(a.id)}>Mark read</button>}
                </div>
              ))}
            </section>
          );
        })}
      </div>
      <aside>{canManageRules && <AlertRuleForm onSubmit={createRule} />}</aside>
    </div>
  );
}
```

- [ ] **Step 7: Add the route in `router.tsx`**

```tsx
import { Alerts } from "./pages/Alerts.js";
// add inside the routes array:
{ path: "/alerts", element: <ProtectedRoute permission="alert:read"><Alerts /></ProtectedRoute> },
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `pnpm --filter @zordms/web test AlertRuleForm Alerts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/api/notify.ts apps/web/src/components/AlertRuleForm.tsx apps/web/src/pages/Alerts.tsx apps/web/src/router.tsx apps/web/src/components/AlertRuleForm.test.tsx apps/web/src/pages/Alerts.test.tsx
git commit -m "feat(web): alerts & event management screen + configure alert rule form

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: End-to-end smoke + CI note + runbook

**Files:**
- Create: `services/notify/src/e2e.test.ts`
- Create: `docs/RUNBOOK-notify.md`
- Modify: `.github/workflows/ci.yml` (notify is covered by the existing `pnpm test` job; add an env note for SMTP/Twilio/Teams secrets being optional)

**Interfaces:**
- Produces: a full-stack notify smoke test driving an event through the consumer to a persisted alert and an HTTP read of `/alerts`; a runbook documenting env vars and channel configuration; a CI note that channel secrets are optional (adapters are stub-safe).

- [ ] **Step 1: Write the end-to-end smoke test**

`services/notify/src/e2e.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import knexLib from "knex";
import { buildKnexConfig } from "@zordms/db";
import { loadConfig } from "@zordms/config";
import { signToken } from "@zordms/auth";
import { ChannelRegistry } from "./channels/registry.js";
import { FakeAdapter } from "./channels/fake.js";
import { RealtimeHub } from "./realtime/hub.js";
import { InMemoryBus } from "./bus/fake.js";
import { attachConsumer } from "./services/consumer.js";
import { runExpiryScan } from "./jobs/expiryScan.js";
import { createApp } from "./app.js";

const knex = knexLib(buildKnexConfig({
  client: "sqlite3", host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "",
}));
const registry = new ChannelRegistry();
for (const c of ["email", "sms", "whatsapp", "teams", "inapp"] as const) registry.register(new FakeAdapter(c));
const hub = new RealtimeHub();
const bus = new InMemoryBus();
const app = createApp({ knex, config: loadConfig({ JWT_SECRET: "t" } as NodeJS.ProcessEnv), registry, bus, hub });

let adminToken = "";
beforeAll(async () => {
  await knex.migrate.latest(); await knex.seed.run();
  attachConsumer({ knex, registry, hub, bus });
  const admin = await knex("users").where({ username: "admin" }).first();
  adminToken = signToken({ sub: admin.id, username: "admin" }, "t");
});
afterAll(async () => { await knex.destroy(); });

describe("notify end-to-end", () => {
  it("expiry scan -> document.expiring -> rule fires -> alert visible over HTTP", async () => {
    // today == T-07 of a 2026-12-31 expiry
    const scan = await runExpiryScan({ knex, bus, today: "2026-12-24" }, [
      { docId: "CID-100", docType: "BT_CID_4G", expiryDate: "2026-12-31", branch: "Thimphu" },
    ]);
    expect(scan.scheduled).toBe(1);

    const res = await request(app).get("/alerts?level=critical").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.alerts.some((a: any) => a.title.includes("BT_CID_4G"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the smoke test to verify it passes**

Run: `pnpm --filter @zordms/notify test e2e`
Expected: PASS (the seeded `document.expiring` rule from Task 2 turns the scan event into a critical alert).

- [ ] **Step 3: Write the runbook**

`docs/RUNBOOK-notify.md`:
```markdown
# ZorDMS Notify — Run & Verify

## Env vars (all channel secrets optional; adapters are stub-safe)
- `NOTIFY_PORT` (default 4003)
- Email (nodemailer): `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`
  (no SMTP_HOST → jsonTransport, useful for dev/air-gapped staging)
- SMS / WhatsApp (Twilio): `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_SMS_FROM`, `TWILIO_WA_FROM`
  (missing creds → adapter returns failed "..._not_configured", never throws)
- MS Teams: `TEAMS_WEBHOOK_URL`

## Run locally
1. Foundation must be migrated/seeded (Plan 1) plus notify migrations:
   `node packages/db/dist/cli.js migrate && node packages/db/dist/cli.js seed`
2. `pnpm --filter @zordms/notify dev`   # notify on :4003, WS on /ws/alerts
3. Realtime: connect a WS client to `ws://localhost:4003/ws/alerts`, or SSE to `GET /alerts/stream`.

## Expiry campaign
Schedule `runExpiryScan` daily (cron/BullMQ). It publishes `document.expiring` for
T-60/T-30/T-07/T-00 milestones due today (IDP §4.3) and records `alert_schedule` to prevent
duplicate sends.

## Tests
`pnpm --filter @zordms/notify test` runs all suites against in-memory SQLite with FakeAdapters
(no real network I/O).
```

- [ ] **Step 4: Add the CI note**

In `.github/workflows/ci.yml`, under the `unit` job (which already runs `pnpm test` across the workspace, including `@zordms/notify`), add a comment documenting that channel secrets are not required for CI:
```yaml
      # notify channel secrets (SMTP_*, TWILIO_*, TEAMS_WEBHOOK_URL) are intentionally unset in CI:
      # adapters are stub-safe and tests use injected FakeAdapters / jsonTransport.
```

- [ ] **Step 5: Run the full service suite**

Run: `pnpm --filter @zordms/notify test && pnpm --filter @zordms/db test`
Expected: all notify + db suites PASS.

- [ ] **Step 6: Commit**

```bash
git add services/notify/src/e2e.test.ts docs/RUNBOOK-notify.md .github/workflows/ci.yml
git commit -m "test(notify): end-to-end expiry->alert smoke + runbook + CI note

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage (Plan 4 portion):**
- `services/notify` scaffold + `createApp` factory + health → Task 1. ✓
- Migration `alert_rules` / `alerts` / `notifications` (+ `alert_schedule`) via Knex schema-builder → Tasks 2, 10. ✓
- Channel adapter interface + fake adapter + registry; multi-channel dispatch routing tested → Task 3. ✓
- Email (nodemailer jsonTransport in test), SMS (Twilio, stub-safe), WhatsApp, Teams webhook, In-App (DB row via dispatch loop + WS broadcast) — each tested with injected client/mocks → Tasks 5, 6. ✓
- Alert-rule engine: pure `evaluateRule(rule, event)` → fire?/channels/recipients/level, fully unit-tested → Task 7. ✓
- Expiry tiers (IDP §4.3): exact T-60/T-30/T-07/T-00 channel+recipient matrix; pure `computeExpiryMilestones`; scheduled job writes the alert schedule → Tasks 8, 10. ✓
- Escalation routing to named RBAC roles; mark-read endpoint; list alerts (RBAC-gated) → Tasks 9, 11. ✓
- Realtime: WebSocket server (`/ws/alerts`) + broadcast on `alert.raised`; SSE fallback (`/alerts/stream`) → Tasks 6, 9, 12. ✓
- React Alerts & Event Management screen: severity feed + Configure Alert Rule form (trigger list + channel checkboxes + escalation target) → Task 13. ✓
- New permissions seeded (`alert:read`, `alert:manage`, `alert_rule:manage`); CI note → Tasks 2, 14. ✓
- Event bus consumes `document.expiring` / `workflow.escalated`, produces `alert.raised` → Tasks 4, 9, 12. ✓

**Reuse check:** `@zordms/config` (loadConfig), `@zordms/db` (buildKnexConfig + migrations/seeds dir), `@zordms/auth` (signToken/verifyToken/resolveUserAuthz/can + requireAuth/requirePermission middleware copied verbatim from Plan 1 Task 11), `@zordms/types` (AuthUser) are consumed unchanged. No new DB factory, no new RBAC engine. ✓

**Interface-driven / no-network check:** every channel goes through `ChannelAdapter`; tests register `FakeAdapter`s or inject mock Twilio/`fetch`/`jsonTransport`. No test performs real network I/O. Twilio/Teams adapters are stub-safe when creds are absent. ✓

**Pure-function check:** `evaluateRule` and `computeExpiryMilestones` take plain inputs and return plain data with no I/O; exhaustively unit-tested (trigger mismatch, scope, all expiry bands, escalation, parse). ✓

**Type consistency:** `ChannelKey`/`Notification`/`DeliveryResult` (Task 3) used unchanged in Tasks 5, 6, 9. `RuleDecision`/`Recipient`/`AlertRule` (Task 7) used in Tasks 9, 12. `EventBus`/`DomainEvent` (Task 4) used in Tasks 9, 10, 12. `AlertDeps` (Task 9) reused by the consumer (Task 12) and e2e (Task 14). `NotifyDeps` (Task 1) is the single deps shape threaded through every route. ✓

**Placeholder scan:** no TBD/TODO; every code step contains complete code; every test step has real assertions. The only forward-references (Task 1 placeholder interfaces for `ChannelRegistry`/`EventBus`/`RealtimeHub`) are explicitly replaced in Tasks 3/4/6 and called out in-line. ✓

---

## Notes for later plans / integration

- **Producers of consumed events:** Core DMS (Plan 2) emits `document.expiring` from the Auto-Catalog expiry-field population (IDP §4.2/§4.3); Workflow (Plan 3) emits `workflow.escalated` on SLA breach. Until those land, the `runExpiryScan` job (driven by Core's expiry index) is the primary `document.expiring` source.
- **Event bus swap:** `InMemoryBus` is the single-box default and the test double; swap to a `RedisStreamsBus implements EventBus` (Plan 6 / infra) with zero changes to the consumer or `raiseAlert`.
- **Escalation authority:** `resolveEscalationRecipients` reads RBAC role membership directly from the shared DB. If notify is deployed without DB co-location, switch it to call the Gateway `/authz`-adjacent membership API (Plan 1 Task 14 pattern) — the function signature already isolates this.
- **Gateway proxy:** the architecture doc has the gateway proxy `/ws`; expose notify's `/ws/alerts` and `/alerts/stream` through the gateway BFF in the gateway plan.
- **BullMQ scheduling:** wrap `runExpiryScan` in a daily BullMQ repeatable job (cross-cutting §6) reading the Core DMS expiry index; the function is already pure-shell over the pure `computeExpiryMilestones`.
