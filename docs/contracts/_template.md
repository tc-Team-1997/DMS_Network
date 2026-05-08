# Contract — <feature>

> Copy this file to `docs/contracts/<feature>.md` at the start of every feature slice.
> It is the single source of truth that SPA / Node / Python / DB / QA engineers work against in parallel.
> Edit in place when the wire shape drifts — don't duplicate.

## Header

| Field | Value |
| --- | --- |
| Feature | `<feature>` |
| Owner | `<lead name / agent>` |
| Status | `draft` / `in-progress` / `shipped` |
| Contract published | `YYYY-MM-DD` |
| Last updated | `YYYY-MM-DD` |

## 1. Python routes — `/api/v1/<feature>/*`

Owner: `python-engineer`. File: `python-service/app/routers/<feature>.py` + `python-service/app/services/<feature>.py`.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/v1/<feature>/` | `require_api_key` | List |
| `GET` | `/api/v1/<feature>/{id}` | `require_api_key` | Read |
| `POST` | `/api/v1/<feature>/` | `require_api_key` + JWT(role≥`maker`) | Create |
| `PATCH` | `/api/v1/<feature>/{id}` | `require_api_key` + JWT(role≥`maker`) | Update |

### Request / response shapes

```jsonc
// POST /api/v1/<feature>/  — request
{
  "name": "string",
  "notes": "string | null"
}

// POST /api/v1/<feature>/  — response 201
{
  "id": "uuid",
  "name": "string",
  "notes": "string | null",
  "created_at": "ISO-8601"
}
```

## 2. Node SPA mirrors — `/spa/api/<feature>/*`

Owner: `node-engineer`. File: `routes/spa-api/<feature>.js`, mounted from `server.js`.

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| `GET` | `/spa/api/<feature>` | session | Proxies list + adds branch scope |
| `POST` | `/spa/api/<feature>` | session | Proxies create; injects `X-API-Key` |

Divergence from Python shape (if any): **none** by default. Note deviations here.

## 3. SPA zod schemas

Owner: `spa-engineer`. File: `apps/web/src/modules/<feature>/schemas.ts` + `api.ts`.

```ts
import { z } from "zod";

export const <Feature>Item = z.object({
  id: z.string().uuid(),
  name: z.string(),
  notes: z.string().nullable(),
  created_at: z.string(),
});
export type <Feature>Item = z.infer<typeof <Feature>Item>;

export const <Feature>List = z.object({
  items: z.array(<Feature>Item),
  total: z.number().int().nonnegative(),
});

export const Create<Feature>Input = z.object({
  name: z.string().min(1).max(200),
  notes: z.string().max(2000).nullable().optional(),
});
```

## 4. DB shape

Owner: `db-migrator`. Files: `db/schema.sql` (Node SQLite), `python-service/app/models.py` + a new Alembic revision.

```sql
CREATE TABLE <feature> (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  notes TEXT,
  branch TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_<feature>_branch ON <feature>(branch);
```

- Searchable columns to add to `documents_fts` (if any): _none_.
- Seed rows: add to `db/seed.js` so a fresh clone renders ≥1 row.

## 5. Test checklist

| Layer | File | Owner |
| --- | --- | --- |
| Pytest | `python-service/tests/test_<feature>.py` | `python-engineer` |
| Playwright happy path | `apps/web/e2e/<feature>.spec.ts` | `qa-engineer` |
| Playwright edge cases (mocked) | `apps/web/e2e/<feature>.errors.spec.ts` | `qa-engineer` |
| Seed smoke | `node db/seed.js` yields ≥1 visible row | `db-migrator` |

## 6. Done criteria

- [ ] `cd python-service && pytest -q` green
- [ ] `cd apps/web && npm run typecheck` green
- [ ] `cd apps/web && npx playwright test e2e/<feature>.spec.ts` green against live `./start.sh`
- [ ] One-line entry added to `docs/README.md` changelog: `YYYY-MM-DD — <feature> — <one-line summary>`
