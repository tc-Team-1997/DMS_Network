# ZorDMS Foundation + Identity/RBAC + Login — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the ZorDMS monorepo with a PostgreSQL⇄Oracle-switchable data layer, a data-driven RBAC engine, a Gateway/Identity service (login, MFA, supervisor-managed unlimited user provisioning), and a React (Vite+TS) app with the split-screen carousel login and a supervisor User-Management screen.

**Architecture:** pnpm + Turborepo monorepo. Shared TypeScript packages (`config`, `db`, `auth`, `types`) consumed by an Express Gateway service and a Vite/React SPA. RBAC is the single source of authority (data-driven roles + `resource:action` permissions), enforced at UI, Gateway, and service layers. The DB layer is Knex with the client chosen by env (`pg` | `oracledb`); tests run against `sqlite3` for speed while production uses Postgres/Oracle.

**Tech Stack:** Node 20+, TypeScript 5, Express 4, Knex 3 (pg / oracledb / sqlite3), Vitest + Supertest, bcryptjs, jsonwebtoken, speakeasy + qrcode, React 18 + Vite 5 + react-router-dom 6, @testing-library/react.

## Global Constraints

- **No licensing layer** — access is governed solely by RBAC; supervisors create an unlimited number of users. No seat counts, no license keys.
- **RBAC is the backbone** — data-driven roles + `resource:action` permissions; enforced at UI, Gateway, and each service. Same RBAC is the authority source for the (future) workflow engine.
- **All code fully functional** — no mocks/stubs for auth (real bcrypt hashing, real TOTP, real JWT/session).
- **DB switchable via env** — `DB_CLIENT=pg|oracledb` for Node (Knex). No SQLite-isms in migrations (use Knex schema-builder; `increments()` only). SQLite is a test-only backend.
- **Frontend** — Vite + React + TypeScript. Login is split-screen: left blue dotted carousel panel, right sign-in form. No public sign-up.
- **TypeScript everywhere**, ESM modules (`"type": "module"`), strict mode on.
- **Package names** under the `@zordms/` scope (e.g. `@zordms/db`).
- **Conventional commits**; commit after every passing step. End commit messages with the Co-Authored-By trailer used by this repo.

---

## File Structure

```
zordms/                          # NEW monorepo root (this repo)
  package.json                   # pnpm workspace root, turbo scripts
  pnpm-workspace.yaml
  turbo.json
  tsconfig.base.json
  .env.example
  packages/
    config/  src/index.ts        # env parsing + typed settings
    types/   src/index.ts        # shared TS contracts (User, Role, Permission, ...)
    db/      src/index.ts        # knex factory + dialect switch
             src/migrations/*.ts # dialect-neutral migrations
             src/seeds/*.ts      # default roles/permissions/admin
    auth/    src/password.ts      # hash/verify
             src/totp.ts          # MFA
             src/rbac.ts          # permission resolution + can()
             src/tokens.ts        # JWT issue/verify
             src/index.ts
  services/
    gateway/ src/app.ts           # express app factory (testable)
             src/server.ts        # listen()
             src/routes/auth.ts    # login/logout/mfa
             src/routes/users.ts   # supervisor user CRUD
             src/routes/authz.ts   # RBAC check API for other services
             src/middleware/requireAuth.ts
             src/middleware/requirePermission.ts
             src/middleware/audit.ts
  apps/
    web/     src/main.tsx, App.tsx, router.tsx
             src/theme.css         # navy+gold tokens
             src/api/client.ts
             src/auth/AuthContext.tsx
             src/pages/Login.tsx   # split-screen carousel
             src/pages/Users.tsx   # supervisor user management
             src/components/Carousel.tsx
             src/components/ProtectedRoute.tsx
```

---

## Task 1: Monorepo scaffold (pnpm + Turborepo + TS base)

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `tsconfig.base.json`, `.env.example`
- Modify: `.gitignore`

**Interfaces:**
- Produces: pnpm workspace recognizing `packages/*`, `services/*`, `apps/*`; root scripts `pnpm build`, `pnpm test`, `pnpm lint`.

- [ ] **Step 1: Create the workspace manifest**

`pnpm-workspace.yaml`:
```yaml
packages:
  - "packages/*"
  - "services/*"
  - "apps/*"
```

- [ ] **Step 2: Create root `package.json`**

```json
{
  "name": "zordms",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "turbo run build",
    "test": "turbo run test",
    "lint": "turbo run lint",
    "dev": "turbo run dev"
  },
  "devDependencies": {
    "turbo": "^2.0.0",
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 3: Create `turbo.json`**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
    "test": { "dependsOn": ["^build"] },
    "lint": {},
    "dev": { "cache": false, "persistent": true }
  }
}
```

- [ ] **Step 4: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "composite": false,
    "resolveJsonModule": true,
    "outDir": "dist",
    "rootDir": "src"
  }
}
```

- [ ] **Step 5: Create `.env.example`**

```bash
# Node DB layer (Knex)
DB_CLIENT=pg            # pg | oracledb (sqlite3 is test-only)
DB_HOST=localhost
DB_PORT=5432
DB_USER=zordms
DB_PASSWORD=zordms
DB_NAME=zordms
DB_ORACLE_CONNECT_STRING=localhost:1521/ORCLPDB1   # used when DB_CLIENT=oracledb

# Auth
JWT_SECRET=change-me-in-prod
SESSION_SECRET=change-me-in-prod
GATEWAY_PORT=4000

# Python AI service (later plan)
DATABASE_URL=postgresql+psycopg://zordms:zordms@localhost:5432/zordms
```

- [ ] **Step 6: Append to `.gitignore`**

```
node_modules/
dist/
.turbo/
*.local
.env
```

- [ ] **Step 7: Install and verify workspace**

Run: `pnpm install`
Expected: completes; `pnpm -r exec true` lists no errors (no packages yet is fine).

- [ ] **Step 8: Commit**

```bash
git add package.json pnpm-workspace.yaml turbo.json tsconfig.base.json .env.example .gitignore pnpm-lock.yaml
git commit -m "chore: scaffold pnpm + turborepo monorepo"
```

---

## Task 2: `@zordms/config` — typed environment settings

**Files:**
- Create: `packages/config/package.json`, `packages/config/tsconfig.json`, `packages/config/src/index.ts`
- Test: `packages/config/src/index.test.ts`

**Interfaces:**
- Produces: `loadConfig(env: NodeJS.ProcessEnv): AppConfig` where
  `AppConfig = { db: { client: 'pg'|'oracledb'|'sqlite3', host, port, user, password, name, oracleConnectString }, jwtSecret: string, sessionSecret: string, gatewayPort: number }`.

- [ ] **Step 1: Create `packages/config/package.json`**

```json
{
  "name": "@zordms/config",
  "version": "0.0.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "lint": "tsc -p tsconfig.json --noEmit"
  },
  "devDependencies": { "typescript": "^5.4.0", "vitest": "^1.6.0", "@types/node": "^20.0.0" }
}
```

- [ ] **Step 2: Create `packages/config/tsconfig.json`**

```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

- [ ] **Step 3: Write the failing test**

`packages/config/src/index.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { loadConfig } from "./index.js";

describe("loadConfig", () => {
  it("defaults DB client to pg and parses port as number", () => {
    const cfg = loadConfig({ DB_PORT: "5432" } as NodeJS.ProcessEnv);
    expect(cfg.db.client).toBe("pg");
    expect(cfg.db.port).toBe(5432);
    expect(typeof cfg.gatewayPort).toBe("number");
  });

  it("honors oracledb selection and connect string", () => {
    const cfg = loadConfig({ DB_CLIENT: "oracledb", DB_ORACLE_CONNECT_STRING: "h:1521/PDB" } as NodeJS.ProcessEnv);
    expect(cfg.db.client).toBe("oracledb");
    expect(cfg.db.oracleConnectString).toBe("h:1521/PDB");
  });

  it("rejects an unknown DB client", () => {
    expect(() => loadConfig({ DB_CLIENT: "mysql" } as NodeJS.ProcessEnv)).toThrow(/DB_CLIENT/);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter @zordms/config test`
Expected: FAIL — cannot find `./index.js` / `loadConfig` not exported.

- [ ] **Step 5: Write minimal implementation**

