import { createApp } from "./app.js";
import { loadConfig } from "@zordms/config";
import { buildServiceKnex } from "@zordms/db";
import { InMemoryEventSink } from "./events/sink.js";
import { selectConnector } from "./connectors/registry.js";
import { CoreIngestClient } from "./core/ingest.js";

const migrationsDir = new URL("./migrations", import.meta.url).pathname;
const seedsDir = new URL("./seeds", import.meta.url).pathname;
const config = loadConfig();
const knex = buildServiceKnex({ migrationsDir, seedsDir, db: config.db });
await knex.migrate.latest();
await knex.seed.run();
const events = new InMemoryEventSink();
// P7: forward verified inbound webhooks to core's internal ingest endpoints.
const coreIngest = new CoreIngestClient({
  coreUrl: process.env.CORE_URL ?? "http://localhost:4001",
  internalServiceToken: config.internalServiceToken,
  timeoutMs: Number(process.env.CORE_INGEST_TIMEOUT_MS ?? 5000),
});
const app = createApp({
  knex,
  config,
  events,
  // P7: pick the live HTTP connector when <SYSTEM>_BASE_URL is set, else the mock.
  connectorFor: (system) => selectConnector(system, { knex }),
  coreIngest,
});
const port = Number(process.env.INTEGRATION_PORT ?? 4005);
app.listen(port, () => console.log(`ZorDMS integration hub on :${port}`));
