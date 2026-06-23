# Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This is **Plan 5** of the ZorDMS series; it assumes Plans 1–4 (foundation/RBAC, core DMS, workflow, notify) are merged and the shared packages `@zordms/config`, `@zordms/db`, `@zordms/auth`, `@zordms/types`, `@zordms/events` exist.

**Goal:** Stand up the ZorDMS **Search** service (`services/search`) — a pluggable, branch/role-scoped enterprise search engine. Phase 1 ships a SQL/`LIKE`-based search index that runs on SQLite (tests) and PostgreSQL FTS (prod); Phase 2 swaps in an Elasticsearch adapter behind the same interface with zero route changes. The service consumes `document.indexed` / `document.cataloged` events to (re)index, exposes a query API (full-text / boolean / wildcard / fuzzy / semantic-placeholder) with faceted filters, relevance scoring, pagination + latency, saved searches, and CSV export, plus the React Enterprise Search screen.

**Architecture:** A standalone Express service following the same `createApp(deps)` factory pattern as the Gateway (Plan 1). The search backend is an **interface** (`SearchBackend`) with two implementations — `SqlSearchBackend` (default, used by tests + prod-PG) and `EsSearchBackend` (stub now, real ES in Phase 2) — selected by config so the rest of the service is backend-agnostic. Indexing is driven by an event consumer that upserts rows into a `search_index` table; querying builds a parameterized SQL query from a typed `SearchQuery` and applies branch/role scope from the authenticated user's RBAC context. The DB layer is Knex with the client chosen by env (`pg` | `oracledb`); tests run against `sqlite3`.

**Tech Stack:** Node 20+, TypeScript 5, Express 4, Knex 3 (pg / oracledb / sqlite3), Vitest + Supertest, `@zordms/auth` (`requireAuth`, `requirePermission`, JWT), `@zordms/events` (Redis Streams client; in-memory fake in tests), React 18 + Vite 5 + react-router-dom 6, @testing-library/react.

## Global Constraints

- **Pluggable backend** — all reads/writes go through the `SearchBackend` interface (`index`, `bulkIndex`, `search`, `delete`, `reindexAll`). Phase 1 = `SqlSearchBackend`; Phase 2 = `EsSearchBackend`. Tests use the SQL backend. No route/handler code references a concrete backend.
- **RBAC is the backbone** — every query is scoped by the caller's branch/region/roles. A user without `crossbranch:read` only sees rows for their own `branch`. Query endpoints are guarded by `requirePermission("document:read")`.
- **DB switchable via env** — `DB_CLIENT=pg|oracledb` for Node (Knex). No SQLite-isms in migrations (Knex schema-builder; `increments()` only). SQLite is a test-only backend. SQL search uses `whereILike`/`LIKE` (portable) in Phase 1; a Postgres-only `tsvector` GIN index is added as an optional, dialect-guarded migration step.
- **All code fully functional** — no mocks/stubs in shipped code. The ES backend is a real class implementing the interface; it throws a clear `not_enabled` error until Phase 2 wires a live client. The event consumer is a real consumer driven by `@zordms/events`.
- **TypeScript everywhere**, ESM modules (`"type": "module"`), strict mode on.
- **Package names** under the `@zordms/` scope (e.g. `@zordms/search`).
- **Conventional commits**; commit after every passing step. End commit messages with the Co-Authored-By trailer used by this repo:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## File Structure

```
zordms/
  packages/
    db/
      src/migrations/20260623_0005_search.ts   # search_index + saved_searches (NEW)
    types/
      src/index.ts                              # extend with search contracts (MODIFY)
  services/
    search/                                     # NEW service
      package.json
      tsconfig.json
      vitest.config.ts
      src/app.ts                                # express app factory
      src/server.ts                             # listen() + start event consumer
      src/backend/SearchBackend.ts              # interface + shared types
      src/backend/SqlSearchBackend.ts           # Phase-1 SQL/LIKE backend
      src/backend/EsSearchBackend.ts            # Phase-2 Elasticsearch stub
      src/backend/index.ts                       # selectBackend(config, knex)
      src/query/buildQuery.ts                   # SearchQuery -> Knex query builder
      src/query/tokenize.ts                     # field tokenization for the index
      src/query/facets.ts                       # facet aggregation
      src/consumer/indexConsumer.ts             # document.indexed/cataloged -> upsert
      src/routes/search.ts                      # POST /search, GET /facets
      src/routes/saved.ts                       # saved searches CRUD + run
      src/routes/reindex.ts                     # POST /admin/reindex
      src/routes/export.ts                      # POST /search/export.csv
  apps/
    web/
      src/api/search.ts                          # search API helpers (NEW)
      src/pages/Search.tsx                       # Enterprise Search screen (NEW)
      src/components/FacetPanel.tsx              # facet filters (NEW)
      src/components/SavedSearches.tsx           # saved-query panel (NEW)
```

---

## Task 1: Search service scaffold + app factory + health

**Files:**
- Create: `services/search/package.json`, `services/search/tsconfig.json`, `services/search/vitest.config.ts`, `services/search/src/app.ts`, `services/search/src/server.ts`
- Test: `services/search/src/app.test.ts`

**Interfaces:**
- Produces: `createApp(deps: { knex: Knex; config: AppConfig; backend: SearchBackend }): Express` — pure factory (no `listen`), so tests mount it with a sqlite knex + SQL backend.
- `GET /health` → `{ status: "ok", backend: "sql" | "es" }`.

- [ ] **Step 1: Create `services/search/package.json`**

```json
{
  "name": "@zordms/search",
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
    "express": "^4.19.2", "cors": "^2.8.5",
    "@zordms/auth": "workspace:*", "@zordms/db": "workspace:*",
    "@zordms/config": "workspace:*", "@zordms/types": "workspace:*",
    "@zordms/events": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.4.0", "vitest": "^1.6.0", "supertest": "^7.0.0", "tsx": "^4.15.0",
    "@types/express": "^4.17.21", "@types/cors": "^2.8.17", "@types/supertest": "^6.0.2", "@types/node": "^20.0.0",
    "knex": "^3.1.0", "sqlite3": "^5.1.7"
  }
}
```

- [ ] **Step 2: Create `services/search/tsconfig.json`**

```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

- [ ] **Step 3: Create `services/search/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
```

- [ ] **Step 4: Write the failing test**

`services/search/src/app.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import knexLib from "knex";
import { buildKnexConfig } from "@zordms/db";
import { loadConfig } from "@zordms/config";
import { createApp } from "./app.js";
import { SqlSearchBackend } from "./backend/SqlSearchBackend.js";

const knex = knexLib(buildKnexConfig({
  client: "sqlite3", host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "",
}));
const app = createApp({ knex, config: loadConfig({ JWT_SECRET: "t" } as NodeJS.ProcessEnv), backend: new SqlSearchBackend(knex) });

beforeAll(async () => { await knex.migrate.latest(); });
afterAll(async () => { await knex.destroy(); });

