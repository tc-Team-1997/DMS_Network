import { createApp } from "./app.js";
import { getServiceKnex } from "./db.js";
import { loadConfig } from "@zordms/config";

const config = loadConfig();
const knex = getServiceKnex();
await knex.migrate.latest();
await knex.seed.run();
const app = createApp({ knex, config });
const port = Number(process.env.WORKFLOW_PORT ?? 4002);
app.listen(port, () => console.log(`ZorDMS workflow on :${port}`));
