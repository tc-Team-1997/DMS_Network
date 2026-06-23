# ZorDMS Foundation — Run & Verify

## Local (Postgres)
1. `cp .env.example .env` and set `DB_CLIENT=pg` + Postgres creds.
2. `pnpm install && pnpm -r build`
3. `node packages/db/dist/cli.js migrate && node packages/db/dist/cli.js seed`
4. `pnpm --filter @zordms/gateway dev`   # gateway on :4000
5. `pnpm --filter @zordms/web dev`       # web on :5174
6. Open http://localhost:5174 → log in with `admin` / `admin123`.

## Switch to Oracle 19c
Set `DB_CLIENT=oracledb`, `DB_USER`, `DB_PASSWORD`, `DB_ORACLE_CONNECT_STRING=host:1521/PDB`.
Re-run migrate + seed. No code changes.

## Tests
`pnpm -r test` runs all unit/integration suites against in-memory SQLite.
