import { createApp } from "./app.js";
import { getServiceKnex } from "./db.js";
import { loadConfig } from "@zordms/config";

const config = loadConfig();
const knex = getServiceKnex();
await knex.migrate.latest();
await knex.seed.run();
const app = createApp({ knex, config });
const port = Number(process.env.SEARCH_PORT ?? 4004);
app.listen(port, () => console.log(`ZorDMS search on :${port}`));
