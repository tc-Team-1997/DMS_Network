import { createApp } from "./app.js";
import { getServiceKnex } from "./db.js";
import { loadConfig } from "@zordms/config";

const config = loadConfig();
const knex = getServiceKnex();
await knex.migrate.latest();
await knex.seed.run();
const app = createApp({ knex, config });
const port = Number(process.env.NOTIFY_PORT ?? 4003);
app.listen(port, () => console.log(`ZorDMS notify on :${port}`));
