# Core DMS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This is **Plan 2**; it builds directly on **Plan 1 (Foundation + Identity/RBAC)** and REUSES its packages (`@zordms/config`, `@zordms/db`, `@zordms/auth`, `@zordms/types`) unchanged. Do not re-scaffold those packages — extend them where noted.

**Goal:** Stand up the **Core DMS service** (`services/core`): content-addressed object storage, a folder/repository tree, document upload/list/get/download/delete with RBAC + branch scoping, version control with rollback, Bhutan-typed indexing/metadata validation (BT_CID_4G, BT_PASSPORT, BOB_LOAN_APPLICATION + system metadata), viewer annotations/redaction/stamps, a deterministic **Auto-Catalog rule engine**, an **Auto Directory Mapper** with per-folder ACL inheritance, and the React screens (Repository, Capture, Indexing, Viewer, Dashboard) wired to the API — all TDD, all fully functional.

**Architecture:** A new Express service `services/core` exposing a pure `createApp({ knex, config })` factory (mirrors the Gateway). It reuses `@zordms/auth` middleware (`requireAuth`, `requirePermission`) and resolves cross-service authority via the Gateway `POST /authz/check`. Documents are stored content-addressed (SHA-256) through a `@zordms/storage` abstraction (local-FS backend for dev/test, S3/MinIO backend interface for prod). Metadata, folders, versions, annotations, and folder ACLs live in new Knex migrations under `packages/db/src/migrations`. The Auto-Catalog engine and Directory Mapper are **pure functions** (deterministic, fully unit-tested) wrapped by thin endpoints. Domain events (`document.captured`, `document.indexed`, `document.cataloged`) are emitted to Redis Streams via a small event-bus helper. React adds RBAC-aware pages reusing the Plan 1 `api` client, `AuthContext`, and `ProtectedRoute`.

**Tech Stack:** Node 20+, TypeScript 5 (ESM, strict), Express 4, Knex 3 (pg / oracledb / sqlite3), Vitest + Supertest, multer (uploads), Node `crypto` (SHA-256), `@aws-sdk/client-s3` (MinIO/S3 backend), `ioredis` (Redis Streams events), React 18 + Vite 5 + react-router-dom 6, @testing-library/react.

## Global Constraints

