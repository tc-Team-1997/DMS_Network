# Workflow & Cases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the ZorDMS Workflow & Cases service (`services/workflow`) — maker-checker approval workflows with a BPMN-style template builder, confidence gates (≥0.90), SLA countdown + escalation, and Case Management (KYC/Loan/Account/AML). Workflow authority is **never** evaluated locally: every act (approve/reject/escalate/hold) resolves actor authority through the Gateway's `POST /authz/check` — the single source of RBAC truth (Plan 1, Task 14). The React app gains a Workflow Engine screen and a Case Management screen.

**Architecture:** A new Node/Express service `services/workflow` that reuses the shared packages from Plan 1 (`@zordms/config`, `@zordms/db`, `@zordms/auth`, `@zordms/types`). It owns its own schema namespace (workflows, templates, steps, cases, case_documents) via Knex schema-builder migrations (dialect-neutral, `increments()` only). The engine compiles a template's `steps_json` into ordered steps, each declaring the RBAC permissions required to act on it. When an actor attempts a maker-checker action, the engine asks the **Gateway authority client** (an injectable HTTP client that POSTs to `/authz/check`) whether the actor holds those permissions — making authority fully RBAC-driven and mockable in tests. Every transition writes an audit row and emits an event on the event bus (`workflow.created`, `workflow.approved`, `workflow.rejected`, `workflow.escalated`). SLA escalation runs as a background job over a pure overdue-detection function.

**Tech Stack:** Node 20+, TypeScript 5 (strict, ESM), Express 4, Knex 3 (pg / oracledb / sqlite3), Vitest + Supertest (against in-memory sqlite), React 18 + Vite 5 + react-router-dom 6, @testing-library/react. SLA job via `node-cron` (BullMQ-compatible job function kept pure so it can be driven by either).

## Global Constraints

- **RBAC is the single source of authority** — the workflow engine resolves who may act by calling the Gateway `POST /authz/check`. It does **not** keep a parallel ACL. A workflow step declares `required_permissions`; the engine asks the gateway whether the actor qualifies. The authority client is dependency-injected so tests mock `fetch`.
- **Permissions used:** `workflow:act`, `document:approve`, `document:reject` (seeded in Plan 1 already include `workflow:act`, `document:approve`, `document:reject`; this plan adds `workflow:escalate`, `workflow:hold`, `case:create`, `case:read`, `case:manage`).
- **Event bus** emits `workflow.created`, `workflow.approved`, `workflow.rejected`, `workflow.escalated` (and `case.created`). The bus client is injectable; tests use an in-memory recorder.
- **Confidence gate** — a workflow step may carry a `min_confidence` (default `0.90`); a document below the gate cannot auto-advance and is forced to manual maker-checker review.
- **DB switchable via env** — `DB_CLIENT=pg|oracledb` (Knex). No SQLite-isms in migrations (`increments()` only). SQLite is the test-only backend.
- **Service factory** — `createApp({ knex, config })` is a pure Express factory (no `listen`), mirroring the Gateway in Plan 1, so Supertest can mount it with a sqlite knex.
- **All code fully functional** — no stubbed authority, no fake transitions. The only test doubles are the injected HTTP authority client (mocked `fetch`) and the in-memory event recorder.
- **TypeScript everywhere**, ESM modules (`"type": "module"`), strict mode.
- **Package/service names** under the `@zordms/` scope (`@zordms/workflow`).
- **Conventional commits**; commit after every passing step. End commit messages with the Co-Authored-By trailer used by this repo.

---

## File Structure

```
services/
  workflow/
    package.json
    tsconfig.json
    src/
      app.ts                       # createApp({knex,config}) factory
      server.ts                    # listen() + migrate
      authority.ts                 # Gateway /authz/check HTTP client
      events.ts                    # injectable event-bus client (+ in-memory recorder)
      audit.ts                     # writeAudit helper (workflow schema)
      engine/
        compileTemplate.ts         # steps_json -> ordered StepDef[] (+ confidence gate)
        transitions.ts             # approve/reject/escalate/hold pure transition logic
        sla.ts                     # pure findOverdueSteps()
      routes/
        workflows.ts               # CRUD + instantiate-from-template + act
        cases.ts                   # case CRUD + attach docs + drive workflow + metrics
      jobs/
        slaWorker.ts               # node-cron job: detect overdue -> escalate
packages/
  db/
    src/migrations/20260623_0003_workflow_cases.ts
    src/seeds/0003_workflow_permissions.ts
apps/
  web/
    src/api/workflow.ts            # typed calls to the workflow service
    src/pages/WorkflowEngine.tsx   # active workflows + visual builder + act buttons
    src/pages/CaseManagement.tsx   # cases list + create + attach docs
    src/components/WorkflowBuilder.tsx  # visual step-chain representation
```

---

## Task 1: Workflow service scaffold + app factory + health

**Files:**
- Create: `services/workflow/package.json`, `services/workflow/tsconfig.json`, `services/workflow/src/app.ts`, `services/workflow/src/server.ts`
- Test: `services/workflow/src/app.test.ts`

**Interfaces:**
- Consumes: `AppConfig` from `@zordms/config`; a `Knex` instance; the future authority client + event bus (added as optional deps now, wired later).
- Produces: `createApp(deps: { knex: Knex; config: AppConfig; authority?: AuthorityClient; events?: EventBus }): Express` — pure factory (no `listen`). `GET /health` → `{ status: "ok", service: "workflow" }`.

- [ ] **Step 1: Create `services/workflow/package.json`**

```json
{
  "name": "@zordms/workflow",
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
    "node-cron": "^3.0.3",
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
    "@types/node-cron": "^3.0.11",
    "knex": "^3.1.0",
    "sqlite3": "^5.1.7"
  }
}
```

- [ ] **Step 2: Create `services/workflow/tsconfig.json`**

```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

- [ ] **Step 3: Write the failing test**

`services/workflow/src/app.test.ts`:
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

afterAll(async () => { await knex.destroy(); });

describe("workflow health", () => {
  it("GET /health returns ok for the workflow service", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.service).toBe("workflow");
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter @zordms/workflow test`
Expected: FAIL — `./app.js` not found.

- [ ] **Step 5: Write `app.ts`**

```ts
import express, { type Express } from "express";
import cors from "cors";
import type { Knex } from "knex";
import type { AppConfig } from "@zordms/config";
import type { AuthorityClient } from "./authority.js";
import type { EventBus } from "./events.js";

export interface AppDeps {
  knex: Knex;
  config: AppConfig;
  authority?: AuthorityClient;
  events?: EventBus;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.locals.deps = deps;

  app.get("/health", (_req, res) => res.json({ status: "ok", service: "workflow" }));
  return app;
}
```

- [ ] **Step 6: Write `server.ts`**

```ts
import { createApp } from "./app.js";
import { getKnex } from "@zordms/db";
import { loadConfig } from "@zordms/config";
import { createAuthorityClient } from "./authority.js";
import { createEventBus } from "./events.js";

const config = loadConfig();
const knex = getKnex();
await knex.migrate.latest();
const gatewayUrl = process.env.GATEWAY_URL ?? "http://localhost:4000";
const app = createApp({
  knex,
  config,
  authority: createAuthorityClient({ gatewayUrl }),
  events: createEventBus(),
});
const port = Number(process.env.WORKFLOW_PORT ?? 4002);
app.listen(port, () => console.log(`ZorDMS workflow on :${port}`));
```

(Note: `authority.ts` and `events.ts` are created in Tasks 3 and 5; the imports compile once those files exist. Until then, `server.ts` is not exercised by tests — the app factory test only needs `app.ts`. Build the service after Task 5.)

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm --filter @zordms/workflow test`
Expected: PASS (health). The `server.ts` imports resolve after Tasks 3 and 5; if a build is run before then, temporarily stub the two imports or implement Tasks 3 and 5 first.

- [ ] **Step 8: Commit**

```bash
git add services/workflow/package.json services/workflow/tsconfig.json services/workflow/src/app.ts services/workflow/src/server.ts services/workflow/src/app.test.ts
git commit -m "feat(workflow): express app factory + health route"
```

---

## Task 2: Workflow & Cases schema migration

**Files:**
- Create: `packages/db/src/migrations/20260623_0003_workflow_cases.ts`
- Test: `packages/db/src/migrations/workflow_cases.test.ts`

**Interfaces:**
- Produces tables: `workflow_templates`, `workflows`, `workflow_steps`, `cases`, `case_documents`, `workflow_audit`.
- `workflows`: `ref_code` (unique), `title`, `doc_id`, `template_id`, `stage`, `priority`, `status`, `sla_due_at`, `assigned_to`.
- `workflow_templates`: `name`, `doc_type`, `steps_json` (text), `active`.
- `workflow_steps`: `workflow_id`, `seq`, `name`, `required_permissions` (text/JSON), `min_confidence`, `status`, `actor_id`, `acted_at`, `sla_minutes`, `due_at`.
- `cases`: `case_ref`, `case_type` (KYC/Loan/Account/AML), `title`, `status`, `assigned_to`, `due_at`, `workflow_id`, `resolution`.
- `case_documents`: `case_id`, `doc_id`, `label`.

- [ ] **Step 1: Write the failing test (runs the migration on in-memory sqlite)**

`packages/db/src/migrations/workflow_cases.test.ts`:
```ts
import { describe, it, expect, afterAll } from "vitest";
import knexLib from "knex";
import { buildKnexConfig } from "../knexConfig.js";

const knex = knexLib(buildKnexConfig({
  client: "sqlite3", host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "",
}));

afterAll(async () => { await knex.destroy(); });

