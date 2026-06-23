import { createApp } from "./app.js";
import { getServiceKnex } from "./db.js";
import { loadConfig } from "@zordms/config";
import { createAuthorityClient } from "./authority.js";
import { createEventBus } from "./events.js";
import { startSlaCron } from "./jobs/slaWorker.js";

const config = loadConfig();
const knex = getServiceKnex();
await knex.migrate.latest();
await knex.seed.run();

const gatewayUrl = process.env.GATEWAY_URL ?? "http://localhost:4000";
const events = createEventBus();

const app = createApp({
  knex,
  config,
  authority: createAuthorityClient({
    gatewayUrl,
    internalServiceToken: config.internalServiceToken,
  }),
  events,
});

startSlaCron({ knex, events });

const port = Number(process.env.WORKFLOW_PORT ?? 4002);
app.listen(port, () => console.log(`ZorDMS workflow on :${port}`));
