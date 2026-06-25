import { createApp } from "./app.js";
import { getServiceKnex } from "./db.js";
import { loadConfig } from "@zordms/config";
import { LocalStorage } from "./storage/local.js";
import { RedisStreamsEventBus } from "./events/index.js";
import { createWorker } from "./worker/index.js";

const config = loadConfig();
const knex = getServiceKnex();
await knex.migrate.latest();
await knex.seed.run();

const storage = LocalStorage(process.env.STORAGE_LOCAL_ROOT ?? "./.storage");
const events = RedisStreamsEventBus(process.env.REDIS_URL ?? "redis://localhost:6379");

const port = Number(process.env.CORE_PORT ?? 4001);
const deps = { knex, config, storage, events };
const app = createApp(deps);
app.listen(port, () => console.log(`ZorDMS core on :${port}`));

// P8: start the durable-queue worker in boot. Guarded so tests/CI never spawn a
// background poll loop (set START_WORKER=0 to disable in any env).
if (process.env.START_WORKER !== "0" && process.env.NODE_ENV !== "test") {
  const worker = createWorker(deps);
  worker.start();
  console.log("ZorDMS queue worker started");
}
