import { createApp } from "./app.js";
import { loadConfig } from "@zordms/config";
import { buildServiceKnex } from "@zordms/db";
import { InMemoryEventSink } from "./events/sink.js";
import { buildConnector } from "./connectors/registry.js";

const migrationsDir = new URL("./migrations", import.meta.url).pathname;
const seedsDir = new URL("./seeds", import.meta.url).pathname;
const config = loadConfig();
const knex = buildServiceKnex({ migrationsDir, seedsDir, db: config.db });
await knex.migrate.latest();
await knex.seed.run();
const events = new InMemoryEventSink();
const app = createApp({
  knex,
  config,
  events,
  connectorFor: (system) => buildConnector(system, { knex }),
});
const port = Number(process.env.INTEGRATION_PORT ?? 4006);
app.listen(port, () => console.log(`ZorDMS integration hub on :${port}`));
