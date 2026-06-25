# ZorDMS — local Elasticsearch harness

Single-node **Elasticsearch 8** (security disabled, plain HTTP on `:9200`) for
running the search service against a real ES engine on a developer laptop.

> DEV ONLY. Security/TLS are off. Do not use this compose file in any
> shared/UAT/prod environment.

The search service is **env-selectable**: `SEARCH_BACKEND=sql` (default) keeps
the zero-infra SQL backend; `SEARCH_BACKEND=elasticsearch` switches to ES. If ES
is unreachable at boot the service logs a warning and **falls back to SQL**, so
dev never breaks.

---

## 1. Start Elasticsearch

```bash
docker compose -f deploy/es-local/docker-compose.yml up -d

# wait until the node is healthy
curl -s http://localhost:9200/_cluster/health | jq .status   # -> "green" or "yellow"
```

Validate the compose file without starting anything:

```bash
docker compose -f deploy/es-local/docker-compose.yml config
```

## 2. Point the search service at ES and (re)start it

From the repo root:

```bash
SEARCH_BACKEND=elasticsearch ELASTICSEARCH_NODE=http://localhost:9200 ./restart.sh
```

Env vars (see `.env.example`):

| Var                   | Default                  | Meaning                                  |
| --------------------- | ------------------------ | ---------------------------------------- |
| `SEARCH_BACKEND`      | `sql`                    | `sql` or `elasticsearch` (alias `es`)    |
| `ELASTICSEARCH_NODE`  | `http://localhost:9200`  | ES node URL                              |
| `ELASTICSEARCH_INDEX` | `zordms-documents`       | ES index name                            |

On boot with ES selected, the service:

1. pings ES and **ensures the index exists** with an explicit mapping
   (text fields analyzed; `doc_type`/`branch`/`status`/`risk_band` etc. as
   `keyword` for exact filters + facet aggregations);
2. **backfills** the existing `search_index` corpus into ES so an empty cluster
   is populated from the data the seeds already loaded.

Confirm which backend is live:

```bash
curl -s http://localhost:4004/health    # -> { "status": "ok", "backend": "es" }
```

## 3. Reindex on demand (admin)

`POST /admin/reindex` with an **empty body** backfills from the local corpus
(use this to repopulate an empty ES). An admin (`admin:access`) bearer token is
required.

```bash
curl -s -X POST http://localhost:4004/admin/reindex \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'                                  # -> { "reindexed": N }
```

You can also push explicit docs: `-d '{"docs":[ ... ]}'`.

## 4. Run a search

```bash
curl -s -X POST http://localhost:4004/search \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"text":"loan","mode":"fulltext"}' | jq .
```

The response shape is identical to the SQL backend — `hits[]` (with `snippet`
from ES highlight), `total`, `page`, `pageSize`, `tookMs`, and `facets`
(`doc_type` / `status` / `branch` / `risk_band`) as `{ value, count }`. A viewer
without cross-branch rights only sees documents in their own branch.

## 5. Falling back to SQL when ES is down

Stop ES and restart the service with ES still selected:

```bash
docker compose -f deploy/es-local/docker-compose.yml down
SEARCH_BACKEND=elasticsearch ./restart.sh
```

The boot log shows:

```
[search] Elasticsearch UNREACHABLE at http://localhost:9200 (...). Falling back to SQL backend so the service still boots.
```

and `/health` reports `"backend": "sql"`. The service keeps working.

## 6. Teardown

```bash
docker compose -f deploy/es-local/docker-compose.yml down          # keep data
docker compose -f deploy/es-local/docker-compose.yml down -v       # wipe the volume
```