describe("workflow_cases migration", () => {
  it("creates all workflow + case tables", async () => {
    await knex.migrate.latest();
    for (const t of ["workflow_templates", "workflows", "workflow_steps", "cases", "case_documents", "workflow_audit"]) {
      expect(await knex.schema.hasTable(t)).toBe(true);
    }
  });

  it("enforces a unique ref_code on workflows", async () => {
    const tpl = await knex("workflow_templates").insert({
      name: "KYC Approval", doc_type: "BT_CID_4G", steps_json: "[]", active: true,
    }).returning("id");
    const tplId = typeof tpl[0] === "object" ? (tpl[0] as any).id : tpl[0];
    await knex("workflows").insert({ ref_code: "WF-1", title: "t", template_id: tplId, stage: "intake", priority: "Normal", status: "Active" });
    await expect(
      knex("workflows").insert({ ref_code: "WF-1", title: "dup", template_id: tplId, stage: "intake", priority: "Normal", status: "Active" }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zordms/db test workflow_cases`
Expected: FAIL — migration file does not exist, tables absent.

- [ ] **Step 3: Write the migration**

`packages/db/src/migrations/20260623_0003_workflow_cases.ts`:
```ts
import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("workflow_templates", (t) => {
    t.increments("id").primary();
    t.string("name", 160).notNullable();
    t.string("doc_type", 120);
    t.text("steps_json").notNullable().defaultTo("[]"); // ordered step defs
    t.boolean("active").notNullable().defaultTo(true);
    t.timestamp("created_at").defaultTo(knex.fn.now());
  });

  await knex.schema.createTable("workflows", (t) => {
    t.increments("id").primary();
    t.string("ref_code", 60).notNullable().unique();
    t.string("title", 240).notNullable();
    t.string("doc_id", 80);
    t.integer("template_id").references("id").inTable("workflow_templates").onDelete("SET NULL");
    t.string("stage", 80).notNullable().defaultTo("intake");
    t.string("priority", 20).notNullable().defaultTo("Normal"); // Low | Normal | High | Urgent
    t.string("status", 20).notNullable().defaultTo("Active");   // Active | Approved | Rejected | OnHold | Escalated
    t.timestamp("sla_due_at");
    t.string("assigned_to", 100);
    t.string("created_by", 100);
    t.timestamp("created_at").defaultTo(knex.fn.now());
  });

  await knex.schema.createTable("workflow_steps", (t) => {
    t.increments("id").primary();
    t.integer("workflow_id").notNullable().references("id").inTable("workflows").onDelete("CASCADE");
    t.integer("seq").notNullable();
    t.string("name", 160).notNullable();
    t.text("required_permissions").notNullable().defaultTo("[]"); // JSON array of permission keys
    t.float("min_confidence").notNullable().defaultTo(0.9);
    t.string("status", 20).notNullable().defaultTo("Pending");    // Pending | Approved | Rejected | Skipped
    t.integer("actor_id");
    t.timestamp("acted_at");
    t.integer("sla_minutes");
    t.timestamp("due_at");
  });

  await knex.schema.createTable("cases", (t) => {
    t.increments("id").primary();
    t.string("case_ref", 60).notNullable().unique();
    t.string("case_type", 30).notNullable(); // KYC | Loan | Account | AML
    t.string("title", 240).notNullable();
    t.string("status", 20).notNullable().defaultTo("Open"); // Open | InReview | Resolved | Rejected
    t.string("assigned_to", 100);
    t.timestamp("due_at");
    t.integer("workflow_id").references("id").inTable("workflows").onDelete("SET NULL");
    t.string("resolution", 240);
    t.string("created_by", 100);
    t.timestamp("created_at").defaultTo(knex.fn.now());
    t.timestamp("resolved_at");
  });

  await knex.schema.createTable("case_documents", (t) => {
    t.increments("id").primary();
    t.integer("case_id").notNullable().references("id").inTable("cases").onDelete("CASCADE");
    t.string("doc_id", 80).notNullable();
    t.string("label", 160);
    t.timestamp("attached_at").defaultTo(knex.fn.now());
  });

  await knex.schema.createTable("workflow_audit", (t) => {
    t.increments("id").primary();
    t.integer("actor_id");
    t.string("actor_username", 100);
    t.string("action", 80).notNullable();
    t.string("entity", 80);
    t.string("entity_id", 80);
    t.text("details");
    t.timestamp("created_at").defaultTo(knex.fn.now());
  });
}

export async function down(knex: Knex): Promise<void> {
  for (const t of ["workflow_audit", "case_documents", "cases", "workflow_steps", "workflows", "workflow_templates"]) {
    await knex.schema.dropTableIfExists(t);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @zordms/db test workflow_cases`
Expected: PASS (both tests). The Plan 1 RBAC migration runs first (earlier timestamp), then this one.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/migrations/20260623_0003_workflow_cases.ts packages/db/src/migrations/workflow_cases.test.ts
git commit -m "feat(db): workflow + cases schema migration (templates/workflows/steps/cases)"
```

---

## Task 3: Authority client (Gateway `/authz/check`)

**Files:**
- Create: `services/workflow/src/authority.ts`
- Test: `services/workflow/src/authority.test.ts`

**Interfaces:**
- Produces:
  - `interface AuthorityClient { check(userId: number, permissions: string[]): Promise<{ allowed: boolean; missing: string[] }> }`.
  - `createAuthorityClient(opts: { gatewayUrl: string; fetchImpl?: typeof fetch }): AuthorityClient` — POSTs `{ userId, permissions }` to `${gatewayUrl}/authz/check`; throws on non-2xx. `fetchImpl` is injectable so tests mock `fetch`.

- [ ] **Step 1: Write the failing test (mocked fetch)**

`services/workflow/src/authority.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { createAuthorityClient } from "./authority.js";

describe("authority client", () => {
  it("POSTs to /authz/check and returns allowed/missing", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ allowed: true, missing: [] }),
    });
    const client = createAuthorityClient({ gatewayUrl: "http://gw:4000", fetchImpl: fetchImpl as any });

    const res = await client.check(7, ["document:approve", "workflow:act"]);

    expect(res.allowed).toBe(true);
    expect(res.missing).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledWith("http://gw:4000/authz/check", expect.objectContaining({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: 7, permissions: ["document:approve", "workflow:act"] }),
    }));
  });

  it("reports missing permissions when the gateway denies", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ allowed: false, missing: ["document:approve"] }),
    });
    const client = createAuthorityClient({ gatewayUrl: "http://gw:4000", fetchImpl: fetchImpl as any });
    const res = await client.check(9, ["document:approve"]);
    expect(res.allowed).toBe(false);
    expect(res.missing).toEqual(["document:approve"]);
  });

  it("throws when the gateway returns a non-2xx", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const client = createAuthorityClient({ gatewayUrl: "http://gw:4000", fetchImpl: fetchImpl as any });
    await expect(client.check(1, ["workflow:act"])).rejects.toThrow(/authz_check_failed/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zordms/workflow test authority`
Expected: FAIL — `./authority.js` not found.

- [ ] **Step 3: Write `authority.ts`**

```ts
export interface AuthorityDecision {
  allowed: boolean;
  missing: string[];
}

export interface AuthorityClient {
  check(userId: number, permissions: string[]): Promise<AuthorityDecision>;
}

export interface AuthorityOptions {
  gatewayUrl: string;
  fetchImpl?: typeof fetch;
}

export function createAuthorityClient(opts: AuthorityOptions): AuthorityClient {
  const doFetch = opts.fetchImpl ?? fetch;
  const url = `${opts.gatewayUrl.replace(/\/$/, "")}/authz/check`;
  return {
    async check(userId, permissions) {
      const res = await doFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, permissions }),
      });
      if (!res.ok) {
        throw Object.assign(new Error("authz_check_failed"), { status: res.status });
      }
      const data = (await res.json()) as Partial<AuthorityDecision>;
      return { allowed: Boolean(data.allowed), missing: data.missing ?? [] };
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @zordms/workflow test authority`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add services/workflow/src/authority.ts services/workflow/src/authority.test.ts
git commit -m "feat(workflow): RBAC authority client calling gateway /authz/check"
```

---

## Task 4: Template compiler + confidence gate

**Files:**
- Create: `services/workflow/src/engine/compileTemplate.ts`
- Test: `services/workflow/src/engine/compileTemplate.test.ts`

**Interfaces:**
- Produces:
  - `interface StepDef { name: string; required_permissions: string[]; min_confidence: number; sla_minutes?: number }`.
  - `compileTemplate(stepsJson: string): StepDef[]` — parses the template's `steps_json`, validates each step has a non-empty `name`, defaults `required_permissions` to `["workflow:act"]`, defaults `min_confidence` to `0.90`, and returns steps in declared order. Throws on malformed JSON or empty step list.
  - `passesConfidenceGate(stepConfidenceFloor: number, docConfidence: number): boolean` — `docConfidence >= stepConfidenceFloor`.

- [ ] **Step 1: Write the failing test**

`services/workflow/src/engine/compileTemplate.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { compileTemplate, passesConfidenceGate } from "./compileTemplate.js";

describe("compileTemplate", () => {
  it("compiles ordered steps with defaults applied", () => {
    const json = JSON.stringify([
      { name: "Maker submits", required_permissions: ["workflow:act"], sla_minutes: 60 },
      { name: "Checker approves", required_permissions: ["document:approve"], min_confidence: 0.95 },
    ]);
    const steps = compileTemplate(json);
    expect(steps).toHaveLength(2);
    expect(steps[0].name).toBe("Maker submits");
    expect(steps[0].min_confidence).toBe(0.9); // default
    expect(steps[1].min_confidence).toBe(0.95);
    expect(steps[1].required_permissions).toEqual(["document:approve"]);
  });

  it("defaults required_permissions to workflow:act", () => {
    const steps = compileTemplate(JSON.stringify([{ name: "Review" }]));
    expect(steps[0].required_permissions).toEqual(["workflow:act"]);
  });

  it("throws on malformed JSON", () => {
    expect(() => compileTemplate("{not json")).toThrow(/invalid_steps_json/);
  });

  it("throws on an empty step list", () => {
    expect(() => compileTemplate("[]")).toThrow(/empty_template/);
  });

  it("throws when a step is missing a name", () => {
    expect(() => compileTemplate(JSON.stringify([{ required_permissions: [] }]))).toThrow(/step_name_required/);
  });
});

describe("passesConfidenceGate", () => {
  it("passes at or above the floor", () => {
    expect(passesConfidenceGate(0.9, 0.9)).toBe(true);
    expect(passesConfidenceGate(0.9, 0.95)).toBe(true);
  });
  it("fails below the floor", () => {
    expect(passesConfidenceGate(0.9, 0.89)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zordms/workflow test compileTemplate`
Expected: FAIL — `./compileTemplate.js` not found.

- [ ] **Step 3: Write `compileTemplate.ts`**

```ts
export interface StepDef {
  name: string;
  required_permissions: string[];
  min_confidence: number;
  sla_minutes?: number;
}

const DEFAULT_CONFIDENCE = 0.9;

export function compileTemplate(stepsJson: string): StepDef[] {
  let raw: unknown;
  try {
    raw = JSON.parse(stepsJson);
  } catch {
    throw new Error("invalid_steps_json");
  }
  if (!Array.isArray(raw)) throw new Error("invalid_steps_json");
  if (raw.length === 0) throw new Error("empty_template");

  return raw.map((s, idx) => {
    const step = s as Partial<StepDef>;
    if (!step.name || typeof step.name !== "string") {
      throw new Error(`step_name_required:${idx}`);
    }
    const perms = Array.isArray(step.required_permissions) && step.required_permissions.length
      ? step.required_permissions
      : ["workflow:act"];
    const conf = typeof step.min_confidence === "number" ? step.min_confidence : DEFAULT_CONFIDENCE;
    return {
      name: step.name,
      required_permissions: perms,
      min_confidence: conf,
      sla_minutes: typeof step.sla_minutes === "number" ? step.sla_minutes : undefined,
    };
  });
}

export function passesConfidenceGate(stepConfidenceFloor: number, docConfidence: number): boolean {
  return docConfidence >= stepConfidenceFloor;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @zordms/workflow test compileTemplate`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add services/workflow/src/engine/compileTemplate.ts services/workflow/src/engine/compileTemplate.test.ts
git commit -m "feat(workflow): template compiler + confidence gate"
```

---

## Task 5: Event bus client + audit helper

**Files:**
- Create: `services/workflow/src/events.ts`, `services/workflow/src/audit.ts`
- Test: `services/workflow/src/events.test.ts`

**Interfaces:**
- Produces:
  - `type WorkflowEvent = "workflow.created" | "workflow.approved" | "workflow.rejected" | "workflow.escalated" | "case.created"`.
  - `interface EventBus { emit(event: WorkflowEvent, payload: Record<string, unknown>): Promise<void> }`.
  - `createEventBus(): EventBus` — production bus (logs + would publish to Redis Streams; here a no-op publisher with structured log, replaceable by `@zordms/events` later).
  - `createRecordingBus(): EventBus & { events: Array<{ event: WorkflowEvent; payload: Record<string, unknown> }> }` — in-memory recorder for tests.
  - `writeAudit(knex, entry)` in `audit.ts` writing to `workflow_audit`.

- [ ] **Step 1: Write the failing test**

`services/workflow/src/events.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { createRecordingBus } from "./events.js";

describe("recording event bus", () => {
  it("records emitted events in order", async () => {
    const bus = createRecordingBus();
    await bus.emit("workflow.created", { id: 1, ref: "WF-1" });
    await bus.emit("workflow.approved", { id: 1 });
    expect(bus.events.map((e) => e.event)).toEqual(["workflow.created", "workflow.approved"]);
    expect(bus.events[0].payload).toEqual({ id: 1, ref: "WF-1" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zordms/workflow test events`
Expected: FAIL — `./events.js` not found.

- [ ] **Step 3: Write `events.ts`**

```ts
export type WorkflowEvent =
  | "workflow.created"
  | "workflow.approved"
  | "workflow.rejected"
  | "workflow.escalated"
  | "case.created";

export interface EventBus {
  emit(event: WorkflowEvent, payload: Record<string, unknown>): Promise<void>;
}

export function createEventBus(): EventBus {
  return {
    async emit(event, payload) {
      // Production: publish to Redis Streams via @zordms/events.
      // Kept structured so observability can scrape it; safe no-op publish for now.
      console.log(JSON.stringify({ type: "event", event, payload }));
    },
  };
}

export interface RecordingBus extends EventBus {
  events: Array<{ event: WorkflowEvent; payload: Record<string, unknown> }>;
}

export function createRecordingBus(): RecordingBus {
  const events: RecordingBus["events"] = [];
  return {
    events,
    async emit(event, payload) {
      events.push({ event, payload });
    },
  };
}
```

- [ ] **Step 4: Write `audit.ts`**

```ts
import type { Knex } from "knex";

export interface AuditEntry {
  actor_id?: number;
  actor_username?: string;
  action: string;
  entity?: string;
  entity_id?: string;
  details?: string;
}

export async function writeAudit(knex: Knex, e: AuditEntry): Promise<void> {
  await knex("workflow_audit").insert(e);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @zordms/workflow test events`
Expected: PASS.

- [ ] **Step 6: Build the service to confirm `server.ts` imports resolve**

Run: `pnpm --filter @zordms/workflow build`
Expected: PASS — `authority.ts` (Task 3) and `events.ts`/`audit.ts` (this task) now exist, so `server.ts` compiles.

- [ ] **Step 7: Commit**

```bash
git add services/workflow/src/events.ts services/workflow/src/events.test.ts services/workflow/src/audit.ts
git commit -m "feat(workflow): event bus client (+recorder) and audit helper"
```

---

## Task 6: Workflow CRUD + template-driven instantiation

**Files:**
- Create: `services/workflow/src/routes/workflows.ts`
- Modify: `services/workflow/src/app.ts` (mount `/workflows` and `/templates`)
- Test: `services/workflow/src/routes/workflows.test.ts`

**Interfaces:**
- Consumes: `compileTemplate`, `writeAudit`, `EventBus`.
- Produces (mounted under `/templates` and `/workflows`):
  - `POST /templates` body `{ name; doc_type?; steps_json }` → 201 `{ template }`.
  - `GET /templates` → `{ templates }`.
  - `POST /workflows` body `{ title; doc_id?; template_id; priority?; assigned_to?; doc_confidence?; created_by? }` → 201. Compiles the template into ordered `workflow_steps` (seq starting at 1), sets `due_at` per step `sla_minutes`, sets workflow `sla_due_at` to the first step's due date, sets stage to the first step name. If `doc_confidence` is provided and below the first step's `min_confidence`, the workflow is still created but flagged `requires_manual_review: true` (cannot auto-advance). Generates a unique `ref_code` `WF-<n>`. Writes `WORKFLOW_CREATE` audit, emits `workflow.created`.
  - `GET /workflows` → `{ workflows }` (active first).
  - `GET /workflows/:id` → `{ workflow, steps }`.

- [ ] **Step 1: Write the failing test**

`services/workflow/src/routes/workflows.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import knexLib from "knex";
import { buildKnexConfig } from "@zordms/db";
import { loadConfig } from "@zordms/config";
import { createApp } from "../app.js";
import { createRecordingBus } from "../events.js";

const knex = knexLib(buildKnexConfig({
  client: "sqlite3", host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "",
}));
const events = createRecordingBus();
const app = createApp({ knex, config: loadConfig({ JWT_SECRET: "t" } as NodeJS.ProcessEnv), events });

beforeAll(async () => { await knex.migrate.latest(); });
afterAll(async () => { await knex.destroy(); });

describe("workflow CRUD + instantiation", () => {
  let templateId = 0;

  it("creates a template", async () => {
    const res = await request(app).post("/templates").send({
      name: "KYC Approval",
      doc_type: "BT_CID_4G",
      steps_json: JSON.stringify([
        { name: "Maker submits", required_permissions: ["workflow:act"], sla_minutes: 60 },
        { name: "Checker approves", required_permissions: ["document:approve"], sla_minutes: 120, min_confidence: 0.9 },
      ]),
    });
    expect(res.status).toBe(201);
    templateId = res.body.template.id;
    expect(templateId).toBeGreaterThan(0);
  });

  it("instantiates a workflow with ordered steps and emits workflow.created", async () => {
    const res = await request(app).post("/workflows").send({
      title: "KYC for CID 11503001234", doc_id: "DOC-1", template_id: templateId,
      priority: "High", assigned_to: "checker1", doc_confidence: 0.97, created_by: "maker1",
    });
    expect(res.status).toBe(201);
    expect(res.body.workflow.ref_code).toMatch(/^WF-/);
    expect(res.body.steps).toHaveLength(2);
    expect(res.body.steps[0].seq).toBe(1);
    expect(res.body.requires_manual_review).toBe(false);
    expect(events.events.some((e) => e.event === "workflow.created")).toBe(true);
  });

  it("flags low-confidence documents for manual review", async () => {
    const res = await request(app).post("/workflows").send({
      title: "Low conf", doc_id: "DOC-2", template_id: templateId, doc_confidence: 0.5,
    });
    expect(res.status).toBe(201);
    expect(res.body.requires_manual_review).toBe(true);
  });

  it("lists and fetches a workflow with its steps", async () => {
    const list = await request(app).get("/workflows");
    expect(list.body.workflows.length).toBeGreaterThan(0);
    const id = list.body.workflows[0].id;
    const one = await request(app).get(`/workflows/${id}`);
    expect(one.status).toBe(200);
    expect(Array.isArray(one.body.steps)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zordms/workflow test routes/workflows`
Expected: FAIL — `/templates` and `/workflows` 404.

- [ ] **Step 3: Write `routes/workflows.ts`**

```ts
import { Router } from "express";
import type { Knex } from "knex";
import { compileTemplate, passesConfidenceGate } from "../engine/compileTemplate.js";
import { writeAudit } from "../audit.js";
import type { EventBus } from "../events.js";

function unwrapId(inserted: unknown): number {
  const v = Array.isArray(inserted) ? inserted[0] : inserted;
  return typeof v === "object" && v !== null ? (v as { id: number }).id : (v as number);
}

export function workflowRouter(): Router {
  const r = Router();

  // --- Templates ---
  r.post("/templates", async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    const { name, doc_type, steps_json } = req.body as { name: string; doc_type?: string; steps_json: string };
    if (!name || !steps_json) { res.status(400).json({ error: "name_and_steps_required" }); return; }
    try { compileTemplate(steps_json); } catch (e) { res.status(400).json({ error: String((e as Error).message) }); return; }
    const id = unwrapId(await knex("workflow_templates").insert({ name, doc_type, steps_json, active: true }).returning("id"));
    const template = await knex("workflow_templates").where({ id }).first();
    res.status(201).json({ template });
  });

  r.get("/templates", async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    const templates = await knex("workflow_templates").where({ active: true }).orderBy("id", "desc");
    res.json({ templates });
  });

  return r;
}

export function workflowsRouter(): Router {
  const r = Router();

  r.post("/", async (req, res) => {
    const { knex, events } = req.app.locals.deps as { knex: Knex; events?: EventBus };
    const body = req.body as {
      title: string; doc_id?: string; template_id: number; priority?: string;
      assigned_to?: string; doc_confidence?: number; created_by?: string;
    };
    if (!body.title || !body.template_id) { res.status(400).json({ error: "title_and_template_required" }); return; }

    const tpl = await knex("workflow_templates").where({ id: body.template_id }).first();
    if (!tpl) { res.status(404).json({ error: "template_not_found" }); return; }

    let steps;
    try { steps = compileTemplate(tpl.steps_json); }
    catch (e) { res.status(400).json({ error: String((e as Error).message) }); return; }

    const now = Date.now();
    const firstSla = steps[0].sla_minutes;
    const slaDue = firstSla ? new Date(now + firstSla * 60_000).toISOString() : null;

    const requiresManualReview =
      typeof body.doc_confidence === "number" &&
      !passesConfidenceGate(steps[0].min_confidence, body.doc_confidence);

    const count = Number((await knex("workflows").count<{ c: number }[]>("id as c"))[0].c);
    const refCode = `WF-${count + 1}`;

    const workflowId = unwrapId(await knex("workflows").insert({
      ref_code: refCode,
      title: body.title,
      doc_id: body.doc_id,
      template_id: body.template_id,
      stage: steps[0].name,
      priority: body.priority ?? "Normal",
      status: "Active",
      sla_due_at: slaDue,
      assigned_to: body.assigned_to,
      created_by: body.created_by,
    }).returning("id"));

    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      const dueAt = s.sla_minutes ? new Date(now + s.sla_minutes * 60_000).toISOString() : null;
      await knex("workflow_steps").insert({
        workflow_id: workflowId,
        seq: i + 1,
        name: s.name,
        required_permissions: JSON.stringify(s.required_permissions),
        min_confidence: s.min_confidence,
        status: "Pending",
        sla_minutes: s.sla_minutes ?? null,
        due_at: dueAt,
      });
    }

    await writeAudit(knex, { actor_username: body.created_by, action: "WORKFLOW_CREATE", entity: "workflow", entity_id: String(workflowId), details: refCode });
    await events?.emit("workflow.created", { id: workflowId, ref_code: refCode, doc_id: body.doc_id });

    const workflow = await knex("workflows").where({ id: workflowId }).first();
    const createdSteps = await knex("workflow_steps").where({ workflow_id: workflowId }).orderBy("seq");
    res.status(201).json({ workflow, steps: createdSteps, requires_manual_review: requiresManualReview });
  });

  r.get("/", async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    const workflows = await knex("workflows").orderByRaw("CASE WHEN status = 'Active' THEN 0 ELSE 1 END").orderBy("created_at", "desc");
    res.json({ workflows });
  });

  r.get("/:id", async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    const workflow = await knex("workflows").where({ id: req.params.id }).first();
    if (!workflow) { res.status(404).json({ error: "not_found" }); return; }
    const steps = await knex("workflow_steps").where({ workflow_id: workflow.id }).orderBy("seq");
    res.json({ workflow, steps });
  });

  return r;
}
```

- [ ] **Step 4: Mount in `app.ts`**

Add the imports and mounts inside `createApp`, after `app.use(express.json())`:
```ts
import { workflowRouter, workflowsRouter } from "./routes/workflows.js";
// inside createApp:
app.use("/templates", workflowRouter());   // POST/GET /templates live on the workflowRouter
app.use("/workflows", workflowsRouter());
```

(Note: `workflowRouter()` registers `/templates` and `/templates`-list under `/templates`'s mount path; since the router defines `r.post("/templates", …)` it would resolve to `/templates/templates`. To keep paths exact, mount `workflowRouter()` at root.)

Correct the mount to avoid path doubling:
```ts
app.use("/", workflowRouter());            // exposes POST /templates, GET /templates
app.use("/workflows", workflowsRouter());  // exposes POST /, GET /, GET /:id under /workflows
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @zordms/workflow test routes/workflows`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add services/workflow/src/routes/workflows.ts services/workflow/src/app.ts services/workflow/src/routes/workflows.test.ts
git commit -m "feat(workflow): template CRUD + confidence-gated workflow instantiation"
```

---

## Task 7: Maker-checker actions (approve/reject/escalate/hold) guarded by RBAC

**Files:**
- Create: `services/workflow/src/engine/transitions.ts`
- Modify: `services/workflow/src/routes/workflows.ts` (add `POST /workflows/:id/act`)
- Test: `services/workflow/src/engine/transitions.test.ts`, `services/workflow/src/routes/act.test.ts`

**Interfaces:**
- Produces in `transitions.ts` (pure):
  - `type WorkflowAction = "approve" | "reject" | "escalate" | "hold"`.
  - `nextStateForAction(action, currentStep, totalSteps): { workflowStatus; stepStatus; nextSeq | null; event }` — approve advances to the next pending step or completes (`Approved`); reject sets `Rejected`; escalate sets `Escalated`; hold sets `OnHold`.
- Produces route `POST /workflows/:id/act` body `{ userId; action; comment? }`:
  - Loads the active step (lowest `seq` with status `Pending`).
  - Resolves the action's required permissions: the step's `required_permissions` plus an action-specific permission (`approve`→`document:approve`, `reject`→`document:reject`, `escalate`→`workflow:escalate`, `hold`→`workflow:hold`).
  - Calls `deps.authority.check(userId, requiredPermissions)`. If `!allowed` → 403 `{ error: "forbidden", missing }` (no state change).
  - On allowed: applies the transition, stamps the step (`actor_id`, `acted_at`, `status`), updates the workflow (`status`, `stage`), writes audit, emits the mapped event (`workflow.approved` / `workflow.rejected` / `workflow.escalated`; hold emits nothing destructive but writes audit).

- [ ] **Step 1: Write the failing transitions test**

`services/workflow/src/engine/transitions.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { nextStateForAction } from "./transitions.js";

describe("nextStateForAction", () => {
  it("approve advances to the next step when one remains", () => {
    const r = nextStateForAction("approve", { seq: 1 }, 2);
    expect(r.stepStatus).toBe("Approved");
    expect(r.nextSeq).toBe(2);
    expect(r.workflowStatus).toBe("Active");
    expect(r.event).toBe("workflow.approved");
  });

  it("approve completes the workflow on the final step", () => {
    const r = nextStateForAction("approve", { seq: 2 }, 2);
    expect(r.workflowStatus).toBe("Approved");
    expect(r.nextSeq).toBeNull();
    expect(r.event).toBe("workflow.approved");
  });

  it("reject terminates the workflow", () => {
    const r = nextStateForAction("reject", { seq: 1 }, 3);
    expect(r.workflowStatus).toBe("Rejected");
    expect(r.stepStatus).toBe("Rejected");
    expect(r.event).toBe("workflow.rejected");
  });

  it("escalate marks escalated and keeps the step pending owner", () => {
    const r = nextStateForAction("escalate", { seq: 1 }, 3);
    expect(r.workflowStatus).toBe("Escalated");
    expect(r.event).toBe("workflow.escalated");
  });

  it("hold pauses the workflow", () => {
    const r = nextStateForAction("hold", { seq: 1 }, 3);
    expect(r.workflowStatus).toBe("OnHold");
    expect(r.event).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zordms/workflow test engine/transitions`
Expected: FAIL — `./transitions.js` not found.

- [ ] **Step 3: Write `transitions.ts`**

```ts
import type { WorkflowEvent } from "../events.js";

export type WorkflowAction = "approve" | "reject" | "escalate" | "hold";

export interface TransitionResult {
  workflowStatus: "Active" | "Approved" | "Rejected" | "Escalated" | "OnHold";
  stepStatus: "Approved" | "Rejected" | "Pending";
  nextSeq: number | null;
  event: WorkflowEvent | null;
}

export const ACTION_PERMISSION: Record<WorkflowAction, string> = {
  approve: "document:approve",
  reject: "document:reject",
  escalate: "workflow:escalate",
  hold: "workflow:hold",
};

export function nextStateForAction(
  action: WorkflowAction,
  currentStep: { seq: number },
  totalSteps: number,
): TransitionResult {
  switch (action) {
    case "approve": {
      const hasNext = currentStep.seq < totalSteps;
      return {
        workflowStatus: hasNext ? "Active" : "Approved",
        stepStatus: "Approved",
        nextSeq: hasNext ? currentStep.seq + 1 : null,
        event: "workflow.approved",
      };
    }
    case "reject":
      return { workflowStatus: "Rejected", stepStatus: "Rejected", nextSeq: null, event: "workflow.rejected" };
    case "escalate":
      return { workflowStatus: "Escalated", stepStatus: "Pending", nextSeq: currentStep.seq, event: "workflow.escalated" };
    case "hold":
      return { workflowStatus: "OnHold", stepStatus: "Pending", nextSeq: currentStep.seq, event: null };
    default:
      throw new Error(`unknown_action:${action as string}`);
  }
}
```

- [ ] **Step 4: Run transitions test to verify it passes**

Run: `pnpm --filter @zordms/workflow test engine/transitions`
Expected: PASS (5 tests).

- [ ] **Step 5: Write the failing route test (authority client mocked via injected dep)**

`services/workflow/src/routes/act.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import knexLib from "knex";
import { buildKnexConfig } from "@zordms/db";
import { loadConfig } from "@zordms/config";
import { createApp } from "../app.js";
import { createRecordingBus } from "../events.js";
import type { AuthorityClient } from "../authority.js";

const knex = knexLib(buildKnexConfig({
  client: "sqlite3", host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "",
}));
const events = createRecordingBus();

// Authority stub: allows actor 1 (checker), denies actor 2 (viewer).
const authority: AuthorityClient = {
  async check(userId, permissions) {
    if (userId === 1) return { allowed: true, missing: [] };
    return { allowed: false, missing: permissions };
  },
};

const app = createApp({ knex, config: loadConfig({ JWT_SECRET: "t" } as NodeJS.ProcessEnv), authority, events });

async function makeWorkflow(): Promise<number> {
  const tpl = await request(app).post("/templates").send({
    name: "T", steps_json: JSON.stringify([
      { name: "Maker", required_permissions: ["workflow:act"] },
      { name: "Checker", required_permissions: ["document:approve"] },
    ]),
  });
  const wf = await request(app).post("/workflows").send({ title: "W", template_id: tpl.body.template.id, doc_confidence: 0.99 });
  return wf.body.workflow.id;
}

beforeAll(async () => { await knex.migrate.latest(); });
afterAll(async () => { await knex.destroy(); });

describe("POST /workflows/:id/act", () => {
  it("403 when the gateway denies authority (no state change)", async () => {
    const id = await makeWorkflow();
    const res = await request(app).post(`/workflows/${id}/act`).send({ userId: 2, action: "approve" });
    expect(res.status).toBe(403);
    expect(res.body.missing.length).toBeGreaterThan(0);
    const wf = await knex("workflows").where({ id }).first();
    expect(wf.status).toBe("Active");
  });

  it("advances on approve when authority is granted and emits workflow.approved", async () => {
    const id = await makeWorkflow();
    const res = await request(app).post(`/workflows/${id}/act`).send({ userId: 1, action: "approve" });
    expect(res.status).toBe(200);
    expect(res.body.workflow.stage).toBe("Checker"); // advanced to step 2
    const step1 = await knex("workflow_steps").where({ workflow_id: id, seq: 1 }).first();
    expect(step1.status).toBe("Approved");
    expect(step1.actor_id).toBe(1);
    expect(events.events.some((e) => e.event === "workflow.approved")).toBe(true);
  });

  it("completes the workflow as Approved on the final approval", async () => {
    const id = await makeWorkflow();
    await request(app).post(`/workflows/${id}/act`).send({ userId: 1, action: "approve" }); // step 1
    const res = await request(app).post(`/workflows/${id}/act`).send({ userId: 1, action: "approve" }); // step 2
    expect(res.body.workflow.status).toBe("Approved");
  });

  it("rejects the workflow and emits workflow.rejected", async () => {
    const id = await makeWorkflow();
    const res = await request(app).post(`/workflows/${id}/act`).send({ userId: 1, action: "reject", comment: "bad scan" });
    expect(res.body.workflow.status).toBe("Rejected");
    expect(events.events.some((e) => e.event === "workflow.rejected")).toBe(true);
  });

  it("escalates and emits workflow.escalated", async () => {
    const id = await makeWorkflow();
    const res = await request(app).post(`/workflows/${id}/act`).send({ userId: 1, action: "escalate" });
    expect(res.body.workflow.status).toBe("Escalated");
    expect(events.events.some((e) => e.event === "workflow.escalated")).toBe(true);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter @zordms/workflow test routes/act`
Expected: FAIL — `/workflows/:id/act` 404.

- [ ] **Step 7: Add the `act` route to `routes/workflows.ts`**

Add imports at the top of `routes/workflows.ts`:
```ts
import { nextStateForAction, ACTION_PERMISSION, type WorkflowAction } from "../engine/transitions.js";
import type { AuthorityClient } from "../authority.js";
```

Add this route inside `workflowsRouter()` before `return r;`:
```ts
  r.post("/:id/act", async (req, res) => {
    const { knex, events, authority } = req.app.locals.deps as {
      knex: Knex; events?: EventBus; authority?: AuthorityClient;
    };
    if (!authority) { res.status(500).json({ error: "authority_unavailable" }); return; }

    const { userId, action, comment } = req.body as { userId: number; action: WorkflowAction; comment?: string };
    if (!userId || !action || !ACTION_PERMISSION[action]) { res.status(400).json({ error: "userId_and_valid_action_required" }); return; }

    const workflow = await knex("workflows").where({ id: req.params.id }).first();
    if (!workflow) { res.status(404).json({ error: "not_found" }); return; }
    if (["Approved", "Rejected"].includes(workflow.status)) { res.status(409).json({ error: "workflow_closed" }); return; }

    const steps = await knex("workflow_steps").where({ workflow_id: workflow.id }).orderBy("seq");
    const currentStep = steps.find((s) => s.status === "Pending");
    if (!currentStep) { res.status(409).json({ error: "no_pending_step" }); return; }

    // Authority comes from RBAC via the gateway — the single source of truth.
    const stepPerms: string[] = JSON.parse(currentStep.required_permissions || "[]");
    const required = Array.from(new Set([...stepPerms, ACTION_PERMISSION[action]]));
    const decision = await authority.check(userId, required);
    if (!decision.allowed) { res.status(403).json({ error: "forbidden", missing: decision.missing }); return; }

    const result = nextStateForAction(action, { seq: currentStep.seq }, steps.length);

    // Stamp the acted-on step (approve/reject change its status; escalate/hold leave it pending but record the actor).
    await knex("workflow_steps").where({ id: currentStep.id }).update({
      status: result.stepStatus,
      actor_id: userId,
      acted_at: new Date().toISOString(),
    });

    const nextStage = result.nextSeq
      ? (steps.find((s) => s.seq === result.nextSeq)?.name ?? workflow.stage)
      : workflow.stage;

    await knex("workflows").where({ id: workflow.id }).update({
      status: result.workflowStatus,
      stage: result.workflowStatus === "Approved" ? "Completed" : nextStage,
    });

    await writeAudit(knex, {
      actor_id: userId,
      action: `WORKFLOW_${action.toUpperCase()}`,
      entity: "workflow",
      entity_id: String(workflow.id),
      details: comment,
    });
    if (result.event) {
      await events?.emit(result.event, { id: workflow.id, ref_code: workflow.ref_code, action, actor_id: userId });
    }

    const updated = await knex("workflows").where({ id: workflow.id }).first();
    const updatedSteps = await knex("workflow_steps").where({ workflow_id: workflow.id }).orderBy("seq");
    res.json({ workflow: updated, steps: updatedSteps });
  });
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm --filter @zordms/workflow test routes/act`
Expected: PASS (5 tests).

- [ ] **Step 9: Commit**

```bash
git add services/workflow/src/engine/transitions.ts services/workflow/src/engine/transitions.test.ts services/workflow/src/routes/workflows.ts services/workflow/src/routes/act.test.ts
git commit -m "feat(workflow): maker-checker act endpoint (RBAC-gated approve/reject/escalate/hold)"
```

---

## Task 8: SLA overdue detection + escalation job

**Files:**
- Create: `services/workflow/src/engine/sla.ts`, `services/workflow/src/jobs/slaWorker.ts`
- Test: `services/workflow/src/engine/sla.test.ts`, `services/workflow/src/jobs/slaWorker.test.ts`

**Interfaces:**
- Produces in `sla.ts` (pure):
  - `interface SlaStep { id: number; workflow_id: number; status: string; due_at: string | null }`.
  - `findOverdueSteps(steps: SlaStep[], now: Date): SlaStep[]` — returns pending steps whose `due_at` is in the past.
- Produces in `slaWorker.ts`:
  - `escalateOverdue(deps: { knex; events? }, now?: Date): Promise<number>` — finds overdue pending steps, sets their workflow status to `Escalated`, writes audit, emits `workflow.escalated`, returns the count escalated.
  - `startSlaCron(deps): cron.ScheduledTask` — schedules `escalateOverdue` every minute (production wiring; not run in tests).

- [ ] **Step 1: Write the failing pure-function test**

`services/workflow/src/engine/sla.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { findOverdueSteps } from "./sla.js";

const now = new Date("2026-06-23T12:00:00Z");

describe("findOverdueSteps", () => {
  it("returns pending steps past their due date", () => {
    const overdue = findOverdueSteps([
      { id: 1, workflow_id: 1, status: "Pending", due_at: "2026-06-23T11:00:00Z" }, // overdue
      { id: 2, workflow_id: 2, status: "Pending", due_at: "2026-06-23T13:00:00Z" }, // future
      { id: 3, workflow_id: 3, status: "Approved", due_at: "2026-06-23T10:00:00Z" }, // not pending
      { id: 4, workflow_id: 4, status: "Pending", due_at: null },                    // no SLA
    ], now);
    expect(overdue.map((s) => s.id)).toEqual([1]);
  });

  it("returns empty when nothing is overdue", () => {
    expect(findOverdueSteps([{ id: 1, workflow_id: 1, status: "Pending", due_at: "2026-06-23T13:00:00Z" }], now)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zordms/workflow test engine/sla`
Expected: FAIL — `./sla.js` not found.

- [ ] **Step 3: Write `sla.ts`**

```ts
export interface SlaStep {
  id: number;
  workflow_id: number;
  status: string;
  due_at: string | null;
}

export function findOverdueSteps(steps: SlaStep[], now: Date): SlaStep[] {
  const t = now.getTime();
  return steps.filter((s) => s.status === "Pending" && s.due_at !== null && new Date(s.due_at).getTime() < t);
}
```

- [ ] **Step 4: Run sla test to verify it passes**

Run: `pnpm --filter @zordms/workflow test engine/sla`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the failing worker test**

`services/workflow/src/jobs/slaWorker.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import knexLib from "knex";
import { buildKnexConfig } from "@zordms/db";
import { createRecordingBus } from "../events.js";
import { escalateOverdue } from "./slaWorker.js";

const knex = knexLib(buildKnexConfig({
  client: "sqlite3", host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "",
}));
const events = createRecordingBus();

beforeAll(async () => {
  await knex.migrate.latest();
  const tpl = await knex("workflow_templates").insert({ name: "T", steps_json: "[]", active: true }).returning("id");
  const tplId = typeof tpl[0] === "object" ? (tpl[0] as any).id : tpl[0];
  const wf = await knex("workflows").insert({ ref_code: "WF-SLA", title: "overdue", template_id: tplId, stage: "review", priority: "High", status: "Active" }).returning("id");
  const wfId = typeof wf[0] === "object" ? (wf[0] as any).id : wf[0];
  await knex("workflow_steps").insert({ workflow_id: wfId, seq: 1, name: "Review", required_permissions: "[]", min_confidence: 0.9, status: "Pending", due_at: "2020-01-01T00:00:00Z" });
});
afterAll(async () => { await knex.destroy(); });

describe("escalateOverdue", () => {
  it("escalates overdue workflows and emits workflow.escalated", async () => {
    const count = await escalateOverdue({ knex, events }, new Date("2026-06-23T12:00:00Z"));
    expect(count).toBe(1);
    const wf = await knex("workflows").where({ ref_code: "WF-SLA" }).first();
    expect(wf.status).toBe("Escalated");
    expect(events.events.some((e) => e.event === "workflow.escalated")).toBe(true);
  });

  it("is idempotent — already-escalated workflows are not re-counted", async () => {
    const count = await escalateOverdue({ knex, events }, new Date("2026-06-23T12:00:00Z"));
    expect(count).toBe(0);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter @zordms/workflow test jobs/slaWorker`
Expected: FAIL — `./slaWorker.js` not found.

- [ ] **Step 7: Write `slaWorker.ts`**

```ts
import cron from "node-cron";
import type { Knex } from "knex";
import { findOverdueSteps, type SlaStep } from "../engine/sla.js";
import { writeAudit } from "../audit.js";
import type { EventBus } from "../events.js";

export interface SlaDeps {
  knex: Knex;
  events?: EventBus;
}

export async function escalateOverdue(deps: SlaDeps, now: Date = new Date()): Promise<number> {
  const { knex, events } = deps;
  // Only consider steps belonging to still-active workflows (idempotent: escalated/closed are skipped).
  const rows: SlaStep[] = await knex("workflow_steps as s")
    .join("workflows as w", "w.id", "s.workflow_id")
    .where("w.status", "Active")
    .select("s.id as id", "s.workflow_id as workflow_id", "s.status as status", "s.due_at as due_at");

  const overdue = findOverdueSteps(rows, now);
  let escalated = 0;
  for (const step of overdue) {
    await knex("workflows").where({ id: step.workflow_id }).update({ status: "Escalated" });
    await writeAudit(knex, { action: "WORKFLOW_ESCALATE", entity: "workflow", entity_id: String(step.workflow_id), details: "SLA breach" });
    await events?.emit("workflow.escalated", { id: step.workflow_id, reason: "sla_breach" });
    escalated++;
  }
  return escalated;
}

export function startSlaCron(deps: SlaDeps): cron.ScheduledTask {
  return cron.schedule("* * * * *", () => {
    void escalateOverdue(deps).catch((err) => console.error("sla_escalation_error", err));
  });
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm --filter @zordms/workflow test jobs/slaWorker`
Expected: PASS (2 tests).

- [ ] **Step 9: Wire the cron into `server.ts`**

Add to `services/workflow/src/server.ts` after the app is created (before/after `listen` is fine):
```ts
import { startSlaCron } from "./jobs/slaWorker.js";
// after createApp(...):
const events = createEventBus();
startSlaCron({ knex, events });
```

(Adjust so `events` is created once and passed to both `createApp` and `startSlaCron`.)

- [ ] **Step 10: Commit**

```bash
git add services/workflow/src/engine/sla.ts services/workflow/src/engine/sla.test.ts services/workflow/src/jobs/slaWorker.ts services/workflow/src/jobs/slaWorker.test.ts services/workflow/src/server.ts
git commit -m "feat(workflow): SLA overdue detection + cron escalation job"
```

---

## Task 9: Case Management (create, attach docs, drive workflow, metrics)

**Files:**
- Create: `services/workflow/src/routes/cases.ts`
- Modify: `services/workflow/src/app.ts` (mount `/cases`)
- Test: `services/workflow/src/routes/cases.test.ts`

**Interfaces:**
- Consumes: `writeAudit`, `EventBus`, the existing workflow instantiation (a case may embed a workflow by `template_id`).
- Produces (under `/cases`):
  - `POST /cases` body `{ case_type; title; assigned_to?; due_at?; template_id?; doc_confidence?; created_by? }` → 201. `case_type` must be one of `KYC|Loan|Account|AML`. Generates `case_ref` `CASE-<type>-<n>`. If `template_id` given, instantiates an embedded workflow (reusing `compileTemplate` + step creation) and links `workflow_id`. Writes `CASE_CREATE` audit, emits `case.created`.
  - `POST /cases/:id/documents` body `{ doc_id; label? }` → 201 attaches a document.
  - `GET /cases/:id` → `{ case, documents, workflow? }`.
  - `POST /cases/:id/resolve` body `{ status: "Resolved"|"Rejected"; resolution }` → updates status + `resolved_at`.
  - `GET /cases/metrics` → `{ total, open, resolved, by_type, avg_resolution_minutes }`.

- [ ] **Step 1: Write the failing test**

`services/workflow/src/routes/cases.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import knexLib from "knex";
import { buildKnexConfig } from "@zordms/db";
import { loadConfig } from "@zordms/config";
import { createApp } from "../app.js";
import { createRecordingBus } from "../events.js";

const knex = knexLib(buildKnexConfig({
  client: "sqlite3", host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "",
}));
const events = createRecordingBus();
const app = createApp({ knex, config: loadConfig({ JWT_SECRET: "t" } as NodeJS.ProcessEnv), events });

beforeAll(async () => { await knex.migrate.latest(); });
afterAll(async () => { await knex.destroy(); });

describe("case management", () => {
  let caseId = 0;
  let templateId = 0;

  it("creates a KYC case with an embedded workflow and emits case.created", async () => {
    const tpl = await request(app).post("/templates").send({
      name: "KYC", steps_json: JSON.stringify([{ name: "Verify", required_permissions: ["document:approve"] }]),
    });
    templateId = tpl.body.template.id;

    const res = await request(app).post("/cases").send({
      case_type: "KYC", title: "Onboard Dorji", assigned_to: "checker1",
      template_id: templateId, doc_confidence: 0.98, created_by: "maker1",
    });
    expect(res.status).toBe(201);
    expect(res.body.case.case_ref).toMatch(/^CASE-KYC-/);
    expect(res.body.case.workflow_id).toBeTruthy();
    caseId = res.body.case.id;
    expect(events.events.some((e) => e.event === "case.created")).toBe(true);
  });

  it("rejects an invalid case_type", async () => {
    const res = await request(app).post("/cases").send({ case_type: "Mortgage", title: "x" });
    expect(res.status).toBe(400);
  });

  it("attaches a document and fetches the case bundle", async () => {
    const att = await request(app).post(`/cases/${caseId}/documents`).send({ doc_id: "DOC-99", label: "CID front" });
    expect(att.status).toBe(201);
    const bundle = await request(app).get(`/cases/${caseId}`);
    expect(bundle.body.documents).toHaveLength(1);
    expect(bundle.body.workflow).toBeTruthy();
  });

  it("resolves a case and records resolution metrics", async () => {
    const res = await request(app).post(`/cases/${caseId}/resolve`).send({ status: "Resolved", resolution: "KYC verified" });
    expect(res.status).toBe(200);
    expect(res.body.case.status).toBe("Resolved");
    expect(res.body.case.resolved_at).toBeTruthy();

    const metrics = await request(app).get("/cases/metrics");
    expect(metrics.body.total).toBeGreaterThan(0);
    expect(metrics.body.resolved).toBeGreaterThan(0);
    expect(metrics.body.by_type.KYC).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zordms/workflow test routes/cases`
Expected: FAIL — `/cases` 404.

- [ ] **Step 3: Write `routes/cases.ts`**

```ts
import { Router } from "express";
import type { Knex } from "knex";
import { compileTemplate } from "../engine/compileTemplate.js";
import { writeAudit } from "../audit.js";
import type { EventBus } from "../events.js";

const CASE_TYPES = ["KYC", "Loan", "Account", "AML"];

function unwrapId(inserted: unknown): number {
  const v = Array.isArray(inserted) ? inserted[0] : inserted;
  return typeof v === "object" && v !== null ? (v as { id: number }).id : (v as number);
}

async function instantiateWorkflow(knex: Knex, templateId: number, title: string): Promise<number | null> {
  const tpl = await knex("workflow_templates").where({ id: templateId }).first();
  if (!tpl) return null;
  const steps = compileTemplate(tpl.steps_json);
  const now = Date.now();
  const count = Number((await knex("workflows").count<{ c: number }[]>("id as c"))[0].c);
  const refCode = `WF-${count + 1}`;
  const wfId = unwrapId(await knex("workflows").insert({
    ref_code: refCode, title, template_id: templateId, stage: steps[0].name,
    priority: "Normal", status: "Active",
    sla_due_at: steps[0].sla_minutes ? new Date(now + steps[0].sla_minutes * 60_000).toISOString() : null,
  }).returning("id"));
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    await knex("workflow_steps").insert({
      workflow_id: wfId, seq: i + 1, name: s.name,
      required_permissions: JSON.stringify(s.required_permissions),
      min_confidence: s.min_confidence, status: "Pending",
      sla_minutes: s.sla_minutes ?? null,
      due_at: s.sla_minutes ? new Date(now + s.sla_minutes * 60_000).toISOString() : null,
    });
  }
  return wfId;
}

export function casesRouter(): Router {
  const r = Router();

  r.post("/", async (req, res) => {
    const { knex, events } = req.app.locals.deps as { knex: Knex; events?: EventBus };
    const body = req.body as {
      case_type: string; title: string; assigned_to?: string; due_at?: string;
      template_id?: number; created_by?: string;
    };
    if (!CASE_TYPES.includes(body.case_type)) { res.status(400).json({ error: "invalid_case_type" }); return; }
    if (!body.title) { res.status(400).json({ error: "title_required" }); return; }

    const typeCount = Number((await knex("cases").where({ case_type: body.case_type }).count<{ c: number }[]>("id as c"))[0].c);
    const caseRef = `CASE-${body.case_type}-${typeCount + 1}`;

    let workflowId: number | null = null;
    if (body.template_id) workflowId = await instantiateWorkflow(knex, body.template_id, body.title);

    const caseId = unwrapId(await knex("cases").insert({
      case_ref: caseRef, case_type: body.case_type, title: body.title,
      status: "Open", assigned_to: body.assigned_to, due_at: body.due_at,
      workflow_id: workflowId, created_by: body.created_by,
    }).returning("id"));

    await writeAudit(knex, { actor_username: body.created_by, action: "CASE_CREATE", entity: "case", entity_id: String(caseId), details: caseRef });
    await events?.emit("case.created", { id: caseId, case_ref: caseRef, case_type: body.case_type });

    const created = await knex("cases").where({ id: caseId }).first();
    res.status(201).json({ case: created });
  });

  r.post("/:id/documents", async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    const { doc_id, label } = req.body as { doc_id: string; label?: string };
    if (!doc_id) { res.status(400).json({ error: "doc_id_required" }); return; }
    const exists = await knex("cases").where({ id: req.params.id }).first();
    if (!exists) { res.status(404).json({ error: "case_not_found" }); return; }
    const id = unwrapId(await knex("case_documents").insert({ case_id: Number(req.params.id), doc_id, label }).returning("id"));
    res.status(201).json({ document: await knex("case_documents").where({ id }).first() });
  });

  r.get("/metrics", async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    const all = await knex("cases").select("case_type", "status", "created_at", "resolved_at");
    const total = all.length;
    const open = all.filter((c) => c.status === "Open" || c.status === "InReview").length;
    const resolved = all.filter((c) => c.status === "Resolved").length;
    const by_type: Record<string, number> = {};
    for (const c of all) by_type[c.case_type] = (by_type[c.case_type] ?? 0) + 1;
    const durations = all
      .filter((c) => c.resolved_at && c.created_at)
      .map((c) => (new Date(c.resolved_at).getTime() - new Date(c.created_at).getTime()) / 60_000);
    const avg_resolution_minutes = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
    res.json({ total, open, resolved, by_type, avg_resolution_minutes });
  });

  r.get("/:id", async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    const c = await knex("cases").where({ id: req.params.id }).first();
    if (!c) { res.status(404).json({ error: "not_found" }); return; }
    const documents = await knex("case_documents").where({ case_id: c.id });
    const workflow = c.workflow_id ? await knex("workflows").where({ id: c.workflow_id }).first() : null;
    res.json({ case: c, documents, workflow });
  });

  r.post("/:id/resolve", async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    const { status, resolution } = req.body as { status: "Resolved" | "Rejected"; resolution: string };
    if (!["Resolved", "Rejected"].includes(status)) { res.status(400).json({ error: "invalid_status" }); return; }
    const c = await knex("cases").where({ id: req.params.id }).first();
    if (!c) { res.status(404).json({ error: "not_found" }); return; }
    await knex("cases").where({ id: c.id }).update({ status, resolution, resolved_at: new Date().toISOString() });
    await writeAudit(knex, { action: "CASE_RESOLVE", entity: "case", entity_id: String(c.id), details: `${status}: ${resolution}` });
    res.json({ case: await knex("cases").where({ id: c.id }).first() });
  });

  return r;
}
```

(Note: `/metrics` is registered before `/:id` so the literal route is not shadowed by the param route.)

- [ ] **Step 4: Mount in `app.ts`**

```ts
import { casesRouter } from "./routes/cases.js";
// inside createApp:
app.use("/cases", casesRouter());
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @zordms/workflow test routes/cases`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add services/workflow/src/routes/cases.ts services/workflow/src/app.ts services/workflow/src/routes/cases.test.ts
git commit -m "feat(workflow): case management (create/attach/embedded workflow/resolve/metrics)"
```

---

## Task 10: Seed new workflow/case permissions

**Files:**
- Create: `packages/db/src/seeds/0003_workflow_permissions.ts`
- Test: `packages/db/src/seeds/workflow_permissions.test.ts`

**Interfaces:**
- Produces: adds permissions `workflow:escalate`, `workflow:hold`, `case:create`, `case:read`, `case:manage` (idempotent), grants them to existing roles (Checker/Supervisor get escalate+hold; Maker/Checker/Supervisor get case perms; CDO gets all), without disturbing Plan 1 seed data.

- [ ] **Step 1: Write the failing test**

`packages/db/src/seeds/workflow_permissions.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import knexLib from "knex";
import { buildKnexConfig } from "../knexConfig.js";

const knex = knexLib(buildKnexConfig({
  client: "sqlite3", host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "",
}));

beforeAll(async () => { await knex.migrate.latest(); await knex.seed.run(); });
afterAll(async () => { await knex.destroy(); });

describe("workflow permissions seed", () => {
  it("adds the new workflow + case permissions", async () => {
    const keys = await knex("permissions").pluck("key");
    expect(keys).toEqual(expect.arrayContaining(["workflow:escalate", "workflow:hold", "case:create", "case:read", "case:manage"]));
  });

  it("grants escalate to the Checker role", async () => {
    const granted = await knex("role_permissions as rp")
      .join("roles as r", "r.id", "rp.role_id")
      .join("permissions as p", "p.id", "rp.permission_id")
      .where("r.name", "Checker").pluck("p.key");
    expect(granted).toContain("workflow:escalate");
  });

  it("keeps the Plan 1 bootstrap admin intact", async () => {
    const admin = await knex("users").where({ username: "admin" }).first();
    expect(admin).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zordms/db test workflow_permissions`
Expected: FAIL — new permission keys absent (seed file not present).

- [ ] **Step 3: Write the seed**

`packages/db/src/seeds/0003_workflow_permissions.ts`:
```ts
import type { Knex } from "knex";

const NEW_PERMISSIONS: Array<[string, string]> = [
  ["workflow:escalate", "Escalate workflows"],
  ["workflow:hold", "Place workflows on hold"],
  ["case:create", "Create cases"],
  ["case:read", "View cases"],
  ["case:manage", "Manage and resolve cases"],
];

const GRANTS: Record<string, string[]> = {
  CDO: ["workflow:escalate", "workflow:hold", "case:create", "case:read", "case:manage"],
  Supervisor: ["workflow:escalate", "workflow:hold", "case:create", "case:read", "case:manage"],
  Checker: ["workflow:escalate", "workflow:hold", "case:read", "case:manage"],
  Maker: ["case:create", "case:read"],
  Auditor: ["case:read"],
};

export async function seed(knex: Knex): Promise<void> {
  for (const [key, description] of NEW_PERMISSIONS) {
    const exists = await knex("permissions").where({ key }).first();
    if (!exists) await knex("permissions").insert({ key, description });
  }
  for (const [roleName, perms] of Object.entries(GRANTS)) {
    const role = await knex("roles").where({ name: roleName }).first();
    if (!role) continue;
    for (const key of perms) {
      const perm = await knex("permissions").where({ key }).first();
      if (!perm) continue;
      const link = await knex("role_permissions").where({ role_id: role.id, permission_id: perm.id }).first();
      if (!link) await knex("role_permissions").insert({ role_id: role.id, permission_id: perm.id });
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @zordms/db test workflow_permissions`
Expected: PASS (3 tests). Knex runs seed files alphabetically, so `0001_default_rbac` (Plan 1) runs before `0003_workflow_permissions`, guaranteeing roles exist.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/seeds/0003_workflow_permissions.ts packages/db/src/seeds/workflow_permissions.test.ts
git commit -m "feat(db): seed workflow + case permissions and role grants"
```

---

## Task 11: React — workflow API client + Workflow Engine screen

**Files:**
- Create: `apps/web/src/api/workflow.ts`, `apps/web/src/components/WorkflowBuilder.tsx`, `apps/web/src/pages/WorkflowEngine.tsx`
- Modify: `apps/web/vite.config.ts` (proxy `/workflows`, `/templates`, `/cases`)
- Test: `apps/web/src/components/WorkflowBuilder.test.tsx`, `apps/web/src/pages/WorkflowEngine.test.tsx`

**Interfaces:**
- Consumes: Plan 1 `api` client (`apps/web/src/api/client.ts`), `useAuth`.
- Produces:
  - `apps/web/src/api/workflow.ts`: typed helpers `listWorkflows()`, `getWorkflow(id)`, `actOnWorkflow(id, { userId, action, comment? })`, `listTemplates()`.
  - `WorkflowBuilder({ steps })` — renders an ordered visual chain of steps with their required permissions and confidence gate (a static visual representation of the template/instance).
  - `WorkflowEngine()` — fetches active workflows into a table (ref_code, title, stage, priority, status, SLA), and provides Approve/Reject/Escalate buttons that call `actOnWorkflow` for the selected workflow; the buttons are disabled unless the user holds `workflow:act`.

- [ ] **Step 1: Add proxy routes to `apps/web/vite.config.ts`**

Extend the `server.proxy` map (it already proxies `/auth`, `/users`, `/authz`, `/health` to the gateway). Add workflow-service routes (gateway forwards or direct, env-dependent — for local dev point them at the workflow service):
```ts
server: {
  proxy: {
    "/auth": "http://localhost:4000",
    "/users": "http://localhost:4000",
    "/authz": "http://localhost:4000",
    "/health": "http://localhost:4000",
    "/workflows": "http://localhost:4002",
    "/templates": "http://localhost:4002",
    "/cases": "http://localhost:4002",
  },
},
```

- [ ] **Step 2: Write the failing WorkflowBuilder test**

`apps/web/src/components/WorkflowBuilder.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkflowBuilder } from "./WorkflowBuilder.js";

describe("WorkflowBuilder", () => {
  it("renders an ordered step chain with permissions and confidence", () => {
    render(<WorkflowBuilder steps={[
      { seq: 1, name: "Maker submits", required_permissions: ["workflow:act"], min_confidence: 0.9, status: "Approved" },
      { seq: 2, name: "Checker approves", required_permissions: ["document:approve"], min_confidence: 0.95, status: "Pending" },
    ]} />);
    expect(screen.getByText("Maker submits")).toBeInTheDocument();
    expect(screen.getByText("Checker approves")).toBeInTheDocument();
    expect(screen.getByText(/document:approve/)).toBeInTheDocument();
    expect(screen.getByText(/0\.95/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @zordms/web test WorkflowBuilder`
Expected: FAIL — `./WorkflowBuilder.js` not found.

- [ ] **Step 4: Write `api/workflow.ts`**

```ts
import { api } from "./client.js";

export interface WorkflowRow {
  id: number; ref_code: string; title: string; stage: string;
  priority: string; status: string; sla_due_at?: string | null; assigned_to?: string;
}
export interface WorkflowStepRow {
  seq: number; name: string; required_permissions: string | string[]; min_confidence: number; status: string;
}
export type WorkflowAction = "approve" | "reject" | "escalate" | "hold";

export const listWorkflows = (): Promise<{ workflows: WorkflowRow[] }> => api.get("/workflows");
export const getWorkflow = (id: number): Promise<{ workflow: WorkflowRow; steps: WorkflowStepRow[] }> => api.get(`/workflows/${id}`);
export const actOnWorkflow = (id: number, body: { userId: number; action: WorkflowAction; comment?: string }) =>
  api.post(`/workflows/${id}/act`, body);
export const listTemplates = (): Promise<{ templates: Array<{ id: number; name: string; doc_type?: string; steps_json: string }> }> =>
  api.get("/templates");
```

- [ ] **Step 5: Write `components/WorkflowBuilder.tsx`**

```tsx
export interface BuilderStep {
  seq: number; name: string; required_permissions: string[] | string; min_confidence: number; status: string;
}

function perms(p: string[] | string): string[] {
  return Array.isArray(p) ? p : (() => { try { return JSON.parse(p); } catch { return []; } })();
}

export function WorkflowBuilder({ steps }: { steps: BuilderStep[] }) {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "stretch", flexWrap: "wrap" }}>
      {steps.map((s, i) => (
        <div key={s.seq} style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 14, minWidth: 200,
            borderLeft: `4px solid ${s.status === "Approved" ? "#16a34a" : s.status === "Rejected" ? "#b91c1c" : "var(--navy)"}` }}>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>Step {s.seq} · {s.status}</div>
            <div style={{ fontWeight: 600, margin: "4px 0" }}>{s.name}</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>Requires: {perms(s.required_permissions).join(", ")}</div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>Confidence ≥ {s.min_confidence}</div>
          </div>
          {i < steps.length - 1 && <span aria-hidden style={{ color: "var(--muted)" }}>→</span>}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Run WorkflowBuilder test to verify it passes**

Run: `pnpm --filter @zordms/web test WorkflowBuilder`
Expected: PASS.

- [ ] **Step 7: Write the failing WorkflowEngine test**

`apps/web/src/pages/WorkflowEngine.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { WorkflowEngine } from "./WorkflowEngine.js";

vi.mock("../auth/AuthContext.js", () => ({
  useAuth: () => ({ user: { id: 1, username: "checker1", roles: ["Checker"], permissions: ["workflow:act", "document:approve"] } }),
}));

describe("WorkflowEngine", () => {
  it("lists active workflows and approves one", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ workflows: [
        { id: 7, ref_code: "WF-7", title: "KYC Dorji", stage: "Checker approves", priority: "High", status: "Active", sla_due_at: null },
      ] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ workflow: { id: 7, status: "Approved" }, steps: [] }) });
    globalThis.fetch = fetchMock as any;

    render(<WorkflowEngine />);
    await waitFor(() => expect(screen.getByText("WF-7")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /approve/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/workflows/7/act", expect.objectContaining({ method: "POST" })));
  });
});
```

- [ ] **Step 8: Run test to verify it fails**

Run: `pnpm --filter @zordms/web test WorkflowEngine`
Expected: FAIL — `./WorkflowEngine.js` not found.

- [ ] **Step 9: Write `pages/WorkflowEngine.tsx`**

```tsx
import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext.js";
import { listWorkflows, actOnWorkflow, type WorkflowRow, type WorkflowAction } from "../api/workflow.js";

export function WorkflowEngine() {
  const { user } = useAuth();
  const [rows, setRows] = useState<WorkflowRow[]>([]);
  const [busy, setBusy] = useState<number | null>(null);
  const canAct = !!user?.permissions.includes("workflow:act");

  async function refresh() { setRows((await listWorkflows()).workflows); }
  useEffect(() => { void refresh(); }, []);

  async function act(id: number, action: WorkflowAction) {
    if (!user) return;
    setBusy(id);
    try { await actOnWorkflow(id, { userId: user.id, action }); await refresh(); }
    finally { setBusy(null); }
  }

  return (
    <div style={{ padding: 32 }}>
      <h2>Workflow Engine</h2>
      <p style={{ color: "var(--muted)" }}>Maker-checker approvals — authority is resolved from RBAC via the gateway.</p>
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 16 }}>
        <thead>
          <tr>
            {["Ref", "Title", "Stage", "Priority", "Status", "Actions"].map((h) => (
              <th key={h} style={{ textAlign: "left", padding: 8, fontSize: 13, color: "var(--muted)" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((w) => (
            <tr key={w.id} style={{ borderTop: "1px solid var(--line)" }}>
              <td style={{ padding: 8 }}>{w.ref_code}</td>
              <td style={{ padding: 8 }}>{w.title}</td>
              <td style={{ padding: 8 }}>{w.stage}</td>
              <td style={{ padding: 8 }}>{w.priority}</td>
              <td style={{ padding: 8 }}>{w.status}</td>
              <td style={{ padding: 8, display: "flex", gap: 6 }}>
                <button disabled={!canAct || busy === w.id} onClick={() => act(w.id, "approve")}>Approve</button>
                <button disabled={!canAct || busy === w.id} onClick={() => act(w.id, "reject")}>Reject</button>
                <button disabled={!canAct || busy === w.id} onClick={() => act(w.id, "escalate")}>Escalate</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 10: Run test to verify it passes**

Run: `pnpm --filter @zordms/web test WorkflowEngine`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add apps/web/src/api/workflow.ts apps/web/src/components/WorkflowBuilder.tsx apps/web/src/components/WorkflowBuilder.test.tsx apps/web/src/pages/WorkflowEngine.tsx apps/web/src/pages/WorkflowEngine.test.tsx apps/web/vite.config.ts
git commit -m "feat(web): workflow API client + Workflow Engine screen + visual builder"
```

---

## Task 12: React — Case Management screen + routing

**Files:**
- Create: `apps/web/src/api/cases.ts`, `apps/web/src/pages/CaseManagement.tsx`
- Modify: `apps/web/src/router.tsx` (add `/workflows`, `/cases` protected routes)
- Test: `apps/web/src/pages/CaseManagement.test.tsx`

**Interfaces:**
- Consumes: `api` client, `useAuth`.
- Produces:
  - `apps/web/src/api/cases.ts`: `listCases()` (via `GET /cases/metrics` + a list endpoint), `createCase(body)`, `getCase(id)`, `attachDocument(id, body)`, `getMetrics()`.
  - `CaseManagement()` — shows metric tiles (total/open/resolved/by-type) and a create-case form (type select KYC/Loan/Account/AML, title, optional template); create requires `case:create`.
  - `router.tsx` gains `/workflows` (perm `workflow:act`) and `/cases` (perm `case:read`).

- [ ] **Step 1: Add a `GET /cases` list endpoint to the service (small backend addition)**

Add to `services/workflow/src/routes/cases.ts` inside `casesRouter()` (before `/:id`):
```ts
  r.get("/", async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    const cases = await knex("cases").orderBy("created_at", "desc");
    res.json({ cases });
  });
```

Add a quick assertion to `services/workflow/src/routes/cases.test.ts` (append inside the existing describe):
```ts
  it("lists cases", async () => {
    const res = await request(app).get("/cases");
    expect(Array.isArray(res.body.cases)).toBe(true);
  });
```

Run: `pnpm --filter @zordms/workflow test routes/cases`
Expected: PASS (now 5 tests). Commit the backend addition:
```bash
git add services/workflow/src/routes/cases.ts services/workflow/src/routes/cases.test.ts
git commit -m "feat(workflow): list cases endpoint"
```

- [ ] **Step 2: Write the failing CaseManagement test**

`apps/web/src/pages/CaseManagement.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { CaseManagement } from "./CaseManagement.js";

vi.mock("../auth/AuthContext.js", () => ({
  useAuth: () => ({ user: { id: 1, username: "maker1", roles: ["Maker"], permissions: ["case:read", "case:create"] } }),
}));

describe("CaseManagement", () => {
  it("shows metric tiles and the cases list", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ total: 3, open: 1, resolved: 2, by_type: { KYC: 2, Loan: 1 }, avg_resolution_minutes: 120 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ cases: [{ id: 1, case_ref: "CASE-KYC-1", case_type: "KYC", title: "Onboard Dorji", status: "Open" }] }) });
    globalThis.fetch = fetchMock as any;

    render(<CaseManagement />);
    await waitFor(() => expect(screen.getByText("CASE-KYC-1")).toBeInTheDocument());
    expect(screen.getByText(/Resolved/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @zordms/web test CaseManagement`
Expected: FAIL — `./CaseManagement.js` not found.

- [ ] **Step 4: Write `api/cases.ts`**

```ts
import { api } from "./client.js";

export interface CaseRow { id: number; case_ref: string; case_type: string; title: string; status: string; assigned_to?: string; }
export interface CaseMetrics { total: number; open: number; resolved: number; by_type: Record<string, number>; avg_resolution_minutes: number; }

export const listCases = (): Promise<{ cases: CaseRow[] }> => api.get("/cases");
export const getMetrics = (): Promise<CaseMetrics> => api.get("/cases/metrics");
export const createCase = (body: { case_type: string; title: string; assigned_to?: string; template_id?: number; created_by?: string }) =>
  api.post("/cases", body);
export const getCase = (id: number) => api.get(`/cases/${id}`);
export const attachDocument = (id: number, body: { doc_id: string; label?: string }) => api.post(`/cases/${id}/documents`, body);
```

- [ ] **Step 5: Write `pages/CaseManagement.tsx`**

```tsx
import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthContext.js";
import { listCases, getMetrics, createCase, type CaseRow, type CaseMetrics } from "../api/cases.js";

const TYPES = ["KYC", "Loan", "Account", "AML"];

export function CaseManagement() {
  const { user } = useAuth();
  const [metrics, setMetrics] = useState<CaseMetrics | null>(null);
  const [rows, setRows] = useState<CaseRow[]>([]);
  const [form, setForm] = useState({ case_type: "KYC", title: "" });
  const canCreate = !!user?.permissions.includes("case:create");

  async function refresh() {
    setMetrics(await getMetrics());
    setRows((await listCases()).cases);
  }
  useEffect(() => { void refresh(); }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    await createCase({ case_type: form.case_type, title: form.title, created_by: user?.username });
    setForm({ case_type: "KYC", title: "" });
    await refresh();
  }

  const tiles: Array<[string, string | number]> = metrics
    ? [["Total", metrics.total], ["Open", metrics.open], ["Resolved", metrics.resolved], ["Avg mins", Math.round(metrics.avg_resolution_minutes)]]
    : [];

  return (
    <div style={{ padding: 32 }}>
      <h2>Case Management</h2>
      <p style={{ color: "var(--muted)" }}>KYC, Loan, Account, and AML cases with embedded maker-checker workflows.</p>

      <div style={{ display: "flex", gap: 12, margin: "16px 0" }}>
        {tiles.map(([label, value]) => (
          <div key={label} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 16, minWidth: 110 }}>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>{label}</div>
            <div style={{ fontSize: 24, fontWeight: 700 }}>{value}</div>
          </div>
        ))}
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr>{["Ref", "Type", "Title", "Status"].map((h) => <th key={h} style={{ textAlign: "left", padding: 8, fontSize: 13, color: "var(--muted)" }}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} style={{ borderTop: "1px solid var(--line)" }}>
              <td style={{ padding: 8 }}>{c.case_ref}</td>
              <td style={{ padding: 8 }}>{c.case_type}</td>
              <td style={{ padding: 8 }}>{c.title}</td>
              <td style={{ padding: 8 }}>{c.status}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {canCreate && (
        <form onSubmit={create} style={{ marginTop: 24, display: "flex", gap: 8, flexWrap: "wrap", maxWidth: 640 }}>
          <select className="field" style={{ width: 140 }} value={form.case_type} onChange={(e) => setForm({ ...form, case_type: e.target.value })}>
            {TYPES.map((t) => <option key={t}>{t}</option>)}
          </select>
          <input className="field" style={{ width: 280 }} placeholder="case title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <button className="btn-primary" style={{ width: 140 }}>Create case</button>
        </form>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Wire the routes in `router.tsx`**

Add imports and route entries to `apps/web/src/router.tsx`:
```tsx
import { WorkflowEngine } from "./pages/WorkflowEngine.js";
import { CaseManagement } from "./pages/CaseManagement.js";
// add to the routes array (before the catch-all "*"):
  { path: "/workflows", element: <ProtectedRoute permission="workflow:act"><WorkflowEngine /></ProtectedRoute> },
  { path: "/cases", element: <ProtectedRoute permission="case:read"><CaseManagement /></ProtectedRoute> },
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm --filter @zordms/web test CaseManagement`
Expected: PASS.

- [ ] **Step 8: Run the full web suite to confirm no regressions**

Run: `pnpm --filter @zordms/web test`
Expected: PASS (all web tests including Plan 1 Login/Users/Carousel and the new screens).

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/api/cases.ts apps/web/src/pages/CaseManagement.tsx apps/web/src/pages/CaseManagement.test.tsx apps/web/src/router.tsx
git commit -m "feat(web): case management screen + workflow/cases routing"
```

---

## Task 13: Full-suite verification + CI note

**Files:**
- Modify: `.github/workflows/ci.yml` (the Plan 1 CI; the `unit` job already runs `pnpm test` across the workspace and now picks up `@zordms/workflow`; the `migrations-postgres` job's migrate/seed now applies the new migration + seed). Add an explicit `pnpm --filter @zordms/workflow build` to the build step is unnecessary — `pnpm build` covers it.
- Create: `docs/RUNBOOK-workflow.md`

**Interfaces:**
- Produces: a verified all-green workspace test run and a runbook for running the workflow service locally alongside the gateway.

- [ ] **Step 1: Run the entire workspace test suite**

Run: `pnpm install && pnpm build && pnpm test`
Expected: all suites PASS — `@zordms/config`, `@zordms/db` (incl. workflow_cases migration + workflow_permissions seed), `@zordms/auth`, `@zordms/types`, `@zordms/gateway`, `@zordms/workflow`, `@zordms/web`.

- [ ] **Step 2: Confirm the CI migration job covers the new migration**

Open `.github/workflows/ci.yml` and verify the `migrations-postgres` job runs `node packages/db/dist/cli.js migrate` then `seed`. Because the new migration/seed live in `packages/db`, no workflow change is needed — confirm the comment below is present (add it if missing):
```yaml
      # Applies ALL Knex migrations (RBAC + workflow_cases) and ALL seeds
      # (default_rbac + workflow_permissions) against Postgres to prove dialect parity.
      - run: node packages/db/dist/cli.js migrate
      - run: node packages/db/dist/cli.js seed
```

- [ ] **Step 3: Write the runbook**

`docs/RUNBOOK-workflow.md`:
```markdown
# ZorDMS Workflow & Cases — Run & Verify

## Prerequisites
Foundation (Plan 1) running: gateway on :4000 with seeded RBAC.

## Local
1. `cp .env.example .env` (Plan 1 vars) and set:
   - `GATEWAY_URL=http://localhost:4000`
   - `WORKFLOW_PORT=4002`
2. `pnpm install && pnpm build`
3. `node packages/db/dist/cli.js migrate && node packages/db/dist/cli.js seed`
   (applies RBAC + workflow/cases migrations and both seeds)
4. `pnpm --filter @zordms/gateway dev`    # :4000
5. `pnpm --filter @zordms/workflow dev`   # :4002 (SLA cron starts)
6. `pnpm --filter @zordms/web dev`        # :5174 → /workflows and /cases

## Authority model
Every approve/reject/escalate/hold calls the gateway `POST /authz/check`
({ userId, permissions }) — RBAC is the single source of truth. The workflow
service holds NO parallel ACL.

## Switch to Oracle 19c
Set `DB_CLIENT=oracledb` + Oracle creds; re-run migrate + seed. No code changes.

## Tests
`pnpm test` runs all suites against in-memory SQLite (authority client + event bus
are dependency-injected and mocked in tests).
```

- [ ] **Step 4: Commit**

```bash
git add docs/RUNBOOK-workflow.md .github/workflows/ci.yml
git commit -m "docs(workflow): runbook + CI note for workflow/cases migrations"
```

---

## Self-Review

**Spec coverage (Plan 3 portion of the spec — Service #3 Workflow & Cases):**
- New `services/workflow` with `createApp({knex,config})` factory + health → Task 1. ✓
- Schema: `workflows` (ref_code, title, doc_id, stage, priority, sla_due_at, assigned_to), `workflow_templates` (steps_json), `workflow_steps`, `cases` (case_type, status, assigned, due), `case_documents` — Knex schema-builder, `increments()` only → Task 2. ✓
- Authority client POSTing to gateway `/authz/check`, returning allowed/missing, unit-tested with mocked fetch → Task 3. ✓
- Workflow CRUD + template-driven instantiation (compile `steps_json` → ordered steps with required permissions + confidence gate ≥0.90) → Tasks 4, 6. ✓
- Maker-checker approve/reject/escalate/hold, each RBAC-gated via the authority client, with stage transitions, audit writes, and event emits → Task 7 (pure transitions Task 7 Step 3; route Step 7). ✓
- SLA countdown + escalation job with a unit-tested pure overdue-detection function → Task 8. ✓
- Case Management (KYC/Loan/Account/AML), attach documents, embedded workflow, status + resolution metrics → Task 9. ✓
- React Workflow Engine screen (active workflows table + visual builder + approve/reject/escalate) and Case Management screen, reusing Plan 1 `api` client + `ProtectedRoute` → Tasks 11, 12. ✓
- New permissions seeded; CI note → Tasks 10, 13. ✓
- Events `workflow.created/approved/rejected/escalated` (+ `case.created`) emitted on the injectable bus → Tasks 5, 6, 7, 8, 9. ✓

**RBAC-as-single-source-of-truth check:** No code path in the workflow service evaluates a local permission table for actions. `routes/workflows.ts` `act` and `jobs/slaWorker.ts` derive authority only from the injected `AuthorityClient` (Task 3), which calls the gateway `/authz/check` (Plan 1, Task 14). Tests inject a stub authority and/or mock `fetch` — production wires the real HTTP client in `server.ts`. ✓

**Placeholder scan:** No TBD/TODO; every code step contains complete, runnable code; every test step has real assertions. The only test doubles are the injected authority client and the in-memory event recorder, both first-class production-shaped interfaces. ✓

**Convention consistency with Plan 1:** `createApp({knex,config})` factory shape, `app.locals.deps`, sqlite test backend, `buildKnexConfig({...})` test setup, `unwrapId` insert pattern, `writeAudit` helper shape, seed idempotency, `ProtectedRoute`/`api` reuse, and the `Co-Authored-By: Claude Opus 4.8 (1M context)` commit trailer all mirror Plan 1 exactly. ✓

**Type consistency:** `AuthorityClient`/`AuthorityDecision` (Task 3) are consumed unchanged in Tasks 7 and 8. `StepDef`/`compileTemplate` (Task 4) feed Tasks 6 and 9. `WorkflowAction`/`ACTION_PERMISSION`/`nextStateForAction` (Task 7) are used in the act route. `WorkflowEvent`/`EventBus` (Task 5) are emitted in Tasks 6, 7, 8, 9 and recorded in tests. ✓

---

## Notes for later plans
- The workflow service emits `workflow.*` and `case.created` on the event bus — Plan 4 (Notification & Alerts) subscribes to `workflow.escalated`/`workflow.rejected` for role-targeted dispatch.
- `doc_id` on workflows/cases references Core DMS (Plan 2) document IDs; cross-service joins resolve via the gateway/BFF, not foreign keys.
- The authority client currently calls the gateway directly via `GATEWAY_URL`; when service mesh/mTLS lands, only `createAuthorityClient` wiring in `server.ts` changes.
- Replace `node-cron` with BullMQ by swapping `startSlaCron` for a BullMQ repeatable job calling the same pure `escalateOverdue` — no engine changes needed.
- The visual `WorkflowBuilder` is a read-only representation now; an editable drag-and-drop builder that writes `steps_json` is a Plan 8 enterprise-depth enhancement.