describe("search health", () => {
  it("GET /health returns ok with the active backend name", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.backend).toBe("sql");
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `pnpm --filter @zordms/search test`
Expected: FAIL — `./app.js` / `./backend/SqlSearchBackend.js` not found. (You will create the backend stub in Step 6 so the import resolves; the SQL backend body is completed in Task 3, but a minimal `name`/constructor is enough for health.)

- [ ] **Step 6: Write a minimal `backend/SqlSearchBackend.ts` placeholder (name only) so health resolves**

`services/search/src/backend/SqlSearchBackend.ts`:
```ts
import type { Knex } from "knex";

// Minimal shell so the app factory + health route compile in Task 1.
// Fully implemented in Task 3.
export class SqlSearchBackend {
  readonly name = "sql" as const;
  constructor(protected readonly knex: Knex) {}
}
```

- [ ] **Step 7: Write `app.ts`**

`services/search/src/app.ts`:
```ts
import express, { type Express } from "express";
import cors from "cors";
import type { Knex } from "knex";
import type { AppConfig } from "@zordms/config";

export interface SearchDeps {
  knex: Knex;
  config: AppConfig;
  backend: { name: "sql" | "es" };
}

export function createApp(deps: SearchDeps): Express {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));
  app.locals.deps = deps;

  app.get("/health", (_req, res) => res.json({ status: "ok", backend: deps.backend.name }));
  return app;
}
```

- [ ] **Step 8: Write `server.ts`**

`services/search/src/server.ts`:
```ts
import { createApp } from "./app.js";
import { getKnex } from "@zordms/db";
import { loadConfig } from "@zordms/config";
import { selectBackend } from "./backend/index.js";
import { startIndexConsumer } from "./consumer/indexConsumer.js";

const config = loadConfig();
const knex = getKnex();
await knex.migrate.latest();
const backend = selectBackend(config, knex);
const app = createApp({ knex, config, backend });
await startIndexConsumer({ knex, backend }).catch((e) => console.error("consumer start failed", e));
const port = Number(process.env.SEARCH_PORT ?? 4005);
app.listen(port, () => console.log(`ZorDMS search (${backend.name}) on :${port}`));
```

(Note: `selectBackend`, `startIndexConsumer`, and the full backend are added in Tasks 3, 4, 7; `server.ts` is not exercised by unit tests but is wired here so the final build links. Until those modules exist this file will not compile — keep `server.ts` last in the build by completing Tasks 2–7 before running a full `pnpm --filter @zordms/search build`.)

- [ ] **Step 9: Run test to verify it passes**

Run: `pnpm --filter @zordms/search test`
Expected: PASS (1 test). Build of `server.ts` is deferred until Task 7.

- [ ] **Step 10: Commit**

```bash
git add services/search/package.json services/search/tsconfig.json services/search/vitest.config.ts services/search/src/app.ts services/search/src/server.ts services/search/src/backend/SqlSearchBackend.ts
git commit -m "feat(search): service scaffold, app factory + health route"
```

---

## Task 2: Shared search contracts in `@zordms/types`

**Files:**
- Modify: `packages/types/src/index.ts`
- Test: `packages/types/src/search.test.ts`

**Interfaces:**
- Produces TS contracts:
  - `SearchDoc` — the indexable document shape (`doc_id`, `ocr_text`, `metadata_text`, `doc_type`, `branch`, `status`, `risk_band`, `legal_hold`, `expiry_status`, `uploaded_by`, `indexed_at`).
  - `SearchMode = "fulltext" | "boolean" | "wildcard" | "fuzzy" | "semantic"`.
  - `SearchFilters` — `doc_type?`, `status?`, `branch?`, `uploaded_by?`, `risk_band?`, `legal_hold?`, `expiry_status?`, `date_from?`, `date_to?`.
  - `SearchQuery` — `{ text: string; mode: SearchMode; filters?: SearchFilters; page?: number; pageSize?: number; sort?: "relevance" | "recent" }`.
  - `SearchScope` — `{ branch?: string; region?: string; crossBranch: boolean }`.
  - `SearchHit` — `{ doc_id, doc_type, branch, status, snippet, score, indexed_at }`.
  - `SearchResults` — `{ hits: SearchHit[]; total: number; page: number; pageSize: number; tookMs: number; facets?: Record<string, Array<{ value: string; count: number }>> }`.
  - `SavedSearch` — `{ id, user_id, name, query_json, visibility }`; `SaveSearchRequest`.
  - Guard `isSearchQuery(x): x is SearchQuery`.

- [ ] **Step 1: Write the failing test**

`packages/types/src/search.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { isSearchQuery } from "./index.js";

describe("isSearchQuery", () => {
  it("accepts a well-formed query", () => {
    expect(isSearchQuery({ text: "loan", mode: "fulltext" })).toBe(true);
  });
  it("rejects an unknown mode", () => {
    expect(isSearchQuery({ text: "loan", mode: "regex" })).toBe(false);
  });
  it("rejects a missing text field", () => {
    expect(isSearchQuery({ mode: "fulltext" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zordms/types test search`
Expected: FAIL — `isSearchQuery` not exported.

- [ ] **Step 3: Append the contracts to `packages/types/src/index.ts`**

```ts
// ---- Search domain (Plan 5) ----

export interface SearchDoc {
  doc_id: string;
  ocr_text: string;
  metadata_text: string;
  doc_type: string;
  branch: string;
  status: string;
  risk_band: string;           // low | medium | high
  legal_hold: boolean;
  expiry_status: string;       // none | le30 | le90 | expired
  uploaded_by: string;
  indexed_at: string;          // ISO timestamp
}

export type SearchMode = "fulltext" | "boolean" | "wildcard" | "fuzzy" | "semantic";

export interface SearchFilters {
  doc_type?: string;
  status?: string;
  branch?: string;
  uploaded_by?: string;
  risk_band?: string;
  legal_hold?: boolean;
  expiry_status?: string;      // none | le30 | le90 | expired
  date_from?: string;          // ISO
  date_to?: string;            // ISO
}

export interface SearchQuery {
  text: string;
  mode: SearchMode;
  filters?: SearchFilters;
  page?: number;
  pageSize?: number;
  sort?: "relevance" | "recent";
}

export interface SearchScope {
  branch?: string;
  region?: string;
  crossBranch: boolean;
}

export interface SearchHit {
  doc_id: string;
  doc_type: string;
  branch: string;
  status: string;
  snippet: string;
  score: number;
  indexed_at: string;
}

export interface SearchResults {
  hits: SearchHit[];
  total: number;
  page: number;
  pageSize: number;
  tookMs: number;
  facets?: Record<string, Array<{ value: string; count: number }>>;
}

export type SavedSearchVisibility = "private" | "public";

export interface SavedSearch {
  id: number;
  user_id: number;
  name: string;
  query_json: SearchQuery;
  visibility: SavedSearchVisibility;
}

export interface SaveSearchRequest {
  name: string;
  query: SearchQuery;
  visibility: SavedSearchVisibility;
}

const SEARCH_MODES: SearchMode[] = ["fulltext", "boolean", "wildcard", "fuzzy", "semantic"];

export function isSearchQuery(x: unknown): x is SearchQuery {
  const q = x as SearchQuery;
  return !!q && typeof q.text === "string" && SEARCH_MODES.includes(q.mode);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @zordms/types test search`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/types/src/index.ts packages/types/src/search.test.ts
git commit -m "feat(types): search query/result/saved-search contracts"
```

---

## Task 3: `search_index` + `saved_searches` migration

**Files:**
- Create: `packages/db/src/migrations/20260623_0005_search.ts`
- Test: `packages/db/src/migrations/search.test.ts`

**Interfaces:**
- Produces tables:
  - `search_index` — `id` (PK), `doc_id` (unique), `ocr_text`, `metadata_text`, `doc_type`, `branch`, `status`, `risk_band`, `legal_hold`, `expiry_status`, `uploaded_by`, `tokens` (lowercased concatenation used for portable `LIKE` matching), `indexed_at`. Indexed on `doc_type`, `branch`, `status`.
  - `saved_searches` — `id` (PK), `user_id`, `name`, `query_json` (text), `visibility`, `created_at`.
- A dialect-guarded `tsvector` GIN index is created **only** when `knex.client.config.client === "pg"` (skipped on sqlite/oracle).

- [ ] **Step 1: Write the failing test (runs the migration on in-memory sqlite)**

`packages/db/src/migrations/search.test.ts`:
```ts
import { describe, it, expect, afterAll } from "vitest";
import knexLib from "knex";
import { buildKnexConfig } from "../knexConfig.js";

const knex = knexLib(buildKnexConfig({
  client: "sqlite3", host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "",
}));

afterAll(async () => { await knex.destroy(); });

describe("search migration", () => {
  it("creates search_index and saved_searches tables", async () => {
    await knex.migrate.latest();
    expect(await knex.schema.hasTable("search_index")).toBe(true);
    expect(await knex.schema.hasTable("saved_searches")).toBe(true);
  });

  it("search_index carries the expected columns", async () => {
    for (const c of ["doc_id", "ocr_text", "metadata_text", "doc_type", "branch", "status", "risk_band", "legal_hold", "expiry_status", "uploaded_by", "tokens", "indexed_at"]) {
      expect(await knex.schema.hasColumn("search_index", c)).toBe(true);
    }
  });

  it("enforces unique doc_id", async () => {
    await knex("search_index").insert({ doc_id: "D1", ocr_text: "", metadata_text: "", doc_type: "x", branch: "b", status: "s", risk_band: "low", legal_hold: false, expiry_status: "none", uploaded_by: "u", tokens: "", indexed_at: new Date().toISOString() });
    await expect(
      knex("search_index").insert({ doc_id: "D1", ocr_text: "", metadata_text: "", doc_type: "x", branch: "b", status: "s", risk_band: "low", legal_hold: false, expiry_status: "none", uploaded_by: "u", tokens: "", indexed_at: new Date().toISOString() })
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zordms/db test search`
Expected: FAIL — no `search_index` table (migration absent).

- [ ] **Step 3: Write the migration**

`packages/db/src/migrations/20260623_0005_search.ts`:
```ts
import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("search_index", (t) => {
    t.increments("id").primary();
    t.string("doc_id", 120).notNullable().unique();
    t.text("ocr_text");
    t.text("metadata_text");
    t.string("doc_type", 120).notNullable();
    t.string("branch", 120).notNullable();
    t.string("status", 40).notNullable();
    t.string("risk_band", 20).notNullable().defaultTo("low");
    t.boolean("legal_hold").notNullable().defaultTo(false);
    t.string("expiry_status", 20).notNullable().defaultTo("none"); // none | le30 | le90 | expired
    t.string("uploaded_by", 120);
    t.text("tokens"); // lowercased ocr_text + metadata_text + doc_type for portable LIKE
    t.timestamp("indexed_at").defaultTo(knex.fn.now());
    t.index(["doc_type"], "idx_search_doc_type");
    t.index(["branch"], "idx_search_branch");
    t.index(["status"], "idx_search_status");
  });

  await knex.schema.createTable("saved_searches", (t) => {
    t.increments("id").primary();
    t.integer("user_id").notNullable();
    t.string("name", 200).notNullable();
    t.text("query_json").notNullable();
    t.string("visibility", 20).notNullable().defaultTo("private"); // private | public
    t.timestamp("created_at").defaultTo(knex.fn.now());
    t.index(["user_id"], "idx_saved_user");
  });

  // Postgres-only FTS acceleration; skipped on sqlite/oracle (Phase-1 LIKE works everywhere).
  if (knex.client.config.client === "pg") {
    await knex.raw(
      "CREATE INDEX IF NOT EXISTS idx_search_tsv ON search_index USING GIN (to_tsvector('simple', coalesce(tokens, '')))"
    );
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("saved_searches");
  await knex.schema.dropTableIfExists("search_index");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @zordms/db test search`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/migrations/20260623_0005_search.ts packages/db/src/migrations/search.test.ts
git commit -m "feat(db): search_index + saved_searches migration (PG GIN guarded)"
```

---

## Task 4: Tokenizer + `SearchBackend` interface + ES stub

**Files:**
- Create: `services/search/src/query/tokenize.ts`, `services/search/src/backend/SearchBackend.ts`, `services/search/src/backend/EsSearchBackend.ts`
- Test: `services/search/src/query/tokenize.test.ts`, `services/search/src/backend/EsSearchBackend.test.ts`

**Interfaces:**
- `tokenize(parts: string[]): string` — lowercases, strips punctuation to spaces, collapses whitespace, joins; used to build the `tokens` column.
- `buildTokensForDoc(doc: SearchDoc): string` — `tokenize([doc.ocr_text, doc.metadata_text, doc.doc_type])`.
- `SearchBackend` (interface):
  - `name: "sql" | "es"`
  - `index(doc: SearchDoc): Promise<void>`
  - `bulkIndex(docs: SearchDoc[]): Promise<void>`
  - `search(query: SearchQuery, scope: SearchScope): Promise<SearchResults>`
  - `delete(docId: string): Promise<void>`
  - `reindexAll(docs: SearchDoc[]): Promise<number>`
- `EsSearchBackend implements SearchBackend` — real class; every method throws `Error("es_backend_not_enabled")` until Phase 2 injects a live `@elastic/elasticsearch` client.

- [ ] **Step 1: Write the failing tokenize test**

`services/search/src/query/tokenize.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { tokenize, buildTokensForDoc } from "./tokenize.js";

describe("tokenize", () => {
  it("lowercases, strips punctuation, collapses whitespace", () => {
    expect(tokenize(["Loan Application #42!", "  Thimphu  "])).toBe("loan application 42 thimphu");
  });
  it("builds tokens from a search doc", () => {
    const toks = buildTokensForDoc({
      doc_id: "D1", ocr_text: "KYC Form", metadata_text: "Customer: Dorji", doc_type: "BT_CID_4G",
      branch: "Thimphu", status: "indexed", risk_band: "low", legal_hold: false, expiry_status: "none",
      uploaded_by: "u1", indexed_at: "2026-06-23T00:00:00Z",
    });
    expect(toks).toContain("kyc form");
    expect(toks).toContain("dorji");
    expect(toks).toContain("bt_cid_4g");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zordms/search test tokenize`
Expected: FAIL — `./tokenize.js` not found.

- [ ] **Step 3: Write `query/tokenize.ts`**

```ts
import type { SearchDoc } from "@zordms/types";

export function tokenize(parts: Array<string | undefined | null>): string {
  return parts
    .filter((p): p is string => typeof p === "string")
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9_-￿]+/g, " ") // keep word chars + unicode (Dzongkha), drop punctuation
    .replace(/\s+/g, " ")
    .trim();
}

export function buildTokensForDoc(doc: SearchDoc): string {
  return tokenize([doc.ocr_text, doc.metadata_text, doc.doc_type]);
}
```

- [ ] **Step 4: Run tokenize test to verify it passes**

Run: `pnpm --filter @zordms/search test tokenize`
Expected: PASS.

- [ ] **Step 5: Write `backend/SearchBackend.ts`**

```ts
import type { SearchDoc, SearchQuery, SearchResults, SearchScope } from "@zordms/types";

export interface SearchBackend {
  readonly name: "sql" | "es";
  index(doc: SearchDoc): Promise<void>;
  bulkIndex(docs: SearchDoc[]): Promise<void>;
  search(query: SearchQuery, scope: SearchScope): Promise<SearchResults>;
  delete(docId: string): Promise<void>;
  reindexAll(docs: SearchDoc[]): Promise<number>;
}
```

- [ ] **Step 6: Write the failing ES-stub test**

`services/search/src/backend/EsSearchBackend.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { EsSearchBackend } from "./EsSearchBackend.js";

describe("EsSearchBackend (Phase-2 stub)", () => {
  const es = new EsSearchBackend();

  it("reports the es backend name", () => {
    expect(es.name).toBe("es");
  });

  it("throws es_backend_not_enabled until Phase 2 wires a client", async () => {
    await expect(es.search({ text: "x", mode: "fulltext" }, { crossBranch: true })).rejects.toThrow(/es_backend_not_enabled/);
    await expect(es.index({} as any)).rejects.toThrow(/es_backend_not_enabled/);
  });
});
```

- [ ] **Step 7: Run ES-stub test to verify it fails**

Run: `pnpm --filter @zordms/search test EsSearchBackend`
Expected: FAIL — module not found.

- [ ] **Step 8: Write `backend/EsSearchBackend.ts`**

```ts
import type { SearchBackend } from "./SearchBackend.js";
import type { SearchDoc, SearchQuery, SearchResults, SearchScope } from "@zordms/types";

/**
 * Phase-2 Elasticsearch backend. Same interface as SqlSearchBackend, so the
 * service is backend-agnostic. Until Phase 2 injects a live @elastic/elasticsearch
 * client (see "Phase-2 ES cutover" at the bottom of this plan), every method
 * fails fast with es_backend_not_enabled. The shape is final; only the bodies change.
 */
export class EsSearchBackend implements SearchBackend {
  readonly name = "es" as const;
  private fail(): never { throw new Error("es_backend_not_enabled"); }

  async index(_doc: SearchDoc): Promise<void> { this.fail(); }
  async bulkIndex(_docs: SearchDoc[]): Promise<void> { this.fail(); }
  async search(_query: SearchQuery, _scope: SearchScope): Promise<SearchResults> { this.fail(); }
  async delete(_docId: string): Promise<void> { this.fail(); }
  async reindexAll(_docs: SearchDoc[]): Promise<number> { this.fail(); }
}
```

- [ ] **Step 9: Run ES-stub test to verify it passes**

Run: `pnpm --filter @zordms/search test EsSearchBackend`
Expected: PASS (2 tests).

- [ ] **Step 10: Commit**

```bash
git add services/search/src/query/tokenize.ts services/search/src/query/tokenize.test.ts services/search/src/backend/SearchBackend.ts services/search/src/backend/EsSearchBackend.ts services/search/src/backend/EsSearchBackend.test.ts
git commit -m "feat(search): tokenizer, SearchBackend interface, ES Phase-2 stub"
```

---

## Task 5: Query builder (modes + facets + scope) — pure unit-tested

**Files:**
- Create: `services/search/src/query/buildQuery.ts`, `services/search/src/query/facets.ts`
- Test: `services/search/src/query/buildQuery.test.ts`

**Interfaces:**
- `applyScope(qb: Knex.QueryBuilder, scope: SearchScope): Knex.QueryBuilder` — when `!crossBranch`, restricts to `where branch = scope.branch`.
- `applyFilters(qb: Knex.QueryBuilder, filters: SearchFilters): Knex.QueryBuilder` — type/status/branch/uploaded_by/risk_band/legal_hold/expiry_status equality + `indexed_at` between `date_from`/`date_to`.
- `applyTextMatch(qb: Knex.QueryBuilder, text: string, mode: SearchMode): Knex.QueryBuilder` — builds the `tokens` predicate per mode:
  - `fulltext`/`fuzzy`/`semantic` → AND of `whereILike('tokens', %term%)` for each term (semantic is a Phase-1 placeholder that routes through the same LIKE path; see "Semantic routing" note).
  - `boolean` → parse `AND`/`OR`/`NOT` operators between terms.
  - `wildcard` → translate user `*` / `?` to SQL `%` / `_` and use `whereILike`.
- `scoreHit(tokens: string, terms: string[]): number` — term-frequency relevance score in `[0,1]`.
- `paginate(page, pageSize): { limit, offset }` (defaults page=1, pageSize=20, max 100).
- `facets.ts`: `aggregateFacets(rows: Array<{ doc_type; status; branch; risk_band }>): Record<string, {value,count}[]>`.

- [ ] **Step 1: Write the failing test**

`services/search/src/query/buildQuery.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import knexLib from "knex";
import { applyScope, applyFilters, applyTextMatch, scoreHit, paginate } from "./buildQuery.js";
import { aggregateFacets } from "./facets.js";

const knex = knexLib({ client: "sqlite3", useNullAsDefault: true });
const base = () => knex("search_index");

describe("applyScope", () => {
  it("restricts to own branch without crossbranch", () => {
    const sql = applyScope(base(), { crossBranch: false, branch: "Thimphu" }).toString();
    expect(sql).toMatch(/branch.*=.*Thimphu/);
  });
  it("does not restrict branch when crossBranch is true", () => {
    const sql = applyScope(base(), { crossBranch: true }).toString();
    expect(sql).not.toMatch(/where/i);
  });
});

describe("applyFilters", () => {
  it("filters by doc_type, status and legal_hold", () => {
    const sql = applyFilters(base(), { doc_type: "BT_CID_4G", status: "indexed", legal_hold: true }).toString();
    expect(sql).toMatch(/doc_type.*BT_CID_4G/);
    expect(sql).toMatch(/status.*indexed/);
    expect(sql).toMatch(/legal_hold/);
  });
  it("applies a date range on indexed_at", () => {
    const sql = applyFilters(base(), { date_from: "2026-01-01", date_to: "2026-12-31" }).toString();
    expect(sql).toMatch(/indexed_at/);
    expect(sql).toMatch(/2026-01-01/);
  });
  it("maps expiry_status le30 to a stored value filter", () => {
    const sql = applyFilters(base(), { expiry_status: "le30" }).toString();
    expect(sql).toMatch(/expiry_status.*le30/);
  });
});

describe("applyTextMatch", () => {
  it("fulltext ANDs each term as a LIKE on tokens", () => {
    const sql = applyTextMatch(base(), "loan dorji", "fulltext").toString();
    expect(sql).toMatch(/tokens.*like.*%loan%/i);
    expect(sql).toMatch(/tokens.*like.*%dorji%/i);
  });
  it("wildcard translates * and ? to SQL % and _", () => {
    const sql = applyTextMatch(base(), "dor*", "wildcard").toString();
    expect(sql).toMatch(/like.*%dor%/i);
  });
  it("boolean honours NOT to exclude a term", () => {
    const sql = applyTextMatch(base(), "loan NOT closed", "boolean").toString();
    expect(sql).toMatch(/not like.*%closed%/i);
  });
});

describe("scoreHit", () => {
  it("scores higher when more query terms appear", () => {
    const a = scoreHit("loan application dorji thimphu", ["loan", "dorji"]);
    const b = scoreHit("loan application", ["loan", "dorji"]);
    expect(a).toBeGreaterThan(b);
    expect(a).toBeLessThanOrEqual(1);
  });
});

describe("paginate", () => {
  it("defaults to page 1 / size 20 and caps size at 100", () => {
    expect(paginate()).toEqual({ limit: 20, offset: 0 });
    expect(paginate(3, 25)).toEqual({ limit: 25, offset: 50 });
    expect(paginate(1, 5000)).toEqual({ limit: 100, offset: 0 });
  });
});

describe("aggregateFacets", () => {
  it("counts distinct values per facet dimension", () => {
    const f = aggregateFacets([
      { doc_type: "A", status: "x", branch: "T", risk_band: "low" },
      { doc_type: "A", status: "y", branch: "T", risk_band: "high" },
      { doc_type: "B", status: "x", branch: "P", risk_band: "low" },
    ]);
    expect(f.doc_type).toEqual(expect.arrayContaining([{ value: "A", count: 2 }, { value: "B", count: 1 }]));
    expect(f.branch).toEqual(expect.arrayContaining([{ value: "T", count: 2 }, { value: "P", count: 1 }]));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zordms/search test buildQuery`
Expected: FAIL — `./buildQuery.js` / `./facets.js` not found.

- [ ] **Step 3: Write `query/buildQuery.ts`**

```ts
import type { Knex } from "knex";
import type { SearchFilters, SearchMode, SearchScope } from "@zordms/types";

export function applyScope(qb: Knex.QueryBuilder, scope: SearchScope): Knex.QueryBuilder {
  if (!scope.crossBranch && scope.branch) qb.where("branch", scope.branch);
  return qb;
}

export function applyFilters(qb: Knex.QueryBuilder, filters: SearchFilters = {}): Knex.QueryBuilder {
  if (filters.doc_type) qb.where("doc_type", filters.doc_type);
  if (filters.status) qb.where("status", filters.status);
  if (filters.branch) qb.where("branch", filters.branch);
  if (filters.uploaded_by) qb.where("uploaded_by", filters.uploaded_by);
  if (filters.risk_band) qb.where("risk_band", filters.risk_band);
  if (typeof filters.legal_hold === "boolean") qb.where("legal_hold", filters.legal_hold);
  if (filters.expiry_status) qb.where("expiry_status", filters.expiry_status);
  if (filters.date_from) qb.where("indexed_at", ">=", filters.date_from);
  if (filters.date_to) qb.where("indexed_at", "<=", filters.date_to);
  return qb;
}

const STOP = new Set(["and", "or", "not"]);

function terms(text: string): string[] {
  return text.toLowerCase().split(/\s+/).filter((t) => t.length > 0);
}

export function applyTextMatch(qb: Knex.QueryBuilder, text: string, mode: SearchMode): Knex.QueryBuilder {
  if (!text.trim()) return qb;

  if (mode === "boolean") {
    const toks = text.split(/\s+/);
    let i = 0;
    while (i < toks.length) {
      const t = toks[i];
      const up = t.toUpperCase();
      if (up === "OR") {
        const next = toks[i + 1];
        if (next) qb.orWhereILike("tokens", `%${next.toLowerCase()}%`);
        i += 2; continue;
      }
      if (up === "NOT") {
        const next = toks[i + 1];
        if (next) qb.whereNot((b) => b.whereILike("tokens", `%${next.toLowerCase()}%`));
        i += 2; continue;
      }
      if (up === "AND") { i += 1; continue; }
      qb.whereILike("tokens", `%${t.toLowerCase()}%`);
      i += 1;
    }
    return qb;
  }

  if (mode === "wildcard") {
    for (const raw of terms(text)) {
      if (STOP.has(raw)) continue;
      const pat = raw.replace(/\*/g, "%").replace(/\?/g, "_");
      qb.whereILike("tokens", `%${pat}%`);
    }
    return qb;
  }

  // fulltext | fuzzy | semantic (Phase-1 placeholder) -> AND of LIKE terms
  for (const raw of terms(text)) {
    if (STOP.has(raw)) continue;
    qb.whereILike("tokens", `%${raw}%`);
  }
  return qb;
}

export function scoreHit(tokens: string, queryTerms: string[]): number {
  if (queryTerms.length === 0) return 0;
  const lc = tokens.toLowerCase();
  let matched = 0;
  for (const t of queryTerms) if (t && lc.includes(t.toLowerCase())) matched += 1;
  return Math.min(1, matched / queryTerms.length);
}

export function paginate(page = 1, pageSize = 20): { limit: number; offset: number } {
  const size = Math.min(Math.max(1, pageSize), 100);
  const p = Math.max(1, page);
  return { limit: size, offset: (p - 1) * size };
}
```

- [ ] **Step 4: Write `query/facets.ts`**

```ts
type FacetRow = { doc_type: string; status: string; branch: string; risk_band: string };

const DIMENSIONS: Array<keyof FacetRow> = ["doc_type", "status", "branch", "risk_band"];

export function aggregateFacets(rows: FacetRow[]): Record<string, Array<{ value: string; count: number }>> {
  const out: Record<string, Array<{ value: string; count: number }>> = {};
  for (const dim of DIMENSIONS) {
    const counts = new Map<string, number>();
    for (const r of rows) {
      const v = r[dim];
      if (v == null) continue;
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    out[dim] = [...counts.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count);
  }
  return out;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @zordms/search test buildQuery`
Expected: PASS (all describe blocks).

- [ ] **Step 6: Commit**

```bash
git add services/search/src/query/buildQuery.ts services/search/src/query/facets.ts services/search/src/query/buildQuery.test.ts
git commit -m "feat(search): query builder — modes, filters, scope, scoring, facets"
```

---

## Task 6: `SqlSearchBackend` — full implementation

**Files:**
- Modify: `services/search/src/backend/SqlSearchBackend.ts` (complete it)
- Create: `services/search/src/backend/index.ts` (`selectBackend`)
- Test: `services/search/src/backend/SqlSearchBackend.test.ts`

**Interfaces:**
- `SqlSearchBackend implements SearchBackend` (name `"sql"`):
  - `index(doc)` → upsert by `doc_id` (delete-then-insert for portability), storing `tokens = buildTokensForDoc(doc)`.
  - `bulkIndex(docs)` → loop `index`.
  - `search(query, scope)` → applies scope + filters + text match, paginates, computes per-row `score` via `scoreHit`, builds `snippet` (first 160 chars of `ocr_text`), sorts by `score` (or `indexed_at` when `sort==="recent"`), runs a parallel `total` count + facet aggregation, measures `tookMs`.
  - `delete(docId)` → delete row.
  - `reindexAll(docs)` → truncate-equivalent (`del()`) then `bulkIndex`; returns count.
- `selectBackend(config, knex): SearchBackend` — returns `EsSearchBackend` when `process.env.SEARCH_BACKEND === "es"`, else `SqlSearchBackend`.

- [ ] **Step 1: Write the failing test (seeded sqlite)**

`services/search/src/backend/SqlSearchBackend.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import knexLib from "knex";
import { buildKnexConfig } from "@zordms/db";
import { SqlSearchBackend } from "./SqlSearchBackend.js";
import { selectBackend } from "./index.js";
import { loadConfig } from "@zordms/config";
import type { SearchDoc } from "@zordms/types";

const knex = knexLib(buildKnexConfig({
  client: "sqlite3", host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "",
}));
const backend = new SqlSearchBackend(knex);

function doc(over: Partial<SearchDoc>): SearchDoc {
  return {
    doc_id: "D1", ocr_text: "Loan application for Dorji", metadata_text: "Customer Dorji, Thimphu",
    doc_type: "BOB_LOAN_APPLICATION", branch: "Thimphu", status: "indexed", risk_band: "low",
    legal_hold: false, expiry_status: "none", uploaded_by: "maker1", indexed_at: "2026-06-23T00:00:00Z", ...over,
  };
}

beforeAll(async () => { await knex.migrate.latest(); });
afterAll(async () => { await knex.destroy(); });
beforeEach(async () => { await knex("search_index").del(); });

describe("SqlSearchBackend", () => {
  it("indexes and finds a document by full text, scoped to crossbranch", async () => {
    await backend.index(doc({}));
    const res = await backend.search({ text: "dorji", mode: "fulltext" }, { crossBranch: true });
    expect(res.total).toBe(1);
    expect(res.hits[0].doc_id).toBe("D1");
    expect(res.hits[0].score).toBeGreaterThan(0);
    expect(res.tookMs).toBeGreaterThanOrEqual(0);
  });

  it("re-indexing the same doc_id upserts rather than duplicating", async () => {
    await backend.index(doc({}));
    await backend.index(doc({ status: "approved" }));
    const all = await knex("search_index").where({ doc_id: "D1" });
    expect(all.length).toBe(1);
    expect(all[0].status).toBe("approved");
  });

  it("scopes out other branches when crossBranch is false", async () => {
    await backend.index(doc({ doc_id: "D1", branch: "Thimphu" }));
    await backend.index(doc({ doc_id: "D2", branch: "Paro" }));
    const res = await backend.search({ text: "dorji", mode: "fulltext" }, { crossBranch: false, branch: "Paro" });
    expect(res.hits.map((h) => h.doc_id)).toEqual(["D2"]);
  });

  it("applies facet filters and returns facet counts", async () => {
    await backend.index(doc({ doc_id: "D1", doc_type: "BOB_LOAN_APPLICATION" }));
    await backend.index(doc({ doc_id: "D2", doc_type: "BT_CID_4G", ocr_text: "Dorji CID" }));
    const res = await backend.search({ text: "dorji", mode: "fulltext", filters: { doc_type: "BT_CID_4G" } }, { crossBranch: true });
    expect(res.hits.map((h) => h.doc_id)).toEqual(["D2"]);
    expect(res.facets!.doc_type.length).toBeGreaterThan(0);
  });

  it("paginates results", async () => {
    for (let i = 0; i < 25; i++) await backend.index(doc({ doc_id: `D${i}`, ocr_text: "shared term" }));
    const page1 = await backend.search({ text: "shared", mode: "fulltext", page: 1, pageSize: 10 }, { crossBranch: true });
    expect(page1.hits.length).toBe(10);
    expect(page1.total).toBe(25);
    const page3 = await backend.search({ text: "shared", mode: "fulltext", page: 3, pageSize: 10 }, { crossBranch: true });
    expect(page3.hits.length).toBe(5);
  });

  it("deletes a document from the index", async () => {
    await backend.index(doc({}));
    await backend.delete("D1");
    const res = await backend.search({ text: "dorji", mode: "fulltext" }, { crossBranch: true });
    expect(res.total).toBe(0);
  });

  it("reindexAll replaces the whole index", async () => {
    await backend.index(doc({ doc_id: "OLD" }));
    const n = await backend.reindexAll([doc({ doc_id: "N1" }), doc({ doc_id: "N2" })]);
    expect(n).toBe(2);
    const rows = await knex("search_index").pluck("doc_id");
    expect(rows.sort()).toEqual(["N1", "N2"]);
  });
});

describe("selectBackend", () => {
  it("returns the SQL backend by default", () => {
    delete process.env.SEARCH_BACKEND;
    expect(selectBackend(loadConfig({} as NodeJS.ProcessEnv), knex).name).toBe("sql");
  });
  it("returns the ES backend when SEARCH_BACKEND=es", () => {
    process.env.SEARCH_BACKEND = "es";
    expect(selectBackend(loadConfig({} as NodeJS.ProcessEnv), knex).name).toBe("es");
    delete process.env.SEARCH_BACKEND;
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zordms/search test SqlSearchBackend`
Expected: FAIL — `SqlSearchBackend` has no `index`/`search` yet; `./index.js` missing.

- [ ] **Step 3: Complete `backend/SqlSearchBackend.ts`**

```ts
import type { Knex } from "knex";
import type { SearchBackend } from "./SearchBackend.js";
import type { SearchDoc, SearchQuery, SearchResults, SearchScope, SearchHit } from "@zordms/types";
import { buildTokensForDoc } from "../query/tokenize.js";
import { applyScope, applyFilters, applyTextMatch, scoreHit, paginate } from "../query/buildQuery.js";
import { aggregateFacets } from "../query/facets.js";

interface Row {
  doc_id: string; ocr_text: string; metadata_text: string; doc_type: string;
  branch: string; status: string; risk_band: string; legal_hold: boolean;
  expiry_status: string; uploaded_by: string; tokens: string; indexed_at: string;
}

export class SqlSearchBackend implements SearchBackend {
  readonly name = "sql" as const;
  constructor(private readonly knex: Knex) {}

  private rowFor(doc: SearchDoc): Row {
    return {
      doc_id: doc.doc_id, ocr_text: doc.ocr_text ?? "", metadata_text: doc.metadata_text ?? "",
      doc_type: doc.doc_type, branch: doc.branch, status: doc.status, risk_band: doc.risk_band ?? "low",
      legal_hold: !!doc.legal_hold, expiry_status: doc.expiry_status ?? "none", uploaded_by: doc.uploaded_by ?? "",
      tokens: buildTokensForDoc(doc), indexed_at: doc.indexed_at,
    };
  }

  async index(doc: SearchDoc): Promise<void> {
    const row = this.rowFor(doc);
    await this.knex("search_index").where({ doc_id: row.doc_id }).del();
    await this.knex("search_index").insert(row);
  }

  async bulkIndex(docs: SearchDoc[]): Promise<void> {
    for (const d of docs) await this.index(d);
  }

  async delete(docId: string): Promise<void> {
    await this.knex("search_index").where({ doc_id: docId }).del();
  }

  async reindexAll(docs: SearchDoc[]): Promise<number> {
    await this.knex("search_index").del();
    await this.bulkIndex(docs);
    return docs.length;
  }

  async search(query: SearchQuery, scope: SearchScope): Promise<SearchResults> {
    const started = Date.now();
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const { limit, offset } = paginate(page, pageSize);
    const qTerms = query.text.toLowerCase().split(/\s+/).filter((t) => t && !["and", "or", "not"].includes(t));

    const predicate = (qb: Knex.QueryBuilder) => {
      applyScope(qb, scope);
      applyFilters(qb, query.filters ?? {});
      applyTextMatch(qb, query.text, query.mode);
      return qb;
    };

    // Total + facets over the full matched set (facet rows kept lean).
    const facetRows = (await predicate(this.knex("search_index"))
      .select("doc_type", "status", "branch", "risk_band")) as Array<{ doc_type: string; status: string; branch: string; risk_band: string }>;
    const total = facetRows.length;

    const rows = (await predicate(this.knex("search_index"))
      .select("doc_id", "ocr_text", "doc_type", "branch", "status", "tokens", "indexed_at")
      .orderBy(query.sort === "recent" ? "indexed_at" : "indexed_at", "desc")
      .limit(limit)
      .offset(offset)) as Array<Pick<Row, "doc_id" | "ocr_text" | "doc_type" | "branch" | "status" | "tokens" | "indexed_at">>;

    let hits: SearchHit[] = rows.map((r) => ({
      doc_id: r.doc_id, doc_type: r.doc_type, branch: r.branch, status: r.status,
      snippet: (r.ocr_text ?? "").slice(0, 160),
      score: scoreHit(r.tokens ?? "", qTerms),
      indexed_at: r.indexed_at,
    }));

    if (query.sort !== "recent") hits = hits.sort((a, b) => b.score - a.score);

    return {
      hits, total, page, pageSize, tookMs: Date.now() - started,
      facets: aggregateFacets(facetRows),
    };
  }
}
```

- [ ] **Step 4: Write `backend/index.ts`**

```ts
import type { Knex } from "knex";
import type { AppConfig } from "@zordms/config";
import type { SearchBackend } from "./SearchBackend.js";
import { SqlSearchBackend } from "./SqlSearchBackend.js";
import { EsSearchBackend } from "./EsSearchBackend.js";

export function selectBackend(_config: AppConfig, knex: Knex): SearchBackend {
  if (process.env.SEARCH_BACKEND === "es") return new EsSearchBackend();
  return new SqlSearchBackend(knex);
}

export { SqlSearchBackend, EsSearchBackend };
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @zordms/search test SqlSearchBackend`
Expected: PASS (all backend + selectBackend tests).

- [ ] **Step 6: Commit**

```bash
git add services/search/src/backend/SqlSearchBackend.ts services/search/src/backend/index.ts services/search/src/backend/SqlSearchBackend.test.ts
git commit -m "feat(search): SQL backend (index/search/delete/reindex) + backend selector"
```

---

## Task 7: Index consumer + reindex endpoint

**Files:**
- Create: `services/search/src/consumer/indexConsumer.ts`, `services/search/src/routes/reindex.ts`
- Modify: `services/search/src/app.ts` (mount `/admin`), `services/search/src/server.ts` (already calls `startIndexConsumer`)
- Test: `services/search/src/consumer/indexConsumer.test.ts`, `services/search/src/routes/reindex.test.ts`

**Interfaces:**
- `handleDocumentEvent(backend, payload): Promise<void>` — maps an event payload (`document.indexed` / `document.cataloged`) to a `SearchDoc` and calls `backend.index`. A `document.deleted` payload calls `backend.delete`.
- `startIndexConsumer(deps: { knex; backend }): Promise<void>` — subscribes to `document.indexed`, `document.cataloged`, `document.deleted` on the `@zordms/events` bus and dispatches to `handleDocumentEvent`. (In tests we call `handleDocumentEvent` directly; the bus wiring is thin.)
- `POST /admin/reindex` (`requirePermission("admin:access")`) body `{ docs: SearchDoc[] }` → `{ reindexed: number }` via `backend.reindexAll`.

- [ ] **Step 1: Write the failing consumer test**

`services/search/src/consumer/indexConsumer.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import knexLib from "knex";
import { buildKnexConfig } from "@zordms/db";
import { SqlSearchBackend } from "../backend/SqlSearchBackend.js";
import { handleDocumentEvent } from "./indexConsumer.js";

const knex = knexLib(buildKnexConfig({
  client: "sqlite3", host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "",
}));
const backend = new SqlSearchBackend(knex);

beforeAll(async () => { await knex.migrate.latest(); });
afterAll(async () => { await knex.destroy(); });
beforeEach(async () => { await knex("search_index").del(); });

const payload = {
  doc_id: "DOC-7", ocr_text: "Passport for Tashi", metadata_text: "Name: Tashi",
  doc_type: "BT_PASSPORT", branch: "Thimphu", status: "indexed", risk_band: "medium",
  legal_hold: false, expiry_status: "le90", uploaded_by: "indexer1", indexed_at: "2026-06-23T10:00:00Z",
};

describe("handleDocumentEvent", () => {
  it("indexes on document.indexed", async () => {
    await handleDocumentEvent(backend, "document.indexed", payload);
    const res = await backend.search({ text: "tashi", mode: "fulltext" }, { crossBranch: true });
    expect(res.total).toBe(1);
  });

  it("re-indexes (upsert) on document.cataloged", async () => {
    await handleDocumentEvent(backend, "document.indexed", payload);
    await handleDocumentEvent(backend, "document.cataloged", { ...payload, status: "cataloged" });
    const rows = await knex("search_index").where({ doc_id: "DOC-7" });
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe("cataloged");
  });

  it("removes on document.deleted", async () => {
    await handleDocumentEvent(backend, "document.indexed", payload);
    await handleDocumentEvent(backend, "document.deleted", { doc_id: "DOC-7" });
    const res = await backend.search({ text: "tashi", mode: "fulltext" }, { crossBranch: true });
    expect(res.total).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zordms/search test indexConsumer`
Expected: FAIL — `./indexConsumer.js` not found.

- [ ] **Step 3: Write `consumer/indexConsumer.ts`**

```ts
import type { Knex } from "knex";
import type { SearchBackend } from "../backend/SearchBackend.js";
import type { SearchDoc } from "@zordms/types";

type EventName = "document.indexed" | "document.cataloged" | "document.deleted";

function toSearchDoc(p: Record<string, unknown>): SearchDoc {
  return {
    doc_id: String(p.doc_id),
    ocr_text: String(p.ocr_text ?? ""),
    metadata_text: String(p.metadata_text ?? ""),
    doc_type: String(p.doc_type ?? "unknown"),
    branch: String(p.branch ?? ""),
    status: String(p.status ?? "indexed"),
    risk_band: String(p.risk_band ?? "low"),
    legal_hold: Boolean(p.legal_hold ?? false),
    expiry_status: String(p.expiry_status ?? "none"),
    uploaded_by: String(p.uploaded_by ?? ""),
    indexed_at: String(p.indexed_at ?? new Date().toISOString()),
  };
}

export async function handleDocumentEvent(
  backend: SearchBackend,
  event: EventName,
  payload: Record<string, unknown>,
): Promise<void> {
  if (event === "document.deleted") {
    await backend.delete(String(payload.doc_id));
    return;
  }
  await backend.index(toSearchDoc(payload));
}

export async function startIndexConsumer(deps: { knex: Knex; backend: SearchBackend }): Promise<void> {
  // Lazy import so unit tests that call handleDocumentEvent directly don't require a live bus.
  const { subscribe } = await import("@zordms/events");
  const events: EventName[] = ["document.indexed", "document.cataloged", "document.deleted"];
  for (const ev of events) {
    await subscribe(ev, async (payload: Record<string, unknown>) => {
      await handleDocumentEvent(deps.backend, ev, payload);
    });
  }
}
```

- [ ] **Step 4: Run consumer test to verify it passes**

Run: `pnpm --filter @zordms/search test indexConsumer`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing reindex-route test**

`services/search/src/routes/reindex.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import knexLib from "knex";
import { buildKnexConfig } from "@zordms/db";
import { loadConfig } from "@zordms/config";
import { signToken } from "@zordms/auth";
import { createApp } from "../app.js";
import { SqlSearchBackend } from "../backend/SqlSearchBackend.js";

const knex = knexLib(buildKnexConfig({
  client: "sqlite3", host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "",
}));
const app = createApp({ knex, config: loadConfig({ JWT_SECRET: "t" } as NodeJS.ProcessEnv), backend: new SqlSearchBackend(knex) });
let adminToken = "";

beforeAll(async () => {
  await knex.migrate.latest(); await knex.seed.run();
  const admin = await knex("users").where({ username: "admin" }).first();
  adminToken = signToken({ sub: admin.id, username: "admin" }, "t");
});
afterAll(async () => { await knex.destroy(); });

describe("POST /admin/reindex", () => {
  it("reindexes the supplied docs (admin only)", async () => {
    const res = await request(app).post("/admin/reindex").set("Authorization", `Bearer ${adminToken}`).send({
      docs: [{ doc_id: "R1", ocr_text: "alpha", metadata_text: "", doc_type: "X", branch: "Thimphu", status: "indexed", risk_band: "low", legal_hold: false, expiry_status: "none", uploaded_by: "u", indexed_at: "2026-06-23T00:00:00Z" }],
    });
    expect(res.status).toBe(200);
    expect(res.body.reindexed).toBe(1);
  });

  it("401 without a token", async () => {
    expect((await request(app).post("/admin/reindex").send({ docs: [] })).status).toBe(401);
  });
});
```

- [ ] **Step 6: Run reindex test to verify it fails**

Run: `pnpm --filter @zordms/search test routes/reindex`
Expected: FAIL — `/admin/reindex` 404.

- [ ] **Step 7: Write `routes/reindex.ts`**

```ts
import { Router } from "express";
import { requireAuth, requirePermission } from "@zordms/auth";
import type { SearchBackend } from "../backend/SearchBackend.js";
import type { SearchDoc } from "@zordms/types";

export function reindexRouter(): Router {
  const r = Router();
  r.use(requireAuth);
  r.post("/reindex", requirePermission("admin:access"), async (req, res) => {
    const { backend } = req.app.locals.deps as { backend: SearchBackend };
    const docs = (req.body?.docs ?? []) as SearchDoc[];
    const reindexed = await backend.reindexAll(docs);
    res.json({ reindexed });
  });
  return r;
}
```

(Note: `requireAuth` / `requirePermission` are re-exported from `@zordms/auth` per Plan 1's barrel; if Plan 1 keeps them in the gateway only, import from the shared middleware path the foundation plan exposes. They read `app.locals.deps.{knex,config}`, which `createApp` provides.)

- [ ] **Step 8: Mount the router in `app.ts`**

Add to `services/search/src/app.ts` inside `createApp`, after `express.json()`:
```ts
import { reindexRouter } from "./routes/reindex.js";
// ...
app.use("/admin", reindexRouter());
```

- [ ] **Step 9: Run reindex test to verify it passes**

Run: `pnpm --filter @zordms/search test routes/reindex`
Expected: PASS (2 tests).

- [ ] **Step 10: Commit**

```bash
git add services/search/src/consumer/indexConsumer.ts services/search/src/consumer/indexConsumer.test.ts services/search/src/routes/reindex.ts services/search/src/routes/reindex.test.ts services/search/src/app.ts
git commit -m "feat(search): event index consumer + admin reindex endpoint"
```

---

## Task 8: Query API — `POST /search` + `GET /facets`

**Files:**
- Create: `services/search/src/routes/search.ts`
- Modify: `services/search/src/app.ts` (mount `/`)
- Test: `services/search/src/routes/search.test.ts`

**Interfaces:**
- Helper `scopeFromUser(authUser): SearchScope` — `crossBranch = authUser.permissions.includes("crossbranch:read")`; `branch = authUser.branch`.
- `POST /search` (`requireAuth`, `requirePermission("document:read")`) body `SearchQuery` (validated by `isSearchQuery`) → `SearchResults` from `backend.search(query, scope)`. Returns 400 on a malformed query.
- `GET /facets` (same guards) → facet dimensions for the caller's scope (empty-text search returning only facets).

- [ ] **Step 1: Write the failing test**

`services/search/src/routes/search.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import knexLib from "knex";
import { buildKnexConfig } from "@zordms/db";
import { loadConfig } from "@zordms/config";
import { signToken } from "@zordms/auth";
import { createApp } from "../app.js";
import { SqlSearchBackend } from "../backend/SqlSearchBackend.js";

const knex = knexLib(buildKnexConfig({
  client: "sqlite3", host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "",
}));
const backend = new SqlSearchBackend(knex);
const app = createApp({ knex, config: loadConfig({ JWT_SECRET: "t" } as NodeJS.ProcessEnv), backend });
let adminToken = "";
let viewerThimphuToken = "";

beforeAll(async () => {
  await knex.migrate.latest(); await knex.seed.run();
  const admin = await knex("users").where({ username: "admin" }).first();
  adminToken = signToken({ sub: admin.id, username: "admin" }, "t");

  // a Viewer scoped to Thimphu (no crossbranch:read)
  const [vid] = await knex("users").insert({ username: "viewerT", password_hash: "x", status: "Active", branch: "Thimphu" }).returning("id");
  const userId = typeof vid === "object" ? (vid as any).id : vid;
  const viewerRole = await knex("roles").where({ name: "Viewer" }).first();
  await knex("user_roles").insert({ user_id: userId, role_id: viewerRole.id });
  viewerThimphuToken = signToken({ sub: userId, username: "viewerT" }, "t");

  await backend.index({ doc_id: "D1", ocr_text: "Loan Dorji", metadata_text: "", doc_type: "BOB_LOAN_APPLICATION", branch: "Thimphu", status: "indexed", risk_band: "low", legal_hold: false, expiry_status: "none", uploaded_by: "m", indexed_at: "2026-06-23T00:00:00Z" });
  await backend.index({ doc_id: "D2", ocr_text: "Loan Dorji", metadata_text: "", doc_type: "BOB_LOAN_APPLICATION", branch: "Paro", status: "indexed", risk_band: "high", legal_hold: false, expiry_status: "none", uploaded_by: "m", indexed_at: "2026-06-23T00:00:00Z" });
});
afterAll(async () => { await knex.destroy(); });

describe("POST /search", () => {
  it("requires authentication", async () => {
    expect((await request(app).post("/search").send({ text: "dorji", mode: "fulltext" })).status).toBe(401);
  });

  it("admin (crossbranch) sees results from all branches", async () => {
    const res = await request(app).post("/search").set("Authorization", `Bearer ${adminToken}`).send({ text: "dorji", mode: "fulltext" });
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.facets.branch.length).toBe(2);
  });

  it("Thimphu Viewer (no crossbranch) only sees Thimphu results", async () => {
    const res = await request(app).post("/search").set("Authorization", `Bearer ${viewerThimphuToken}`).send({ text: "dorji", mode: "fulltext" });
    expect(res.status).toBe(200);
    expect(res.body.hits.map((h: any) => h.doc_id)).toEqual(["D1"]);
  });

  it("rejects a malformed query with 400", async () => {
    const res = await request(app).post("/search").set("Authorization", `Bearer ${adminToken}`).send({ mode: "regex" });
    expect(res.status).toBe(400);
  });
});

describe("GET /facets", () => {
  it("returns facet dimensions for the caller scope", async () => {
    const res = await request(app).get("/facets").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.facets.doc_type.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zordms/search test routes/search`
Expected: FAIL — `/search` 404.

- [ ] **Step 3: Write `routes/search.ts`**

```ts
import { Router } from "express";
import { requireAuth, requirePermission } from "@zordms/auth";
import { isSearchQuery, type SearchQuery, type SearchScope } from "@zordms/types";
import type { SearchBackend } from "../backend/SearchBackend.js";
import type { AuthUser } from "@zordms/types";

export function scopeFromUser(user: AuthUser): SearchScope {
  return {
    branch: user.branch,
    region: user.region,
    crossBranch: user.permissions.includes("crossbranch:read"),
  };
}

export function searchRouter(): Router {
  const r = Router();
  r.use(requireAuth);

  r.post("/search", requirePermission("document:read"), async (req, res) => {
    const { backend } = req.app.locals.deps as { backend: SearchBackend };
    const body = req.body as SearchQuery;
    if (!isSearchQuery(body)) { res.status(400).json({ error: "invalid_query" }); return; }
    const results = await backend.search(body, scopeFromUser(req.authUser!));
    res.json(results);
  });

  r.get("/facets", requirePermission("document:read"), async (req, res) => {
    const { backend } = req.app.locals.deps as { backend: SearchBackend };
    const results = await backend.search({ text: "", mode: "fulltext", pageSize: 1 }, scopeFromUser(req.authUser!));
    res.json({ facets: results.facets ?? {} });
  });

  return r;
}
```

- [ ] **Step 4: Mount in `app.ts`**

```ts
import { searchRouter } from "./routes/search.js";
// inside createApp, after express.json():
app.use("/", searchRouter());
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @zordms/search test routes/search`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add services/search/src/routes/search.ts services/search/src/app.ts services/search/src/routes/search.test.ts
git commit -m "feat(search): query API (POST /search, GET /facets) with branch/role scoping"
```

---

## Task 9: Saved searches — create / list / run

**Files:**
- Create: `services/search/src/routes/saved.ts`
- Modify: `services/search/src/app.ts` (mount `/saved`)
- Test: `services/search/src/routes/saved.test.ts`

**Interfaces:**
- `POST /saved` (`requireAuth`, `requirePermission("document:read")`) body `SaveSearchRequest` → 201 `SavedSearch`. Stores `query_json` as text; `visibility` private|public.
- `GET /saved` → all saved searches the caller may see: their own (`user_id = me`) plus any `visibility = "public"`.
- `POST /saved/:id/run` → loads the saved query, runs it via `backend.search` with the caller's scope (NOT the author's), returns `SearchResults`. 404 if not found or not visible to the caller.

- [ ] **Step 1: Write the failing test**

`services/search/src/routes/saved.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import knexLib from "knex";
import { buildKnexConfig } from "@zordms/db";
import { loadConfig } from "@zordms/config";
import { signToken } from "@zordms/auth";
import { createApp } from "../app.js";
import { SqlSearchBackend } from "../backend/SqlSearchBackend.js";

const knex = knexLib(buildKnexConfig({
  client: "sqlite3", host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "",
}));
const backend = new SqlSearchBackend(knex);
const app = createApp({ knex, config: loadConfig({ JWT_SECRET: "t" } as NodeJS.ProcessEnv), backend });
let adminToken = "";
let adminId = 0;

beforeAll(async () => {
  await knex.migrate.latest(); await knex.seed.run();
  const admin = await knex("users").where({ username: "admin" }).first();
  adminId = admin.id;
  adminToken = signToken({ sub: admin.id, username: "admin" }, "t");
  await backend.index({ doc_id: "D1", ocr_text: "Loan Dorji", metadata_text: "", doc_type: "BOB_LOAN_APPLICATION", branch: "Thimphu", status: "indexed", risk_band: "low", legal_hold: false, expiry_status: "none", uploaded_by: "m", indexed_at: "2026-06-23T00:00:00Z" });
});
afterAll(async () => { await knex.destroy(); });

describe("saved searches", () => {
  let savedId = 0;

  it("creates a private saved search", async () => {
    const res = await request(app).post("/saved").set("Authorization", `Bearer ${adminToken}`).send({
      name: "My loans", visibility: "private", query: { text: "dorji", mode: "fulltext" },
    });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("My loans");
    savedId = res.body.id;
  });

  it("lists the caller's own + public saved searches", async () => {
    await knex("saved_searches").insert({ user_id: 999, name: "Shared", query_json: JSON.stringify({ text: "x", mode: "fulltext" }), visibility: "public" });
    await knex("saved_searches").insert({ user_id: 999, name: "Hidden", query_json: JSON.stringify({ text: "x", mode: "fulltext" }), visibility: "private" });
    const res = await request(app).get("/saved").set("Authorization", `Bearer ${adminToken}`);
    const names = res.body.saved.map((s: any) => s.name);
    expect(names).toContain("My loans");
    expect(names).toContain("Shared");
    expect(names).not.toContain("Hidden");
  });

  it("runs a saved search with the caller's scope", async () => {
    const res = await request(app).post(`/saved/${savedId}/run`).set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.hits[0].doc_id).toBe("D1");
  });

  it("404s when running a private search owned by someone else", async () => {
    const [otherId] = await knex("saved_searches").insert({ user_id: 999, name: "Private other", query_json: JSON.stringify({ text: "x", mode: "fulltext" }), visibility: "private" }).returning("id");
    const id = typeof otherId === "object" ? (otherId as any).id : otherId;
    expect((await request(app).post(`/saved/${id}/run`).set("Authorization", `Bearer ${adminToken}`)).status).toBe(404);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zordms/search test routes/saved`
Expected: FAIL — `/saved` 404.

- [ ] **Step 3: Write `routes/saved.ts`**

```ts
import { Router } from "express";
import type { Knex } from "knex";
import { requireAuth, requirePermission } from "@zordms/auth";
import type { SaveSearchRequest, SearchQuery } from "@zordms/types";
import type { SearchBackend } from "../backend/SearchBackend.js";
import { scopeFromUser } from "./search.js";

export function savedRouter(): Router {
  const r = Router();
  r.use(requireAuth, requirePermission("document:read"));

  r.post("/", async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    const body = req.body as SaveSearchRequest;
    if (!body?.name || !body?.query) { res.status(400).json({ error: "invalid_saved_search" }); return; }
    const visibility = body.visibility === "public" ? "public" : "private";
    const [id] = await knex("saved_searches").insert({
      user_id: req.authUser!.id, name: body.name, query_json: JSON.stringify(body.query), visibility,
    }).returning("id");
    const savedId = typeof id === "object" ? (id as any).id : id;
    res.status(201).json({ id: savedId, user_id: req.authUser!.id, name: body.name, query_json: body.query, visibility });
  });

  r.get("/", async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    const rows = await knex("saved_searches")
      .where({ user_id: req.authUser!.id })
      .orWhere({ visibility: "public" })
      .select("id", "user_id", "name", "query_json", "visibility");
    res.json({ saved: rows.map((s) => ({ ...s, query_json: JSON.parse(s.query_json) })) });
  });

  r.post("/:id/run", async (req, res) => {
    const { knex, backend } = req.app.locals.deps as { knex: Knex; backend: SearchBackend };
    const row = await knex("saved_searches").where({ id: req.params.id }).first();
    const visible = row && (row.user_id === req.authUser!.id || row.visibility === "public");
    if (!visible) { res.status(404).json({ error: "not_found" }); return; }
    const query = JSON.parse(row.query_json) as SearchQuery;
    const results = await backend.search(query, scopeFromUser(req.authUser!));
    res.json(results);
  });

  return r;
}
```

- [ ] **Step 4: Mount in `app.ts`**

```ts
import { savedRouter } from "./routes/saved.js";
// inside createApp:
app.use("/saved", savedRouter());
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @zordms/search test routes/saved`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add services/search/src/routes/saved.ts services/search/src/app.ts services/search/src/routes/saved.test.ts
git commit -m "feat(search): saved searches — create/list (public+private)/run"
```

---

## Task 10: CSV export endpoint

**Files:**
- Create: `services/search/src/routes/export.ts`
- Modify: `services/search/src/app.ts` (mount `/search/export.csv`)
- Test: `services/search/src/routes/export.test.ts`

**Interfaces:**
- `toCsv(hits: SearchHit[]): string` — header `doc_id,doc_type,branch,status,score,indexed_at`, RFC-4180 quoting (escape `"` and commas), one row per hit.
- `POST /search/export.csv` (`requireAuth`, `requirePermission("document:read")`) body `SearchQuery` → runs the scoped search (export cap: up to 5000 rows; `pageSize` forced to the cap) and returns `text/csv` with `Content-Disposition: attachment`.

- [ ] **Step 1: Write the failing test**

`services/search/src/routes/export.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import knexLib from "knex";
import { buildKnexConfig } from "@zordms/db";
import { loadConfig } from "@zordms/config";
import { signToken } from "@zordms/auth";
import { createApp } from "../app.js";
import { SqlSearchBackend } from "../backend/SqlSearchBackend.js";
import { toCsv } from "./export.js";

const knex = knexLib(buildKnexConfig({
  client: "sqlite3", host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "",
}));
const backend = new SqlSearchBackend(knex);
const app = createApp({ knex, config: loadConfig({ JWT_SECRET: "t" } as NodeJS.ProcessEnv), backend });
let adminToken = "";

beforeAll(async () => {
  await knex.migrate.latest(); await knex.seed.run();
  const admin = await knex("users").where({ username: "admin" }).first();
  adminToken = signToken({ sub: admin.id, username: "admin" }, "t");
  await backend.index({ doc_id: "D1", ocr_text: "Loan, Dorji \"VIP\"", metadata_text: "", doc_type: "BOB_LOAN_APPLICATION", branch: "Thimphu", status: "indexed", risk_band: "low", legal_hold: false, expiry_status: "none", uploaded_by: "m", indexed_at: "2026-06-23T00:00:00Z" });
});
afterAll(async () => { await knex.destroy(); });

describe("toCsv", () => {
  it("emits a header and quotes fields containing commas/quotes", () => {
    const csv = toCsv([{ doc_id: "D1", doc_type: "T,X", branch: "Th", status: "ok", snippet: "", score: 0.5, indexed_at: "2026-06-23" }]);
    const [header, row] = csv.trim().split("\n");
    expect(header).toBe("doc_id,doc_type,branch,status,score,indexed_at");
    expect(row).toContain('"T,X"');
  });
});

describe("POST /search/export.csv", () => {
  it("returns a CSV attachment of scoped results", async () => {
    const res = await request(app).post("/search/export.csv").set("Authorization", `Bearer ${adminToken}`).send({ text: "dorji", mode: "fulltext" });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/csv/);
    expect(res.headers["content-disposition"]).toMatch(/attachment/);
    expect(res.text).toMatch(/^doc_id,doc_type,branch,status,score,indexed_at/);
    expect(res.text).toContain("D1");
  });

  it("401 without a token", async () => {
    expect((await request(app).post("/search/export.csv").send({ text: "x", mode: "fulltext" })).status).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zordms/search test routes/export`
Expected: FAIL — `./export.js` not found.

- [ ] **Step 3: Write `routes/export.ts`**

```ts
import { Router } from "express";
import { requireAuth, requirePermission } from "@zordms/auth";
import { isSearchQuery, type SearchHit, type SearchQuery } from "@zordms/types";
import type { SearchBackend } from "../backend/SearchBackend.js";
import { scopeFromUser } from "./search.js";

const COLUMNS: Array<keyof SearchHit> = ["doc_id", "doc_type", "branch", "status", "score", "indexed_at"];
const EXPORT_CAP = 5000;

function cell(v: unknown): string {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(hits: SearchHit[]): string {
  const header = COLUMNS.join(",");
  const rows = hits.map((h) => COLUMNS.map((c) => cell(h[c])).join(","));
  return [header, ...rows].join("\n") + "\n";
}

export function exportRouter(): Router {
  const r = Router();
  r.use(requireAuth);
  r.post("/search/export.csv", requirePermission("document:read"), async (req, res) => {
    const { backend } = req.app.locals.deps as { backend: SearchBackend };
    const body = req.body as SearchQuery;
    if (!isSearchQuery(body)) { res.status(400).json({ error: "invalid_query" }); return; }
    const results = await backend.search({ ...body, page: 1, pageSize: EXPORT_CAP }, scopeFromUser(req.authUser!));
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="zordms-search.csv"');
    res.send(toCsv(results.hits));
  });
  return r;
}
```

- [ ] **Step 4: Mount in `app.ts`**

```ts
import { exportRouter } from "./routes/export.js";
// inside createApp:
app.use("/", exportRouter());
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @zordms/search test routes/export`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add services/search/src/routes/export.ts services/search/src/app.ts services/search/src/routes/export.test.ts
git commit -m "feat(search): CSV export of scoped search results"
```

---

## Task 11: Web — search API helper + facet/saved components

**Files:**
- Create: `apps/web/src/api/search.ts`, `apps/web/src/components/FacetPanel.tsx`, `apps/web/src/components/SavedSearches.tsx`
- Test: `apps/web/src/components/FacetPanel.test.tsx`

**Interfaces:**
- `apps/web/src/api/search.ts`: `runSearch(query): Promise<SearchResults>`, `getFacets(): Promise<Record<...>>`, `listSaved(): Promise<SavedSearch[]>`, `createSaved(req): Promise<SavedSearch>`, `runSaved(id): Promise<SearchResults>`. All call the gateway-proxied search endpoints via the shared `api` client (Plan 1 `apps/web/src/api/client.ts`).
- `FacetPanel({ facets, selected, onToggle })` — renders each facet dimension with `value (count)` rows; clicking calls `onToggle(dimension, value)`. Active facet highlighted.
- `SavedSearches({ items, onRun, onNew })` — lists saved queries (with a public/private badge), a Run button per item, and a "Save current" action.

- [ ] **Step 1: Write the failing FacetPanel test**

`apps/web/src/components/FacetPanel.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FacetPanel } from "./FacetPanel.js";

const facets = {
  doc_type: [{ value: "BT_CID_4G", count: 3 }, { value: "BOB_LOAN_APPLICATION", count: 1 }],
  branch: [{ value: "Thimphu", count: 2 }],
};

describe("FacetPanel", () => {
  it("renders facet values with counts and toggles on click", () => {
    const onToggle = vi.fn();
    render(<FacetPanel facets={facets} selected={{}} onToggle={onToggle} />);
    expect(screen.getByText(/BT_CID_4G/)).toBeInTheDocument();
    expect(screen.getByText(/\(3\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/BT_CID_4G/));
    expect(onToggle).toHaveBeenCalledWith("doc_type", "BT_CID_4G");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zordms/web test FacetPanel`
Expected: FAIL — `./FacetPanel.js` not found.

- [ ] **Step 3: Write `apps/web/src/api/search.ts`**

```ts
import { api } from "./client.js";
import type { SavedSearch, SaveSearchRequest, SearchQuery, SearchResults } from "@zordms/types";

export const runSearch = (query: SearchQuery): Promise<SearchResults> => api.post("/search", query);
export const getFacets = (): Promise<{ facets: Record<string, Array<{ value: string; count: number }>> }> => api.get("/facets");
export const listSaved = (): Promise<{ saved: SavedSearch[] }> => api.get("/saved");
export const createSaved = (req: SaveSearchRequest): Promise<SavedSearch> => api.post("/saved", req);
export const runSaved = (id: number): Promise<SearchResults> => api.post(`/saved/${id}/run`);
```

- [ ] **Step 4: Write `apps/web/src/components/FacetPanel.tsx`**

```tsx
type Facets = Record<string, Array<{ value: string; count: number }>>;

const LABELS: Record<string, string> = {
  doc_type: "Document Type", status: "Status", branch: "Branch", risk_band: "Risk Band",
};

export function FacetPanel({ facets, selected, onToggle }: {
  facets: Facets;
  selected: Record<string, string | undefined>;
  onToggle: (dimension: string, value: string) => void;
}) {
  return (
    <aside style={{ width: 220, borderRight: "1px solid var(--line)", padding: 16 }}>
      <h3 style={{ marginTop: 0 }}>Filters</h3>
      {Object.entries(facets).map(([dim, values]) => (
        <div key={dim} style={{ marginBottom: 18 }}>
          <div className="label" style={{ fontWeight: 600 }}>{LABELS[dim] ?? dim}</div>
          {values.map((v) => {
            const active = selected[dim] === v.value;
            return (
              <button key={v.value} onClick={() => onToggle(dim, v.value)}
                style={{ display: "block", width: "100%", textAlign: "left", border: "none", background: active ? "var(--navy)" : "transparent", color: active ? "#fff" : "var(--ink)", padding: "6px 8px", borderRadius: 6, cursor: "pointer", marginTop: 4 }}>
                {v.value} ({v.count})
              </button>
            );
          })}
        </div>
      ))}
    </aside>
  );
}
```

- [ ] **Step 5: Write `apps/web/src/components/SavedSearches.tsx`**

```tsx
import type { SavedSearch } from "@zordms/types";

export function SavedSearches({ items, onRun, onNew }: {
  items: SavedSearch[];
  onRun: (id: number) => void;
  onNew: () => void;
}) {
  return (
    <aside style={{ width: 240, borderLeft: "1px solid var(--line)", padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0 }}>Saved searches</h3>
        <button className="btn-primary" style={{ width: "auto", padding: "6px 10px" }} onClick={onNew}>Save</button>
      </div>
      {items.length === 0 && <p className="label" style={{ marginTop: 12 }}>No saved searches yet.</p>}
      {items.map((s) => (
        <div key={s.id} style={{ borderTop: "1px solid var(--line)", padding: "10px 0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontWeight: 600 }}>{s.name}</div>
            <span className="label">{s.visibility === "public" ? "Public" : "Private"}</span>
          </div>
          <button onClick={() => onRun(s.id)} style={{ border: "1px solid var(--line)", background: "#fff", borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>Run</button>
        </div>
      ))}
    </aside>
  );
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @zordms/web test FacetPanel`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/api/search.ts apps/web/src/components/FacetPanel.tsx apps/web/src/components/FacetPanel.test.tsx apps/web/src/components/SavedSearches.tsx
git commit -m "feat(web): search API client + facet panel + saved-searches panel"
```

---

## Task 12: Web — Enterprise Search screen

**Files:**
- Create: `apps/web/src/pages/Search.tsx`
- Modify: `apps/web/src/router.tsx` (add `/search` route)
- Test: `apps/web/src/pages/Search.test.tsx`

**Interfaces:**
- Consumes: `runSearch`, `getFacets`, `listSaved`, `createSaved`, `runSaved`; `FacetPanel`, `SavedSearches`.
- Produces `Search()` — three-column layout: left `FacetPanel`, center (search bar + mode `<select>` for fulltext/boolean/wildcard/fuzzy/semantic + results table showing `doc_id`, type, branch, status, **score**, and a "Preview" button that opens a quick-preview drawer with the snippet), right `SavedSearches`. Submitting runs `runSearch`; toggling a facet re-runs with the filter applied; "Save" prompts for a name and calls `createSaved`.
- Route `/search` is protected by `permission="document:read"`.

- [ ] **Step 1: Write the failing Search test**

`apps/web/src/pages/Search.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Search } from "./Search.js";

vi.mock("../api/search.js", () => ({
  runSearch: vi.fn().mockResolvedValue({
    hits: [{ doc_id: "D1", doc_type: "BT_CID_4G", branch: "Thimphu", status: "indexed", snippet: "Dorji CID card", score: 0.92, indexed_at: "2026-06-23" }],
    total: 1, page: 1, pageSize: 20, tookMs: 4,
    facets: { doc_type: [{ value: "BT_CID_4G", count: 1 }] },
  }),
  getFacets: vi.fn().mockResolvedValue({ facets: { doc_type: [{ value: "BT_CID_4G", count: 1 }] } }),
  listSaved: vi.fn().mockResolvedValue({ saved: [] }),
  createSaved: vi.fn(),
  runSaved: vi.fn(),
}));

describe("Search screen", () => {
  beforeEach(() => vi.clearAllMocks());

  it("runs a search and renders hits with scores", async () => {
    render(<Search />);
    fireEvent.change(screen.getByPlaceholderText(/search documents/i), { target: { value: "dorji" } });
    fireEvent.click(screen.getByRole("button", { name: /^Search$/i }));
    await waitFor(() => expect(screen.getByText("D1")).toBeInTheDocument());
    expect(screen.getByText(/0\.92/)).toBeInTheDocument();
    expect(screen.getByText(/1 result/i)).toBeInTheDocument();
  });

  it("offers all search modes", () => {
    render(<Search />);
    const select = screen.getByLabelText(/mode/i) as HTMLSelectElement;
    const opts = Array.from(select.options).map((o) => o.value);
    expect(opts).toEqual(expect.arrayContaining(["fulltext", "boolean", "wildcard", "fuzzy", "semantic"]));
  });

  it("opens a quick preview drawer for a hit", async () => {
    render(<Search />);
    fireEvent.change(screen.getByPlaceholderText(/search documents/i), { target: { value: "dorji" } });
    fireEvent.click(screen.getByRole("button", { name: /^Search$/i }));
    await waitFor(() => expect(screen.getByText("D1")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /preview/i }));
    expect(screen.getByText(/Dorji CID card/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zordms/web test Search`
Expected: FAIL — `./Search.js` not found.

- [ ] **Step 3: Write `pages/Search.tsx`**

```tsx
import { useEffect, useState, type FormEvent } from "react";
import type { SearchHit, SearchMode, SearchQuery, SearchResults, SavedSearch } from "@zordms/types";
import { runSearch, getFacets, listSaved, createSaved, runSaved } from "../api/search.js";
import { FacetPanel } from "../components/FacetPanel.js";
import { SavedSearches } from "../components/SavedSearches.js";

const MODES: SearchMode[] = ["fulltext", "boolean", "wildcard", "fuzzy", "semantic"];

export function Search() {
  const [text, setText] = useState("");
  const [mode, setMode] = useState<SearchMode>("fulltext");
  const [selected, setSelected] = useState<Record<string, string | undefined>>({});
  const [results, setResults] = useState<SearchResults | null>(null);
  const [facets, setFacets] = useState<Record<string, Array<{ value: string; count: number }>>>({});
  const [saved, setSaved] = useState<SavedSearch[]>([]);
  const [preview, setPreview] = useState<SearchHit | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getFacets().then((r) => setFacets(r.facets)).catch(() => {});
    listSaved().then((r) => setSaved(r.saved)).catch(() => {});
  }, []);

  function currentQuery(): SearchQuery {
    const filters: Record<string, string> = {};
    for (const [dim, val] of Object.entries(selected)) if (val) filters[dim] = val;
    return { text, mode, filters, page: 1, pageSize: 20, sort: "relevance" };
  }

  async function execute(q: SearchQuery) {
    setBusy(true);
    try {
      const r = await runSearch(q);
      setResults(r);
      if (r.facets) setFacets(r.facets);
    } finally { setBusy(false); }
  }

  async function onSubmit(e: FormEvent) { e.preventDefault(); await execute(currentQuery()); }

  function toggleFacet(dim: string, value: string) {
    const next = { ...selected, [dim]: selected[dim] === value ? undefined : value };
    setSelected(next);
    const filters: Record<string, string> = {};
    for (const [d, v] of Object.entries(next)) if (v) filters[d] = v;
    execute({ text, mode, filters, page: 1, pageSize: 20, sort: "relevance" });
  }

  async function saveCurrent() {
    const name = window.prompt("Name this search:");
    if (!name) return;
    await createSaved({ name, visibility: "private", query: currentQuery() });
    setSaved((await listSaved()).saved);
  }

  return (
    <div style={{ display: "flex", height: "100vh" }}>
      <FacetPanel facets={facets} selected={selected} onToggle={toggleFacet} />

      <main style={{ flex: 1, padding: 20, overflow: "auto" }}>
        <h2 style={{ marginTop: 0 }}>Enterprise Search</h2>
        <form onSubmit={onSubmit} style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input className="field" style={{ flex: 1 }} placeholder="Search documents, OCR text, metadata…" value={text} onChange={(e) => setText(e.target.value)} />
          <label className="label" htmlFor="mode">Mode</label>
          <select id="mode" className="field" style={{ width: 150 }} value={mode} onChange={(e) => setMode(e.target.value as SearchMode)}>
            {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
          <button className="btn-primary" style={{ width: 120 }} disabled={busy}>Search</button>
        </form>

        {results && (
          <p className="label" style={{ marginTop: 12 }}>{results.total} result{results.total === 1 ? "" : "s"} · {results.tookMs} ms</p>
        )}

        {results && (
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
            <thead><tr>
              {["Doc ID", "Type", "Branch", "Status", "Score", ""].map((h) => (
                <th key={h} style={{ textAlign: "left", padding: 8, borderBottom: "1px solid var(--line)" }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {results.hits.map((h) => (
                <tr key={h.doc_id} style={{ borderBottom: "1px solid var(--line)" }}>
                  <td style={{ padding: 8 }}>{h.doc_id}</td>
                  <td style={{ padding: 8 }}>{h.doc_type}</td>
                  <td style={{ padding: 8 }}>{h.branch}</td>
                  <td style={{ padding: 8 }}>{h.status}</td>
                  <td style={{ padding: 8 }}>{h.score.toFixed(2)}</td>
                  <td style={{ padding: 8 }}><button onClick={() => setPreview(h)} style={{ border: "1px solid var(--line)", background: "#fff", borderRadius: 6, padding: "4px 10px", cursor: "pointer" }}>Preview</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {preview && (
          <div style={{ position: "fixed", top: 0, right: 0, width: 360, height: "100vh", background: "#fff", borderLeft: "1px solid var(--line)", boxShadow: "-8px 0 24px rgba(0,0,0,.08)", padding: 20 }}>
            <button onClick={() => setPreview(null)} style={{ float: "right", border: "none", background: "transparent", cursor: "pointer", fontSize: 18 }}>×</button>
            <h3>{preview.doc_id}</h3>
            <p className="label">{preview.doc_type} · {preview.branch} · {preview.status}</p>
            <p style={{ lineHeight: 1.5 }}>{preview.snippet}</p>
          </div>
        )}
      </main>

      <SavedSearches items={saved} onNew={saveCurrent} onRun={async (id) => setResults(await runSaved(id))} />
    </div>
  );
}
```

- [ ] **Step 4: Add the route to `router.tsx`**

```tsx
import { Search } from "./pages/Search.js";
// add inside the routes array:
{ path: "/search", element: <ProtectedRoute permission="document:read"><Search /></ProtectedRoute> },
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @zordms/web test Search`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/pages/Search.tsx apps/web/src/pages/Search.test.tsx apps/web/src/router.tsx
git commit -m "feat(web): Enterprise Search screen (bar, modes, facets, score, preview, saved)"
```

---

## Task 13: Permissions, vite proxy, CI note + Phase-2 ES cutover doc

**Files:**
- Modify: `packages/db/src/seeds/0001_default_rbac.ts` (ensure `document:read` + `crossbranch:read` exist — they do from Plan 1; add a `search:export` permission and grant to relevant roles if you want it gated; otherwise leave search under `document:read`)
- Modify: `apps/web/vite.config.ts` (proxy search endpoints to the gateway/search port)
- Modify: `.github/workflows/ci.yml` (search is covered by `pnpm test`; add the search migration to the PG job is automatic via shared `@zordms/db`)
- Create: `docs/RUNBOOK-search.md`

**Interfaces:**
- Produces: vite dev proxy entries so the web app can reach `/search`, `/facets`, `/saved`, `/admin` during local dev; a runbook documenting local run + the Phase-2 Elasticsearch cutover.

- [ ] **Step 1: (Optional) add a `search:export` permission to the seed**

Only if you want export RBAC-gated separately. In `packages/db/src/seeds/0001_default_rbac.ts`, add `["search:export", "Export search results"]` to `PERMISSIONS`, grant it to `CDO`, `Supervisor`, `Auditor`, and change `routes/export.ts` guard to `requirePermission("search:export")`. (If you skip this, export stays under `document:read` and the seed is unchanged — the plan's tests assume `document:read`.)

This step is a no-op unless you choose to gate export. Note the decision in the runbook.

- [ ] **Step 2: Extend the vite dev proxy**

In `apps/web/vite.config.ts`, extend the `server.proxy` map so the SPA reaches the search service in dev. If a gateway aggregates search, point these at the gateway port (4000); otherwise at the search port (4005):
```ts
server: {
  proxy: {
    "/auth": "http://localhost:4000",
    "/users": "http://localhost:4000",
    "/authz": "http://localhost:4000",
    "/health": "http://localhost:4000",
    "/search": "http://localhost:4005",
    "/facets": "http://localhost:4005",
    "/saved": "http://localhost:4005",
    "/admin": "http://localhost:4005",
  },
},
```

- [ ] **Step 3: Write `docs/RUNBOOK-search.md`**

`docs/RUNBOOK-search.md`:
```markdown
# ZorDMS Search — Run, Verify & Phase-2 ES Cutover

## Local (Postgres, SQL backend)
1. Ensure foundation migrations are applied (`node packages/db/dist/cli.js migrate`).
2. `pnpm --filter @zordms/search dev`   # search on :4005, SQL backend (SEARCH_BACKEND unset)
3. `pnpm --filter @zordms/web dev`       # SPA on :5174 → open /search
4. Documents flow in automatically: the search service consumes `document.indexed`
   and `document.cataloged` events and upserts into `search_index`. To bulk (re)build,
   POST `/admin/reindex` (requires `admin:access`) with `{ docs: SearchDoc[] }`.

## Backend selection (pluggable)
- `SEARCH_BACKEND` unset or `sql` → `SqlSearchBackend` (LIKE on `search_index.tokens`).
  Works on SQLite (tests) and Postgres (prod, accelerated by the guarded `tsvector` GIN index).
- `SEARCH_BACKEND=es` → `EsSearchBackend`. Until Phase 2 this throws `es_backend_not_enabled`.

## Tests
`pnpm --filter @zordms/search test` (and `@zordms/types`, `@zordms/db`) run against in-memory SQLite.

## Phase-2 Elasticsearch cutover (zero route changes)
The `SearchBackend` interface is the seam. To go live on ES:
1. Add `@elastic/elasticsearch` to `services/search` deps and an `ES_URL` to `@zordms/config`.
2. Implement the five `EsSearchBackend` methods against the same `SearchDoc`/`SearchResults`
   contracts:
   - `index`/`bulkIndex` → ES `_bulk` upsert keyed by `doc_id`.
   - `search` → translate `SearchQuery.mode` to ES: `fulltext`→`multi_match`, `boolean`→`query_string`,
     `wildcard`→`wildcard`, `fuzzy`→`match` with `fuzziness:"AUTO"`, `semantic`→kNN against the
     vector field (populated by the AI/IDP service, Plan 7); apply scope/filters as `filter` clauses;
     use ES aggregations for `facets`; ES `_score` → `SearchHit.score`.
   - `delete` → ES delete by `doc_id`.
   - `reindexAll` → recreate the index alias and `_bulk` load.
3. Set `SEARCH_BACKEND=es` and `ES_URL`. No route, consumer, saved-search, or UI code changes —
   they all depend only on the interface.
4. Backfill: run `POST /admin/reindex` (or a one-off job streaming `search_index` rows into ES)
   so the ES index matches the SQL index before flipping traffic.

## CI
`pnpm test` exercises the search suites on SQLite. The shared `@zordms/db` PG migration job
in `.github/workflows/ci.yml` now also applies `20260623_0005_search` against Postgres,
proving the `search_index`/`saved_searches` schema (and the PG `tsvector` GIN index) on the
production dialect. No extra CI job is required.
```

- [ ] **Step 3: Verify the whole search-related suite passes locally**

Run: `pnpm --filter @zordms/types test && pnpm --filter @zordms/db test && pnpm --filter @zordms/search test && pnpm --filter @zordms/web test`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/vite.config.ts docs/RUNBOOK-search.md packages/db/src/seeds/0001_default_rbac.ts
git commit -m "docs(search): runbook + Phase-2 ES cutover; vite proxy + optional export perm"
```

---

## Self-Review

**Spec coverage (Plan 5 portion of the spec — Service #5 "Search"):**
- Standalone `services/search` with `createApp` factory + health → Task 1. ✓
- Pluggable backend: `SearchBackend` interface + `SqlSearchBackend` (SQLite tests / PG-FTS prod) + `EsSearchBackend` Phase-2 stub behind the same interface → Tasks 4, 6, 13. ✓
- Migration `search_index` (doc_id, ocr_text, metadata_text, doc_type, branch, status, risk_band, legal_hold, expiry_status, indexed_at) + `saved_searches` (user_id, name, query_json, visibility), Knex schema-builder, PG GIN guarded → Task 3. ✓
- Consumes `document.indexed` / `document.cataloged` to (re)index; reindex endpoint → Task 7. ✓
- Query API: modes full-text / boolean / wildcard / fuzzy / semantic(placeholder); faceted filters (type, date range, status, branch, uploaded-by, risk band, legal hold, expiry status le30/le90); relevance scoring; pagination + latency (`tookMs`); branch/role scoping → Tasks 5, 6, 8. ✓
- Saved searches: create / list (public+private) / run with caller scope → Task 9. ✓
- Export results (CSV) → Task 10. ✓
- React Enterprise Search screen: search bar + mode selector + facet filters + results table with score + saved-queries panel + quick preview → Tasks 11, 12. ✓
- Permissions/CI note + Phase-2 ES cutover documented → Task 13. ✓
- Deferred to other plans (correctly out of scope): real vector/semantic ranking (AI/IDP, Plan 7), live Elasticsearch cluster (Phase 2 ops), document storage/capture (Plan 2), notifications (Plan 4), gateway aggregation routing (Plan 1).

**Pluggability check:** No route, consumer, saved-search, or UI module imports a concrete backend — they all receive `SearchBackend` via `app.locals.deps.backend` (Tasks 7–10) or call the typed API client (Tasks 11–12). The only place that names a concrete class is `selectBackend` (Task 6) and the test/server wiring. Flipping `SEARCH_BACKEND=es` changes behaviour with no handler edits. ✓

**Scope/RBAC check:** Every query path (`/search`, `/facets`, `/saved/:id/run`, `/search/export.csv`) is guarded by `requireAuth` + `requirePermission("document:read")` and applies `scopeFromUser` so a user without `crossbranch:read` is restricted to their `branch` (verified by the Thimphu-Viewer test in Task 8). Saved-search visibility enforces private/public access (Task 9). ✓

**Type consistency:** `SearchDoc`/`SearchQuery`/`SearchResults`/`SearchHit`/`SearchScope`/`SavedSearch` defined in Task 2 are used unchanged across the backend (Tasks 4, 6), consumer (Task 7), routes (Tasks 8–10), and web client/screen (Tasks 11–12). `buildTokensForDoc` (Task 4) feeds both `index` and the LIKE predicates. `scopeFromUser` (Task 8) is reused by saved-run (Task 9) and export (Task 10). ✓

**Placeholder scan:** No TBD/TODO; every code step contains complete, runnable code; every test step has real assertions. The only intentional "placeholder" is the `semantic` search mode, which deliberately routes through the LIKE path in Phase 1 and is documented to switch to ES kNN/vector ranking in Phase 2 (Tasks 5, 13). ✓

---

## Notes for later plans
- Plan 7 (AI/IDP) populates a vector field on each `SearchDoc` so the `semantic` mode can switch from the Phase-1 LIKE fallback to ES kNN at cutover.
- When the gateway (Plan 1) aggregates services, route `/search`, `/facets`, `/saved`, `/admin/reindex`, `/search/export.csv` through it and point the vite proxy at the gateway port instead of 4005.
- The `@zordms/events` `subscribe(name, handler)` contract used by `startIndexConsumer` (Task 7) must match the events package shipped by an earlier plan; if its signature differs, adapt `startIndexConsumer` only — `handleDocumentEvent` (unit-tested directly) stays unchanged.