`packages/config/src/index.ts`:
```ts
export type DbClient = "pg" | "oracledb" | "sqlite3";

export interface AppConfig {
  db: {
    client: DbClient;
    host: string;
    port: number;
    user: string;
    password: string;
    name: string;
    oracleConnectString: string;
  };
  jwtSecret: string;
  sessionSecret: string;
  gatewayPort: number;
}

const VALID: DbClient[] = ["pg", "oracledb", "sqlite3"];

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const client = (env.DB_CLIENT ?? "pg") as DbClient;
  if (!VALID.includes(client)) {
    throw new Error(`Invalid DB_CLIENT "${client}". Expected one of ${VALID.join(", ")}`);
  }
  return {
    db: {
      client,
      host: env.DB_HOST ?? "localhost",
      port: Number(env.DB_PORT ?? 5432),
      user: env.DB_USER ?? "zordms",
      password: env.DB_PASSWORD ?? "zordms",
      name: env.DB_NAME ?? "zordms",
      oracleConnectString: env.DB_ORACLE_CONNECT_STRING ?? "",
    },
    jwtSecret: env.JWT_SECRET ?? "change-me-in-prod",
    sessionSecret: env.SESSION_SECRET ?? "change-me-in-prod",
    gatewayPort: Number(env.GATEWAY_PORT ?? 4000),
  };
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @zordms/config test`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/config
git commit -m "feat(config): typed env settings with DB client validation"
```

---

## Task 3: `@zordms/db` — Knex factory with PG/Oracle/SQLite switch

**Files:**
- Create: `packages/db/package.json`, `packages/db/tsconfig.json`, `packages/db/src/knexConfig.ts`, `packages/db/src/index.ts`
- Test: `packages/db/src/knexConfig.test.ts`

**Interfaces:**
- Consumes: `AppConfig` from `@zordms/config`.
- Produces:
  - `buildKnexConfig(cfg: AppConfig['db']): Knex.Config` (pure, returns dialect-correct config).
  - `getKnex(cfg?: AppConfig['db']): Knex` (memoized singleton).

- [ ] **Step 1: Create `packages/db/package.json`**

```json
{
  "name": "@zordms/db",
  "version": "0.0.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "lint": "tsc -p tsconfig.json --noEmit",
    "migrate": "node dist/cli.js migrate",
    "seed": "node dist/cli.js seed"
  },
  "dependencies": { "knex": "^3.1.0", "@zordms/config": "workspace:*" },
  "devDependencies": {
    "typescript": "^5.4.0", "vitest": "^1.6.0", "@types/node": "^20.0.0",
    "sqlite3": "^5.1.7", "pg": "^8.11.0", "oracledb": "^6.5.0"
  }
}
```

(Note: `pg`/`oracledb` are devDependencies for type/CI; production images install the one matching `DB_CLIENT`.)

- [ ] **Step 2: Create `packages/db/tsconfig.json`**

```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

- [ ] **Step 3: Write the failing test**

`packages/db/src/knexConfig.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildKnexConfig } from "./knexConfig.js";

const base = { host: "h", port: 5432, user: "u", password: "p", name: "n", oracleConnectString: "h:1521/PDB" };

describe("buildKnexConfig", () => {
  it("maps pg to a host/port connection", () => {
    const c = buildKnexConfig({ ...base, client: "pg" });
    expect(c.client).toBe("pg");
    expect((c.connection as any).host).toBe("h");
    expect((c.connection as any).database).toBe("n");
  });

  it("maps oracledb to a connectString connection", () => {
    const c = buildKnexConfig({ ...base, client: "oracledb" });
    expect(c.client).toBe("oracledb");
    expect((c.connection as any).connectString).toBe("h:1521/PDB");
    expect((c.connection as any).user).toBe("u");
  });

  it("maps sqlite3 to a file connection with useNullAsDefault", () => {
    const c = buildKnexConfig({ ...base, client: "sqlite3" });
    expect(c.client).toBe("sqlite3");
    expect(c.useNullAsDefault).toBe(true);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter @zordms/db test`
Expected: FAIL — `./knexConfig.js` not found.

- [ ] **Step 5: Write `knexConfig.ts`**

```ts
import type { Knex } from "knex";
import type { AppConfig } from "@zordms/config";

type DbCfg = AppConfig["db"];

export function buildKnexConfig(db: DbCfg): Knex.Config {
  const migrations = { directory: new URL("./migrations", import.meta.url).pathname, extension: "js" };
  const seeds = { directory: new URL("./seeds", import.meta.url).pathname };

  if (db.client === "oracledb") {
    return {
      client: "oracledb",
      connection: { user: db.user, password: db.password, connectString: db.oracleConnectString },
      pool: { min: 2, max: 10 },
      migrations, seeds,
    };
  }
  if (db.client === "sqlite3") {
    return {
      client: "sqlite3",
      connection: { filename: process.env.SQLITE_FILE ?? ":memory:" },
      useNullAsDefault: true,
      pool: { min: 1, max: 1 },
      migrations, seeds,
    };
  }
  return {
    client: "pg",
    connection: { host: db.host, port: db.port, user: db.user, password: db.password, database: db.name },
    pool: { min: 2, max: 10 },
    migrations, seeds,
  };
}
```

- [ ] **Step 6: Write `index.ts`**

```ts
import knexLib, { type Knex } from "knex";
import { loadConfig, type AppConfig } from "@zordms/config";
import { buildKnexConfig } from "./knexConfig.js";

export { buildKnexConfig };

let instance: Knex | undefined;

export function getKnex(db: AppConfig["db"] = loadConfig().db): Knex {
  if (!instance) instance = knexLib(buildKnexConfig(db));
  return instance;
}

export async function destroyKnex(): Promise<void> {
  if (instance) { await instance.destroy(); instance = undefined; }
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm --filter @zordms/db test`
Expected: PASS (3 tests).

- [ ] **Step 8: Commit**

```bash
git add packages/db
git commit -m "feat(db): knex factory with pg/oracle/sqlite dialect switch"
```

---

## Task 4: RBAC schema migration + default seed

**Files:**
- Create: `packages/db/src/migrations/20260623_0001_identity_rbac.ts`
- Create: `packages/db/src/seeds/0001_default_rbac.ts`
- Create: `packages/db/src/cli.ts`
- Test: `packages/db/src/migrations/identity_rbac.test.ts`

**Interfaces:**
- Produces tables: `users`, `roles`, `permissions`, `role_permissions`, `user_roles`, `audit_log`.
- Seed produces: permission catalog (`resource:action`), default roles (CDO, Supervisor, Maker, Checker, Indexer, Viewer, Auditor), and one bootstrap admin user `admin` (role CDO) with password `admin123` (hashed) — only if no users exist.

- [ ] **Step 1: Write the failing test (runs migrations on in-memory sqlite)**

`packages/db/src/migrations/identity_rbac.test.ts`:
```ts
import { describe, it, expect, afterAll } from "vitest";
import knexLib from "knex";
import { buildKnexConfig } from "../knexConfig.js";

const knex = knexLib(buildKnexConfig({
  client: "sqlite3", host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "",
}));

afterAll(async () => { await knex.destroy(); });

describe("identity_rbac migration", () => {
  it("creates all RBAC tables", async () => {
    await knex.migrate.latest();
    for (const t of ["users", "roles", "permissions", "role_permissions", "user_roles", "audit_log"]) {
      expect(await knex.schema.hasTable(t)).toBe(true);
    }
  });

  it("seeds default roles, permissions, and a bootstrap admin", async () => {
    await knex.seed.run();
    const roles = await knex("roles").pluck("name");
    expect(roles).toEqual(expect.arrayContaining(["CDO", "Supervisor", "Maker", "Checker", "Viewer", "Auditor"]));
    const admin = await knex("users").where({ username: "admin" }).first();
    expect(admin).toBeTruthy();
    const perms = await knex("permissions").pluck("key");
    expect(perms).toEqual(expect.arrayContaining(["user:create", "document:approve"]));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zordms/db test`
Expected: FAIL — no migration files.

- [ ] **Step 3: Write the migration**

`packages/db/src/migrations/20260623_0001_identity_rbac.ts`:
```ts
import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("users", (t) => {
    t.increments("id").primary();
    t.string("username", 100).notNullable().unique();
    t.string("password_hash", 255).notNullable();
    t.string("full_name", 200);
    t.string("email", 200);
    t.string("branch", 120);
    t.string("region", 120);
    t.boolean("mfa_enabled").notNullable().defaultTo(false);
    t.string("mfa_secret", 120);
    t.string("status", 20).notNullable().defaultTo("Active"); // Active | Locked
    t.string("created_by", 100);
    t.timestamp("created_at").defaultTo(knex.fn.now());
  });

  await knex.schema.createTable("roles", (t) => {
    t.increments("id").primary();
    t.string("name", 80).notNullable().unique();
    t.string("description", 255);
    t.boolean("system").notNullable().defaultTo(false);
  });

  await knex.schema.createTable("permissions", (t) => {
    t.increments("id").primary();
    t.string("key", 120).notNullable().unique(); // resource:action
    t.string("description", 255);
  });

  await knex.schema.createTable("role_permissions", (t) => {
    t.integer("role_id").notNullable().references("id").inTable("roles").onDelete("CASCADE");
    t.integer("permission_id").notNullable().references("id").inTable("permissions").onDelete("CASCADE");
    t.primary(["role_id", "permission_id"]);
  });

  await knex.schema.createTable("user_roles", (t) => {
    t.integer("user_id").notNullable().references("id").inTable("users").onDelete("CASCADE");
    t.integer("role_id").notNullable().references("id").inTable("roles").onDelete("CASCADE");
    t.primary(["user_id", "role_id"]);
  });

  await knex.schema.createTable("audit_log", (t) => {
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
  for (const t of ["audit_log", "user_roles", "role_permissions", "permissions", "roles", "users"]) {
    await knex.schema.dropTableIfExists(t);
  }
}
```

- [ ] **Step 4: Write the seed**

