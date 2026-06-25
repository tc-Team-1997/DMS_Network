import { createApp } from "./app.js";
import { getServiceKnex } from "./db.js";
import { loadConfig } from "@zordms/config";
import { selectBackend } from "./backend/index.js";
import { startIndexConsumer } from "./consumer/indexConsumer.js";

const config = loadConfig();
const knex = getServiceKnex();
await knex.migrate.latest();
await knex.seed.run();
const backend = selectBackend(config, knex);
const app = createApp({ knex, config, backend });
await startIndexConsumer({ knex, backend }).catch((e) => console.error("consumer start failed", e));
const port = Number(process.env.SEARCH_PORT ?? 4004);
app.listen(port, () => console.log(`ZorDMS search (${backend.name}) on :${port}`));
