# ZorDMS — persistent dev database (Postgres)

The dev stack (`./start.sh`) defaults to **in-memory SQLite** — every restart
wipes all data. This harness gives you a **persistent, production-like Postgres**
so uploads, extractions, workflows, etc. survive restarts.

> Runs on host port **5436** (container 5432) to avoid clashing with any local
> Postgres on :5432/:5435.

---

## Important: db-per-service

ZorDMS is a **microservice db-per-service** design — each Node service runs its
own Knex migrations + seed on boot and owns its own tables. In-memory SQLite
gives each service a *private* database automatically. Postgres does **not**, so
each service must point at its **own database** (otherwise they collide on the
shared `knex_migrations` table → "migration directory is corrupt" / duplicate
sequence errors).

This is wired in each service's `dev` script via a per-service `DB_NAME`:

| Service | Database | Override env |
|---------|----------|--------------|
| gateway | `zordms_gateway` | `DB_NAME_GATEWAY` |
| core | `zordms_core` | `DB_NAME_CORE` |
| workflow | `zordms_workflow` | `DB_NAME_WORKFLOW` |
| notify | `zordms_notify` | `DB_NAME_NOTIFY` |
| search | `zordms_search` | `DB_NAME_SEARCH` |
| integration | `zordms_integration` | `DB_NAME_INTEGRATION` |

(`DB_NAME` is ignored under SQLite, so this is harmless when `DB_CLIENT=sqlite3`.)

---

## 1. Start Postgres

```bash
docker compose -f deploy/dev-db/docker-compose.yml up -d
```

## 2. Create the per-service databases (first time only)

```bash
for db in gateway core workflow notify search integration; do
  docker exec zordms-dev-postgres createdb -U zordms "zordms_$db" 2>/dev/null || true
done
```

## 3. Point .env at it

```bash
DB_CLIENT=pg
DB_HOST=localhost
DB_PORT=5436
DB_USER=zordms
DB_PASSWORD=zordms
# DB_NAME is set per-service by the dev scripts; this is only a fallback.
DB_NAME=zordms_dev
```

## 4. Restart — services migrate + seed on boot

```bash
./restart.sh
# sign in at http://localhost:5174  (admin / admin123)
```

## Inspect / teardown

```bash
# tables + migrations per service DB
docker exec zordms-dev-postgres psql -U zordms -d zordms_core -c "\dt"

docker compose -f deploy/dev-db/docker-compose.yml down       # keep data
docker compose -f deploy/dev-db/docker-compose.yml down -v    # wipe the volume
```

## Back to throwaway SQLite

Set `DB_CLIENT=sqlite3` in `.env` and `./restart.sh` — no container needed.