`packages/db/src/seeds/0001_default_rbac.ts`:
```ts
import type { Knex } from "knex";
import bcrypt from "bcryptjs";

const PERMISSIONS: Array<[string, string]> = [
  ["user:create", "Create users"],
  ["user:update", "Update users"],
  ["user:read", "View users"],
  ["role:assign", "Assign roles"],
  ["document:capture", "Capture documents"],
  ["document:index", "Index documents"],
  ["document:read", "View documents"],
  ["document:approve", "Approve documents"],
  ["document:reject", "Reject documents"],
  ["document:delete", "Delete documents"],
  ["workflow:act", "Act on workflows"],
  ["legal_hold:place", "Place legal holds"],
  ["compliance:read", "View compliance"],
  ["admin:access", "Access admin"],
  ["crossbranch:read", "Read across branches"],
];

const ROLES: Record<string, string[]> = {
  CDO: PERMISSIONS.map(([k]) => k), // full
  Supervisor: ["user:create", "user:update", "user:read", "role:assign", "document:read", "admin:access"],
  Maker: ["document:capture", "document:index", "document:read", "workflow:act"],
  Checker: ["document:approve", "document:reject", "document:read", "workflow:act"],
  Indexer: ["document:index", "document:read"],
  Viewer: ["document:read"],
  Auditor: ["document:read", "compliance:read", "crossbranch:read"],
};

export async function seed(knex: Knex): Promise<void> {
  // permissions
  for (const [key, description] of PERMISSIONS) {
    const exists = await knex("permissions").where({ key }).first();
    if (!exists) await knex("permissions").insert({ key, description });
  }
  // roles + role_permissions
  for (const [name, perms] of Object.entries(ROLES)) {
    let role = await knex("roles").where({ name }).first();
    if (!role) {
      const [id] = await knex("roles").insert({ name, description: `${name} role`, system: true }).returning("id");
      role = { id: typeof id === "object" ? (id as any).id : id };
    }
    for (const key of perms) {
      const perm = await knex("permissions").where({ key }).first();
      if (perm) {
        const link = await knex("role_permissions").where({ role_id: role.id, permission_id: perm.id }).first();
        if (!link) await knex("role_permissions").insert({ role_id: role.id, permission_id: perm.id });
      }
    }
  }
  // bootstrap admin only if no users
  const userCount = Number((await knex("users").count<{ c: number }[]>("id as c"))[0].c);
  if (userCount === 0) {
    const [uid] = await knex("users").insert({
      username: "admin",
      password_hash: bcrypt.hashSync("admin123", 10),
      full_name: "System Administrator",
      status: "Active",
      created_by: "system",
    }).returning("id");
    const userId = typeof uid === "object" ? (uid as any).id : uid;
    const cdo = await knex("roles").where({ name: "CDO" }).first();
    await knex("user_roles").insert({ user_id: userId, role_id: cdo.id });
  }
}
```

Add `bcryptjs` to `packages/db/package.json` dependencies: `"bcryptjs": "^2.4.3"` and devDep `"@types/bcryptjs": "^2.4.6"`. Run `pnpm install`.

- [ ] **Step 5: Write the CLI runner**

`packages/db/src/cli.ts`:
```ts
import { getKnex, destroyKnex } from "./index.js";

const cmd = process.argv[2];
const knex = getKnex();
try {
  if (cmd === "migrate") { await knex.migrate.latest(); console.log("migrations applied"); }
  else if (cmd === "rollback") { await knex.migrate.rollback(); console.log("rolled back"); }
  else if (cmd === "seed") { await knex.seed.run(); console.log("seed applied"); }
  else { console.error("usage: cli <migrate|rollback|seed>"); process.exit(1); }
} finally {
  await destroyKnex();
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @zordms/db test`
Expected: PASS (migration + seed tests green).

- [ ] **Step 7: Commit**

```bash
git add packages/db
git commit -m "feat(db): RBAC schema migration + default roles/permissions/admin seed"
```

---

## Task 5: `@zordms/types` — shared contracts

**Files:**
- Create: `packages/types/package.json`, `packages/types/tsconfig.json`, `packages/types/src/index.ts`
- Test: `packages/types/src/index.test.ts`

**Interfaces:**
- Produces TS types: `Permission` (string), `Role`, `User`, `AuthUser` (`{ id, username, roles: string[], permissions: string[], branch?, region? }`), `LoginRequest`, `LoginResponse`, `CreateUserRequest`.

- [ ] **Step 1: Create `packages/types/package.json`**

```json
{
  "name": "@zordms/types",
  "version": "0.0.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": { "build": "tsc -p tsconfig.json", "test": "vitest run", "lint": "tsc -p tsconfig.json --noEmit" },
  "devDependencies": { "typescript": "^5.4.0", "vitest": "^1.6.0" }
}
```

- [ ] **Step 2: Create `packages/types/tsconfig.json`**

```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

- [ ] **Step 3: Write the failing test**

`packages/types/src/index.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { isAuthUser } from "./index.js";

