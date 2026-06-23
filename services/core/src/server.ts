import { createApp } from "./app.js";
import { getServiceKnex } from "./db.js";
import { loadConfig } from "@zordms/config";
import { LocalStorage } from "./storage/local.js";
import { RedisStreamsEventBus } from "./events/index.js";

const config = loadConfig();
const knex = getServiceKnex();
await knex.migrate.latest();
await knex.seed.run();

const storage = LocalStorage(process.env.STORAGE_LOCAL_ROOT ?? "./.storage");
const events = RedisStreamsEventBus(process.env.REDIS_URL ?? "redis://localhost:6379");

const port = Number(process.env.CORE_PORT ?? 4001);
const app = createApp({ knex, config, storage, events });
app.listen(port, () => console.log(`ZorDMS core on :${port}`));