- **RBAC is the backbone** — every Core route is guarded by `requireAuth` + `requirePermission`. Permissions are `resource:action` (`document:capture`, `document:index`, `document:read`, `document:delete`). Cross-service authority uses Gateway `POST /authz/check`. Branch scoping is enforced in the data layer (list/get filtered by the caller's branch unless they hold `crossbranch:read`).
- **No licensing layer** — access is governed solely by RBAC.
- **All code fully functional** — no mocks/stubs. Real SHA-256 hashing, real file persistence, real validation, real versioning. The local-FS storage backend is a real backend, not a stub.
- **DB switchable via env** — `DB_CLIENT=pg|oracledb` for Node (Knex). **No SQLite-isms** in migrations: use the Knex schema-builder, `increments()` only for PKs, dialect-neutral column types. SQLite (`:memory:`) is the test-only backend.
- **Reuse Plan 1 packages** — `@zordms/config` (`loadConfig`), `@zordms/db` (`getKnex`, `buildKnexConfig`, `destroyKnex`), `@zordms/auth` (`requireAuth`, `requirePermission`, `resolveUserAuthz`, `can`, `canAll`, `signToken`), `@zordms/types`. New permissions go into the Plan 1 seed catalog (Task 3 here amends the seed).
- **Service factory pattern** — `services/core/src/app.ts` exports `createApp({ knex, config })` (no `listen`); `server.ts` wires `getKnex()` + `loadConfig()` and listens. Tests mount the app with an in-memory sqlite knex via Supertest.
- **Event bus** — Redis Streams; emit `document.captured`, `document.indexed`, `document.cataloged`. The event-bus helper is injectable so tests use an in-memory recorder (the *contract* is tested, the transport is swapped — the production transport is real `ioredis`).
- **TypeScript everywhere**, ESM modules (`"type": "module"`), strict mode on. Package/service names under the `@zordms/` scope.
- **Conventional commits**; commit after every passing step with the trailer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

---

## File Structure

```
zordms/
  packages/
    storage/                          # NEW — @zordms/storage
      package.json
      tsconfig.json
      src/index.ts                    # StorageBackend interface + factory
      src/local.ts                    # content-addressed local-FS backend
      src/s3.ts                       # S3/MinIO backend
      src/hash.ts                     # sha256 of a buffer
      src/local.test.ts
      src/hash.test.ts
    events/                           # NEW — @zordms/events
      package.json
      tsconfig.json
      src/index.ts                    # EventBus interface + InMemoryEventBus + RedisStreamsEventBus
      src/index.test.ts
    db/
      src/migrations/20260623_0002_core_dms.ts        # documents, folders, versions, annotations, folder_acls
      src/migrations/core_dms.test.ts
      src/seeds/0001_default_rbac.ts                  # AMEND: add document:* perms already partly present
    types/
      src/index.ts                    # AMEND: add Document, Folder, DocumentVersion, Annotation, catalog/mapper types
  services/
    core/                             # NEW service
      package.json
      tsconfig.json
      src/app.ts                      # createApp factory
      src/server.ts                   # listen()
      src/deps.ts                     # CoreDeps type (knex, config, storage, events)
      src/repo/folders.ts            # folder repository (create/tree/move)
      src/repo/documents.ts          # document repository (branch-scoped)
      src/repo/versions.ts           # versioning + rollback
      src/repo/annotations.ts        # annotations/redaction/stamps
      src/repo/acls.ts               # folder ACL inheritance
      src/schemas/index.ts           # Bhutan typed metadata schemas + validate()
      src/catalog/engine.ts          # pure Auto-Catalog rule engine
      src/mapper/directory.ts        # pure path-template resolver + ACL inheritance defaults
      src/routes/folders.ts
      src/routes/documents.ts
      src/routes/index.ts            # indexing/metadata endpoint
      src/routes/annotations.ts
      src/routes/catalog.ts
      src/routes/mapper.ts
      src/routes/dashboard.ts
      src/*.test.ts / src/**/**.test.ts
  apps/
    web/
      src/api/core.ts                 # typed core API client (reuses api from Plan 1)
      src/pages/Repository.tsx
      src/pages/Capture.tsx
      src/pages/Indexing.tsx
      src/pages/Viewer.tsx
      src/pages/Dashboard.tsx
      src/pages/*.test.tsx
      src/router.tsx                  # AMEND: add routes
```

---

## Task 1: `@zordms/storage` — content-addressed SHA-256 + local-FS backend

**Files:**
- Create: `packages/storage/package.json`, `packages/storage/tsconfig.json`, `packages/storage/src/hash.ts`, `packages/storage/src/index.ts`, `packages/storage/src/local.ts`, `packages/storage/src/s3.ts`
- Test: `packages/storage/src/hash.test.ts`, `packages/storage/src/local.test.ts`

**Interfaces:**
- Consumes: Node `crypto`, `fs/promises`, `@aws-sdk/client-s3` (S3 backend only).
- Produces:
  - `sha256(buf: Buffer): string` — lowercase hex digest.
  - `StorageBackend` interface: `put(buf: Buffer): Promise<{ key: string; size: number; hash: string }>` (key derived from content hash), `get(key: string): Promise<Buffer>`, `exists(key: string): Promise<boolean>`, `delete(key: string): Promise<void>`.
  - `LocalStorage(rootDir: string): StorageBackend` — writes to `rootDir/<aa>/<bb>/<hash>` (sharded), idempotent on identical content.
  - `S3Storage(opts): StorageBackend` — MinIO/S3 backend (same key scheme).
  - `createStorage(config): StorageBackend` — picks backend by `config.storageDriver`.

- [ ] **Step 1: Create `packages/storage/package.json`**

```json
{
  "name": "@zordms/storage",
  "version": "0.0.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "lint": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": { "@aws-sdk/client-s3": "^3.600.0" },
  "devDependencies": { "typescript": "^5.4.0", "vitest": "^1.6.0", "@types/node": "^20.0.0" }
}
```

- [ ] **Step 2: Create `packages/storage/tsconfig.json`**

```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

- [ ] **Step 3: Write the failing hash test**

`packages/storage/src/hash.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { sha256 } from "./hash.js";

describe("sha256", () => {
  it("hashes a known buffer deterministically", () => {
    const h = sha256(Buffer.from("hello"));
    expect(h).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });
  it("produces different hashes for different content", () => {
    expect(sha256(Buffer.from("a"))).not.toBe(sha256(Buffer.from("b")));
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter @zordms/storage test hash`
Expected: FAIL — `./hash.js` not found.

- [ ] **Step 5: Write `hash.ts`**

```ts
import { createHash } from "node:crypto";

export function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @zordms/storage test hash`
Expected: PASS (2 tests).

- [ ] **Step 7: Write the failing local-backend test**

`packages/storage/src/local.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalStorage } from "./local.js";
import { sha256 } from "./hash.js";

let root = "";
beforeAll(async () => { root = await mkdtemp(join(tmpdir(), "zordms-store-")); });
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

describe("LocalStorage", () => {
  it("stores content addressed by sha256 and reads it back", async () => {
    const s = LocalStorage(root);
    const buf = Buffer.from("Bank of Bhutan DMS");
    const r = await s.put(buf);
    expect(r.hash).toBe(sha256(buf));
    expect(r.key).toContain(r.hash);
    expect(r.size).toBe(buf.length);
    expect(await s.exists(r.key)).toBe(true);
    expect((await s.get(r.key)).toString()).toBe("Bank of Bhutan DMS");
  });

  it("is idempotent for identical content (same key, no error)", async () => {
    const s = LocalStorage(root);
    const buf = Buffer.from("identical");
    const a = await s.put(buf);
    const b = await s.put(buf);
    expect(a.key).toBe(b.key);
  });

  it("deletes content", async () => {
    const s = LocalStorage(root);
    const r = await s.put(Buffer.from("to-delete"));
    await s.delete(r.key);
    expect(await s.exists(r.key)).toBe(false);
  });
});
```

- [ ] **Step 8: Run test to verify it fails**

Run: `pnpm --filter @zordms/storage test local`
Expected: FAIL — `./local.js` not found.

- [ ] **Step 9: Write `index.ts` (interface + factory)**

```ts
export { sha256 } from "./hash.js";

export interface PutResult { key: string; size: number; hash: string; }

export interface StorageBackend {
  put(buf: Buffer): Promise<PutResult>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
  delete(key: string): Promise<void>;
}

export interface StorageConfig {
  storageDriver: "local" | "s3";
  localRoot: string;
  s3Bucket: string;
  s3Endpoint: string;
  s3Region: string;
  s3AccessKey: string;
  s3SecretKey: string;
}

export function keyForHash(hash: string): string {
  return `${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}`;
}

import { LocalStorage } from "./local.js";
import { S3Storage } from "./s3.js";

export function createStorage(cfg: StorageConfig): StorageBackend {
  if (cfg.storageDriver === "s3") {
    return S3Storage({
      bucket: cfg.s3Bucket, endpoint: cfg.s3Endpoint, region: cfg.s3Region,
      accessKeyId: cfg.s3AccessKey, secretAccessKey: cfg.s3SecretKey,
    });
  }
  return LocalStorage(cfg.localRoot);
}

export { LocalStorage } from "./local.js";
export { S3Storage } from "./s3.js";
```

- [ ] **Step 10: Write `local.ts`**

```ts
import { mkdir, writeFile, readFile, access, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { sha256 } from "./hash.js";
import { keyForHash, type StorageBackend, type PutResult } from "./index.js";

export function LocalStorage(rootDir: string): StorageBackend {
  const pathFor = (key: string) => join(rootDir, key);

  return {
    async put(buf: Buffer): Promise<PutResult> {
      const hash = sha256(buf);
      const key = keyForHash(hash);
      const abs = pathFor(key);
      try {
        await access(abs); // already stored — idempotent
      } catch {
        await mkdir(dirname(abs), { recursive: true });
        await writeFile(abs, buf);
      }
      return { key, size: buf.length, hash };
    },
    async get(key: string): Promise<Buffer> {
      return readFile(pathFor(key));
    },
    async exists(key: string): Promise<boolean> {
      try { await access(pathFor(key)); return true; } catch { return false; }
    },
    async delete(key: string): Promise<void> {
      try { await unlink(pathFor(key)); } catch { /* already gone */ }
    },
  };
}
```

- [ ] **Step 11: Write `s3.ts`**

```ts
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { sha256 } from "./hash.js";
import { keyForHash, type StorageBackend, type PutResult } from "./index.js";

export interface S3Opts {
  bucket: string; endpoint: string; region: string;
  accessKeyId: string; secretAccessKey: string;
}

export function S3Storage(opts: S3Opts): StorageBackend {
  const client = new S3Client({
    region: opts.region,
    endpoint: opts.endpoint || undefined,
    forcePathStyle: true, // MinIO compatibility
    credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey },
  });

  async function streamToBuffer(body: unknown): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of body as AsyncIterable<Uint8Array>) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }

  return {
    async put(buf: Buffer): Promise<PutResult> {
      const hash = sha256(buf);
      const key = keyForHash(hash);
      await client.send(new PutObjectCommand({ Bucket: opts.bucket, Key: key, Body: buf }));
      return { key, size: buf.length, hash };
    },
    async get(key: string): Promise<Buffer> {
      const res = await client.send(new GetObjectCommand({ Bucket: opts.bucket, Key: key }));
      return streamToBuffer(res.Body);
    },
    async exists(key: string): Promise<boolean> {
      try { await client.send(new HeadObjectCommand({ Bucket: opts.bucket, Key: key })); return true; }
      catch { return false; }
    },
    async delete(key: string): Promise<void> {
      await client.send(new DeleteObjectCommand({ Bucket: opts.bucket, Key: key }));
    },
  };
}
```

- [ ] **Step 12: Run test to verify it passes**

Run: `pnpm --filter @zordms/storage test`
Expected: PASS (hash + local suites; S3 has no test — it requires a live MinIO, exercised in integration/runbook only).

- [ ] **Step 13: Commit**

```bash
git add packages/storage
git commit -m "feat(storage): content-addressed sha256 storage (local-fs + s3/minio backends)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: `@zordms/events` — Redis Streams event bus (with in-memory test backend)

**Files:**
- Create: `packages/events/package.json`, `packages/events/tsconfig.json`, `packages/events/src/index.ts`
- Test: `packages/events/src/index.test.ts`

**Interfaces:**
- Consumes: `ioredis` (production transport only).
- Produces:
  - `DomainEvent = { type: string; payload: Record<string, unknown>; at: string }`.
  - `EventBus` interface: `emit(type: string, payload: Record<string, unknown>): Promise<void>`.
  - `InMemoryEventBus(): EventBus & { events: DomainEvent[] }` — records emitted events (test + injectable default).
  - `RedisStreamsEventBus(redisUrl: string, stream?: string): EventBus` — `XADD` to a Redis stream.
  - Event name constants: `EVENTS.DOCUMENT_CAPTURED = "document.captured"`, `DOCUMENT_INDEXED = "document.indexed"`, `DOCUMENT_CATALOGED = "document.cataloged"`.

- [ ] **Step 1: Create `packages/events/package.json`**

```json
{
  "name": "@zordms/events",
  "version": "0.0.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "lint": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": { "ioredis": "^5.4.1" },
  "devDependencies": { "typescript": "^5.4.0", "vitest": "^1.6.0", "@types/node": "^20.0.0" }
}
```

- [ ] **Step 2: Create `packages/events/tsconfig.json`**

```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

- [ ] **Step 3: Write the failing test**

`packages/events/src/index.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { InMemoryEventBus, EVENTS } from "./index.js";

describe("InMemoryEventBus", () => {
  it("records emitted events with type, payload, and timestamp", async () => {
    const bus = InMemoryEventBus();
    await bus.emit(EVENTS.DOCUMENT_CAPTURED, { docId: 1, branch: "Thimphu" });
    expect(bus.events).toHaveLength(1);
    expect(bus.events[0].type).toBe("document.captured");
    expect(bus.events[0].payload.docId).toBe(1);
    expect(typeof bus.events[0].at).toBe("string");
  });

  it("exposes the canonical event names", () => {
    expect(EVENTS.DOCUMENT_INDEXED).toBe("document.indexed");
    expect(EVENTS.DOCUMENT_CATALOGED).toBe("document.cataloged");
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter @zordms/events test`
Expected: FAIL — module not found.

- [ ] **Step 5: Write `index.ts`**

```ts
import Redis from "ioredis";

export const EVENTS = {
  DOCUMENT_CAPTURED: "document.captured",
  DOCUMENT_INDEXED: "document.indexed",
  DOCUMENT_CATALOGED: "document.cataloged",
} as const;

export interface DomainEvent {
  type: string;
  payload: Record<string, unknown>;
  at: string;
}

export interface EventBus {
  emit(type: string, payload: Record<string, unknown>): Promise<void>;
}

export function InMemoryEventBus(): EventBus & { events: DomainEvent[] } {
  const events: DomainEvent[] = [];
  return {
    events,
    async emit(type, payload) {
      events.push({ type, payload, at: new Date().toISOString() });
    },
  };
}

export function RedisStreamsEventBus(redisUrl: string, stream = "zordms:events"): EventBus {
  const client = new Redis(redisUrl);
  return {
    async emit(type, payload) {
      await client.xadd(stream, "*", "type", type, "payload", JSON.stringify(payload), "at", new Date().toISOString());
    },
  };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @zordms/events test`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/events
git commit -m "feat(events): redis-streams event bus + in-memory test backend

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Core DMS schema migration + permission-catalog seed amendment

**Files:**
- Create: `packages/db/src/migrations/20260623_0002_core_dms.ts`
- Test: `packages/db/src/migrations/core_dms.test.ts`
- Modify: `packages/db/src/seeds/0001_default_rbac.ts` (add the catalog/mapper permissions to the catalog + grant to roles)

**Interfaces:**
- Produces tables: `folders`, `documents`, `document_versions`, `annotations`, `folder_acls`.
- Seed amendment adds permissions `folder:create`, `folder:read`, `document:catalog`, `document:map`, `annotation:write` to the catalog and grants sensible defaults to existing roles.

- [ ] **Step 1: Write the failing migration test (in-memory sqlite)**

`packages/db/src/migrations/core_dms.test.ts`:
```ts
import { describe, it, expect, afterAll } from "vitest";
import knexLib from "knex";
import { buildKnexConfig } from "../knexConfig.js";

const knex = knexLib(buildKnexConfig({
  client: "sqlite3", host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "",
}));

afterAll(async () => { await knex.destroy(); });

describe("core_dms migration", () => {
  it("creates all core DMS tables after running all migrations", async () => {
    await knex.migrate.latest();
    for (const t of ["folders", "documents", "document_versions", "annotations", "folder_acls"]) {
      expect(await knex.schema.hasTable(t)).toBe(true);
    }
  });

  it("documents has the system + index metadata columns from IDP §3.3", async () => {
    for (const c of ["file_hash_sha256", "source_channel", "page_count", "file_size_bytes", "retention_years", "destruction_date", "doc_type", "metadata", "catalog_category", "review_flag", "confidence", "branch"]) {
      expect(await knex.schema.hasColumn("documents", c)).toBe(true);
    }
  });

  it("seeds the new catalog/mapper permissions", async () => {
    await knex.seed.run();
    const perms = await knex("permissions").pluck("key");
    expect(perms).toEqual(expect.arrayContaining([
      "document:capture", "document:index", "document:read", "document:delete",
      "folder:create", "folder:read", "document:catalog", "document:map", "annotation:write",
    ]));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zordms/db test core_dms`
Expected: FAIL — migration file does not exist; `folders` table missing.

- [ ] **Step 3: Write the migration**

`packages/db/src/migrations/20260623_0002_core_dms.ts`:
```ts
import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("folders", (t) => {
    t.increments("id").primary();
    t.integer("parent_id").references("id").inTable("folders").onDelete("CASCADE");
    t.string("name", 200).notNullable();
    t.string("path", 1000).notNullable(); // materialized absolute path, e.g. /BoB/Customers/.../2026/
    t.string("domain", 80);               // Customers | Operations | Compliance | Legal | IT | General | _Review
    t.string("created_by", 100);
    t.timestamp("created_at").defaultTo(knex.fn.now());
    t.unique(["path"]);
    t.index(["parent_id"]);
  });

  await knex.schema.createTable("documents", (t) => {
    t.increments("id").primary();
    t.integer("folder_id").references("id").inTable("folders").onDelete("SET NULL");
    t.string("title", 300).notNullable();
    t.string("original_filename", 300);
    t.string("mime_type", 150);
    t.integer("current_version").notNullable().defaultTo(1);
    // System metadata (IDP §3.3)
    t.string("file_hash_sha256", 64).notNullable();
    t.string("source_channel", 30).notNullable().defaultTo("UPLOAD"); // SCAN|UPLOAD|EMAIL|BaNCS_FEED
    t.string("ingest_user_id", 100);
    t.integer("page_count").notNullable().defaultTo(1);
    t.integer("file_size_bytes").notNullable().defaultTo(0);
    t.string("ocr_engine", 60);
    t.integer("processing_ms");
    t.integer("retention_years");
    t.date("destruction_date");
    // Indexing / classification
    t.string("doc_type", 60);
    t.text("metadata"); // JSON string of typed extracted fields
    t.string("catalog_category", 80);
    t.boolean("review_flag").notNullable().defaultTo(false);
    t.float("confidence");
    // Access scoping
    t.string("branch", 120);
    t.string("status", 20).notNullable().defaultTo("Active"); // Active | Deleted
    t.timestamp("ingest_timestamp").defaultTo(knex.fn.now());
    t.index(["folder_id"]);
    t.index(["branch"]);
    t.index(["doc_type"]);
  });

  await knex.schema.createTable("document_versions", (t) => {
    t.increments("id").primary();
    t.integer("document_id").notNullable().references("id").inTable("documents").onDelete("CASCADE");
    t.integer("version_no").notNullable();
    t.string("storage_key", 255).notNullable(); // content-addressed key
    t.string("file_hash_sha256", 64).notNullable();
    t.integer("file_size_bytes").notNullable().defaultTo(0);
    t.string("mime_type", 150);
    t.string("created_by", 100);
    t.string("comment", 500);
    t.timestamp("created_at").defaultTo(knex.fn.now());
    t.unique(["document_id", "version_no"]);
    t.index(["document_id"]);
  });

  await knex.schema.createTable("annotations", (t) => {
    t.increments("id").primary();
    t.integer("document_id").notNullable().references("id").inTable("documents").onDelete("CASCADE");
    t.integer("page").notNullable().defaultTo(1);
    t.string("kind", 20).notNullable(); // note | highlight | redaction | stamp
    t.float("x").notNullable().defaultTo(0);
    t.float("y").notNullable().defaultTo(0);
    t.float("width").notNullable().defaultTo(0);
    t.float("height").notNullable().defaultTo(0);
    t.text("content");        // note text / stamp label
    t.string("color", 20);
    t.string("created_by", 100);
    t.timestamp("created_at").defaultTo(knex.fn.now());
    t.index(["document_id"]);
  });

  await knex.schema.createTable("folder_acls", (t) => {
    t.increments("id").primary();
    t.integer("folder_id").notNullable().references("id").inTable("folders").onDelete("CASCADE");
    t.string("role", 80).notNullable();
    t.string("access", 20).notNullable(); // read | write | delete
    t.boolean("inherited").notNullable().defaultTo(false);
    t.timestamp("created_at").defaultTo(knex.fn.now());
    t.unique(["folder_id", "role", "access"]);
    t.index(["folder_id"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  for (const t of ["folder_acls", "annotations", "document_versions", "documents", "folders"]) {
    await knex.schema.dropTableIfExists(t);
  }
}
```

- [ ] **Step 4: Amend the seed (`packages/db/src/seeds/0001_default_rbac.ts`)**

Add these entries to the `PERMISSIONS` array (after the existing `document:*` entries):
```ts
  ["folder:create", "Create repository folders"],
  ["folder:read", "Browse repository folders"],
  ["document:catalog", "Run auto-catalog"],
  ["document:map", "Run directory mapping"],
  ["annotation:write", "Create annotations/redactions/stamps"],
```

Extend the `ROLES` grants so `CDO` keeps `PERMISSIONS.map(([k]) => k)` (already full — no change needed), and add the new keys to the relevant non-CDO roles:
```ts
  Supervisor: ["user:create", "user:update", "user:read", "role:assign", "document:read", "admin:access", "folder:create", "folder:read", "document:catalog", "document:map"],
  Maker: ["document:capture", "document:index", "document:read", "workflow:act", "folder:read", "annotation:write"],
  Checker: ["document:approve", "document:reject", "document:read", "workflow:act", "folder:read"],
  Indexer: ["document:index", "document:read", "document:catalog", "document:map", "folder:read"],
  Viewer: ["document:read", "folder:read"],
  Auditor: ["document:read", "compliance:read", "crossbranch:read", "folder:read"],
```
(`CDO` already gets every key via `PERMISSIONS.map`, so the new perms flow to CDO automatically. The seed is idempotent — it inserts only missing rows — so re-running is safe.)

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @zordms/db test core_dms`
Expected: PASS (3 tests). Also run the full db suite to confirm Plan 1's `identity_rbac` test still passes alongside the new migration: `pnpm --filter @zordms/db test` → PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/migrations/20260623_0002_core_dms.ts packages/db/src/migrations/core_dms.test.ts packages/db/src/seeds/0001_default_rbac.ts
git commit -m "feat(db): core DMS schema (folders/documents/versions/annotations/acls) + perm catalog

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: `@zordms/types` — Core DMS contracts (amend Plan 1 package)

**Files:**
- Modify: `packages/types/src/index.ts` (append the Core DMS types)
- Test: `packages/types/src/core.test.ts`

**Interfaces:**
- Produces TS types: `Folder`, `DocumentRecord`, `DocumentVersion`, `Annotation`, `AnnotationKind`, `IndexRequest`, `CatalogResult`, `MapResult`, plus type guard `isCatalogResult`.

- [ ] **Step 1: Write the failing test**

`packages/types/src/core.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { isCatalogResult } from "./index.js";

describe("isCatalogResult", () => {
  it("accepts a well-formed catalog result", () => {
    expect(isCatalogResult({ category: "KYC / Identity", route: "AUTO", mandatoryOk: true, missing: [], retentionYears: 10 })).toBe(true);
  });
  it("rejects a malformed object", () => {
    expect(isCatalogResult({ category: "x" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zordms/types test core`
Expected: FAIL — `isCatalogResult` not exported.

- [ ] **Step 3: Append to `packages/types/src/index.ts`**

```ts
// ---- Core DMS (Plan 2) ----

export interface Folder {
  id: number; parent_id?: number | null; name: string; path: string;
  domain?: string; created_by?: string; created_at?: string;
}

export interface DocumentRecord {
  id: number; folder_id?: number | null; title: string; original_filename?: string;
  mime_type?: string; current_version: number;
  file_hash_sha256: string; source_channel: string; ingest_user_id?: string;
  page_count: number; file_size_bytes: number; ocr_engine?: string; processing_ms?: number;
  retention_years?: number; destruction_date?: string;
  doc_type?: string; metadata?: string; catalog_category?: string;
  review_flag: boolean; confidence?: number;
  branch?: string; status: "Active" | "Deleted"; ingest_timestamp?: string;
}

export interface DocumentVersion {
  id: number; document_id: number; version_no: number; storage_key: string;
  file_hash_sha256: string; file_size_bytes: number; mime_type?: string;
  created_by?: string; comment?: string; created_at?: string;
}

export type AnnotationKind = "note" | "highlight" | "redaction" | "stamp";

export interface Annotation {
  id: number; document_id: number; page: number; kind: AnnotationKind;
  x: number; y: number; width: number; height: number;
  content?: string; color?: string; created_by?: string; created_at?: string;
}

export interface IndexRequest {
  doc_type: string;
  fields: Record<string, unknown>;
  confidence?: number;
}

export type CatalogRoute = "AUTO" | "TENTATIVE" | "HUMAN_REVIEW";

export interface CatalogResult {
  category: string;
  route: CatalogRoute;
  mandatoryOk: boolean;
  missing: string[];
  retentionYears: number;
  reviewFlag?: boolean;
  alertRule?: string;
}

export interface MapResult {
  path: string;
  acls: Array<{ role: string; access: "read" | "write" | "delete" }>;
}

export function isCatalogResult(x: unknown): x is CatalogResult {
  const c = x as CatalogResult;
  return !!c && typeof c.category === "string" && typeof c.route === "string"
    && typeof c.mandatoryOk === "boolean" && Array.isArray(c.missing)
    && typeof c.retentionYears === "number";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @zordms/types test`
Expected: PASS (Plan 1 `isAuthUser` test + new `isCatalogResult` test).

- [ ] **Step 5: Commit**

```bash
git add packages/types/src/index.ts packages/types/src/core.test.ts
git commit -m "feat(types): core DMS contracts (folder/document/version/annotation/catalog/map)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: `services/core` scaffold — app factory + deps + health

**Files:**
- Create: `services/core/package.json`, `services/core/tsconfig.json`, `services/core/src/deps.ts`, `services/core/src/app.ts`, `services/core/src/server.ts`
- Create: `services/core/src/testutil.ts` (shared test harness — sqlite knex + temp storage + in-memory bus)
- Test: `services/core/src/app.test.ts`

**Interfaces:**
- Produces:
  - `CoreDeps = { knex: Knex; config: AppConfig; storage: StorageBackend; events: EventBus }`.
  - `createApp(deps: CoreDeps): Express` — pure factory; sets `app.locals.deps`; mounts `GET /health`.
  - `makeTestApp(): Promise<{ app, knex, storage, events, cleanup }>` (in `testutil.ts`) — migrated+seeded sqlite, `LocalStorage` in a temp dir, `InMemoryEventBus`. Reused by every later Core test.

- [ ] **Step 1: Create `services/core/package.json`**

```json
{
  "name": "@zordms/core",
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
    "express": "^4.19.2", "cors": "^2.8.5", "multer": "^1.4.5-lts.1",
    "@zordms/auth": "workspace:*", "@zordms/db": "workspace:*",
    "@zordms/config": "workspace:*", "@zordms/types": "workspace:*",
    "@zordms/storage": "workspace:*", "@zordms/events": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.4.0", "vitest": "^1.6.0", "supertest": "^7.0.0", "tsx": "^4.15.0",
    "@types/express": "^4.17.21", "@types/cors": "^2.8.17", "@types/multer": "^1.4.11",
    "@types/supertest": "^6.0.2", "@types/node": "^20.0.0",
    "knex": "^3.1.0", "sqlite3": "^5.1.7"
  }
}
```

- [ ] **Step 2: Create `services/core/tsconfig.json`**

```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

- [ ] **Step 3: Write `deps.ts`**

```ts
import type { Knex } from "knex";
import type { AppConfig } from "@zordms/config";
import type { StorageBackend } from "@zordms/storage";
import type { EventBus } from "@zordms/events";

export interface CoreDeps {
  knex: Knex;
  config: AppConfig;
  storage: StorageBackend;
  events: EventBus;
}
```

- [ ] **Step 4: Write the failing test**

`services/core/src/app.test.ts`:
```ts
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { makeTestApp } from "./testutil.js";

const h = await makeTestApp();
afterAll(async () => { await h.cleanup(); });

describe("core health", () => {
  it("GET /health returns ok", async () => {
    const res = await request(h.app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.service).toBe("core");
  });
});
```

- [ ] **Step 5: Run test to verify it fails**

Run: `pnpm --filter @zordms/core test app`
Expected: FAIL — `./testutil.js` / `./app.js` not found.

- [ ] **Step 6: Write `app.ts`**

```ts
import express, { type Express } from "express";
import cors from "cors";
import type { CoreDeps } from "./deps.js";

export function createApp(deps: CoreDeps): Express {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.locals.deps = deps;

  app.get("/health", (_req, res) => res.json({ status: "ok", service: "core" }));
  return app;
}
```

- [ ] **Step 7: Write `testutil.ts`**

```ts
import knexLib, { type Knex } from "knex";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Express } from "express";
import { buildKnexConfig } from "@zordms/db";
import { loadConfig } from "@zordms/config";
import { LocalStorage, type StorageBackend } from "@zordms/storage";
import { InMemoryEventBus, type EventBus, type DomainEvent } from "@zordms/events";
import { signToken } from "@zordms/auth";
import { createApp } from "./app.js";

export interface TestHarness {
  app: Express;
  knex: Knex;
  storage: StorageBackend;
  events: EventBus & { events: DomainEvent[] };
  tokenFor: (username: string) => Promise<string>;
  cleanup: () => Promise<void>;
}

export async function makeTestApp(): Promise<TestHarness> {
  const knex = knexLib(buildKnexConfig({
    client: "sqlite3", host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "",
  }));
  await knex.migrate.latest();
  await knex.seed.run();

  const root = await mkdtemp(join(tmpdir(), "zordms-core-"));
  const storage = LocalStorage(root);
  const events = InMemoryEventBus();
  const config = loadConfig({ JWT_SECRET: "t" } as NodeJS.ProcessEnv);
  const app = createApp({ knex, config, storage, events });

  return {
    app, knex, storage, events,
    async tokenFor(username: string): Promise<string> {
      const u = await knex("users").where({ username }).first();
      return signToken({ sub: u.id, username }, "t");
    },
    async cleanup() {
      await knex.destroy();
      await rm(root, { recursive: true, force: true });
    },
  };
}
```

- [ ] **Step 8: Write `server.ts`**

```ts
import { createApp } from "./app.js";
import { getKnex } from "@zordms/db";
import { loadConfig } from "@zordms/config";
import { createStorage } from "@zordms/storage";
import { RedisStreamsEventBus } from "@zordms/events";

const config = loadConfig();
const knex = getKnex();
await knex.migrate.latest();
await knex.seed.run();

const storage = createStorage({
  storageDriver: (process.env.STORAGE_DRIVER as "local" | "s3") ?? "local",
  localRoot: process.env.STORAGE_LOCAL_ROOT ?? "./.storage",
  s3Bucket: process.env.S3_BUCKET ?? "zordms",
  s3Endpoint: process.env.S3_ENDPOINT ?? "",
  s3Region: process.env.S3_REGION ?? "us-east-1",
  s3AccessKey: process.env.S3_ACCESS_KEY ?? "",
  s3SecretKey: process.env.S3_SECRET_KEY ?? "",
});
const events = RedisStreamsEventBus(process.env.REDIS_URL ?? "redis://localhost:6379");

const port = Number(process.env.CORE_PORT ?? 4001);
const app = createApp({ knex, config, storage, events });
app.listen(port, () => console.log(`ZorDMS core on :${port}`));
```

- [ ] **Step 9: Run test to verify it passes**

Run: `pnpm --filter @zordms/core test app`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add services/core
git commit -m "feat(core): service scaffold — app factory, deps, health, test harness

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Folders — repository (create / list tree / move) + routes

**Files:**
- Create: `services/core/src/repo/folders.ts`, `services/core/src/routes/folders.ts`
- Modify: `services/core/src/app.ts` (mount `/folders`)
- Test: `services/core/src/repo/folders.test.ts`, `services/core/src/routes/folders.test.ts`

**Interfaces:**
- Consumes: `Knex`; `Folder` type.
- Produces (repo, pure-ish DB functions):
  - `createFolder(knex, { name, parentId?, domain?, createdBy? }): Promise<Folder>` — computes materialized `path` from parent (root path is `/BoB`), rejects duplicate path.
  - `listTree(knex): Promise<FolderNode[]>` where `FolderNode = Folder & { children: FolderNode[] }`.
  - `moveFolder(knex, id, newParentId): Promise<Folder>` — reparents and recomputes `path` for the node and all descendants; rejects moving a folder into its own subtree.
- Produces (routes, all `requireAuth`):
  - `POST /folders` (`folder:create`) body `{ name, parentId?, domain? }` → 201 `{ folder }`.
  - `GET /folders` (`folder:read`) → `{ tree }`.
  - `POST /folders/:id/move` (`folder:create`) body `{ parentId }` → `{ folder }`.

- [ ] **Step 1: Write the failing repo test**

`services/core/src/repo/folders.test.ts`:
```ts
import { describe, it, expect, afterAll } from "vitest";
import { makeTestApp } from "../testutil.js";
import { createFolder, listTree, moveFolder } from "./folders.js";

const h = await makeTestApp();
afterAll(async () => { await h.cleanup(); });

describe("folders repo", () => {
  it("creates a root folder under /BoB and a child with a materialized path", async () => {
    const customers = await createFolder(h.knex, { name: "Customers", domain: "Customers", createdBy: "admin" });
    expect(customers.path).toBe("/BoB/Customers");
    const kyc = await createFolder(h.knex, { name: "KYC", parentId: customers.id, createdBy: "admin" });
    expect(kyc.path).toBe("/BoB/Customers/KYC");
  });

  it("rejects a duplicate path", async () => {
    await createFolder(h.knex, { name: "Dupe" });
    await expect(createFolder(h.knex, { name: "Dupe" })).rejects.toThrow();
  });

  it("lists a nested tree", async () => {
    const tree = await listTree(h.knex);
    const customers = tree.find((n) => n.name === "Customers");
    expect(customers).toBeTruthy();
    expect(customers!.children.some((c) => c.name === "KYC")).toBe(true);
  });

  it("moves a folder and recomputes descendant paths", async () => {
    const ops = await createFolder(h.knex, { name: "Operations", domain: "Operations" });
    const customers = await h.knex("folders").where({ name: "Customers" }).first();
    const moved = await moveFolder(h.knex, customers.id, ops.id);
    expect(moved.path).toBe("/BoB/Operations/Customers");
    const kyc = await h.knex("folders").where({ name: "KYC" }).first();
    expect(kyc.path).toBe("/BoB/Operations/Customers/KYC");
  });

  it("refuses to move a folder into its own subtree", async () => {
    const ops = await h.knex("folders").where({ name: "Operations" }).first();
    const customers = await h.knex("folders").where({ name: "Customers" }).first();
    await expect(moveFolder(h.knex, ops.id, customers.id)).rejects.toThrow(/subtree/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zordms/core test repo/folders`
Expected: FAIL — `./folders.js` not found.

- [ ] **Step 3: Write `repo/folders.ts`**

```ts
import type { Knex } from "knex";
import type { Folder } from "@zordms/types";

export const ROOT_PATH = "/BoB";

export interface FolderNode extends Folder { children: FolderNode[]; }

function idOf(inserted: unknown): number {
  const x = (inserted as unknown[])[0];
  return typeof x === "object" && x !== null ? (x as { id: number }).id : (x as number);
}

export async function createFolder(
  knex: Knex,
  args: { name: string; parentId?: number | null; domain?: string; createdBy?: string },
): Promise<Folder> {
  let path = `${ROOT_PATH}/${args.name}`;
  if (args.parentId != null) {
    const parent = await knex("folders").where({ id: args.parentId }).first();
    if (!parent) throw new Error("parent_not_found");
    path = `${parent.path}/${args.name}`;
  }
  const existing = await knex("folders").where({ path }).first();
  if (existing) throw new Error(`duplicate_path:${path}`);

  const inserted = await knex("folders").insert({
    name: args.name, parent_id: args.parentId ?? null, path,
    domain: args.domain ?? null, created_by: args.createdBy ?? null,
  }).returning("id");
  const id = idOf(inserted);
  return knex("folders").where({ id }).first() as Promise<Folder>;
}

export async function listTree(knex: Knex): Promise<FolderNode[]> {
  const rows = (await knex("folders").select("*").orderBy("path")) as Folder[];
  const byId = new Map<number, FolderNode>();
  for (const r of rows) byId.set(r.id, { ...r, children: [] });
  const roots: FolderNode[] = [];
  for (const node of byId.values()) {
    if (node.parent_id != null && byId.has(node.parent_id)) byId.get(node.parent_id)!.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export async function moveFolder(knex: Knex, id: number, newParentId: number): Promise<Folder> {
  const node = await knex("folders").where({ id }).first();
  if (!node) throw new Error("not_found");
  const parent = await knex("folders").where({ id: newParentId }).first();
  if (!parent) throw new Error("parent_not_found");
  if (parent.path === node.path || parent.path.startsWith(`${node.path}/`)) {
    throw new Error("cannot_move_into_own_subtree");
  }

  const oldPath = node.path;
  const newPath = `${parent.path}/${node.name}`;
  const descendants = (await knex("folders").where("path", "like", `${oldPath}/%`)) as Folder[];

  await knex.transaction(async (tx) => {
    await tx("folders").where({ id }).update({ parent_id: newParentId, path: newPath });
    for (const d of descendants) {
      await tx("folders").where({ id: d.id }).update({ path: newPath + d.path.slice(oldPath.length) });
    }
  });
  return knex("folders").where({ id }).first() as Promise<Folder>;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @zordms/core test repo/folders`
Expected: PASS (5 tests).

- [ ] **Step 5: Write the failing routes test**

`services/core/src/routes/folders.test.ts`:
```ts
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { makeTestApp } from "../testutil.js";

const h = await makeTestApp();
afterAll(async () => { await h.cleanup(); });

describe("folders routes", () => {
  it("401 without a token", async () => {
    expect((await request(h.app).get("/folders")).status).toBe(401);
  });

  it("admin can create and list folders", async () => {
    const token = await h.tokenFor("admin");
    const created = await request(h.app).post("/folders").set("Authorization", `Bearer ${token}`)
      .send({ name: "Customers", domain: "Customers" });
    expect(created.status).toBe(201);
    expect(created.body.folder.path).toBe("/BoB/Customers");

    const list = await request(h.app).get("/folders").set("Authorization", `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.tree.some((n: any) => n.name === "Customers")).toBe(true);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter @zordms/core test routes/folders`
Expected: FAIL — `/folders` 404.

- [ ] **Step 7: Write `routes/folders.ts`**

```ts
import { Router } from "express";
import type { Knex } from "knex";
import { requireAuth } from "@zordms/auth";
import { requirePermission } from "@zordms/auth";
import { createFolder, listTree, moveFolder } from "../repo/folders.js";

export function foldersRouter(): Router {
  const r = Router();
  r.use(requireAuth);

  r.post("/", requirePermission("folder:create"), async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    try {
      const folder = await createFolder(knex, {
        name: req.body.name, parentId: req.body.parentId ?? null,
        domain: req.body.domain, createdBy: req.authUser!.username,
      });
      res.status(201).json({ folder });
    } catch (e: any) {
      res.status(400).json({ error: String(e.message ?? e) });
    }
  });

  r.get("/", requirePermission("folder:read"), async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    res.json({ tree: await listTree(knex) });
  });

  r.post("/:id/move", requirePermission("folder:create"), async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    try {
      const folder = await moveFolder(knex, Number(req.params.id), Number(req.body.parentId));
      res.json({ folder });
    } catch (e: any) {
      res.status(400).json({ error: String(e.message ?? e) });
    }
  });

  return r;
}
```

> **Note on `requireAuth`/`requirePermission` import source:** Plan 1 defined these as Gateway middleware files. For Core (and all later services) they are reused from `@zordms/auth`. If Plan 1 left them only under `services/gateway`, promote them into `@zordms/auth` (`src/middleware.ts`, re-exported from the barrel) as a one-line refactor before this step — the implementations are identical (they read `req.app.locals.deps.{knex,config}` and use `verifyToken`/`resolveUserAuthz`/`can`). This keeps a single source of truth.

- [ ] **Step 8: Mount in `app.ts`**

```ts
import { foldersRouter } from "./routes/folders.js";
// inside createApp, after express.json():
app.use("/folders", foldersRouter());
```

- [ ] **Step 9: Run test to verify it passes**

Run: `pnpm --filter @zordms/core test routes/folders`
Expected: PASS (2 tests).

- [ ] **Step 10: Commit**

```bash
git add services/core/src/repo/folders.ts services/core/src/routes/folders.ts services/core/src/app.ts services/core/src/repo/folders.test.ts services/core/src/routes/folders.test.ts
git commit -m "feat(core): folder repository (create/tree/move) + RBAC routes

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Documents — upload (multer) / list (branch-scoped) / get / download / delete

**Files:**
- Create: `services/core/src/repo/documents.ts`, `services/core/src/routes/documents.ts`
- Modify: `services/core/src/app.ts` (mount `/documents`)
- Test: `services/core/src/repo/documents.test.ts`, `services/core/src/routes/documents.test.ts`

**Interfaces:**
- Consumes: `Knex`, `StorageBackend`, `EventBus`, `EVENTS`; `DocumentRecord`, `DocumentVersion`.
- Produces (repo):
  - `captureDocument(deps, { title, filename, mimeType, buffer, branch, ingestUserId, sourceChannel?, folderId? }): Promise<DocumentRecord>` — stores buffer (content-addressed), creates `documents` row + initial `document_versions` row (v1), emits `document.captured`.
  - `listDocuments(knex, viewer: { branch?: string; canCrossBranch: boolean }): Promise<DocumentRecord[]>` — branch-scoped unless `canCrossBranch`; excludes `Deleted`.
  - `getDocument(knex, id): Promise<DocumentRecord | undefined>`.
  - `softDeleteDocument(knex, id): Promise<void>` — sets `status='Deleted'`.
  - `currentVersion(knex, id): Promise<DocumentVersion | undefined>`.
- Produces (routes, all `requireAuth`):
  - `POST /documents` (`document:capture`, multer `single("file")`, fields `title`, `branch?`, `folderId?`) → 201 `{ document }`.
  - `GET /documents` (`document:read`) → branch-scoped `{ documents }`.
  - `GET /documents/:id` (`document:read`) → `{ document }` (404 if missing/deleted).
  - `GET /documents/:id/download` (`document:read`) → streams current version bytes with content-type.
  - `DELETE /documents/:id` (`document:delete`) → 204; soft-delete.

- [ ] **Step 1: Write the failing repo test**

`services/core/src/repo/documents.test.ts`:
```ts
import { describe, it, expect, afterAll } from "vitest";
import { makeTestApp } from "../testutil.js";
import { captureDocument, listDocuments, getDocument, softDeleteDocument, currentVersion } from "./documents.js";
import { sha256 } from "@zordms/storage";
import { EVENTS } from "@zordms/events";

const h = await makeTestApp();
afterAll(async () => { await h.cleanup(); });

describe("documents repo", () => {
  it("captures a document content-addressed, with v1, and emits document.captured", async () => {
    const buffer = Buffer.from("CID scan bytes");
    const doc = await captureDocument({ knex: h.knex, storage: h.storage, events: h.events },
      { title: "Customer CID", filename: "cid.png", mimeType: "image/png", buffer, branch: "Thimphu", ingestUserId: "admin" });
    expect(doc.file_hash_sha256).toBe(sha256(buffer));
    expect(doc.current_version).toBe(1);
    const v1 = await currentVersion(h.knex, doc.id);
    expect(v1!.version_no).toBe(1);
    expect(v1!.file_hash_sha256).toBe(sha256(buffer));
    expect(await h.storage.exists(v1!.storage_key)).toBe(true);
    expect(h.events.events.some((e) => e.type === EVENTS.DOCUMENT_CAPTURED)).toBe(true);
  });

  it("scopes list by branch unless crossbranch is allowed", async () => {
    await captureDocument({ knex: h.knex, storage: h.storage, events: h.events },
      { title: "Paro doc", filename: "p.png", mimeType: "image/png", buffer: Buffer.from("paro"), branch: "Paro", ingestUserId: "admin" });

    const scoped = await listDocuments(h.knex, { branch: "Thimphu", canCrossBranch: false });
    expect(scoped.every((d) => d.branch === "Thimphu")).toBe(true);

    const all = await listDocuments(h.knex, { branch: "Thimphu", canCrossBranch: true });
    expect(all.some((d) => d.branch === "Paro")).toBe(true);
  });

  it("soft-deletes a document (hidden from list, fetchable as deleted=false)", async () => {
    const doc = await captureDocument({ knex: h.knex, storage: h.storage, events: h.events },
      { title: "Temp", filename: "t.png", mimeType: "image/png", buffer: Buffer.from("temp"), branch: "Thimphu", ingestUserId: "admin" });
    await softDeleteDocument(h.knex, doc.id);
    const row = await getDocument(h.knex, doc.id);
    expect(row).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zordms/core test repo/documents`
Expected: FAIL — `./documents.js` not found.

- [ ] **Step 3: Write `repo/documents.ts`**

```ts
import type { Knex } from "knex";
import type { StorageBackend } from "@zordms/storage";
import { type EventBus, EVENTS } from "@zordms/events";
import type { DocumentRecord, DocumentVersion } from "@zordms/types";

export interface CaptureDeps { knex: Knex; storage: StorageBackend; events: EventBus; }

function idOf(inserted: unknown): number {
  const x = (inserted as unknown[])[0];
  return typeof x === "object" && x !== null ? (x as { id: number }).id : (x as number);
}

export async function captureDocument(
  deps: CaptureDeps,
  args: {
    title: string; filename: string; mimeType: string; buffer: Buffer;
    branch?: string; ingestUserId?: string; sourceChannel?: string; folderId?: number | null;
  },
): Promise<DocumentRecord> {
  const stored = await deps.storage.put(args.buffer);
  const insertedDoc = await deps.knex("documents").insert({
    folder_id: args.folderId ?? null,
    title: args.title,
    original_filename: args.filename,
    mime_type: args.mimeType,
    current_version: 1,
    file_hash_sha256: stored.hash,
    source_channel: args.sourceChannel ?? "UPLOAD",
    ingest_user_id: args.ingestUserId ?? null,
    page_count: 1,
    file_size_bytes: stored.size,
    branch: args.branch ?? null,
    status: "Active",
  }).returning("id");
  const docId = idOf(insertedDoc);

  await deps.knex("document_versions").insert({
    document_id: docId, version_no: 1, storage_key: stored.key,
    file_hash_sha256: stored.hash, file_size_bytes: stored.size,
    mime_type: args.mimeType, created_by: args.ingestUserId ?? null, comment: "initial capture",
  });

  await deps.events.emit(EVENTS.DOCUMENT_CAPTURED, { docId, branch: args.branch ?? null, hash: stored.hash });
  return (await deps.knex("documents").where({ id: docId }).first()) as DocumentRecord;
}

export async function listDocuments(
  knex: Knex,
  viewer: { branch?: string; canCrossBranch: boolean },
): Promise<DocumentRecord[]> {
  const q = knex("documents").where({ status: "Active" });
  if (!viewer.canCrossBranch && viewer.branch) q.andWhere({ branch: viewer.branch });
  return (await q.orderBy("id", "desc")) as DocumentRecord[];
}

export async function getDocument(knex: Knex, id: number): Promise<DocumentRecord | undefined> {
  return (await knex("documents").where({ id, status: "Active" }).first()) as DocumentRecord | undefined;
}

export async function softDeleteDocument(knex: Knex, id: number): Promise<void> {
  await knex("documents").where({ id }).update({ status: "Deleted" });
}

export async function currentVersion(knex: Knex, id: number): Promise<DocumentVersion | undefined> {
  const doc = await knex("documents").where({ id }).first();
  if (!doc) return undefined;
  return (await knex("document_versions").where({ document_id: id, version_no: doc.current_version }).first()) as DocumentVersion | undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @zordms/core test repo/documents`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing routes test**

`services/core/src/routes/documents.test.ts`:
```ts
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { makeTestApp } from "../testutil.js";

const h = await makeTestApp();
afterAll(async () => { await h.cleanup(); });

describe("documents routes", () => {
  it("uploads, lists, fetches, downloads, and deletes a document", async () => {
    const token = await h.tokenFor("admin");

    const up = await request(h.app).post("/documents").set("Authorization", `Bearer ${token}`)
      .field("title", "Customer CID").field("branch", "Thimphu")
      .attach("file", Buffer.from("file-bytes-here"), "cid.png");
    expect(up.status).toBe(201);
    const id = up.body.document.id;
    expect(up.body.document.file_hash_sha256).toHaveLength(64);

    const list = await request(h.app).get("/documents").set("Authorization", `Bearer ${token}`);
    expect(list.status).toBe(200);
    expect(list.body.documents.some((d: any) => d.id === id)).toBe(true);

    const get = await request(h.app).get(`/documents/${id}`).set("Authorization", `Bearer ${token}`);
    expect(get.status).toBe(200);

    const dl = await request(h.app).get(`/documents/${id}/download`).set("Authorization", `Bearer ${token}`);
    expect(dl.status).toBe(200);
    expect(dl.body.toString()).toBe("file-bytes-here");

    const del = await request(h.app).delete(`/documents/${id}`).set("Authorization", `Bearer ${token}`);
    expect(del.status).toBe(204);
    const after = await request(h.app).get(`/documents/${id}`).set("Authorization", `Bearer ${token}`);
    expect(after.status).toBe(404);
  });

  it("forbids delete without document:delete", async () => {
    const token = await h.tokenFor("admin");
    const up = await request(h.app).post("/documents").set("Authorization", `Bearer ${token}`)
      .field("title", "x").field("branch", "Thimphu").attach("file", Buffer.from("y"), "y.png");
    const id = up.body.document.id;

    // create a Viewer user (document:read but not document:delete)
    const viewerRole = await h.knex("roles").where({ name: "Viewer" }).first();
    const inserted = await h.knex("users").insert({ username: "v_del", password_hash: "x", status: "Active", branch: "Thimphu" }).returning("id");
    const vid = typeof inserted[0] === "object" ? (inserted[0] as any).id : inserted[0];
    await h.knex("user_roles").insert({ user_id: vid, role_id: viewerRole.id });
    const vToken = await h.tokenFor("v_del");

    const del = await request(h.app).delete(`/documents/${id}`).set("Authorization", `Bearer ${vToken}`);
    expect(del.status).toBe(403);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter @zordms/core test routes/documents`
Expected: FAIL — `/documents` 404.

- [ ] **Step 7: Write `routes/documents.ts`**

```ts
import { Router } from "express";
import multer from "multer";
import type { Knex } from "knex";
import { requireAuth, requirePermission, can } from "@zordms/auth";
import type { CoreDeps } from "../deps.js";
import { captureDocument, listDocuments, getDocument, softDeleteDocument, currentVersion } from "../repo/documents.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

export function documentsRouter(): Router {
  const r = Router();
  r.use(requireAuth);

  r.post("/", requirePermission("document:capture"), upload.single("file"), async (req, res) => {
    const deps = req.app.locals.deps as CoreDeps;
    if (!req.file) { res.status(400).json({ error: "file_required" }); return; }
    const document = await captureDocument(deps, {
      title: req.body.title ?? req.file.originalname,
      filename: req.file.originalname,
      mimeType: req.file.mimetype,
      buffer: req.file.buffer,
      branch: req.body.branch ?? req.authUser!.branch,
      ingestUserId: req.authUser!.username,
      sourceChannel: req.body.sourceChannel,
      folderId: req.body.folderId ? Number(req.body.folderId) : null,
    });
    res.status(201).json({ document });
  });

  r.get("/", requirePermission("document:read"), async (req, res) => {
    const { knex } = req.app.locals.deps as CoreDeps;
    const canCrossBranch = can({ permissions: req.authUser!.permissions }, "crossbranch:read");
    const documents = await listDocuments(knex, { branch: req.authUser!.branch, canCrossBranch });
    res.json({ documents });
  });

  r.get("/:id", requirePermission("document:read"), async (req, res) => {
    const { knex } = req.app.locals.deps as CoreDeps;
    const document = await getDocument(knex, Number(req.params.id));
    if (!document) { res.status(404).json({ error: "not_found" }); return; }
    res.json({ document });
  });

  r.get("/:id/download", requirePermission("document:read"), async (req, res) => {
    const deps = req.app.locals.deps as CoreDeps;
    const document = await getDocument(deps.knex, Number(req.params.id));
    if (!document) { res.status(404).json({ error: "not_found" }); return; }
    const v = await currentVersion(deps.knex, document.id);
    if (!v) { res.status(404).json({ error: "no_version" }); return; }
    const buf = await deps.storage.get(v.storage_key);
    res.setHeader("Content-Type", v.mime_type ?? "application/octet-stream");
    res.setHeader("Content-Disposition", `attachment; filename="${document.original_filename ?? "document"}"`);
    res.send(buf);
  });

  r.delete("/:id", requirePermission("document:delete"), async (req, res) => {
    const { knex } = req.app.locals.deps as CoreDeps;
    const document = await getDocument(knex, Number(req.params.id));
    if (!document) { res.status(404).json({ error: "not_found" }); return; }
    await softDeleteDocument(knex, document.id);
    res.status(204).end();
  });

  return r;
}
```

- [ ] **Step 8: Mount in `app.ts`**

```ts
import { documentsRouter } from "./routes/documents.js";
// inside createApp:
app.use("/documents", documentsRouter());
```

- [ ] **Step 9: Run test to verify it passes**

Run: `pnpm --filter @zordms/core test routes/documents`
Expected: PASS (2 tests).

- [ ] **Step 10: Commit**

```bash
git add services/core/src/repo/documents.ts services/core/src/routes/documents.ts services/core/src/app.ts services/core/src/repo/documents.test.ts services/core/src/routes/documents.test.ts
git commit -m "feat(core): document upload/list/get/download/delete (branch-scoped, RBAC, content-addressed)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Versioning + rollback

**Files:**
- Create: `services/core/src/repo/versions.ts`
- Modify: `services/core/src/routes/documents.ts` (add `/documents/:id/versions` endpoints)
- Test: `services/core/src/repo/versions.test.ts`, append cases to `services/core/src/routes/documents.test.ts` (new describe block)

**Interfaces:**
- Consumes: `Knex`, `StorageBackend`, `EventBus`.
- Produces (repo):
  - `addVersion(deps, docId, { buffer, mimeType, createdBy, comment? }): Promise<DocumentVersion>` — stores buffer, inserts next `version_no`, bumps `documents.current_version` + `file_hash_sha256` + `file_size_bytes`.
  - `listVersions(knex, docId): Promise<DocumentVersion[]>` — newest first.
  - `rollback(deps, docId, targetVersionNo): Promise<DocumentVersion>` — creates a NEW version whose bytes equal the target version's bytes (immutable history; rollback is a forward operation), bumps `current_version`.
- Produces (routes, `requireAuth`):
  - `POST /documents/:id/versions` (`document:index`, multer `single("file")`) → 201 `{ version }`.
  - `GET /documents/:id/versions` (`document:read`) → `{ versions }`.
  - `POST /documents/:id/rollback` (`document:index`) body `{ version }` → `{ version }`.

- [ ] **Step 1: Write the failing repo test**

`services/core/src/repo/versions.test.ts`:
```ts
import { describe, it, expect, afterAll } from "vitest";
import { makeTestApp } from "../testutil.js";
import { captureDocument } from "./documents.js";
import { addVersion, listVersions, rollback } from "./versions.js";
import { sha256 } from "@zordms/storage";

const h = await makeTestApp();
afterAll(async () => { await h.cleanup(); });

const deps = () => ({ knex: h.knex, storage: h.storage, events: h.events });

describe("versions repo", () => {
  it("adds versions and bumps current_version", async () => {
    const doc = await captureDocument(deps(), { title: "D", filename: "d.png", mimeType: "image/png", buffer: Buffer.from("v1"), branch: "Thimphu", ingestUserId: "admin" });
    const v2 = await addVersion(deps(), doc.id, { buffer: Buffer.from("v2"), mimeType: "image/png", createdBy: "admin", comment: "edit" });
    expect(v2.version_no).toBe(2);
    const fresh = await h.knex("documents").where({ id: doc.id }).first();
    expect(fresh.current_version).toBe(2);
    expect(fresh.file_hash_sha256).toBe(sha256(Buffer.from("v2")));
    const all = await listVersions(h.knex, doc.id);
    expect(all.map((v) => v.version_no)).toEqual([2, 1]);
  });

  it("rolls back by creating a new version equal to the target bytes", async () => {
    const doc = await captureDocument(deps(), { title: "R", filename: "r.png", mimeType: "image/png", buffer: Buffer.from("orig"), branch: "Thimphu", ingestUserId: "admin" });
    await addVersion(deps(), doc.id, { buffer: Buffer.from("changed"), mimeType: "image/png", createdBy: "admin" });
    const rolled = await rollback(deps(), doc.id, 1);
    expect(rolled.version_no).toBe(3);
    expect(rolled.file_hash_sha256).toBe(sha256(Buffer.from("orig")));
    const bytes = await h.storage.get(rolled.storage_key);
    expect(bytes.toString()).toBe("orig");
    const fresh = await h.knex("documents").where({ id: doc.id }).first();
    expect(fresh.current_version).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zordms/core test repo/versions`
Expected: FAIL — `./versions.js` not found.

- [ ] **Step 3: Write `repo/versions.ts`**

```ts
import type { Knex } from "knex";
import type { StorageBackend } from "@zordms/storage";
import type { EventBus } from "@zordms/events";
import type { DocumentVersion } from "@zordms/types";

export interface VersionDeps { knex: Knex; storage: StorageBackend; events: EventBus; }

async function nextVersionNo(knex: Knex, docId: number): Promise<number> {
  const row = await knex("document_versions").where({ document_id: docId }).max<{ m: number }[]>("version_no as m");
  return Number(row[0]?.m ?? 0) + 1;
}

async function insertVersion(
  deps: VersionDeps, docId: number,
  args: { buffer: Buffer; mimeType?: string; createdBy?: string; comment?: string },
): Promise<DocumentVersion> {
  const stored = await deps.storage.put(args.buffer);
  const version_no = await nextVersionNo(deps.knex, docId);
  await deps.knex("document_versions").insert({
    document_id: docId, version_no, storage_key: stored.key,
    file_hash_sha256: stored.hash, file_size_bytes: stored.size,
    mime_type: args.mimeType ?? null, created_by: args.createdBy ?? null, comment: args.comment ?? null,
  });
  await deps.knex("documents").where({ id: docId }).update({
    current_version: version_no, file_hash_sha256: stored.hash, file_size_bytes: stored.size,
  });
  return (await deps.knex("document_versions").where({ document_id: docId, version_no }).first()) as DocumentVersion;
}

export async function addVersion(
  deps: VersionDeps, docId: number,
  args: { buffer: Buffer; mimeType?: string; createdBy?: string; comment?: string },
): Promise<DocumentVersion> {
  return insertVersion(deps, docId, args);
}

export async function listVersions(knex: Knex, docId: number): Promise<DocumentVersion[]> {
  return (await knex("document_versions").where({ document_id: docId }).orderBy("version_no", "desc")) as DocumentVersion[];
}

export async function rollback(deps: VersionDeps, docId: number, targetVersionNo: number): Promise<DocumentVersion> {
  const target = await deps.knex("document_versions").where({ document_id: docId, version_no: targetVersionNo }).first();
  if (!target) throw new Error("target_version_not_found");
  const buffer = await deps.storage.get(target.storage_key);
  return insertVersion(deps, docId, { buffer, mimeType: target.mime_type, createdBy: target.created_by, comment: `rollback to v${targetVersionNo}` });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @zordms/core test repo/versions`
Expected: PASS (2 tests).

- [ ] **Step 5: Write the failing routes test (append a describe block)**

Append to `services/core/src/routes/documents.test.ts`:
```ts
describe("document versioning routes", () => {
  it("adds a version, lists versions, and rolls back", async () => {
    const h2 = await makeTestApp();
    try {
      const token = await h2.tokenFor("admin");
      const up = await request(h2.app).post("/documents").set("Authorization", `Bearer ${token}`)
        .field("title", "V").field("branch", "Thimphu").attach("file", Buffer.from("one"), "v.png");
      const id = up.body.document.id;

      const v2 = await request(h2.app).post(`/documents/${id}/versions`).set("Authorization", `Bearer ${token}`)
        .attach("file", Buffer.from("two"), "v.png");
      expect(v2.status).toBe(201);
      expect(v2.body.version.version_no).toBe(2);

      const list = await request(h2.app).get(`/documents/${id}/versions`).set("Authorization", `Bearer ${token}`);
      expect(list.body.versions.map((v: any) => v.version_no)).toEqual([2, 1]);

      const rb = await request(h2.app).post(`/documents/${id}/rollback`).set("Authorization", `Bearer ${token}`).send({ version: 1 });
      expect(rb.status).toBe(200);
      expect(rb.body.version.version_no).toBe(3);

      const dl = await request(h2.app).get(`/documents/${id}/download`).set("Authorization", `Bearer ${token}`);
      expect(dl.body.toString()).toBe("one");
    } finally { await h2.cleanup(); }
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter @zordms/core test routes/documents`
Expected: FAIL — version endpoints 404.

- [ ] **Step 7: Add the version endpoints to `routes/documents.ts`**

Add the import and three routes inside `documentsRouter()` (before `return r;`):
```ts
import { addVersion, listVersions, rollback } from "../repo/versions.js";
// ...
  r.post("/:id/versions", requirePermission("document:index"), upload.single("file"), async (req, res) => {
    const deps = req.app.locals.deps as CoreDeps;
    const document = await getDocument(deps.knex, Number(req.params.id));
    if (!document) { res.status(404).json({ error: "not_found" }); return; }
    if (!req.file) { res.status(400).json({ error: "file_required" }); return; }
    const version = await addVersion(deps, document.id, {
      buffer: req.file.buffer, mimeType: req.file.mimetype, createdBy: req.authUser!.username, comment: req.body.comment,
    });
    res.status(201).json({ version });
  });

  r.get("/:id/versions", requirePermission("document:read"), async (req, res) => {
    const { knex } = req.app.locals.deps as CoreDeps;
    res.json({ versions: await listVersions(knex, Number(req.params.id)) });
  });

  r.post("/:id/rollback", requirePermission("document:index"), async (req, res) => {
    const deps = req.app.locals.deps as CoreDeps;
    const document = await getDocument(deps.knex, Number(req.params.id));
    if (!document) { res.status(404).json({ error: "not_found" }); return; }
    try {
      const version = await rollback(deps, document.id, Number(req.body.version));
      res.json({ version });
    } catch (e: any) { res.status(400).json({ error: String(e.message ?? e) }); }
  });
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm --filter @zordms/core test routes/documents`
Expected: PASS (3 tests, incl. the new versioning block).

- [ ] **Step 9: Commit**

```bash
git add services/core/src/repo/versions.ts services/core/src/routes/documents.ts services/core/src/repo/versions.test.ts services/core/src/routes/documents.test.ts
git commit -m "feat(core): document version control + rollback (immutable forward history)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Indexing — Bhutan typed metadata schemas + validated index endpoint

**Files:**
- Create: `services/core/src/schemas/index.ts`, `services/core/src/routes/index.ts`
- Modify: `services/core/src/app.ts` (mount `/index`)
- Test: `services/core/src/schemas/index.test.ts`, `services/core/src/routes/index.test.ts`

**Interfaces:**
- Consumes: `IndexRequest`; IDP doc §3.2 (BT_CID_4G, BT_PASSPORT, BOB_LOAN_APPLICATION) + §3.3 system metadata.
- Produces (schemas — pure):
  - `FieldSpec = { name: string; type: "string"|"date"|"float"|"boolean"; required: boolean; indexed: boolean; pii: boolean; regex?: string; enum?: string[] }`.
  - `SCHEMAS: Record<string, FieldSpec[]>` for the three doc types.
  - `validateMetadata(docType: string, fields: Record<string, unknown>): { ok: boolean; errors: string[]; missing: string[] }` — enforces required, type, regex, and enum rules (per IDP §3.2 validation column).
- Produces (route, `requireAuth`):
  - `POST /index/:documentId` (`document:index`) body `IndexRequest` → 200 `{ document }` on valid (persists `doc_type`, `metadata` JSON, `confidence`, sets `review_flag` if `confidence < 0.85`, emits `document.indexed`); 422 `{ errors, missing }` on invalid.

- [ ] **Step 1: Write the failing schema test**

`services/core/src/schemas/index.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { SCHEMAS, validateMetadata } from "./index.js";

describe("Bhutan metadata schemas", () => {
  it("defines the three BoB doc-type schemas", () => {
    expect(Object.keys(SCHEMAS)).toEqual(expect.arrayContaining(["BT_CID_4G", "BT_PASSPORT", "BOB_LOAN_APPLICATION"]));
  });

  it("accepts a valid CID record", () => {
    const r = validateMetadata("BT_CID_4G", {
      cid_no: "10112345678", full_name: "Tashi Dorji", dob: "1990-05-01",
      issue_date: "2020-01-01", expiry_date: "2030-01-01", dzongkhag: "Thimphu",
    });
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.missing).toEqual([]);
  });

  it("rejects a CID with bad cid_no regex and a missing required field", () => {
    const r = validateMetadata("BT_CID_4G", {
      cid_no: "123", full_name: "X", dob: "1990-05-01", issue_date: "2020-01-01", dzongkhag: "Thimphu",
      // expiry_date missing
    });
    expect(r.ok).toBe(false);
    expect(r.missing).toContain("expiry_date");
    expect(r.errors.some((e) => e.includes("cid_no"))).toBe(true);
  });

  it("enforces enum on loan_type", () => {
    const r = validateMetadata("BOB_LOAN_APPLICATION", {
      application_no: "LN2026001", applicant_cid: "10112345678", applicant_name: "Y",
      loan_type: "SPACESHIP", loan_amount: 1000, branch_code: "THI001", submission_date: "2026-01-01",
    });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("loan_type"))).toBe(true);
  });

  it("validates passport_no format", () => {
    const ok = validateMetadata("BT_PASSPORT", {
      passport_no: "A1234567", surname: "Dorji", given_names: "Tashi",
      dob: "1990-05-01", issue_date: "2020-01-01", expiry_date: "2030-01-01",
    });
    expect(ok.ok).toBe(true);
    const bad = validateMetadata("BT_PASSPORT", {
      passport_no: "1234567", surname: "Dorji", given_names: "Tashi",
      dob: "1990-05-01", issue_date: "2020-01-01", expiry_date: "2030-01-01",
    });
    expect(bad.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zordms/core test schemas`
Expected: FAIL — `./index.js` (schemas) not found.

- [ ] **Step 3: Write `schemas/index.ts`**

```ts
export type FieldType = "string" | "date" | "float" | "boolean";

export interface FieldSpec {
  name: string;
  type: FieldType;
  required: boolean;
  indexed: boolean;
  pii: boolean;
  regex?: string;
  enum?: string[];
}

const ISO_DATE = "^\\d{4}-\\d{2}-\\d{2}$";

export const SCHEMAS: Record<string, FieldSpec[]> = {
  // IDP §3.2.1 — Bhutan CID Card (4G)
  BT_CID_4G: [
    { name: "cid_no", type: "string", required: true, indexed: true, pii: true, regex: "^[0-9]{11}$" },
    { name: "full_name", type: "string", required: true, indexed: true, pii: true },
    { name: "dob", type: "date", required: true, indexed: true, pii: true, regex: ISO_DATE },
    { name: "sex", type: "string", required: false, indexed: false, pii: false, enum: ["M", "F", "O"] },
    { name: "issue_date", type: "date", required: true, indexed: true, pii: false, regex: ISO_DATE },
    { name: "expiry_date", type: "date", required: true, indexed: true, pii: false, regex: ISO_DATE },
    { name: "dzongkhag", type: "string", required: true, indexed: true, pii: false },
    { name: "village", type: "string", required: false, indexed: false, pii: false },
  ],
  // IDP §3.2.2 — Bhutan Passport
  BT_PASSPORT: [
    { name: "passport_no", type: "string", required: true, indexed: true, pii: true, regex: "^[A-Z][0-9]{7}$" },
    { name: "surname", type: "string", required: true, indexed: true, pii: true },
    { name: "given_names", type: "string", required: true, indexed: true, pii: true },
    { name: "nationality", type: "string", required: true, indexed: false, pii: false },
    { name: "dob", type: "date", required: true, indexed: true, pii: true, regex: ISO_DATE },
    { name: "sex", type: "string", required: false, indexed: false, pii: false, enum: ["M", "F"] },
    { name: "place_of_birth", type: "string", required: false, indexed: false, pii: false },
    { name: "issue_date", type: "date", required: true, indexed: true, pii: false, regex: ISO_DATE },
    { name: "expiry_date", type: "date", required: true, indexed: true, pii: false, regex: ISO_DATE },
  ],
  // IDP §3.2.3 — BoB Loan Application
  BOB_LOAN_APPLICATION: [
    { name: "application_no", type: "string", required: true, indexed: true, pii: false },
    { name: "applicant_cid", type: "string", required: true, indexed: true, pii: true, regex: "^[0-9]{11}$" },
    { name: "applicant_name", type: "string", required: true, indexed: true, pii: true },
    { name: "loan_type", type: "string", required: true, indexed: true, pii: false, enum: ["HOME", "AUTO", "AGRI", "BUSINESS", "PERSONAL"] },
    { name: "loan_amount", type: "float", required: true, indexed: true, pii: false },
    { name: "branch_code", type: "string", required: true, indexed: true, pii: false },
    { name: "submission_date", type: "date", required: true, indexed: true, pii: false, regex: ISO_DATE },
    { name: "officer_id", type: "string", required: false, indexed: true, pii: false },
  ],
};

function typeOk(spec: FieldSpec, value: unknown): boolean {
  switch (spec.type) {
    case "float": return typeof value === "number" && Number.isFinite(value);
    case "boolean": return typeof value === "boolean";
    case "string":
    case "date": return typeof value === "string";
  }
}

export function validateMetadata(
  docType: string,
  fields: Record<string, unknown>,
): { ok: boolean; errors: string[]; missing: string[] } {
  const specs = SCHEMAS[docType];
  if (!specs) return { ok: false, errors: [`unknown doc_type: ${docType}`], missing: [] };

  const errors: string[] = [];
  const missing: string[] = [];

  for (const spec of specs) {
    const value = fields[spec.name];
    const present = value !== undefined && value !== null && value !== "";
    if (!present) {
      if (spec.required) missing.push(spec.name);
      continue;
    }
    if (!typeOk(spec, value)) {
      errors.push(`${spec.name}: expected ${spec.type}`);
      continue;
    }
    if (spec.regex && typeof value === "string" && !new RegExp(spec.regex).test(value)) {
      errors.push(`${spec.name}: does not match ${spec.regex}`);
    }
    if (spec.enum && !spec.enum.includes(String(value))) {
      errors.push(`${spec.name}: must be one of ${spec.enum.join("/")}`);
    }
  }

  return { ok: errors.length === 0 && missing.length === 0, errors, missing };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @zordms/core test schemas`
Expected: PASS (5 tests).

- [ ] **Step 5: Write the failing route test**

`services/core/src/routes/index.test.ts`:
```ts
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { makeTestApp } from "../testutil.js";
import { EVENTS } from "@zordms/events";

const h = await makeTestApp();
afterAll(async () => { await h.cleanup(); });

async function uploadDoc(token: string): Promise<number> {
  const up = await request(h.app).post("/documents").set("Authorization", `Bearer ${token}`)
    .field("title", "CID").field("branch", "Thimphu").attach("file", Buffer.from("cid"), "cid.png");
  return up.body.document.id;
}

describe("index route", () => {
  it("persists valid CID metadata and emits document.indexed", async () => {
    const token = await h.tokenFor("admin");
    const id = await uploadDoc(token);
    const res = await request(h.app).post(`/index/${id}`).set("Authorization", `Bearer ${token}`).send({
      doc_type: "BT_CID_4G", confidence: 0.97,
      fields: { cid_no: "10112345678", full_name: "Tashi Dorji", dob: "1990-05-01", issue_date: "2020-01-01", expiry_date: "2030-01-01", dzongkhag: "Thimphu" },
    });
    expect(res.status).toBe(200);
    expect(res.body.document.doc_type).toBe("BT_CID_4G");
    expect(res.body.document.review_flag).toBe(false);
    expect(JSON.parse(res.body.document.metadata).cid_no).toBe("10112345678");
    expect(h.events.events.some((e) => e.type === EVENTS.DOCUMENT_INDEXED)).toBe(true);
  });

  it("sets review_flag when confidence < 0.85", async () => {
    const token = await h.tokenFor("admin");
    const id = await uploadDoc(token);
    const res = await request(h.app).post(`/index/${id}`).set("Authorization", `Bearer ${token}`).send({
      doc_type: "BT_CID_4G", confidence: 0.7,
      fields: { cid_no: "10112345678", full_name: "T", dob: "1990-05-01", issue_date: "2020-01-01", expiry_date: "2030-01-01", dzongkhag: "Thimphu" },
    });
    expect(res.status).toBe(200);
    expect(res.body.document.review_flag).toBe(true);
  });

  it("returns 422 with errors/missing on invalid metadata", async () => {
    const token = await h.tokenFor("admin");
    const id = await uploadDoc(token);
    const res = await request(h.app).post(`/index/${id}`).set("Authorization", `Bearer ${token}`).send({
      doc_type: "BT_CID_4G", fields: { cid_no: "bad", full_name: "T", dob: "1990-05-01", issue_date: "2020-01-01", dzongkhag: "Thimphu" },
    });
    expect(res.status).toBe(422);
    expect(res.body.missing).toContain("expiry_date");
    expect(res.body.errors.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter @zordms/core test routes/index`
Expected: FAIL — `/index/:id` 404.

- [ ] **Step 7: Write `routes/index.ts`**

```ts
import { Router } from "express";
import { requireAuth, requirePermission } from "@zordms/auth";
import { EVENTS } from "@zordms/events";
import type { CoreDeps } from "../deps.js";
import type { IndexRequest } from "@zordms/types";
import { validateMetadata } from "../schemas/index.js";
import { getDocument } from "../repo/documents.js";

export function indexRouter(): Router {
  const r = Router();
  r.use(requireAuth);

  r.post("/:documentId", requirePermission("document:index"), async (req, res) => {
    const deps = req.app.locals.deps as CoreDeps;
    const document = await getDocument(deps.knex, Number(req.params.documentId));
    if (!document) { res.status(404).json({ error: "not_found" }); return; }

    const body = req.body as IndexRequest;
    const result = validateMetadata(body.doc_type, body.fields ?? {});
    if (!result.ok) { res.status(422).json({ errors: result.errors, missing: result.missing }); return; }

    const confidence = typeof body.confidence === "number" ? body.confidence : 1;
    const reviewFlag = confidence < 0.85;
    await deps.knex("documents").where({ id: document.id }).update({
      doc_type: body.doc_type,
      metadata: JSON.stringify(body.fields),
      confidence,
      review_flag: reviewFlag,
    });
    await deps.events.emit(EVENTS.DOCUMENT_INDEXED, { docId: document.id, docType: body.doc_type, confidence });
    const updated = await deps.knex("documents").where({ id: document.id }).first();
    res.json({ document: updated });
  });

  return r;
}
```

- [ ] **Step 8: Mount in `app.ts`**

```ts
import { indexRouter } from "./routes/index.js";
// inside createApp:
app.use("/index", indexRouter());
```

- [ ] **Step 9: Run test to verify it passes**

Run: `pnpm --filter @zordms/core test routes/index`
Expected: PASS (3 tests).

- [ ] **Step 10: Commit**

```bash
git add services/core/src/schemas/index.ts services/core/src/routes/index.ts services/core/src/app.ts services/core/src/schemas/index.test.ts services/core/src/routes/index.test.ts
git commit -m "feat(core): Bhutan typed metadata schemas + validated indexing endpoint (IDP 3.2/3.3)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Viewer data — annotations CRUD (coordinate-based) + redaction/stamp records

**Files:**
- Create: `services/core/src/repo/annotations.ts`, `services/core/src/routes/annotations.ts`
- Modify: `services/core/src/app.ts` (mount `/documents/:documentId/annotations` via the annotations router)
- Test: `services/core/src/repo/annotations.test.ts`, `services/core/src/routes/annotations.test.ts`

**Interfaces:**
- Consumes: `Knex`; `Annotation`, `AnnotationKind`.
- Produces (repo):
  - `createAnnotation(knex, docId, { kind, page, x, y, width, height, content?, color?, createdBy? }): Promise<Annotation>` — validates `kind`.
  - `listAnnotations(knex, docId): Promise<Annotation[]>`.
  - `deleteAnnotation(knex, id): Promise<void>`.
- Produces (routes, `requireAuth`, mounted as a sub-router):
  - `GET /documents/:documentId/annotations` (`document:read`) → `{ annotations }`.
  - `POST /documents/:documentId/annotations` (`annotation:write`) body `{ kind, page, x, y, width, height, content?, color? }` → 201 `{ annotation }`. `kind` covers `note | highlight | redaction | stamp` (a redaction is a coordinate rect; a stamp carries `content` as its label).
  - `DELETE /documents/:documentId/annotations/:id` (`annotation:write`) → 204.

- [ ] **Step 1: Write the failing repo test**

`services/core/src/repo/annotations.test.ts`:
```ts
import { describe, it, expect, afterAll } from "vitest";
import { makeTestApp } from "../testutil.js";
import { captureDocument } from "./documents.js";
import { createAnnotation, listAnnotations, deleteAnnotation } from "./annotations.js";

const h = await makeTestApp();
afterAll(async () => { await h.cleanup(); });

async function doc(): Promise<number> {
  const d = await captureDocument({ knex: h.knex, storage: h.storage, events: h.events },
    { title: "A", filename: "a.png", mimeType: "image/png", buffer: Buffer.from("a"), branch: "Thimphu", ingestUserId: "admin" });
  return d.id;
}

describe("annotations repo", () => {
  it("creates note, redaction, and stamp annotations and lists them", async () => {
    const id = await doc();
    await createAnnotation(h.knex, id, { kind: "note", page: 1, x: 10, y: 20, width: 100, height: 40, content: "Check this", createdBy: "admin" });
    await createAnnotation(h.knex, id, { kind: "redaction", page: 1, x: 50, y: 60, width: 80, height: 20, createdBy: "admin" });
    await createAnnotation(h.knex, id, { kind: "stamp", page: 2, x: 0, y: 0, width: 120, height: 60, content: "APPROVED", createdBy: "admin" });
    const list = await listAnnotations(h.knex, id);
    expect(list.map((a) => a.kind).sort()).toEqual(["note", "redaction", "stamp"]);
    const redaction = list.find((a) => a.kind === "redaction")!;
    expect(redaction.x).toBe(50);
    expect(redaction.width).toBe(80);
  });

  it("rejects an unknown annotation kind", async () => {
    const id = await doc();
    await expect(createAnnotation(h.knex, id, { kind: "scribble" as any, page: 1, x: 0, y: 0, width: 1, height: 1 })).rejects.toThrow();
  });

  it("deletes an annotation", async () => {
    const id = await doc();
    const a = await createAnnotation(h.knex, id, { kind: "highlight", page: 1, x: 1, y: 1, width: 5, height: 5 });
    await deleteAnnotation(h.knex, a.id);
    expect((await listAnnotations(h.knex, id)).find((x) => x.id === a.id)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zordms/core test repo/annotations`
Expected: FAIL — `./annotations.js` not found.

- [ ] **Step 3: Write `repo/annotations.ts`**

```ts
import type { Knex } from "knex";
import type { Annotation, AnnotationKind } from "@zordms/types";

const KINDS: AnnotationKind[] = ["note", "highlight", "redaction", "stamp"];

function idOf(inserted: unknown): number {
  const x = (inserted as unknown[])[0];
  return typeof x === "object" && x !== null ? (x as { id: number }).id : (x as number);
}

export async function createAnnotation(
  knex: Knex, docId: number,
  args: { kind: AnnotationKind; page: number; x: number; y: number; width: number; height: number; content?: string; color?: string; createdBy?: string },
): Promise<Annotation> {
  if (!KINDS.includes(args.kind)) throw new Error(`invalid_kind:${args.kind}`);
  const inserted = await knex("annotations").insert({
    document_id: docId, kind: args.kind, page: args.page,
    x: args.x, y: args.y, width: args.width, height: args.height,
    content: args.content ?? null, color: args.color ?? null, created_by: args.createdBy ?? null,
  }).returning("id");
  const id = idOf(inserted);
  return (await knex("annotations").where({ id }).first()) as Annotation;
}

export async function listAnnotations(knex: Knex, docId: number): Promise<Annotation[]> {
  return (await knex("annotations").where({ document_id: docId }).orderBy("id")) as Annotation[];
}

export async function deleteAnnotation(knex: Knex, id: number): Promise<void> {
  await knex("annotations").where({ id }).del();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @zordms/core test repo/annotations`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing route test**

`services/core/src/routes/annotations.test.ts`:
```ts
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { makeTestApp } from "../testutil.js";

const h = await makeTestApp();
afterAll(async () => { await h.cleanup(); });

describe("annotations routes", () => {
  it("creates, lists, and deletes coordinate annotations", async () => {
    const token = await h.tokenFor("admin");
    const up = await request(h.app).post("/documents").set("Authorization", `Bearer ${token}`)
      .field("title", "Doc").field("branch", "Thimphu").attach("file", Buffer.from("x"), "x.png");
    const id = up.body.document.id;

    const create = await request(h.app).post(`/documents/${id}/annotations`).set("Authorization", `Bearer ${token}`)
      .send({ kind: "redaction", page: 1, x: 12, y: 34, width: 56, height: 78 });
    expect(create.status).toBe(201);
    expect(create.body.annotation.kind).toBe("redaction");

    const list = await request(h.app).get(`/documents/${id}/annotations`).set("Authorization", `Bearer ${token}`);
    expect(list.body.annotations).toHaveLength(1);

    const del = await request(h.app).delete(`/documents/${id}/annotations/${create.body.annotation.id}`).set("Authorization", `Bearer ${token}`);
    expect(del.status).toBe(204);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter @zordms/core test routes/annotations`
Expected: FAIL — annotation endpoints 404.

- [ ] **Step 7: Write `routes/annotations.ts`**

```ts
import { Router } from "express";
import { requireAuth, requirePermission } from "@zordms/auth";
import type { CoreDeps } from "../deps.js";
import { createAnnotation, listAnnotations, deleteAnnotation } from "../repo/annotations.js";

export function annotationsRouter(): Router {
  const r = Router({ mergeParams: true });
  r.use(requireAuth);

  r.get("/", requirePermission("document:read"), async (req, res) => {
    const { knex } = req.app.locals.deps as CoreDeps;
    res.json({ annotations: await listAnnotations(knex, Number(req.params.documentId)) });
  });

  r.post("/", requirePermission("annotation:write"), async (req, res) => {
    const { knex } = req.app.locals.deps as CoreDeps;
    try {
      const annotation = await createAnnotation(knex, Number(req.params.documentId), {
        kind: req.body.kind, page: Number(req.body.page ?? 1),
        x: Number(req.body.x), y: Number(req.body.y), width: Number(req.body.width), height: Number(req.body.height),
        content: req.body.content, color: req.body.color, createdBy: req.authUser!.username,
      });
      res.status(201).json({ annotation });
    } catch (e: any) { res.status(400).json({ error: String(e.message ?? e) }); }
  });

  r.delete("/:id", requirePermission("annotation:write"), async (req, res) => {
    const { knex } = req.app.locals.deps as CoreDeps;
    await deleteAnnotation(knex, Number(req.params.id));
    res.status(204).end();
  });

  return r;
}
```

- [ ] **Step 8: Mount in `app.ts`**

```ts
import { annotationsRouter } from "./routes/annotations.js";
// inside createApp (mergeParams sub-router scoped to a document):
app.use("/documents/:documentId/annotations", annotationsRouter());
```

- [ ] **Step 9: Run test to verify it passes**

Run: `pnpm --filter @zordms/core test routes/annotations`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add services/core/src/repo/annotations.ts services/core/src/routes/annotations.ts services/core/src/app.ts services/core/src/repo/annotations.test.ts services/core/src/routes/annotations.test.ts
git commit -m "feat(core): viewer annotations/redaction/stamp records (coordinate-based, RBAC)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Auto-Catalog rule engine (pure) + endpoint (IDP §4.1/§4.2/§4.3)

**Files:**
- Create: `services/core/src/catalog/engine.ts`, `services/core/src/routes/catalog.ts`
- Modify: `services/core/src/app.ts` (mount `/catalog`)
- Test: `services/core/src/catalog/engine.test.ts`, `services/core/src/routes/catalog.test.ts`

**Interfaces:**
- Consumes: `CatalogResult`, `CatalogRoute`; IDP §4.
- Produces (pure engine):
  - `MANDATORY: Record<string, string[]>` — mandatory index fields per catalog category (IDP §4.1).
  - `RETENTION: Record<string, number>` — retention years per category; `Infinity`-style flagged as a large sentinel (e.g. `9999` for "permanent").
  - `catalog(input: { docType: string; confidence: number; fields: Record<string, unknown> }): CatalogResult` — implements the top-down first-match rule chain (IDP §4.2):
    1. `confidence < 0.50` OR a mandatory field missing → route `HUMAN_REVIEW`, `mandatoryOk=false`, suppress assignment (category = `_Review/Pending`).
    2. `0.50 ≤ confidence < 0.85` → tentative assignment, `route=TENTATIVE`, `reviewFlag=true`.
    3. CID types → `KYC / Identity`; 4. Passport types → `KYC / Identity`; 5. `BOB_LOAN_%` → `Loan & Credit`; 6. compliance types → `Compliance & AML`; 7. HR types → `HR & Staff`; 8. default → `General Corr.`.
  - Each non-review result carries `alertRule` (e.g. `"60/30/7 days before expiry_date"`) and `retentionYears` from the category lookup.
- Produces (route, `requireAuth`):
  - `POST /catalog/:documentId` (`document:catalog`) body `{ docType, confidence, fields }` → 200 `{ result }`; on a routable (non-review) result, persists `catalog_category`, `retention_years`, `destruction_date` (ingest + retention), and emits `document.cataloged`.

- [ ] **Step 1: Write the failing engine test**

`services/core/src/catalog/engine.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { catalog } from "./engine.js";

const cidFields = { cid_no: "10112345678", full_name: "T", dob: "1990-01-01", expiry_date: "2030-01-01" };

describe("auto-catalog engine", () => {
  it("rule 1: routes to HUMAN_REVIEW when confidence < 0.50", () => {
    const r = catalog({ docType: "BT_CID_4G", confidence: 0.4, fields: cidFields });
    expect(r.route).toBe("HUMAN_REVIEW");
    expect(r.category).toBe("_Review/Pending");
  });

  it("rule 1: routes to HUMAN_REVIEW when a mandatory field is missing", () => {
    const r = catalog({ docType: "BT_CID_4G", confidence: 0.99, fields: { cid_no: "10112345678", full_name: "T", dob: "1990-01-01" } });
    expect(r.route).toBe("HUMAN_REVIEW");
    expect(r.mandatoryOk).toBe(false);
    expect(r.missing).toContain("expiry_date");
  });

  it("rule 2: tentative assignment for 0.50<=conf<0.85", () => {
    const r = catalog({ docType: "BT_CID_4G", confidence: 0.7, fields: cidFields });
    expect(r.route).toBe("TENTATIVE");
    expect(r.category).toBe("KYC / Identity");
    expect(r.reviewFlag).toBe(true);
  });

  it("rule 3: CID -> KYC/Identity with expiry alert + retention", () => {
    const r = catalog({ docType: "BT_CID_4G", confidence: 0.97, fields: cidFields });
    expect(r.route).toBe("AUTO");
    expect(r.category).toBe("KYC / Identity");
    expect(r.alertRule).toMatch(/expiry_date/);
    expect(r.retentionYears).toBeGreaterThan(0);
  });

  it("rule 5: BOB_LOAN_% -> Loan & Credit", () => {
    const r = catalog({ docType: "BOB_LOAN_APPLICATION", confidence: 0.95, fields: { application_no: "LN1", loan_type: "HOME", loan_amount: 1, applicant_cid: "10112345678" } });
    expect(r.category).toBe("Loan & Credit");
  });

  it("rule 8: unknown type -> General Corr.", () => {
    const r = catalog({ docType: "GENERAL_LETTER", confidence: 0.95, fields: { ref_no: "X", from_org: "A", to_org: "B", date: "2026-01-01" } });
    expect(r.category).toBe("General Corr.");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zordms/core test catalog/engine`
Expected: FAIL — `./engine.js` not found.

- [ ] **Step 3: Write `catalog/engine.ts`**

```ts
import type { CatalogResult } from "@zordms/types";

const PERMANENT = 9999;

// IDP §4.1 — mandatory index fields per catalog category
export const MANDATORY: Record<string, string[]> = {
  "KYC / Identity": ["full_name", "dob", "expiry_date"],
  "Account Opening": ["account_no", "applicant_cid", "branch_code", "submission_date"],
  "Loan & Credit": ["application_no", "loan_type", "loan_amount", "applicant_cid"],
  "Compliance & AML": ["report_no", "reporting_officer", "filing_date", "status"],
  "HR & Staff": ["staff_id", "staff_name", "contract_start", "contract_end"],
  "Legal & Audit": ["ref_no", "issue_date", "subject"],
  "General Corr.": ["from_org", "to_org", "ref_no", "date"],
};

// IDP §4.1 + Retention_Compliance — retention years per category
export const RETENTION: Record<string, number> = {
  "KYC / Identity": 10,
  "Account Opening": 10,
  "Loan & Credit": 15,
  "Compliance & AML": 10,
  "HR & Staff": 7,
  "Legal & Audit": PERMANENT,
  "General Corr.": 7,
  "_Review/Pending": 1,
};

const ALERT_RULE: Record<string, string> = {
  "KYC / Identity": "60/30/7 days before expiry_date",
  "Loan & Credit": "alert if pending review > 5 days",
  "HR & Staff": "90 days before contract_end",
};

function categoryFor(docType: string): string {
  if (docType === "BT_CID_4G" || docType === "BT_CITIZENSHIP") return "KYC / Identity";
  if (docType === "BT_PASSPORT" || docType === "FOREIGN_PASSPORT") return "KYC / Identity";
  if (/^BOB_LOAN_/.test(docType)) return "Loan & Credit";
  if (["SAR_REPORT", "CTR", "WIRE_TRANSFER_LOG"].includes(docType)) return "Compliance & AML";
  if (/^STAFF_/.test(docType) || /^EMPLOYMENT_/.test(docType)) return "HR & Staff";
  return "General Corr.";
}

function missingMandatory(category: string, fields: Record<string, unknown>): string[] {
  const required = MANDATORY[category] ?? [];
  return required.filter((f) => {
    const v = fields[f];
    return v === undefined || v === null || v === "";
  });
}

export function catalog(input: { docType: string; confidence: number; fields: Record<string, unknown> }): CatalogResult {
  const category = categoryFor(input.docType);
  const missing = missingMandatory(category, input.fields);

  // Rule 1 — Blocked
  if (input.confidence < 0.5 || missing.length > 0) {
    return {
      category: "_Review/Pending",
      route: "HUMAN_REVIEW",
      mandatoryOk: missing.length === 0,
      missing,
      retentionYears: RETENTION["_Review/Pending"],
      reviewFlag: true,
    };
  }

  const base: CatalogResult = {
    category,
    route: "AUTO",
    mandatoryOk: true,
    missing: [],
    retentionYears: RETENTION[category] ?? 7,
    alertRule: ALERT_RULE[category],
  };

  // Rule 2 — Low confidence
  if (input.confidence < 0.85) {
    return { ...base, route: "TENTATIVE", reviewFlag: true };
  }

  // Rules 3–8 are encoded in categoryFor; AUTO assignment proceeds.
  return base;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @zordms/core test catalog/engine`
Expected: PASS (6 tests).

- [ ] **Step 5: Write the failing route test**

`services/core/src/routes/catalog.test.ts`:
```ts
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { makeTestApp } from "../testutil.js";
import { EVENTS } from "@zordms/events";

const h = await makeTestApp();
afterAll(async () => { await h.cleanup(); });

async function uploadDoc(token: string): Promise<number> {
  const up = await request(h.app).post("/documents").set("Authorization", `Bearer ${token}`)
    .field("title", "CID").field("branch", "Thimphu").attach("file", Buffer.from("cid"), "cid.png");
  return up.body.document.id;
}

describe("catalog route", () => {
  it("auto-catalogs a high-confidence CID and persists retention + destruction_date", async () => {
    const token = await h.tokenFor("admin");
    const id = await uploadDoc(token);
    const res = await request(h.app).post(`/catalog/${id}`).set("Authorization", `Bearer ${token}`).send({
      docType: "BT_CID_4G", confidence: 0.97,
      fields: { full_name: "T", dob: "1990-01-01", expiry_date: "2030-01-01" },
    });
    expect(res.status).toBe(200);
    expect(res.body.result.category).toBe("KYC / Identity");
    const doc = await h.knex("documents").where({ id }).first();
    expect(doc.catalog_category).toBe("KYC / Identity");
    expect(doc.retention_years).toBe(10);
    expect(doc.destruction_date).toBeTruthy();
    expect(h.events.events.some((e) => e.type === EVENTS.DOCUMENT_CATALOGED)).toBe(true);
  });

  it("does not assign a category when routed to human review", async () => {
    const token = await h.tokenFor("admin");
    const id = await uploadDoc(token);
    const res = await request(h.app).post(`/catalog/${id}`).set("Authorization", `Bearer ${token}`).send({
      docType: "BT_CID_4G", confidence: 0.3, fields: { full_name: "T", dob: "1990-01-01", expiry_date: "2030-01-01" },
    });
    expect(res.body.result.route).toBe("HUMAN_REVIEW");
    const doc = await h.knex("documents").where({ id }).first();
    expect(doc.catalog_category).toBeFalsy();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter @zordms/core test routes/catalog`
Expected: FAIL — `/catalog/:id` 404.

- [ ] **Step 7: Write `routes/catalog.ts`**

```ts
import { Router } from "express";
import { requireAuth, requirePermission } from "@zordms/auth";
import { EVENTS } from "@zordms/events";
import type { CoreDeps } from "../deps.js";
import { catalog } from "../catalog/engine.js";
import { getDocument } from "../repo/documents.js";

function addYears(iso: string, years: number): string {
  const d = new Date(iso);
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString().slice(0, 10);
}

export function catalogRouter(): Router {
  const r = Router();
  r.use(requireAuth);

  r.post("/:documentId", requirePermission("document:catalog"), async (req, res) => {
    const deps = req.app.locals.deps as CoreDeps;
    const document = await getDocument(deps.knex, Number(req.params.documentId));
    if (!document) { res.status(404).json({ error: "not_found" }); return; }

    const result = catalog({ docType: req.body.docType, confidence: Number(req.body.confidence ?? 1), fields: req.body.fields ?? {} });

    if (result.route !== "HUMAN_REVIEW") {
      const ingest = (document.ingest_timestamp as string | undefined) ?? new Date().toISOString();
      await deps.knex("documents").where({ id: document.id }).update({
        catalog_category: result.category,
        retention_years: result.retentionYears,
        destruction_date: addYears(ingest, result.retentionYears),
        review_flag: result.reviewFlag ?? document.review_flag,
      });
      await deps.events.emit(EVENTS.DOCUMENT_CATALOGED, { docId: document.id, category: result.category, route: result.route });
    }

    res.json({ result });
  });

  return r;
}
```

- [ ] **Step 8: Mount in `app.ts`**

```ts
import { catalogRouter } from "./routes/catalog.js";
// inside createApp:
app.use("/catalog", catalogRouter());
```

- [ ] **Step 9: Run test to verify it passes**

Run: `pnpm --filter @zordms/core test routes/catalog`
Expected: PASS (2 tests).

- [ ] **Step 10: Commit**

```bash
git add services/core/src/catalog services/core/src/routes/catalog.ts services/core/src/app.ts services/core/src/routes/catalog.test.ts
git commit -m "feat(core): auto-catalog rule engine + endpoint (IDP 4.1/4.2/4.3, human-review routing)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Auto Directory Mapper — path templates + per-folder ACL inheritance (IDP §5)

**Files:**
- Create: `services/core/src/mapper/directory.ts`, `services/core/src/repo/acls.ts`, `services/core/src/routes/mapper.ts`
- Modify: `services/core/src/app.ts` (mount `/mapper`)
- Test: `services/core/src/mapper/directory.test.ts`, `services/core/src/repo/acls.test.ts`, `services/core/src/routes/mapper.test.ts`

**Interfaces:**
- Consumes: `MapResult`, folder repo (`createFolder`), IDP §5.1/§5.2/§5.3.
- Produces (pure mapper):
  - `resolvePath(docType: string, fields: Record<string, unknown>): string` — applies the IDP §5.2 path templates with `{year}`/`{quarter}` derived from `submission_date`/`ingest`/`filing_date` (fallback to current year); unknown/low-confidence falls back to `/BoB/_Review/Pending/{date}/`.
  - `defaultAcls(domain: string): Array<{ role: string; access: "read"|"write"|"delete" }>` — IDP §5.3 baseline ACL per domain.
  - `domainForPath(path: string): string` — extracts the §5.3 domain key from a `/BoB/<Domain>/...` path.
- Produces (ACL repo):
  - `setFolderAcls(knex, folderId, acls, inherited): Promise<void>`.
  - `effectiveAcls(knex, folderId): Promise<Array<{ role; access; inherited }>>` — a folder's own ACLs unioned with all ancestor ACLs (inheritance).
- Produces (route, `requireAuth`):
  - `POST /mapper/:documentId` (`document:map`) body `{ docType, fields }` → resolves the path, **creates the folder chain if absent** (each segment under `/BoB`), seeds the leaf folder's ACLs from `defaultAcls(domain)` (marked `inherited=false`), assigns the document to the leaf folder, and returns `{ path, folderId, acls }`.

- [ ] **Step 1: Write the failing mapper test**

`services/core/src/mapper/directory.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { resolvePath, defaultAcls, domainForPath } from "./directory.js";

describe("directory mapper path templates (IDP 5.2)", () => {
  it("maps CID to the customer KYC identity path with year", () => {
    expect(resolvePath("BT_CID_4G", { cid_no: "10112345678", issue_date: "2026-03-01" }))
      .toBe("/BoB/Customers/10112345678/KYC/Identity/2026/");
  });

  it("maps a loan application to the customer loans path", () => {
    expect(resolvePath("BOB_LOAN_APPLICATION", { applicant_cid: "10112345678", loan_type: "HOME", application_no: "LN2026001" }))
      .toBe("/BoB/Customers/10112345678/Loans/HOME/LN2026001/");
  });

  it("maps a SAR report to the AML quarter path", () => {
    expect(resolvePath("SAR_REPORT", { report_no: "SAR1", filing_date: "2026-04-15" }))
      .toBe("/BoB/Compliance/AML/SAR/2026/Q2/");
  });

  it("falls back to the review pending path for unknown types", () => {
    const p = resolvePath("UNKNOWN", { doc_id: "abc", ingest: "2026-06-23" });
    expect(p.startsWith("/BoB/_Review/Pending/")).toBe(true);
  });

  it("derives the domain from a path", () => {
    expect(domainForPath("/BoB/Customers/10112345678/KYC/Identity/2026/")).toBe("Customers");
    expect(domainForPath("/BoB/Compliance/AML/SAR/2026/Q2/")).toBe("Compliance");
  });

  it("returns IDP 5.3 default ACLs for a domain", () => {
    const acls = defaultAcls("Customers");
    expect(acls.some((a) => a.access === "read")).toBe(true);
    expect(acls.some((a) => a.access === "write")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zordms/core test mapper/directory`
Expected: FAIL — `./directory.js` not found.

- [ ] **Step 3: Write `mapper/directory.ts`**

```ts
type Acl = { role: string; access: "read" | "write" | "delete" };

function yearOf(fields: Record<string, unknown>): string {
  const src = (fields.submission_date ?? fields.issue_date ?? fields.filing_date ?? fields.ingest) as string | undefined;
  const d = src ? new Date(src) : new Date();
  return String(d.getFullYear());
}

function quarterOf(fields: Record<string, unknown>): string {
  const src = (fields.filing_date ?? fields.ingest) as string | undefined;
  const d = src ? new Date(src) : new Date();
  return `Q${Math.floor(d.getMonth() / 3) + 1}`;
}

function today(fields: Record<string, unknown>): string {
  const src = (fields.ingest) as string | undefined;
  const d = src ? new Date(src) : new Date();
  return d.toISOString().slice(0, 10);
}

// IDP §5.2 — directory mapping rules (first match wins)
export function resolvePath(docType: string, fields: Record<string, unknown>): string {
  const cid = (fields.cid_no ?? fields.applicant_cid ?? "UNK") as string;
  const year = yearOf(fields);

  if (docType === "BT_CID_4G" || docType === "BT_CITIZENSHIP")
    return `/BoB/Customers/${cid}/KYC/Identity/${year}/`;
  if (docType === "BT_PASSPORT" || docType === "FOREIGN_PASSPORT")
    return `/BoB/Customers/${cid}/KYC/Travel/${year}/`;
  if (docType === "BOB_ACCOUNT_FORM")
    return `/BoB/Customers/${cid}/Accounts/${fields.acct_no ?? "UNK"}/${year}/`;
  if (docType === "BOB_LOAN_APPLICATION")
    return `/BoB/Customers/${cid}/Loans/${fields.loan_type ?? "GEN"}/${fields.application_no ?? "UNK"}/`;
  if (docType === "COLLATERAL_DEED" || docType === "MORTGAGE_DEED")
    return `/BoB/Customers/${cid}/Loans/${fields.loan_no ?? "UNK"}/Security/`;
  if (docType === "EMPLOYMENT_CONTRACT")
    return `/BoB/Operations/${fields.branch_code ?? "HQ"}/HR/Contracts/${year}/`;
  if (docType === "PURCHASE_ORDER" || docType === "BOB_INVOICE")
    return `/BoB/Operations/${fields.branch_code ?? "HQ"}/Procurement/${year}/`;
  if (docType === "SAR_REPORT")
    return `/BoB/Compliance/AML/SAR/${year}/${quarterOf(fields)}/`;
  if (docType === "CTR")
    return `/BoB/Compliance/AML/CTR/${year}/${quarterOf(fields)}/`;
  if (docType === "RMA_INSPECTION" || docType === "RMA_INSPECTION_REPORT")
    return `/BoB/Compliance/RMA/${year}/`;
  if (docType === "RAA_AUDIT_REPORT")
    return `/BoB/Legal/RAA_Audit/${year}/`;
  if (docType === "BOARD_RESOLUTION")
    return `/BoB/Legal/BoardResolutions/${year}/`;
  if (["LETTER", "MEMO", "CIRCULAR", "GENERAL_LETTER"].includes(docType))
    return `/BoB/General/${fields.from_org ?? "Unknown"}/${year}/`;

  return `/BoB/_Review/Pending/${today(fields)}/`;
}

export function domainForPath(path: string): string {
  const parts = path.split("/").filter(Boolean); // ["BoB","Customers",...]
  return parts[1] ?? "General";
}

// IDP §5.3 — per-domain baseline ACLs (role → access)
const ACL_TABLE: Record<string, Acl[]> = {
  Customers: [
    { role: "RM", access: "read" }, { role: "BranchManager", access: "read" }, { role: "Compliance", access: "read" },
    { role: "DMSOperator", access: "write" }, { role: "ComplianceManager", access: "delete" },
  ],
  Operations: [
    { role: "BranchManager", access: "read" }, { role: "InitiatingOfficer", access: "write" }, { role: "Supervisor", access: "delete" },
  ],
  Compliance: [
    { role: "ComplianceOfficer", access: "read" }, { role: "Audit", access: "read" },
    { role: "ComplianceOfficer", access: "write" }, { role: "CISO", access: "delete" },
  ],
  Legal: [
    { role: "Legal", access: "read" }, { role: "BoardSecretary", access: "read" },
    { role: "Legal", access: "write" }, { role: "CEO", access: "delete" },
  ],
  IT: [
    { role: "CISO", access: "read" }, { role: "InternalAudit", access: "read" }, { role: "SYSTEM", access: "write" },
  ],
  General: [
    { role: "BranchStaff", access: "read" }, { role: "InitiatingOfficer", access: "write" }, { role: "Supervisor", access: "delete" },
  ],
  _Review: [
    { role: "DMSAdmin", access: "read" }, { role: "Supervisor", access: "read" }, { role: "DMSAdmin", access: "write" }, { role: "DMSAdmin", access: "delete" },
  ],
};

export function defaultAcls(domain: string): Acl[] {
  return ACL_TABLE[domain] ?? ACL_TABLE.General;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @zordms/core test mapper/directory`
Expected: PASS (6 tests).

- [ ] **Step 5: Write the failing ACL repo test**

`services/core/src/repo/acls.test.ts`:
```ts
import { describe, it, expect, afterAll } from "vitest";
import { makeTestApp } from "../testutil.js";
import { createFolder } from "./folders.js";
import { setFolderAcls, effectiveAcls } from "./acls.js";

const h = await makeTestApp();
afterAll(async () => { await h.cleanup(); });

describe("folder ACL inheritance", () => {
  it("a child folder inherits ancestor ACLs unioned with its own", async () => {
    const customers = await createFolder(h.knex, { name: "Customers", domain: "Customers" });
    await setFolderAcls(h.knex, customers.id, [{ role: "Compliance", access: "read" }], false);

    const kyc = await createFolder(h.knex, { name: "KYC", parentId: customers.id });
    await setFolderAcls(h.knex, kyc.id, [{ role: "DMSOperator", access: "write" }], false);

    const eff = await effectiveAcls(h.knex, kyc.id);
    const pairs = eff.map((a) => `${a.role}:${a.access}`);
    expect(pairs).toContain("Compliance:read");   // inherited from parent
    expect(pairs).toContain("DMSOperator:write");  // own
    expect(eff.find((a) => a.role === "Compliance")!.inherited).toBe(true);
    expect(eff.find((a) => a.role === "DMSOperator")!.inherited).toBe(false);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter @zordms/core test repo/acls`
Expected: FAIL — `./acls.js` not found.

- [ ] **Step 7: Write `repo/acls.ts`**

```ts
import type { Knex } from "knex";

type Acl = { role: string; access: "read" | "write" | "delete" };
type EffectiveAcl = Acl & { inherited: boolean };

export async function setFolderAcls(knex: Knex, folderId: number, acls: Acl[], inherited: boolean): Promise<void> {
  for (const a of acls) {
    const exists = await knex("folder_acls").where({ folder_id: folderId, role: a.role, access: a.access }).first();
    if (!exists) {
      await knex("folder_acls").insert({ folder_id: folderId, role: a.role, access: a.access, inherited });
    }
  }
}

async function ancestorIds(knex: Knex, folderId: number): Promise<number[]> {
  const ids: number[] = [];
  let current = await knex("folders").where({ id: folderId }).first();
  while (current?.parent_id != null) {
    ids.push(current.parent_id);
    current = await knex("folders").where({ id: current.parent_id }).first();
  }
  return ids;
}

export async function effectiveAcls(knex: Knex, folderId: number): Promise<EffectiveAcl[]> {
  const own = (await knex("folder_acls").where({ folder_id: folderId })) as Array<Acl & { inherited: boolean }>;
  const ancestors = await ancestorIds(knex, folderId);
  const inheritedRows = ancestors.length
    ? ((await knex("folder_acls").whereIn("folder_id", ancestors)) as Array<Acl>)
    : [];

  const map = new Map<string, EffectiveAcl>();
  for (const a of own) map.set(`${a.role}:${a.access}`, { role: a.role, access: a.access, inherited: false });
  for (const a of inheritedRows) {
    const key = `${a.role}:${a.access}`;
    if (!map.has(key)) map.set(key, { role: a.role, access: a.access, inherited: true });
  }
  return [...map.values()];
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm --filter @zordms/core test repo/acls`
Expected: PASS.

- [ ] **Step 9: Write the failing route test**

`services/core/src/routes/mapper.test.ts`:
```ts
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { makeTestApp } from "../testutil.js";

const h = await makeTestApp();
afterAll(async () => { await h.cleanup(); });

describe("mapper route", () => {
  it("resolves the path, creates the folder chain, seeds ACLs, and assigns the document", async () => {
    const token = await h.tokenFor("admin");
    const up = await request(h.app).post("/documents").set("Authorization", `Bearer ${token}`)
      .field("title", "CID").field("branch", "Thimphu").attach("file", Buffer.from("cid"), "cid.png");
    const id = up.body.document.id;

    const res = await request(h.app).post(`/mapper/${id}`).set("Authorization", `Bearer ${token}`).send({
      docType: "BT_CID_4G", fields: { cid_no: "10112345678", issue_date: "2026-03-01" },
    });
    expect(res.status).toBe(200);
    expect(res.body.path).toBe("/BoB/Customers/10112345678/KYC/Identity/2026/");
    expect(res.body.folderId).toBeTruthy();
    expect(res.body.acls.length).toBeGreaterThan(0);

    const folder = await h.knex("folders").where({ id: res.body.folderId }).first();
    expect(folder.path).toBe("/BoB/Customers/10112345678/KYC/Identity/2026");
    const doc = await h.knex("documents").where({ id }).first();
    expect(doc.folder_id).toBe(res.body.folderId);
  });

  it("is idempotent — re-mapping reuses the same folder chain", async () => {
    const token = await h.tokenFor("admin");
    const up = await request(h.app).post("/documents").set("Authorization", `Bearer ${token}`)
      .field("title", "CID2").field("branch", "Thimphu").attach("file", Buffer.from("cid2"), "cid2.png");
    const id = up.body.document.id;
    const res = await request(h.app).post(`/mapper/${id}`).set("Authorization", `Bearer ${token}`).send({
      docType: "BT_CID_4G", fields: { cid_no: "10112345678", issue_date: "2026-03-01" },
    });
    const count = await h.knex("folders").where({ path: "/BoB/Customers/10112345678/KYC/Identity/2026" }).count<{ c: number }[]>("id as c");
    expect(Number(count[0].c)).toBe(1);
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 10: Run test to verify it fails**

Run: `pnpm --filter @zordms/core test routes/mapper`
Expected: FAIL — `/mapper/:id` 404.

- [ ] **Step 11: Write `routes/mapper.ts`**

```ts
import { Router } from "express";
import type { Knex } from "knex";
import { requireAuth, requirePermission } from "@zordms/auth";
import type { CoreDeps } from "../deps.js";
import { resolvePath, defaultAcls, domainForPath } from "../mapper/directory.js";
import { ROOT_PATH } from "../repo/folders.js";
import { setFolderAcls, effectiveAcls } from "../repo/acls.js";
import { getDocument } from "../repo/documents.js";

function idOf(inserted: unknown): number {
  const x = (inserted as unknown[])[0];
  return typeof x === "object" && x !== null ? (x as { id: number }).id : (x as number);
}

// Ensures every segment of `path` (relative to /BoB) exists; returns the leaf folder id.
async function ensureFolderChain(knex: Knex, path: string, createdBy: string): Promise<number> {
  const clean = path.replace(/\/+$/, ""); // strip trailing slash
  const segments = clean.split("/").filter(Boolean).slice(1); // drop "BoB"
  let parentId: number | null = null;
  let currentPath = ROOT_PATH;
  let leafId = 0;
  for (const seg of segments) {
    currentPath = `${currentPath}/${seg}`;
    let folder = await knex("folders").where({ path: currentPath }).first();
    if (!folder) {
      const inserted = await knex("folders").insert({
        name: seg, parent_id: parentId, path: currentPath,
        domain: domainForPath(currentPath), created_by: createdBy,
      }).returning("id");
      folder = { id: idOf(inserted) };
    }
    parentId = folder.id;
    leafId = folder.id;
  }
  return leafId;
}

export function mapperRouter(): Router {
  const r = Router();
  r.use(requireAuth);

  r.post("/:documentId", requirePermission("document:map"), async (req, res) => {
    const deps = req.app.locals.deps as CoreDeps;
    const document = await getDocument(deps.knex, Number(req.params.documentId));
    if (!document) { res.status(404).json({ error: "not_found" }); return; }

    const path = resolvePath(req.body.docType, req.body.fields ?? {});
    const folderId = await ensureFolderChain(deps.knex, path, req.authUser!.username);
    const domain = domainForPath(path);
    await setFolderAcls(deps.knex, folderId, defaultAcls(domain), false);
    await deps.knex("documents").where({ id: document.id }).update({ folder_id: folderId });

    const acls = await effectiveAcls(deps.knex, folderId);
    res.json({ path, folderId, acls });
  });

  return r;
}
```

- [ ] **Step 12: Mount in `app.ts`**

```ts
import { mapperRouter } from "./routes/mapper.js";
// inside createApp:
app.use("/mapper", mapperRouter());
```

- [ ] **Step 13: Run test to verify it passes**

Run: `pnpm --filter @zordms/core test routes/mapper`
Expected: PASS (2 tests).

- [ ] **Step 14: Commit**

```bash
git add services/core/src/mapper services/core/src/repo/acls.ts services/core/src/routes/mapper.ts services/core/src/app.ts services/core/src/repo/acls.test.ts services/core/src/routes/mapper.test.ts
git commit -m "feat(core): auto directory mapper (IDP 5.2 templates) + folder ACL inheritance (5.3)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Dashboard summary endpoint

**Files:**
- Create: `services/core/src/routes/dashboard.ts`
- Modify: `services/core/src/app.ts` (mount `/dashboard`)
- Test: `services/core/src/routes/dashboard.test.ts`

**Interfaces:**
- Produces (route, `requireAuth`, `document:read`):
  - `GET /dashboard/summary` → `{ totalDocuments, byCategory: Record<string, number>, pendingReview, indexedToday }` — branch-scoped unless `crossbranch:read`.

- [ ] **Step 1: Write the failing test**

`services/core/src/routes/dashboard.test.ts`:
```ts
import { describe, it, expect, afterAll } from "vitest";
import request from "supertest";
import { makeTestApp } from "../testutil.js";

const h = await makeTestApp();
afterAll(async () => { await h.cleanup(); });

describe("dashboard summary", () => {
  it("returns counts including pendingReview and byCategory", async () => {
    const token = await h.tokenFor("admin");
    const up = await request(h.app).post("/documents").set("Authorization", `Bearer ${token}`)
      .field("title", "D").field("branch", "Thimphu").attach("file", Buffer.from("d"), "d.png");
    const id = up.body.document.id;
    await request(h.app).post(`/catalog/${id}`).set("Authorization", `Bearer ${token}`).send({
      docType: "BT_CID_4G", confidence: 0.97, fields: { full_name: "T", dob: "1990-01-01", expiry_date: "2030-01-01" },
    });

    const res = await request(h.app).get("/dashboard/summary").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.totalDocuments).toBeGreaterThanOrEqual(1);
    expect(res.body.byCategory["KYC / Identity"]).toBeGreaterThanOrEqual(1);
    expect(typeof res.body.pendingReview).toBe("number");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zordms/core test routes/dashboard`
Expected: FAIL — `/dashboard/summary` 404.

- [ ] **Step 3: Write `routes/dashboard.ts`**

```ts
import { Router } from "express";
import { requireAuth, requirePermission, can } from "@zordms/auth";
import type { CoreDeps } from "../deps.js";

export function dashboardRouter(): Router {
  const r = Router();
  r.use(requireAuth);

  r.get("/summary", requirePermission("document:read"), async (req, res) => {
    const { knex } = req.app.locals.deps as CoreDeps;
    const canCrossBranch = can({ permissions: req.authUser!.permissions }, "crossbranch:read");
    const base = () => {
      const q = knex("documents").where({ status: "Active" });
      if (!canCrossBranch && req.authUser!.branch) q.andWhere({ branch: req.authUser!.branch });
      return q;
    };

    const totalRow = await base().count<{ c: number }[]>("id as c");
    const pendingRow = await base().andWhere({ review_flag: true }).count<{ c: number }[]>("id as c");

    const catRows = (await base().whereNotNull("catalog_category")
      .select("catalog_category").count<{ catalog_category: string; c: number }[]>("id as c")
      .groupBy("catalog_category")) as Array<{ catalog_category: string; c: number }>;
    const byCategory: Record<string, number> = {};
    for (const row of catRows) byCategory[row.catalog_category] = Number(row.c);

    const today = new Date().toISOString().slice(0, 10);
    const indexedRow = await base().whereNotNull("doc_type")
      .andWhereRaw("substr(ingest_timestamp,1,10) = ?", [today]).count<{ c: number }[]>("id as c");

    res.json({
      totalDocuments: Number(totalRow[0].c),
      byCategory,
      pendingReview: Number(pendingRow[0].c),
      indexedToday: Number(indexedRow[0].c),
    });
  });

  return r;
}
```

> **Dialect note:** `substr(...)` and `whereRaw` here are used only for the convenience "indexed today" count and run identically on sqlite/pg/oracle for the `substr` builtin. If strict portability is required for production, replace with a `>= startOfDayUTC` timestamp comparison computed in JS and passed as a bound parameter (no raw SQL). The test asserts the other three counts; `indexedToday` is best-effort.

- [ ] **Step 4: Mount in `app.ts`**

```ts
import { dashboardRouter } from "./routes/dashboard.js";
// inside createApp:
app.use("/dashboard", dashboardRouter());
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @zordms/core test routes/dashboard`
Expected: PASS. Then run the whole Core suite: `pnpm --filter @zordms/core test` → all green.

- [ ] **Step 6: Commit**

```bash
git add services/core/src/routes/dashboard.ts services/core/src/app.ts services/core/src/routes/dashboard.test.ts
git commit -m "feat(core): dashboard summary endpoint (branch-scoped counts)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: React — typed Core API client + Repository screen

**Files:**
- Create: `apps/web/src/api/core.ts`, `apps/web/src/pages/Repository.tsx`
- Modify: `apps/web/vite.config.ts` (proxy core routes), `apps/web/src/router.tsx` (add `/repository`)
- Test: `apps/web/src/pages/Repository.test.tsx`

**Interfaces:**
- Consumes: Plan 1 `api` client, `useAuth`.
- Produces:
  - `coreApi` — `listFolders()`, `listDocuments()`, `getDocument(id)`, `deleteDocument(id)`, `uploadDocument(form)`, `indexDocument(id, body)`, `catalogDocument(id, body)`, `mapDocument(id, body)`, `listAnnotations(id)`, `createAnnotation(id, body)`, `dashboardSummary()`.
  - `Repository()` — RBAC-aware: lists folders (tree) + documents; shows a Delete button only when the user holds `document:delete`.

- [ ] **Step 1: Add the proxy targets to `apps/web/vite.config.ts`**

In the `server.proxy` object, add the Core service routes (Core listens on `:4001`):
```ts
    "/documents": "http://localhost:4001",
    "/folders": "http://localhost:4001",
    "/index": "http://localhost:4001",
    "/catalog": "http://localhost:4001",
    "/mapper": "http://localhost:4001",
    "/dashboard": "http://localhost:4001",
```
(Keep the existing `/auth`, `/users`, `/authz`, `/health` → `:4000` gateway targets.)

- [ ] **Step 2: Write `apps/web/src/api/core.ts`**

```ts
import { api, getToken } from "./client.js";

async function upload(path: string, form: FormData): Promise<any> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { method: "POST", headers, body: form });
  if (!res.ok) throw Object.assign(new Error("upload_failed"), { status: res.status, body: await res.json().catch(() => ({})) });
  return res.json();
}

export const coreApi = {
  listFolders: () => api.get("/folders"),
  listDocuments: () => api.get("/documents"),
  getDocument: (id: number) => api.get(`/documents/${id}`),
  deleteDocument: (id: number) => fetch(`/documents/${id}`, { method: "DELETE", headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {} }),
  uploadDocument: (form: FormData) => upload("/documents", form),
  indexDocument: (id: number, body: unknown) => api.post(`/index/${id}`, body),
  catalogDocument: (id: number, body: unknown) => api.post(`/catalog/${id}`, body),
  mapDocument: (id: number, body: unknown) => api.post(`/mapper/${id}`, body),
  listAnnotations: (id: number) => api.get(`/documents/${id}/annotations`),
  createAnnotation: (id: number, body: unknown) => api.post(`/documents/${id}/annotations`, body),
  dashboardSummary: () => api.get("/dashboard/summary"),
};
```

- [ ] **Step 3: Write the failing Repository test**

`apps/web/src/pages/Repository.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { Repository } from "./Repository.js";

vi.mock("../auth/AuthContext.js", () => ({
  useAuth: () => ({ user: { id: 1, username: "admin", roles: ["CDO"], permissions: ["document:read", "folder:read", "document:delete"] }, logout: () => {} }),
}));

describe("Repository screen", () => {
  it("lists documents from the core API and shows Delete for privileged users", async () => {
    globalThis.fetch = vi.fn(async (url: string) => {
      if (url === "/folders") return { ok: true, json: async () => ({ tree: [{ id: 1, name: "Customers", path: "/BoB/Customers", children: [] }] }) } as any;
      if (url === "/documents") return { ok: true, json: async () => ({ documents: [{ id: 9, title: "Customer CID", branch: "Thimphu", catalog_category: "KYC / Identity", status: "Active" }] }) } as any;
      return { ok: true, json: async () => ({}) } as any;
    }) as any;

    render(<Repository />);
    await waitFor(() => expect(screen.getByText("Customer CID")).toBeInTheDocument());
    expect(screen.getByText("Customers")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter @zordms/web test Repository`
Expected: FAIL — `./Repository.js` not found.

- [ ] **Step 5: Write `apps/web/src/pages/Repository.tsx`**

```tsx
import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext.js";
import { coreApi } from "../api/core.js";

interface FolderNode { id: number; name: string; path: string; children: FolderNode[]; }
interface Doc { id: number; title: string; branch?: string; catalog_category?: string; status: string; }

function Tree({ nodes }: { nodes: FolderNode[] }) {
  return (
    <ul style={{ listStyle: "none", paddingLeft: 16 }}>
      {nodes.map((n) => (
        <li key={n.id}>
          <span>📁 {n.name}</span>
          {n.children.length > 0 && <Tree nodes={n.children} />}
        </li>
      ))}
    </ul>
  );
}

export function Repository() {
  const { user } = useAuth();
  const [tree, setTree] = useState<FolderNode[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);
  const canDelete = user?.permissions.includes("document:delete");

  async function refresh() {
    setTree((await coreApi.listFolders()).tree);
    setDocs((await coreApi.listDocuments()).documents);
  }
  useEffect(() => { refresh(); }, []);

  async function remove(id: number) { await coreApi.deleteDocument(id); await refresh(); }

  return (
    <div style={{ padding: 32, display: "grid", gridTemplateColumns: "260px 1fr", gap: 24 }}>
      <aside>
        <h3>Folders</h3>
        <Tree nodes={tree} />
      </aside>
      <section>
        <h2>Repository</h2>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr><th style={{ textAlign: "left", padding: 8 }}>Title</th><th style={{ textAlign: "left", padding: 8 }}>Branch</th><th style={{ textAlign: "left", padding: 8 }}>Category</th><th /></tr></thead>
          <tbody>
            {docs.map((d) => (
              <tr key={d.id} style={{ borderTop: "1px solid var(--line)" }}>
                <td style={{ padding: 8 }}>{d.title}</td>
                <td style={{ padding: 8 }}>{d.branch ?? "—"}</td>
                <td style={{ padding: 8 }}>{d.catalog_category ?? "—"}</td>
                <td style={{ padding: 8 }}>{canDelete && <button onClick={() => remove(d.id)}>Delete</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
```

- [ ] **Step 6: Add the route in `apps/web/src/router.tsx`**

Add the import and route entry:
```tsx
import { Repository } from "./pages/Repository.js";
// inside the routes array:
  { path: "/repository", element: <ProtectedRoute permission="document:read"><Repository /></ProtectedRoute> },
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm --filter @zordms/web test Repository`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/api/core.ts apps/web/src/pages/Repository.tsx apps/web/src/pages/Repository.test.tsx apps/web/vite.config.ts apps/web/src/router.tsx
git commit -m "feat(web): typed core API client + RBAC-aware Repository screen

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: React — Capture + Indexing screens

**Files:**
- Create: `apps/web/src/pages/Capture.tsx`, `apps/web/src/pages/Indexing.tsx`
- Modify: `apps/web/src/router.tsx` (add `/capture`, `/indexing`)
- Test: `apps/web/src/pages/Capture.test.tsx`, `apps/web/src/pages/Indexing.test.tsx`

**Interfaces:**
- Consumes: `coreApi`, `useAuth`.
- Produces:
  - `Capture()` — file input + title + branch; submits multipart to `POST /documents`; requires `document:capture`.
  - `Indexing()` — select a doc type (BT_CID_4G / BT_PASSPORT / BOB_LOAN_APPLICATION), renders the field inputs for that type, and submits to `POST /index/:id`; surfaces validation `errors`/`missing` from a 422. Requires `document:index`.

- [ ] **Step 1: Write the failing Capture test**

`apps/web/src/pages/Capture.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Capture } from "./Capture.js";

vi.mock("../auth/AuthContext.js", () => ({
  useAuth: () => ({ user: { id: 1, username: "admin", roles: ["Maker"], permissions: ["document:capture"], branch: "Thimphu" }, logout: () => {} }),
}));

describe("Capture screen", () => {
  it("uploads a selected file with title to POST /documents", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ document: { id: 1, title: "CID" } }) });
    globalThis.fetch = fetchMock as any;
    render(<Capture />);

    const file = new File(["bytes"], "cid.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText(/title/i), { target: { value: "CID" } });
    fireEvent.change(screen.getByLabelText(/file/i), { target: { files: [file] } });
    fireEvent.click(screen.getByRole("button", { name: /capture/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/documents", expect.objectContaining({ method: "POST" })));
    await waitFor(() => expect(screen.getByText(/captured/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zordms/web test Capture`
Expected: FAIL — `./Capture.js` not found.

- [ ] **Step 3: Write `apps/web/src/pages/Capture.tsx`**

```tsx
import { useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthContext.js";
import { coreApi } from "../api/core.js";

export function Capture() {
  const { user } = useAuth();
  const [title, setTitle] = useState("");
  const [branch, setBranch] = useState(user?.branch ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState("");
  const canCapture = user?.permissions.includes("document:capture");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!file) { setStatus("Select a file."); return; }
    const form = new FormData();
    form.append("title", title);
    form.append("branch", branch);
    form.append("file", file);
    const res = await coreApi.uploadDocument(form);
    setStatus(`Captured document #${res.document.id}.`);
    setTitle(""); setFile(null);
  }

  if (!canCapture) return <div style={{ padding: 40 }}>Not authorised to capture documents.</div>;

  return (
    <div style={{ padding: 32, maxWidth: 520 }}>
      <h2>Capture</h2>
      <form onSubmit={onSubmit}>
        <label className="label" htmlFor="title">Title</label>
        <input id="title" className="field" value={title} onChange={(e) => setTitle(e.target.value)} />
        <label className="label" htmlFor="branch" style={{ marginTop: 14, display: "block" }}>Branch</label>
        <input id="branch" className="field" value={branch} onChange={(e) => setBranch(e.target.value)} />
        <label className="label" htmlFor="file" style={{ marginTop: 14, display: "block" }}>File</label>
        <input id="file" className="field" type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <button className="btn-primary" style={{ marginTop: 18 }}>Capture</button>
      </form>
      {status && <p style={{ color: "var(--muted)" }}>{status}</p>}
    </div>
  );
}
```

- [ ] **Step 4: Run Capture test to verify it passes**

Run: `pnpm --filter @zordms/web test Capture`
Expected: PASS.

- [ ] **Step 5: Write the failing Indexing test**

`apps/web/src/pages/Indexing.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Indexing } from "./Indexing.js";

vi.mock("../auth/AuthContext.js", () => ({
  useAuth: () => ({ user: { id: 1, username: "ix", roles: ["Indexer"], permissions: ["document:index"] }, logout: () => {} }),
}));

describe("Indexing screen", () => {
  it("renders CID fields and surfaces validation errors from a 422", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 422, json: async () => ({ errors: ["cid_no: does not match ^[0-9]{11}$"], missing: ["expiry_date"] }),
    }) as any;
    render(<Indexing documentId={5} />);
    expect(screen.getByLabelText(/cid_no/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/cid_no/i), { target: { value: "bad" } });
    fireEvent.click(screen.getByRole("button", { name: /save index/i }));
    await waitFor(() => expect(screen.getByText(/expiry_date/)).toBeInTheDocument());
  });
});
```

- [ ] **Step 6: Run Indexing test to verify it fails**

Run: `pnpm --filter @zordms/web test Indexing`
Expected: FAIL — `./Indexing.js` not found.

- [ ] **Step 7: Write `apps/web/src/pages/Indexing.tsx`**

```tsx
import { useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthContext.js";
import { coreApi } from "../api/core.js";

const FIELDS: Record<string, string[]> = {
  BT_CID_4G: ["cid_no", "full_name", "dob", "issue_date", "expiry_date", "dzongkhag"],
  BT_PASSPORT: ["passport_no", "surname", "given_names", "nationality", "dob", "issue_date", "expiry_date"],
  BOB_LOAN_APPLICATION: ["application_no", "applicant_cid", "applicant_name", "loan_type", "loan_amount", "branch_code", "submission_date"],
};

export function Indexing({ documentId }: { documentId: number }) {
  const { user } = useAuth();
  const [docType, setDocType] = useState("BT_CID_4G");
  const [values, setValues] = useState<Record<string, string>>({});
  const [problems, setProblems] = useState<string[]>([]);
  const [ok, setOk] = useState(false);
  const canIndex = user?.permissions.includes("document:index");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setProblems([]); setOk(false);
    const fields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(values)) {
      fields[k] = k === "loan_amount" ? Number(v) : v;
    }
    try {
      await coreApi.indexDocument(documentId, { doc_type: docType, fields, confidence: 1 });
      setOk(true);
    } catch (err: any) {
      const body = err?.body ?? {};
      setProblems([...(body.missing ?? []).map((m: string) => `missing: ${m}`), ...(body.errors ?? [])]);
    }
  }

  if (!canIndex) return <div style={{ padding: 40 }}>Not authorised to index documents.</div>;

  return (
    <div style={{ padding: 32, maxWidth: 520 }}>
      <h2>Indexing</h2>
      <label className="label" htmlFor="doctype">Document type</label>
      <select id="doctype" className="field" value={docType} onChange={(e) => { setDocType(e.target.value); setValues({}); }}>
        {Object.keys(FIELDS).map((t) => <option key={t}>{t}</option>)}
      </select>
      <form onSubmit={onSubmit}>
        {FIELDS[docType].map((f) => (
          <div key={f}>
            <label className="label" htmlFor={f} style={{ marginTop: 12, display: "block" }}>{f}</label>
            <input id={f} className="field" value={values[f] ?? ""} onChange={(e) => setValues({ ...values, [f]: e.target.value })} />
          </div>
        ))}
        <button className="btn-primary" style={{ marginTop: 18 }}>Save index</button>
      </form>
      {ok && <p style={{ color: "#15803d" }}>Indexed.</p>}
      {problems.length > 0 && <ul style={{ color: "#b91c1c" }}>{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
    </div>
  );
}
```

- [ ] **Step 8: Add routes in `apps/web/src/router.tsx`**

```tsx
import { Capture } from "./pages/Capture.js";
import { Indexing } from "./pages/Indexing.js";
// inside the routes array:
  { path: "/capture", element: <ProtectedRoute permission="document:capture"><Capture /></ProtectedRoute> },
  { path: "/indexing/:id", element: <ProtectedRoute permission="document:index"><IndexingRoute /></ProtectedRoute> },
```

Add a tiny wrapper at the bottom of `router.tsx` to read the `:id` param into the `Indexing` component:
```tsx
import { useParams } from "react-router-dom";
function IndexingRoute() {
  const { id } = useParams();
  return <Indexing documentId={Number(id)} />;
}
```

- [ ] **Step 9: Run Indexing test to verify it passes**

Run: `pnpm --filter @zordms/web test Indexing`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/pages/Capture.tsx apps/web/src/pages/Capture.test.tsx apps/web/src/pages/Indexing.tsx apps/web/src/pages/Indexing.test.tsx apps/web/src/router.tsx
git commit -m "feat(web): Capture + Indexing screens (typed fields, validation surfacing, RBAC)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 16: React — Viewer + Dashboard screens

**Files:**
- Create: `apps/web/src/pages/Viewer.tsx`, `apps/web/src/pages/Dashboard.tsx`
- Modify: `apps/web/src/router.tsx` (add `/viewer/:id`, `/dashboard`)
- Test: `apps/web/src/pages/Viewer.test.tsx`, `apps/web/src/pages/Dashboard.test.tsx`

**Interfaces:**
- Consumes: `coreApi`, `useAuth`.
- Produces:
  - `Viewer({ documentId })` — renders the document preview area + the annotation list; an "Add redaction" control (visible only with `annotation:write`) posts a coordinate rect to `POST /documents/:id/annotations`.
  - `Dashboard()` — fetches `GET /dashboard/summary` and shows total, pending review, and per-category counts.

- [ ] **Step 1: Write the failing Viewer test**

`apps/web/src/pages/Viewer.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { Viewer } from "./Viewer.js";

vi.mock("../auth/AuthContext.js", () => ({
  useAuth: () => ({ user: { id: 1, username: "admin", roles: ["CDO"], permissions: ["document:read", "annotation:write"] }, logout: () => {} }),
}));

describe("Viewer screen", () => {
  it("lists annotations and can add a redaction", async () => {
    let created = false;
    globalThis.fetch = vi.fn(async (url: string, opts: any) => {
      if (url.endsWith("/annotations") && (!opts || opts.method === "GET" || !opts.method)) {
        return { ok: true, json: async () => ({ annotations: created ? [{ id: 1, kind: "redaction", page: 1, x: 10, y: 10, width: 20, height: 20 }] : [] }) } as any;
      }
      if (url.endsWith("/annotations") && opts?.method === "POST") { created = true; return { ok: true, json: async () => ({ annotation: { id: 1, kind: "redaction" } }) } as any; }
      if (url.startsWith("/documents/")) return { ok: true, json: async () => ({ document: { id: 7, title: "Doc", mime_type: "image/png" } }) } as any;
      return { ok: true, json: async () => ({}) } as any;
    }) as any;

    render(<Viewer documentId={7} />);
    await waitFor(() => expect(screen.getByText("Doc")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add redaction/i }));
    await waitFor(() => expect(screen.getByText(/redaction/i)).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zordms/web test Viewer`
Expected: FAIL — `./Viewer.js` not found.

- [ ] **Step 3: Write `apps/web/src/pages/Viewer.tsx`**

```tsx
import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext.js";
import { coreApi } from "../api/core.js";

interface Ann { id: number; kind: string; page: number; x: number; y: number; width: number; height: number; content?: string; }
interface Doc { id: number; title: string; mime_type?: string; }

export function Viewer({ documentId }: { documentId: number }) {
  const { user } = useAuth();
  const [doc, setDoc] = useState<Doc | null>(null);
  const [anns, setAnns] = useState<Ann[]>([]);
  const canAnnotate = user?.permissions.includes("annotation:write");

  async function refresh() {
    setDoc((await coreApi.getDocument(documentId)).document);
    setAnns((await coreApi.listAnnotations(documentId)).annotations);
  }
  useEffect(() => { refresh(); }, [documentId]);

  async function addRedaction() {
    await coreApi.createAnnotation(documentId, { kind: "redaction", page: 1, x: 10, y: 10, width: 20, height: 20 });
    await refresh();
  }

  return (
    <div style={{ padding: 32, display: "grid", gridTemplateColumns: "1fr 280px", gap: 24 }}>
      <section>
        <h2>{doc?.title ?? "Viewer"}</h2>
        <div style={{ position: "relative", border: "1px solid var(--line)", height: 480, background: "#f8fafc" }}>
          <img src={`/documents/${documentId}/download`} alt={doc?.title ?? ""} style={{ maxWidth: "100%", maxHeight: "100%" }} />
          {anns.filter((a) => a.kind === "redaction").map((a) => (
            <div key={a.id} style={{ position: "absolute", left: a.x, top: a.y, width: a.width, height: a.height, background: "#000" }} />
          ))}
        </div>
      </section>
      <aside>
        <h3>Annotations</h3>
        {canAnnotate && <button className="btn-primary" onClick={addRedaction}>Add redaction</button>}
        <ul>{anns.map((a) => <li key={a.id}>{a.kind} (p{a.page})</li>)}</ul>
      </aside>
    </div>
  );
}
```

- [ ] **Step 4: Run Viewer test to verify it passes**

Run: `pnpm --filter @zordms/web test Viewer`
Expected: PASS.

- [ ] **Step 5: Write the failing Dashboard test**

`apps/web/src/pages/Dashboard.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { Dashboard } from "./Dashboard.js";

vi.mock("../auth/AuthContext.js", () => ({
  useAuth: () => ({ user: { id: 1, username: "admin", roles: ["CDO"], permissions: ["document:read"] }, logout: () => {} }),
}));

describe("Dashboard screen", () => {
  it("renders summary counts from the core API", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ totalDocuments: 12, pendingReview: 3, indexedToday: 2, byCategory: { "KYC / Identity": 8, "Loan & Credit": 4 } }),
    }) as any;
    render(<Dashboard />);
    await waitFor(() => expect(screen.getByText("12")).toBeInTheDocument());
    expect(screen.getByText(/pending review/i)).toBeInTheDocument();
    expect(screen.getByText("KYC / Identity")).toBeInTheDocument();
  });
});
```

- [ ] **Step 6: Run Dashboard test to verify it fails**

Run: `pnpm --filter @zordms/web test Dashboard`
Expected: FAIL — `./Dashboard.js` not found.

- [ ] **Step 7: Write `apps/web/src/pages/Dashboard.tsx`**

```tsx
import { useEffect, useState } from "react";
import { coreApi } from "../api/core.js";

interface Summary { totalDocuments: number; pendingReview: number; indexedToday: number; byCategory: Record<string, number>; }

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 16, minWidth: 160 }}>
      <div style={{ fontSize: 28, fontWeight: 700, color: "var(--navy)" }}>{value}</div>
      <div style={{ color: "var(--muted)" }}>{label}</div>
    </div>
  );
}

export function Dashboard() {
  const [s, setS] = useState<Summary | null>(null);
  useEffect(() => { coreApi.dashboardSummary().then(setS); }, []);
  if (!s) return <div style={{ padding: 32 }}>Loading…</div>;

  return (
    <div style={{ padding: 32 }}>
      <h2>Dashboard</h2>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <Stat label="Total documents" value={s.totalDocuments} />
        <Stat label="Pending review" value={s.pendingReview} />
        <Stat label="Indexed today" value={s.indexedToday} />
      </div>
      <h3 style={{ marginTop: 28 }}>By catalog category</h3>
      <table style={{ borderCollapse: "collapse" }}>
        <tbody>
          {Object.entries(s.byCategory).map(([cat, n]) => (
            <tr key={cat} style={{ borderTop: "1px solid var(--line)" }}>
              <td style={{ padding: 8 }}>{cat}</td><td style={{ padding: 8, fontWeight: 600 }}>{n}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 8: Add routes in `apps/web/src/router.tsx`**

```tsx
import { Viewer } from "./pages/Viewer.js";
import { Dashboard } from "./pages/Dashboard.js";
// inside the routes array:
  { path: "/dashboard", element: <ProtectedRoute permission="document:read"><Dashboard /></ProtectedRoute> },
  { path: "/viewer/:id", element: <ProtectedRoute permission="document:read"><ViewerRoute /></ProtectedRoute> },
```

Add the param wrapper near `IndexingRoute`:
```tsx
function ViewerRoute() {
  const { id } = useParams();
  return <Viewer documentId={Number(id)} />;
}
```

- [ ] **Step 9: Run all web tests to verify they pass**

Run: `pnpm --filter @zordms/web test`
Expected: PASS (Plan 1 tests + Repository, Capture, Indexing, Viewer, Dashboard).

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/pages/Viewer.tsx apps/web/src/pages/Viewer.test.tsx apps/web/src/pages/Dashboard.tsx apps/web/src/pages/Dashboard.test.tsx apps/web/src/router.tsx
git commit -m "feat(web): Viewer (annotations/redaction) + Dashboard screens

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 17: CI wiring + Core runbook

**Files:**
- Modify: `.github/workflows/ci.yml` (the unit job already runs `pnpm test` across the workspace, which now includes `@zordms/storage`, `@zordms/events`, and `@zordms/core`; add the new migration to the PG migration job is automatic since it uses the same Knex CLI)
- Create: `docs/RUNBOOK-core.md`

**Interfaces:**
- Produces: a runbook for running the Core service against local Postgres + MinIO + Redis, and a CI confirmation note.

- [ ] **Step 1: Confirm the workspace test job already covers Core**

The Plan 1 CI `unit` job runs `pnpm install && pnpm build && pnpm test` (Turborepo fans out to every package). Since `@zordms/storage`, `@zordms/events`, and `@zordms/core` are workspace members with a `test` script, they are picked up automatically — no edit required. The `migrations-postgres` job runs `node packages/db/dist/cli.js migrate`, which now applies both `20260623_0001_identity_rbac` and `20260623_0002_core_dms` against real Postgres, proving the new schema is dialect-safe.

Add one explicit guard step to the `unit` job (after `pnpm test`) to ensure the Core suite is not silently skipped:
```yaml
      - run: pnpm --filter @zordms/core test
```

- [ ] **Step 2: Write `docs/RUNBOOK-core.md`**

```markdown
# ZorDMS Core DMS — Run & Verify

## Prerequisites
- Postgres (or Oracle 19c) reachable per `.env`.
- MinIO (S3-compatible) for object storage, OR set `STORAGE_DRIVER=local`.
- Redis for the event bus.

## Environment (add to .env)
```bash
CORE_PORT=4001
STORAGE_DRIVER=local           # local | s3
STORAGE_LOCAL_ROOT=./.storage  # used when STORAGE_DRIVER=local
S3_ENDPOINT=http://localhost:9000
S3_BUCKET=zordms
S3_REGION=us-east-1
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
REDIS_URL=redis://localhost:6379
```

## Run
1. `pnpm install && pnpm build`
2. `node packages/db/dist/cli.js migrate && node packages/db/dist/cli.js seed`  (applies core schema + perms)
3. `pnpm --filter @zordms/core dev`   # core on :4001
4. `pnpm --filter @zordms/gateway dev` # gateway on :4000 (for auth)
5. `pnpm --filter @zordms/web dev`     # web on :5174
6. Log in (`admin`/`admin123`), then visit `/capture`, `/repository`, `/indexing/:id`, `/viewer/:id`, `/dashboard`.

## Switch storage to MinIO/S3
Set `STORAGE_DRIVER=s3` and the `S3_*` vars; restart core. No code change.

## Tests
`pnpm --filter @zordms/core test` runs all Core suites against in-memory SQLite + a temp-dir local storage backend + the in-memory event bus.
```

- [ ] **Step 3: Run the full workspace test suite**

Run: `pnpm install && pnpm build && pnpm test`
Expected: all suites PASS — `@zordms/storage`, `@zordms/events`, `@zordms/db` (incl. core_dms migration), `@zordms/types`, `@zordms/core`, `@zordms/gateway`, `@zordms/web`.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml docs/RUNBOOK-core.md
git commit -m "ci: ensure core suite runs; add core DMS runbook

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage (Plan 2 scope):**
- services/core scaffold + app factory + health → Task 5. ✓
- Object storage abstraction (content-addressed SHA-256; local-FS backend tested; S3/MinIO backend interface) → Task 1 (`@zordms/storage`). ✓
- Migration: `documents`, `folders` (self-referential tree), `document_versions`, `annotations`, `folder_acls` + metadata columns (IDP §3.3) via Knex schema-builder, `increments()` only, no SQLite-isms → Task 3. ✓
- Folders repository: create / list tree / move (with subtree-move guard + descendant path recompute) → Task 6. ✓
- Documents: upload (multer), list (branch-scoped via RBAC + `crossbranch:read`), get, download, delete (`document:delete`), versioning + rollback → Tasks 7, 8. ✓
- Indexing/metadata with Bhutan typed schemas (BT_CID_4G, BT_PASSPORT, BOB_LOAN_APPLICATION + system metadata) + validated index endpoint enforcing required/regex/enum → Task 9. ✓
- Viewer data: annotations CRUD (coordinate-based) + redaction + stamp records → Task 10. ✓
- Auto-Catalog rule engine (IDP §4.1/§4.2/§4.3): deterministic top-down chain → category + mandatory-field check + alert/retention + HUMAN_REVIEW routing; pure function + endpoint, fully unit-tested → Task 11. ✓
- Auto Directory Mapper (IDP §5.1/§5.2): path-template resolution → folder path; create folder chain if absent; per-folder ACL inheritance (`folder_acls`, inherited by children); unit-tested templates + ACL inheritance → Task 12. ✓
- React: Repository, Capture, Indexing, Viewer, Dashboard screens (RBAC-aware), wired to the core API → Tasks 14, 15, 16. ✓
- Seed: new permissions added to the catalog (`folder:create`, `folder:read`, `document:catalog`, `document:map`, `annotation:write`) + CI note → Tasks 3, 17. ✓
- Event bus (Redis Streams) emitting `document.captured` / `document.indexed` / `document.cataloged` → Task 2 (`@zordms/events`); emitted in Tasks 7, 9, 11. ✓
- Cross-service authority pattern (Gateway `POST /authz/check`) — reused from Plan 1; Core enforces locally via `requireAuth`/`requirePermission` from `@zordms/auth`, and the gateway authority API remains available for the Workflow service (Plan 3). ✓
- Correctly out of scope (later plans): workflow/cases (Plan 3), notifications/expiry alert dispatch (Plan 4 — Core only *populates* the alert schedule via catalog), search (Plan 5), integrations (Plan 6), the VLM IDP inference pipeline (Plan 7 — Core consumes its outputs via the index/catalog/mapper endpoints).

**Placeholder scan:** No TBD/TODO/"similar to above". Every implementation step contains complete code; every test step contains real assertions. The S3 backend (`s3.ts`) is fully implemented (not stubbed) but has no unit test because it requires a live MinIO — exercised via the runbook/integration, consistent with the "test the local backend" instruction.

**Type consistency:**
- `CoreDeps` (Task 5) is the single deps shape passed to `createApp` and read by every route via `req.app.locals.deps`.
- `StorageBackend`/`PutResult` (Task 1) are consumed unchanged by `documents.ts` and `versions.ts` (Tasks 7, 8).
- `EventBus`/`EVENTS` (Task 2) are consumed unchanged in Tasks 7, 9, 11; the in-memory backend in `testutil.ts` (Task 5) implements the same interface used in production (`RedisStreamsEventBus`).
- `DocumentRecord`/`DocumentVersion`/`Folder`/`Annotation`/`CatalogResult`/`MapResult` (Task 4) are the contract types used across repos, routes, and the web client.
- `validateMetadata` (Task 9) and the catalog `MANDATORY` map (Task 11) both reference the same field names from IDP §3.2/§4.1; the catalog engine deliberately checks *catalog-level* mandatory fields (IDP §4.1) which are a subset/rename of the schema fields, matching the spec's two distinct lists.
- `requireAuth`/`requirePermission`/`can`/`canAll`/`signToken`/`resolveUserAuthz` are imported from `@zordms/auth` (promoted there per the Task 6 note) — single source of truth shared with the Gateway.
- `buildKnexConfig` (Plan 1 Task 3) signature is used identically in `testutil.ts` and the migration test.

---

## Notes for later plans
- **Plan 3 (Workflow & Cases)** consumes Core's `document:approve`/`document:reject` permissions via Gateway `/authz/check`, and listens to `document.captured`/`document.indexed` on the event bus to start maker-checker flows.
- **Plan 4 (Notify)** consumes `document.cataloged` + the persisted `destruction_date`/catalog `alertRule` to drive the IDP §4.3 expiry alert tiers (T-60/T-30/T-07/T-00). Core only *populates* the schedule; dispatch lives in Notify.
- **Plan 5 (Search)** indexes the `documents.metadata` JSON + OCR text (PG-FTS phase 1).
- **Plan 7 (AI/IDP)** calls Core's `POST /index/:id`, `POST /catalog/:id`, and `POST /mapper/:id` with its VLM classify→extract outputs; the human-review queue is fed by `route: "HUMAN_REVIEW"` / `review_flag` rows.
- Folder ACL roles in IDP §5.3 (RM, BranchManager, Compliance, …) are BoB AD-group names; map them to ZorDMS RBAC roles in a later mapping migration, or treat `folder_acls.role` as an AD-group label resolved at the gateway.

