import { createApp } from "./app.js";
import { getKnex } from "@zordms/db";
import { loadConfig } from "@zordms/config";

const config = loadConfig();
const knex = getKnex();
await knex.migrate.latest();
await knex.seed.run();
const app = createApp({ knex, config });
app.listen(config.gatewayPort, () => console.log(`ZorDMS gateway on :${config.gatewayPort}`));