describe("isAuthUser", () => {
  it("accepts a well-formed auth user", () => {
    expect(isAuthUser({ id: 1, username: "a", roles: ["CDO"], permissions: ["user:create"] })).toBe(true);
  });
  it("rejects a malformed object", () => {
    expect(isAuthUser({ id: 1 })).toBe(false);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter @zordms/types test`
Expected: FAIL — module not found.

- [ ] **Step 5: Write `index.ts`**

```ts
export type Permission = string; // "resource:action"

export interface Role { id: number; name: string; description?: string; system?: boolean; }

export interface User {
  id: number; username: string; full_name?: string; email?: string;
  branch?: string; region?: string; mfa_enabled: boolean; status: "Active" | "Locked";
}

export interface AuthUser {
  id: number; username: string; roles: string[]; permissions: Permission[];
  branch?: string; region?: string;
}

export interface LoginRequest { username: string; password: string; totp?: string; }
export interface LoginResponse { token: string; user: AuthUser; mfaRequired?: boolean; }

export interface CreateUserRequest {
  username: string; password: string; full_name?: string; email?: string;
  branch?: string; region?: string; roles: string[];
}

export function isAuthUser(x: unknown): x is AuthUser {
  const u = x as AuthUser;
  return !!u && typeof u.id === "number" && typeof u.username === "string"
    && Array.isArray(u.roles) && Array.isArray(u.permissions);
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @zordms/types test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/types
git commit -m "feat(types): shared auth/RBAC contracts"
```

---

## Task 6: `@zordms/auth` — password hashing

**Files:**
- Create: `packages/auth/package.json`, `packages/auth/tsconfig.json`, `packages/auth/src/password.ts`
- Test: `packages/auth/src/password.test.ts`

**Interfaces:**
- Produces: `hashPassword(plain: string): Promise<string>`, `verifyPassword(plain: string, hash: string): Promise<boolean>`.

- [ ] **Step 1: Create `packages/auth/package.json`**

```json
{
  "name": "@zordms/auth",
  "version": "0.0.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": { "build": "tsc -p tsconfig.json", "test": "vitest run", "lint": "tsc -p tsconfig.json --noEmit" },
  "dependencies": {
    "bcryptjs": "^2.4.3", "jsonwebtoken": "^9.0.2", "speakeasy": "^2.0.0",
    "@zordms/types": "workspace:*", "@zordms/db": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.4.0", "vitest": "^1.6.0",
    "@types/bcryptjs": "^2.4.6", "@types/jsonwebtoken": "^9.0.6", "@types/speakeasy": "^2.0.10"
  }
}
```

- [ ] **Step 2: Create `packages/auth/tsconfig.json`**

```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

- [ ] **Step 3: Write the failing test**

`packages/auth/src/password.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "./password.js";

describe("password", () => {
  it("hashes and verifies a correct password", async () => {
    const h = await hashPassword("s3cret");
    expect(h).not.toBe("s3cret");
    expect(await verifyPassword("s3cret", h)).toBe(true);
  });
  it("rejects a wrong password", async () => {
    const h = await hashPassword("s3cret");
    expect(await verifyPassword("nope", h)).toBe(false);
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter @zordms/auth test`
Expected: FAIL — module not found.

- [ ] **Step 5: Write `password.ts`**

```ts
import bcrypt from "bcryptjs";

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @zordms/auth test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/auth
git commit -m "feat(auth): bcrypt password hashing"
```

---

## Task 7: `@zordms/auth` — TOTP MFA

**Files:**
- Create: `packages/auth/src/totp.ts`
- Test: `packages/auth/src/totp.test.ts`

**Interfaces:**
- Produces: `generateMfaSecret(label: string): { base32: string; otpauthUrl: string }`, `verifyTotp(secretBase32: string, token: string): boolean`.

- [ ] **Step 1: Write the failing test**

`packages/auth/src/totp.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import speakeasy from "speakeasy";
import { generateMfaSecret, verifyTotp } from "./totp.js";

describe("totp", () => {
  it("generates a secret with otpauth url", () => {
    const s = generateMfaSecret("ZorDMS:alice");
    expect(s.base32).toBeTruthy();
    expect(s.otpauthUrl).toContain("otpauth://");
  });
  it("verifies a live token for the secret", () => {
    const s = generateMfaSecret("ZorDMS:alice");
    const token = speakeasy.totp({ secret: s.base32, encoding: "base32" });
    expect(verifyTotp(s.base32, token)).toBe(true);
    expect(verifyTotp(s.base32, "000000")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zordms/auth test totp`
Expected: FAIL — `./totp.js` not found.

- [ ] **Step 3: Write `totp.ts`**

```ts
import speakeasy from "speakeasy";

export function generateMfaSecret(label: string): { base32: string; otpauthUrl: string } {
  const secret = speakeasy.generateSecret({ name: label });
  return { base32: secret.base32, otpauthUrl: secret.otpauth_url ?? "" };
}

export function verifyTotp(secretBase32: string, token: string): boolean {
  return speakeasy.totp.verify({ secret: secretBase32, encoding: "base32", token, window: 1 });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @zordms/auth test totp`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/auth/src/totp.ts packages/auth/src/totp.test.ts
git commit -m "feat(auth): TOTP MFA secret generation + verification"
```

---

## Task 8: `@zordms/auth` — RBAC engine

**Files:**
- Create: `packages/auth/src/rbac.ts`
- Test: `packages/auth/src/rbac.test.ts`

**Interfaces:**
- Consumes: a Knex instance.
- Produces:
  - `resolveUserAuthz(knex, userId): Promise<{ roles: string[]; permissions: string[] }>` — union of permissions across the user's roles.
  - `can(authz: { permissions: string[] }, required: string): boolean`.
  - `canAll(authz, required: string[]): boolean`.

- [ ] **Step 1: Write the failing test (seeded sqlite)**

`packages/auth/src/rbac.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import knexLib from "knex";
import { buildKnexConfig } from "@zordms/db";
import { resolveUserAuthz, can, canAll } from "./rbac.js";

const knex = knexLib(buildKnexConfig({
  client: "sqlite3", host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "",
}));

beforeAll(async () => { await knex.migrate.latest(); await knex.seed.run(); });
afterAll(async () => { await knex.destroy(); });

describe("rbac engine", () => {
  it("resolves the bootstrap admin (CDO) permissions including user:create", async () => {
    const admin = await knex("users").where({ username: "admin" }).first();
    const authz = await resolveUserAuthz(knex, admin.id);
    expect(authz.roles).toContain("CDO");
    expect(can(authz, "user:create")).toBe(true);
    expect(canAll(authz, ["user:create", "document:approve"])).toBe(true);
  });

  it("denies a permission the user does not have", async () => {
    const authz = { permissions: ["document:read"] };
    expect(can(authz, "user:create")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zordms/auth test rbac`
Expected: FAIL — `./rbac.js` not found.

- [ ] **Step 3: Write `rbac.ts`**

```ts
import type { Knex } from "knex";

export interface Authz { roles: string[]; permissions: string[]; }

export async function resolveUserAuthz(knex: Knex, userId: number): Promise<Authz> {
  const roleRows = await knex("user_roles as ur")
    .join("roles as r", "r.id", "ur.role_id")
    .where("ur.user_id", userId)
    .select("r.id as id", "r.name as name");

  const roleIds = roleRows.map((r) => r.id);
  const roles = roleRows.map((r) => r.name);

  let permissions: string[] = [];
  if (roleIds.length) {
    const permRows = await knex("role_permissions as rp")
      .join("permissions as p", "p.id", "rp.permission_id")
      .whereIn("rp.role_id", roleIds)
      .distinct("p.key as key");
    permissions = permRows.map((p) => p.key);
  }
  return { roles, permissions };
}

export function can(authz: { permissions: string[] }, required: string): boolean {
  return authz.permissions.includes(required);
}

export function canAll(authz: { permissions: string[] }, required: string[]): boolean {
  return required.every((r) => authz.permissions.includes(r));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @zordms/auth test rbac`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/auth/src/rbac.ts packages/auth/src/rbac.test.ts
git commit -m "feat(auth): data-driven RBAC permission resolution engine"
```

---

## Task 9: `@zordms/auth` — JWT tokens + barrel export

**Files:**
- Create: `packages/auth/src/tokens.ts`, `packages/auth/src/index.ts`
- Test: `packages/auth/src/tokens.test.ts`

**Interfaces:**
- Produces:
  - `signToken(payload: { sub: number; username: string }, secret: string): string` (1h expiry).
  - `verifyToken(token: string, secret: string): { sub: number; username: string }` (throws on invalid).
- Barrel `index.ts` re-exports password, totp, rbac, tokens.

- [ ] **Step 1: Write the failing test**

`packages/auth/src/tokens.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { signToken, verifyToken } from "./tokens.js";

describe("tokens", () => {
  it("round-trips a payload", () => {
    const t = signToken({ sub: 7, username: "alice" }, "secret");
    const p = verifyToken(t, "secret");
    expect(p.sub).toBe(7);
    expect(p.username).toBe("alice");
  });
  it("rejects a token signed with a different secret", () => {
    const t = signToken({ sub: 1, username: "x" }, "secret");
    expect(() => verifyToken(t, "other")).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zordms/auth test tokens`
Expected: FAIL — `./tokens.js` not found.

- [ ] **Step 3: Write `tokens.ts`**

```ts
import jwt from "jsonwebtoken";

export interface TokenPayload { sub: number; username: string; }

export function signToken(payload: TokenPayload, secret: string): string {
  return jwt.sign(payload, secret, { expiresIn: "1h" });
}

export function verifyToken(token: string, secret: string): TokenPayload {
  const decoded = jwt.verify(token, secret) as jwt.JwtPayload;
  return { sub: Number(decoded.sub), username: String(decoded.username) };
}
```

- [ ] **Step 4: Write `index.ts`**

```ts
export * from "./password.js";
export * from "./totp.js";
export * from "./rbac.js";
export * from "./tokens.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @zordms/auth test`
Expected: PASS (all auth tests).

- [ ] **Step 6: Commit**

```bash
git add packages/auth/src/tokens.ts packages/auth/src/tokens.test.ts packages/auth/src/index.ts
git commit -m "feat(auth): JWT issue/verify + package barrel"
```

---

## Task 10: Gateway app skeleton + health route

**Files:**
- Create: `services/gateway/package.json`, `services/gateway/tsconfig.json`, `services/gateway/src/app.ts`, `services/gateway/src/server.ts`
- Test: `services/gateway/src/app.test.ts`

**Interfaces:**
- Produces: `createApp(deps: { knex: Knex; config: AppConfig }): Express` — pure factory (no `listen`), so tests can mount it with a sqlite knex.
- `GET /health` → `{ status: "ok" }`.

- [ ] **Step 1: Create `services/gateway/package.json`**

```json
{
  "name": "@zordms/gateway",
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
    "@zordms/config": "workspace:*", "@zordms/types": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.4.0", "vitest": "^1.6.0", "supertest": "^7.0.0", "tsx": "^4.15.0",
    "@types/express": "^4.17.21", "@types/cors": "^2.8.17", "@types/supertest": "^6.0.2", "@types/node": "^20.0.0",
    "knex": "^3.1.0", "sqlite3": "^5.1.7"
  }
}
```

- [ ] **Step 2: Create `services/gateway/tsconfig.json`**

```json
{ "extends": "../../tsconfig.base.json", "include": ["src"] }
```

- [ ] **Step 3: Write the failing test**

`services/gateway/src/app.test.ts`:
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

describe("gateway health", () => {
  it("GET /health returns ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter @zordms/gateway test`
Expected: FAIL — `./app.js` not found.

- [ ] **Step 5: Write `app.ts`**

```ts
import express, { type Express } from "express";
import cors from "cors";
import type { Knex } from "knex";
import type { AppConfig } from "@zordms/config";

export interface AppDeps { knex: Knex; config: AppConfig; }

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.locals.deps = deps;

  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  return app;
}
```

- [ ] **Step 6: Write `server.ts`**

```ts
import { createApp } from "./app.js";
import { getKnex } from "@zordms/db";
import { loadConfig } from "@zordms/config";

const config = loadConfig();
const knex = getKnex();
await knex.migrate.latest();
await knex.seed.run();
const app = createApp({ knex, config });
app.listen(config.gatewayPort, () => console.log(`ZorDMS gateway on :${config.gatewayPort}`));
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm --filter @zordms/gateway test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add services/gateway
git commit -m "feat(gateway): express app factory + health route"
```

---

## Task 11: Gateway auth middleware (`requireAuth`, `requirePermission`)

**Files:**
- Create: `services/gateway/src/middleware/requireAuth.ts`, `services/gateway/src/middleware/requirePermission.ts`
- Test: `services/gateway/src/middleware/requirePermission.test.ts`

**Interfaces:**
- Consumes: `verifyToken`, `resolveUserAuthz`, `can` from `@zordms/auth`; `app.locals.deps`.
- Produces:
  - `requireAuth(req,res,next)` — reads `Authorization: Bearer <jwt>`, sets `req.authUser: AuthUser` (id, username, roles, permissions), else 401.
  - `requirePermission(perm: string)` → middleware returning 403 unless `req.authUser` has it.

- [ ] **Step 1: Write the failing test**

`services/gateway/src/middleware/requirePermission.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import knexLib from "knex";
import { buildKnexConfig } from "@zordms/db";
import { signToken } from "@zordms/auth";
import { requireAuth } from "./requireAuth.js";
import { requirePermission } from "./requirePermission.js";

const knex = knexLib(buildKnexConfig({
  client: "sqlite3", host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "",
}));
const app = express();
app.locals.deps = { knex, config: { jwtSecret: "t" } };
app.get("/secret", requireAuth, requirePermission("user:create"), (_req, res) => res.json({ ok: true }));

let adminToken = "";
beforeAll(async () => {
  await knex.migrate.latest(); await knex.seed.run();
  const admin = await knex("users").where({ username: "admin" }).first();
  adminToken = signToken({ sub: admin.id, username: "admin" }, "t");
});
afterAll(async () => { await knex.destroy(); });

describe("requirePermission", () => {
  it("401 without a token", async () => {
    expect((await request(app).get("/secret")).status).toBe(401);
  });
  it("200 for admin (CDO has user:create)", async () => {
    const res = await request(app).get("/secret").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zordms/gateway test requirePermission`
Expected: FAIL — middleware modules not found.

- [ ] **Step 3: Write `requireAuth.ts`**

```ts
import type { Request, Response, NextFunction } from "express";
import { verifyToken, resolveUserAuthz } from "@zordms/auth";
import type { AuthUser } from "@zordms/types";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express { interface Request { authUser?: AuthUser; } }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) { res.status(401).json({ error: "unauthorized" }); return; }
  const { knex, config } = req.app.locals.deps;
  try {
    const payload = verifyToken(token, config.jwtSecret);
    const user = await knex("users").where({ id: payload.sub }).first();
    if (!user || user.status !== "Active") { res.status(401).json({ error: "unauthorized" }); return; }
    const authz = await resolveUserAuthz(knex, user.id);
    req.authUser = { id: user.id, username: user.username, roles: authz.roles, permissions: authz.permissions, branch: user.branch, region: user.region };
    next();
  } catch {
    res.status(401).json({ error: "unauthorized" });
  }
}
```

- [ ] **Step 4: Write `requirePermission.ts`**

```ts
import type { Request, Response, NextFunction } from "express";
import { can } from "@zordms/auth";

export function requirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.authUser) { res.status(401).json({ error: "unauthorized" }); return; }
    if (!can({ permissions: req.authUser.permissions }, permission)) {
      res.status(403).json({ error: "forbidden", required: permission });
      return;
    }
    next();
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @zordms/gateway test requirePermission`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/gateway/src/middleware
git commit -m "feat(gateway): requireAuth + requirePermission RBAC middleware"
```

---

## Task 12: Gateway audit helper + login route

**Files:**
- Create: `services/gateway/src/middleware/audit.ts`, `services/gateway/src/routes/auth.ts`
- Modify: `services/gateway/src/app.ts` (mount `/auth`)
- Test: `services/gateway/src/routes/auth.test.ts`

**Interfaces:**
- Consumes: `verifyPassword`, `verifyTotp`, `signToken`, `resolveUserAuthz`.
- Produces:
  - `writeAudit(knex, { actor_id?, actor_username?, action, entity?, entity_id?, details? }): Promise<void>`.
  - `POST /auth/login` body `LoginRequest` → 200 `LoginResponse` on success; if `mfa_enabled` and no/invalid `totp` → 401 `{ mfaRequired: true }`; bad creds → 401; locked → 403. Writes `LOGIN` audit.
  - `GET /auth/me` (requireAuth) → `{ user: AuthUser }`.

- [ ] **Step 1: Write the failing test**

`services/gateway/src/routes/auth.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import knexLib from "knex";
import { buildKnexConfig } from "@zordms/db";
import { loadConfig } from "@zordms/config";
import { createApp } from "../app.js";

const knex = knexLib(buildKnexConfig({
  client: "sqlite3", host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "",
}));
const app = createApp({ knex, config: loadConfig({ JWT_SECRET: "t" } as NodeJS.ProcessEnv) });

beforeAll(async () => { await knex.migrate.latest(); await knex.seed.run(); });
afterAll(async () => { await knex.destroy(); });

describe("POST /auth/login", () => {
  it("logs in the bootstrap admin and returns a token + permissions", async () => {
    const res = await request(app).post("/auth/login").send({ username: "admin", password: "admin123" });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.permissions).toContain("user:create");
  });
  it("rejects wrong password", async () => {
    const res = await request(app).post("/auth/login").send({ username: "admin", password: "wrong" });
    expect(res.status).toBe(401);
  });
  it("writes a LOGIN audit row on success", async () => {
    await request(app).post("/auth/login").send({ username: "admin", password: "admin123" });
    const row = await knex("audit_log").where({ action: "LOGIN" }).first();
    expect(row).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zordms/gateway test routes/auth`
Expected: FAIL — `/auth/login` 404.

- [ ] **Step 3: Write `audit.ts`**

```ts
import type { Knex } from "knex";

export interface AuditEntry {
  actor_id?: number; actor_username?: string; action: string;
  entity?: string; entity_id?: string; details?: string;
}

export async function writeAudit(knex: Knex, e: AuditEntry): Promise<void> {
  await knex("audit_log").insert(e);
}
```

- [ ] **Step 4: Write `routes/auth.ts`**

```ts
import { Router } from "express";
import type { Knex } from "knex";
import type { AppConfig } from "@zordms/config";
import { verifyPassword, verifyTotp, signToken, resolveUserAuthz } from "@zordms/auth";
import type { LoginRequest } from "@zordms/types";
import { writeAudit } from "../middleware/audit.js";
import { requireAuth } from "../middleware/requireAuth.js";

export function authRouter(): Router {
  const r = Router();

  r.post("/login", async (req, res) => {
    const { knex, config } = req.app.locals.deps as { knex: Knex; config: AppConfig };
    const { username, password, totp } = req.body as LoginRequest;
    const user = await knex("users").where({ username }).first();
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      res.status(401).json({ error: "invalid_credentials" }); return;
    }
    if (user.status === "Locked") { res.status(403).json({ error: "account_locked" }); return; }
    if (user.mfa_enabled) {
      if (!totp || !verifyTotp(user.mfa_secret, totp)) {
        res.status(401).json({ mfaRequired: true, error: "mfa_required" }); return;
      }
    }
    const authz = await resolveUserAuthz(knex, user.id);
    const token = signToken({ sub: user.id, username: user.username }, config.jwtSecret);
    await writeAudit(knex, { actor_id: user.id, actor_username: user.username, action: "LOGIN" });
    res.json({
      token,
      user: { id: user.id, username: user.username, roles: authz.roles, permissions: authz.permissions, branch: user.branch, region: user.region },
    });
  });

  r.get("/me", requireAuth, (req, res) => res.json({ user: req.authUser }));

  return r;
}
```

- [ ] **Step 5: Mount the router in `app.ts`**

Add the import and mount (place after `express.json()` and before `/health` is fine):
```ts
import { authRouter } from "./routes/auth.js";
// ...inside createApp, after app.use(express.json());
app.use("/auth", authRouter());
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @zordms/gateway test routes/auth`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add services/gateway/src/middleware/audit.ts services/gateway/src/routes/auth.ts services/gateway/src/app.ts
git commit -m "feat(gateway): login (password+MFA) + /auth/me + audit logging"
```

---

## Task 13: Gateway supervisor user-provisioning routes

**Files:**
- Create: `services/gateway/src/routes/users.ts`
- Modify: `services/gateway/src/app.ts` (mount `/users`)
- Test: `services/gateway/src/routes/users.test.ts`

**Interfaces:**
- Consumes: `requireAuth`, `requirePermission`, `hashPassword`, `resolveUserAuthz`, `writeAudit`.
- Produces (all under `requireAuth`):
  - `GET /users` (`user:read`) → list users with roles.
  - `POST /users` (`user:create`) body `CreateUserRequest` → 201 created user; unlimited (no cap). Writes `USER_CREATE` audit.
  - `POST /users/:id/roles` (`role:assign`) body `{ roles: string[] }` → replaces user's roles.
  - `POST /users/:id/lock` (`user:update`) → toggles status Active↔Locked.

- [ ] **Step 1: Write the failing test**

`services/gateway/src/routes/users.test.ts`:
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

describe("supervisor user provisioning", () => {
  it("creates a new user with a role (no licensing cap)", async () => {
    const res = await request(app).post("/users").set("Authorization", `Bearer ${adminToken}`)
      .send({ username: "maker1", password: "pw123456", full_name: "Maker One", branch: "Thimphu", roles: ["Maker"] });
    expect(res.status).toBe(201);
    expect(res.body.user.username).toBe("maker1");
    const link = await knex("user_roles as ur").join("roles as r", "r.id", "ur.role_id")
      .join("users as u", "u.id", "ur.user_id").where("u.username", "maker1").select("r.name");
    expect(link.map((x: any) => x.name)).toContain("Maker");
  });

  it("forbids creation without user:create permission", async () => {
    const viewer = await knex("users").insert({ username: "v1", password_hash: "x", status: "Active" }).returning("id");
    const vid = typeof viewer[0] === "object" ? (viewer[0] as any).id : viewer[0];
    const viewerRole = await knex("roles").where({ name: "Viewer" }).first();
    await knex("user_roles").insert({ user_id: vid, role_id: viewerRole.id });
    const vToken = signToken({ sub: vid, username: "v1" }, "t");
    const res = await request(app).post("/users").set("Authorization", `Bearer ${vToken}`)
      .send({ username: "x2", password: "pw123456", roles: ["Viewer"] });
    expect(res.status).toBe(403);
  });

  it("locks and unlocks a user", async () => {
    const target = await knex("users").where({ username: "maker1" }).first();
    const res = await request(app).post(`/users/${target.id}/lock`).set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const after = await knex("users").where({ id: target.id }).first();
    expect(after.status).toBe("Locked");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zordms/gateway test routes/users`
Expected: FAIL — `/users` 404.

- [ ] **Step 3: Write `routes/users.ts`**

```ts
import { Router } from "express";
import type { Knex } from "knex";
import { hashPassword } from "@zordms/auth";
import type { CreateUserRequest } from "@zordms/types";
import { requireAuth } from "../middleware/requireAuth.js";
import { requirePermission } from "../middleware/requirePermission.js";
import { writeAudit } from "../middleware/audit.js";

async function setUserRoles(knex: Knex, userId: number, roleNames: string[]): Promise<void> {
  await knex("user_roles").where({ user_id: userId }).del();
  const roles = await knex("roles").whereIn("name", roleNames).select("id");
  for (const r of roles) await knex("user_roles").insert({ user_id: userId, role_id: r.id });
}

export function usersRouter(): Router {
  const r = Router();
  r.use(requireAuth);

  r.get("/", requirePermission("user:read"), async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    const users = await knex("users").select("id", "username", "full_name", "email", "branch", "region", "status", "mfa_enabled");
    res.json({ users });
  });

  r.post("/", requirePermission("user:create"), async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    const body = req.body as CreateUserRequest;
    const exists = await knex("users").where({ username: body.username }).first();
    if (exists) { res.status(409).json({ error: "username_taken" }); return; }
    const [uid] = await knex("users").insert({
      username: body.username,
      password_hash: await hashPassword(body.password),
      full_name: body.full_name, email: body.email, branch: body.branch, region: body.region,
      status: "Active", created_by: req.authUser!.username,
    }).returning("id");
    const userId = typeof uid === "object" ? (uid as any).id : uid;
    await setUserRoles(knex, userId, body.roles ?? []);
    await writeAudit(knex, { actor_id: req.authUser!.id, actor_username: req.authUser!.username, action: "USER_CREATE", entity: "user", entity_id: String(userId) });
    res.status(201).json({ user: { id: userId, username: body.username, roles: body.roles ?? [] } });
  });

  r.post("/:id/roles", requirePermission("role:assign"), async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    await setUserRoles(knex, Number(req.params.id), (req.body.roles as string[]) ?? []);
    await writeAudit(knex, { actor_id: req.authUser!.id, actor_username: req.authUser!.username, action: "USER_ROLES", entity: "user", entity_id: req.params.id });
    res.json({ ok: true });
  });

  r.post("/:id/lock", requirePermission("user:update"), async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    const user = await knex("users").where({ id: req.params.id }).first();
    if (!user) { res.status(404).json({ error: "not_found" }); return; }
    const status = user.status === "Locked" ? "Active" : "Locked";
    await knex("users").where({ id: user.id }).update({ status });
    await writeAudit(knex, { actor_id: req.authUser!.id, actor_username: req.authUser!.username, action: "USER_LOCK", entity: "user", entity_id: req.params.id, details: status });
    res.json({ ok: true, status });
  });

  return r;
}
```

- [ ] **Step 4: Mount in `app.ts`**

```ts
import { usersRouter } from "./routes/users.js";
// inside createApp:
app.use("/users", usersRouter());
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @zordms/gateway test routes/users`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add services/gateway/src/routes/users.ts services/gateway/src/app.ts
git commit -m "feat(gateway): supervisor user provisioning (unlimited, RBAC-gated)"
```

---

## Task 14: Gateway authority-check API (for the future workflow engine)

**Files:**
- Create: `services/gateway/src/routes/authz.ts`
- Modify: `services/gateway/src/app.ts` (mount `/authz`)
- Test: `services/gateway/src/routes/authz.test.ts`

**Interfaces:**
- Produces: `POST /authz/check` body `{ userId: number; permissions: string[] }` → `{ allowed: boolean; missing: string[] }`. This is how the Workflow service (Plan 3) resolves actor authority from RBAC — the single source of truth.

- [ ] **Step 1: Write the failing test**

`services/gateway/src/routes/authz.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import knexLib from "knex";
import { buildKnexConfig } from "@zordms/db";
import { loadConfig } from "@zordms/config";
import { createApp } from "../app.js";

const knex = knexLib(buildKnexConfig({
  client: "sqlite3", host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "",
}));
const app = createApp({ knex, config: loadConfig({ JWT_SECRET: "t" } as NodeJS.ProcessEnv) });

beforeAll(async () => { await knex.migrate.latest(); await knex.seed.run(); });
afterAll(async () => { await knex.destroy(); });

describe("POST /authz/check", () => {
  it("confirms admin may approve documents", async () => {
    const admin = await knex("users").where({ username: "admin" }).first();
    const res = await request(app).post("/authz/check").send({ userId: admin.id, permissions: ["document:approve"] });
    expect(res.status).toBe(200);
    expect(res.body.allowed).toBe(true);
    expect(res.body.missing).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zordms/gateway test routes/authz`
Expected: FAIL — 404.

- [ ] **Step 3: Write `routes/authz.ts`**

```ts
import { Router } from "express";
import type { Knex } from "knex";
import { resolveUserAuthz, canAll } from "@zordms/auth";

export function authzRouter(): Router {
  const r = Router();
  r.post("/check", async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    const { userId, permissions } = req.body as { userId: number; permissions: string[] };
    const authz = await resolveUserAuthz(knex, userId);
    const missing = permissions.filter((p) => !authz.permissions.includes(p));
    res.json({ allowed: canAll(authz, permissions), missing });
  });
  return r;
}
```

- [ ] **Step 4: Mount in `app.ts`**

```ts
import { authzRouter } from "./routes/authz.js";
// inside createApp:
app.use("/authz", authzRouter());
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @zordms/gateway test routes/authz`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add services/gateway/src/routes/authz.ts services/gateway/src/app.ts
git commit -m "feat(gateway): RBAC authority-check API for downstream services"
```

---

## Task 15: React app scaffold (Vite + TS) + theme + auth context

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vite.config.ts`, `apps/web/index.html`, `apps/web/src/main.tsx`, `apps/web/src/theme.css`, `apps/web/src/api/client.ts`, `apps/web/src/auth/AuthContext.tsx`
- Test: `apps/web/src/auth/AuthContext.test.tsx`

**Interfaces:**
- Produces: `api.post/get` helper that attaches the bearer token; `AuthProvider` + `useAuth()` exposing `{ user, login(username,password,totp?), logout() }` storing the token in `localStorage`.

- [ ] **Step 1: Create `apps/web/package.json`**

```json
{
  "name": "@zordms/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --port 5174",
    "build": "tsc -b && vite build",
    "test": "vitest run",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "react": "^18.3.1", "react-dom": "^18.3.1", "react-router-dom": "^6.24.0",
    "@zordms/types": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.4.0", "vite": "^5.3.0", "@vitejs/plugin-react": "^4.3.0",
    "vitest": "^1.6.0", "jsdom": "^24.1.0",
    "@testing-library/react": "^16.0.0", "@testing-library/jest-dom": "^6.4.0",
    "@types/react": "^18.3.0", "@types/react-dom": "^18.3.0"
  }
}
```

- [ ] **Step 2: Create `apps/web/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "jsx": "react-jsx", "lib": ["ES2022", "DOM", "DOM.Iterable"], "rootDir": "src", "noEmit": true },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `apps/web/vite.config.ts`**

```ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: { proxy: { "/auth": "http://localhost:4000", "/users": "http://localhost:4000", "/authz": "http://localhost:4000", "/health": "http://localhost:4000" } },
  test: { environment: "jsdom", globals: true, setupFiles: ["./src/test-setup.ts"] },
});
```

- [ ] **Step 4: Create `apps/web/index.html`, `src/main.tsx`, `src/test-setup.ts`, `src/theme.css`**

`apps/web/index.html`:
```html
<!doctype html>
<html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>ZorDMS</title></head>
<body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>
```

`apps/web/src/test-setup.ts`:
```ts
import "@testing-library/jest-dom";
```

`apps/web/src/theme.css`:
```css
:root{ --navy:#0b2e6b; --navy-deep:#072350; --gold:#e8c96b; --ink:#0f172a; --muted:#64748b; --line:#e2e8f0; --bg:#ffffff; }
*{box-sizing:border-box} body{margin:0;font-family:system-ui,Segoe UI,Roboto,sans-serif;color:var(--ink)}
.btn-primary{background:var(--navy);color:#fff;border:none;border-radius:8px;padding:12px 16px;font-weight:600;cursor:pointer;width:100%}
.btn-primary:disabled{opacity:.6;cursor:not-allowed}
.field{display:block;width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:8px;margin-top:6px}
.label{font-size:13px;color:var(--muted)}
```

`apps/web/src/main.tsx`:
```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import "./theme.css";
import { App } from "./App.js";

ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
```

- [ ] **Step 5: Write the failing test**

`apps/web/src/auth/AuthContext.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { AuthProvider, useAuth } from "./AuthContext.js";

function Probe() {
  const { user, login } = useAuth();
  return <button onClick={() => login("admin", "admin123")}>{user ? user.username : "anon"}</button>;
}

describe("AuthContext", () => {
  beforeEach(() => { localStorage.clear(); });
  it("sets the user after a successful login", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ token: "t", user: { id: 1, username: "admin", roles: ["CDO"], permissions: ["user:create"] } }),
    }) as any;
    render(<AuthProvider><Probe /></AuthProvider>);
    screen.getByText("anon").click();
    await waitFor(() => expect(screen.getByText("admin")).toBeInTheDocument());
    expect(localStorage.getItem("zordms_token")).toBe("t");
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm --filter @zordms/web test`
Expected: FAIL — modules not found.

- [ ] **Step 7: Write `src/api/client.ts`**

```ts
const TOKEN_KEY = "zordms_token";

export function getToken(): string | null { return localStorage.getItem(TOKEN_KEY); }
export function setToken(t: string): void { localStorage.setItem(TOKEN_KEY, t); }
export function clearToken(): void { localStorage.removeItem(TOKEN_KEY); }

async function req(method: string, path: string, body?: unknown): Promise<any> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw Object.assign(new Error("request_failed"), { status: res.status, body: await res.json().catch(() => ({})) });
  return res.json();
}

export const api = {
  get: (p: string) => req("GET", p),
  post: (p: string, b?: unknown) => req("POST", p, b),
};
```

- [ ] **Step 8: Write `src/auth/AuthContext.tsx`**

```tsx
import React, { createContext, useContext, useState, useCallback } from "react";
import type { AuthUser } from "@zordms/types";
import { api, setToken, clearToken } from "../api/client.js";

interface AuthState {
  user: AuthUser | null;
  login: (username: string, password: string, totp?: string) => Promise<void>;
  logout: () => void;
}

const Ctx = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);

  const login = useCallback(async (username: string, password: string, totp?: string) => {
    const res = await api.post("/auth/login", { username, password, totp });
    setToken(res.token);
    setUser(res.user);
  }, []);

  const logout = useCallback(() => { clearToken(); setUser(null); }, []);

  return <Ctx.Provider value={{ user, login, logout }}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used within AuthProvider");
  return c;
}
```

- [ ] **Step 9: Add a minimal `App.tsx` so the test tree builds**

`apps/web/src/App.tsx`:
```tsx
import { AuthProvider } from "./auth/AuthContext.js";

export function App() {
  return <AuthProvider><div>ZorDMS</div></AuthProvider>;
}
```

- [ ] **Step 10: Run test to verify it passes**

Run: `pnpm --filter @zordms/web test`
Expected: PASS.

- [ ] **Step 11: Commit**

```bash
git add apps/web
git commit -m "feat(web): vite+react scaffold, theme tokens, auth context"
```

---

## Task 16: Split-screen carousel Login page

**Files:**
- Create: `apps/web/src/components/Carousel.tsx`, `apps/web/src/pages/Login.tsx`
- Test: `apps/web/src/pages/Login.test.tsx`, `apps/web/src/components/Carousel.test.tsx`

**Interfaces:**
- Consumes: `useAuth().login`.
- Produces:
  - `Carousel({ slides }: { slides: Slide[] })` where `Slide = { icon: string; title: string; body: string }`; renders the active slide + clickable dot indicators; advances on dot click.
  - `Login()` — split-screen: left navy dotted panel with brand lockup + `Carousel`; right sign-in form (username, password, optional MFA field shown after an `mfaRequired` response), "Sign in" button, error text. On submit calls `login`.

- [ ] **Step 1: Write the failing Carousel test**

`apps/web/src/components/Carousel.test.tsx`:
```tsx
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Carousel } from "./Carousel.js";

const slides = [
  { icon: "📄", title: "Capture, classify, index.", body: "Multi-channel capture." },
  { icon: "🧭", title: "Maker–checker workflows.", body: "Approval chains." },
];

describe("Carousel", () => {
  it("shows the first slide and switches on dot click", () => {
    render(<Carousel slides={slides} />);
    expect(screen.getByText("Capture, classify, index.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /slide 2/i }));
    expect(screen.getByText("Maker–checker workflows.")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zordms/web test Carousel`
Expected: FAIL — `./Carousel.js` not found.

- [ ] **Step 3: Write `components/Carousel.tsx`**

```tsx
import { useState } from "react";

export interface Slide { icon: string; title: string; body: string; }

export function Carousel({ slides }: { slides: Slide[] }) {
  const [i, setI] = useState(0);
  const s = slides[i];
  return (
    <div style={{ position: "absolute", bottom: 48, left: 48, right: 48, color: "#fff" }}>
      <div style={{ width: 44, height: 44, display: "grid", placeItems: "center", background: "rgba(255,255,255,.12)", borderRadius: 10, fontSize: 20 }}>{s.icon}</div>
      <h1 style={{ fontSize: 30, margin: "20px 0 10px" }}>{s.title}</h1>
      <p style={{ maxWidth: 420, opacity: .8, lineHeight: 1.5 }}>{s.body}</p>
      <div style={{ display: "flex", gap: 8, marginTop: 24 }}>
        {slides.map((_, idx) => (
          <button key={idx} aria-label={`slide ${idx + 1}`} onClick={() => setI(idx)}
            style={{ width: idx === i ? 26 : 8, height: 8, borderRadius: 4, border: "none", cursor: "pointer", background: idx === i ? "#fff" : "rgba(255,255,255,.4)" }} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run Carousel test to verify it passes**

Run: `pnpm --filter @zordms/web test Carousel`
Expected: PASS.

- [ ] **Step 5: Write the failing Login test**

`apps/web/src/pages/Login.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { AuthProvider } from "../auth/AuthContext.js";
import { Login } from "./Login.js";

describe("Login", () => {
  it("renders split-screen with carousel and signs in", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ token: "t", user: { id: 1, username: "admin", roles: ["CDO"], permissions: [] } }),
    }) as any;
    render(<AuthProvider><Login /></AuthProvider>);
    expect(screen.getByText(/Sign in/i)).toBeInTheDocument();
    expect(screen.getByText(/Capture, classify, index\./i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Username/i), { target: { value: "admin" } });
    fireEvent.change(screen.getByLabelText(/Password/i), { target: { value: "admin123" } });
    fireEvent.click(screen.getByRole("button", { name: /^Sign in$/i }));
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith("/auth/login", expect.anything()));
  });
});
```

- [ ] **Step 6: Run Login test to verify it fails**

Run: `pnpm --filter @zordms/web test Login`
Expected: FAIL — `./Login.js` not found.

- [ ] **Step 7: Write `pages/Login.tsx`**

```tsx
import { useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthContext.js";
import { Carousel, type Slide } from "../components/Carousel.js";

const SLIDES: Slide[] = [
  { icon: "📄", title: "Capture, classify, index.", body: "Multi-channel capture from branch scanners, mobile, email, and portal — OCR and AI classification in one pipeline." },
  { icon: "🧭", title: "Maker–checker workflows.", body: "Configurable approval chains with full audit, escalation, and step-up authentication for high-risk documents." },
  { icon: "🔍", title: "Enterprise search across branches.", body: "Full-text across OCR, metadata, and customer records — results scoped by branch, role, and risk band." },
];

export function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [mfa, setMfa] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      await login(username, password, mfa ? totp : undefined);
    } catch (err: any) {
      if (err?.body?.mfaRequired) { setMfa(true); setError("Enter your authenticator code."); }
      else setError("Invalid credentials.");
    } finally { setBusy(false); }
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", height: "100vh" }}>
      <div style={{ position: "relative", background: "linear-gradient(160deg,var(--navy),var(--navy-deep))", backgroundImage: "radial-gradient(rgba(255,255,255,.08) 1px, transparent 1px)", backgroundSize: "16px 16px" }}>
        <div style={{ position: "absolute", top: 40, left: 48, color: "#fff", display: "flex", gap: 12, alignItems: "center" }}>
          <div style={{ width: 34, height: 34, background: "var(--gold)", borderRadius: 8, display: "grid", placeItems: "center", color: "var(--navy-deep)", fontWeight: 700 }}>Z</div>
          <div><div style={{ fontWeight: 700 }}>ZorDMS</div><div style={{ fontSize: 12, opacity: .7 }}>Enterprise Document Management</div></div>
        </div>
        <Carousel slides={SLIDES} />
      </div>

      <div style={{ display: "grid", placeItems: "center", padding: 24 }}>
        <form onSubmit={onSubmit} style={{ width: 360 }}>
          <div style={{ width: 40, height: 40, background: "var(--navy)", borderRadius: 10, display: "grid", placeItems: "center", color: "#fff", marginBottom: 24 }}>🛡️</div>
          <h2 style={{ margin: "0 0 4px" }}>Sign in</h2>
          <p style={{ color: "var(--muted)", marginTop: 0 }}>Document operations for authorised staff only</p>

          <label className="label" htmlFor="username">Username</label>
          <input id="username" className="field" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="your.username" />

          <label className="label" htmlFor="password" style={{ marginTop: 14, display: "block" }}>Password</label>
          <input id="password" className="field" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />

          {mfa && (<>
            <label className="label" htmlFor="totp" style={{ marginTop: 14, display: "block" }}>Authenticator code</label>
            <input id="totp" className="field" value={totp} onChange={(e) => setTotp(e.target.value)} placeholder="123456" />
          </>)}

          {error && <p style={{ color: "#b91c1c", fontSize: 13 }}>{error}</p>}
          <button className="btn-primary" disabled={busy} style={{ marginTop: 18 }}>{busy ? "…" : "Sign in"}</button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 8: Run Login test to verify it passes**

Run: `pnpm --filter @zordms/web test Login`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/components/Carousel.tsx apps/web/src/components/Carousel.test.tsx apps/web/src/pages/Login.tsx apps/web/src/pages/Login.test.tsx
git commit -m "feat(web): split-screen carousel login page"
```

---

## Task 17: Router + protected routes + supervisor User-Management screen

**Files:**
- Create: `apps/web/src/components/ProtectedRoute.tsx`, `apps/web/src/pages/Users.tsx`, `apps/web/src/router.tsx`
- Modify: `apps/web/src/App.tsx` (use router)
- Test: `apps/web/src/pages/Users.test.tsx`

**Interfaces:**
- Consumes: `useAuth`, `api`.
- Produces:
  - `ProtectedRoute({ children, permission? })` — redirects to `/login` if no user; renders "Not authorised" if `permission` set and the user lacks it.
  - `Users()` — lists users (`GET /users`), and a create form (username, password, role select) that calls `POST /users`; only usable with `user:create`.
  - `router.tsx` wiring `/login`, `/users`, and a default redirect.

- [ ] **Step 1: Write the failing Users test**

`apps/web/src/pages/Users.test.tsx`:
```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { Users } from "./Users.js";

vi.mock("../auth/AuthContext.js", () => ({
  useAuth: () => ({ user: { id: 1, username: "admin", roles: ["CDO"], permissions: ["user:read", "user:create"] }, logout: () => {} }),
}));

describe("Users screen", () => {
  it("lists users fetched from the API", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ users: [{ id: 1, username: "admin", status: "Active" }, { id: 2, username: "maker1", status: "Active" }] }),
    }) as any;
    render(<Users />);
    await waitFor(() => expect(screen.getByText("maker1")).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @zordms/web test Users`
Expected: FAIL — `./Users.js` not found.

- [ ] **Step 3: Write `components/ProtectedRoute.tsx`**

```tsx
import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext.js";

export function ProtectedRoute({ children, permission }: { children: ReactNode; permission?: string }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (permission && !user.permissions.includes(permission)) return <div style={{ padding: 40 }}>Not authorised.</div>;
  return <>{children}</>;
}
```

- [ ] **Step 4: Write `pages/Users.tsx`**

```tsx
import { useEffect, useState, type FormEvent } from "react";
import { useAuth } from "../auth/AuthContext.js";
import { api } from "../api/client.js";

interface Row { id: number; username: string; full_name?: string; branch?: string; status: string; }
const ROLES = ["CDO", "Supervisor", "Maker", "Checker", "Indexer", "Viewer", "Auditor"];

export function Users() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Row[]>([]);
  const [form, setForm] = useState({ username: "", password: "", role: "Maker" });
  const canCreate = user?.permissions.includes("user:create");

  async function refresh() { setRows((await api.get("/users")).users); }
  useEffect(() => { refresh(); }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    await api.post("/users", { username: form.username, password: form.password, roles: [form.role] });
    setForm({ username: "", password: "", role: "Maker" });
    await refresh();
  }

  return (
    <div style={{ padding: 32 }}>
      <h2>User Management</h2>
      <p style={{ color: "var(--muted)" }}>Supervisors can add an unlimited number of users — access is governed by RBAC.</p>
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 16 }}>
        <thead><tr><th style={{ textAlign: "left", padding: 8 }}>User</th><th style={{ textAlign: "left", padding: 8 }}>Branch</th><th style={{ textAlign: "left", padding: 8 }}>Status</th></tr></thead>
        <tbody>{rows.map((r) => (<tr key={r.id} style={{ borderTop: "1px solid var(--line)" }}><td style={{ padding: 8 }}>{r.username}</td><td style={{ padding: 8 }}>{r.branch ?? "—"}</td><td style={{ padding: 8 }}>{r.status}</td></tr>))}</tbody>
      </table>

      {canCreate && (
        <form onSubmit={create} style={{ marginTop: 24, display: "flex", gap: 8, flexWrap: "wrap", maxWidth: 640 }}>
          <input className="field" style={{ width: 180 }} placeholder="username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
          <input className="field" style={{ width: 180 }} type="password" placeholder="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <select className="field" style={{ width: 160 }} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select>
          <button className="btn-primary" style={{ width: 140 }}>Add user</button>
        </form>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Write `router.tsx` and update `App.tsx`**

`apps/web/src/router.tsx`:
```tsx
import { createBrowserRouter, Navigate } from "react-router-dom";
import { Login } from "./pages/Login.js";
import { Users } from "./pages/Users.js";
import { ProtectedRoute } from "./components/ProtectedRoute.js";

export const router = createBrowserRouter([
  { path: "/login", element: <Login /> },
  { path: "/users", element: <ProtectedRoute permission="user:read"><Users /></ProtectedRoute> },
  { path: "*", element: <Navigate to="/users" replace /> },
]);
```

`apps/web/src/App.tsx` (replace contents):
```tsx
import { RouterProvider } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext.js";
import { router } from "./router.js";

export function App() {
  return <AuthProvider><RouterProvider router={router} /></AuthProvider>;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @zordms/web test`
Expected: PASS (all web tests).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/ProtectedRoute.tsx apps/web/src/pages/Users.tsx apps/web/src/router.tsx apps/web/src/App.tsx apps/web/src/pages/Users.test.tsx
git commit -m "feat(web): protected routing + supervisor user-management screen"
```

---

## Task 18: End-to-end smoke + CI matrix (PG + Oracle migrations)

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `docs/RUNBOOK-foundation.md`

**Interfaces:**
- Produces: a CI workflow running `pnpm test` (sqlite-backed) plus a migration job that applies Knex migrations against a Postgres service and (best-effort) Oracle XE, proving dialect compatibility.

- [ ] **Step 1: Write the CI workflow**

`.github/workflows/ci.yml`:
```yaml
name: ci
on: [push, pull_request]
jobs:
  unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - run: pnpm test

  migrations-postgres:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env: { POSTGRES_USER: zordms, POSTGRES_PASSWORD: zordms, POSTGRES_DB: zordms }
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U zordms" --health-interval 5s --health-timeout 5s --health-retries 10
    env:
      DB_CLIENT: pg
      DB_HOST: localhost
      DB_PORT: "5432"
      DB_USER: zordms
      DB_PASSWORD: zordms
      DB_NAME: zordms
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @zordms/db build
      - run: node packages/db/dist/cli.js migrate
      - run: node packages/db/dist/cli.js seed
```

- [ ] **Step 2: Write the runbook**

`docs/RUNBOOK-foundation.md`:
```markdown
# ZorDMS Foundation — Run & Verify

## Local (Postgres)
1. `cp .env.example .env` and set `DB_CLIENT=pg` + Postgres creds.
2. `pnpm install && pnpm build`
3. `node packages/db/dist/cli.js migrate && node packages/db/dist/cli.js seed`
4. `pnpm --filter @zordms/gateway dev`   # gateway on :4000
5. `pnpm --filter @zordms/web dev`       # web on :5174
6. Open http://localhost:5174 → log in with `admin` / `admin123`.

## Switch to Oracle 19c
Set `DB_CLIENT=oracledb`, `DB_USER`, `DB_PASSWORD`, `DB_ORACLE_CONNECT_STRING=host:1521/PDB`.
Re-run migrate + seed. No code changes.

## Tests
`pnpm test` runs all unit/integration suites against in-memory SQLite.
```

- [ ] **Step 3: Verify the whole suite passes locally**

Run: `pnpm install && pnpm build && pnpm test`
Expected: all package/service/web test suites PASS.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml docs/RUNBOOK-foundation.md
git commit -m "ci: unit suite + PG migration matrix; add foundation runbook"
```

---

## Self-Review

**Spec coverage (Plan 1 portion of the spec):**
- Monorepo (pnpm+turbo), `packages/{config,db,auth,types}`, `services/gateway`, `apps/web` → Tasks 1–17. ✓
- PostgreSQL⇄Oracle switch via env (Knex), SQLite test backend → Tasks 3, 18. ✓
- RBAC backbone: data-driven roles + `resource:action` perms, 3-layer enforcement → Tasks 4, 8, 11, 17. ✓
- No licensing; supervisor provisions unlimited users → Task 13 (no cap) + Users screen Task 17. ✓
- Login split-screen carousel (matches reference) → Task 16. ✓
- MFA (TOTP), real bcrypt, real JWT (no mocks) → Tasks 6, 7, 9, 12. ✓
- Workflow authority sourced from RBAC → Task 14 `/authz/check` (consumed by Plan 3). ✓
- Audit logging on privileged actions → Tasks 12, 13. ✓
- Deferred to later plans (correctly out of scope here): documents/repository/capture (Plan 2), workflow engine (Plan 3), notifications (Plan 4), search (Plan 5), integrations (Plan 6), AI/OCR (Plan 7), enterprise screens (Plan 8).

**Placeholder scan:** No TBD/TODO; every code step contains complete code; every test step has real assertions. ✓

**Type consistency:** `AuthUser`/`LoginRequest`/`CreateUserRequest` defined in Task 5 are used unchanged in Tasks 12, 13, 15. `resolveUserAuthz`/`can`/`canAll` defined in Task 8 are used in Tasks 11, 12, 14. `buildKnexConfig` signature (Task 3) used identically across all DB-backed tests. `signToken`/`verifyToken` (Task 9) used in Tasks 11, 12. ✓

---

## Notes for later plans
- Plan 2+ services reuse `@zordms/db`, `@zordms/auth` (`requireAuth`, `requirePermission`), and call Gateway `/authz/check` for cross-service authority.
- When adding `connect-redis` session store and Elasticsearch, extend `@zordms/config`.
- Replace bootstrap `admin/admin123` with a forced password reset before any real deployment.
