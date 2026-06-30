import { createApp } from "./app.js";
import { getServiceKnex } from "./db.js";
import { loadConfig } from "@zordms/config";
import { createStorage } from "./storage/index.js";
import { createEventBus } from "./events/index.js";
import { createWorker } from "./worker/index.js";
import { startDisposalScan } from "./jobs/disposalScan.js";

const config = loadConfig();
const knex = getServiceKnex();
await knex.migrate.latest();
await knex.seed.run();

const storage = await createStorage({
  storageDriver: process.env.STORAGE_DRIVER === "s3" ? "s3" : "local",
  localRoot: process.env.STORAGE_LOCAL_ROOT ?? "./.storage",
  s3Bucket: process.env.S3_BUCKET,
  s3Endpoint: process.env.S3_ENDPOINT,
  s3Region: process.env.S3_REGION,
  s3AccessKey: process.env.S3_ACCESS_KEY,
  s3SecretKey: process.env.S3_SECRET_KEY,
});
const events = await createEventBus({
  driver: process.env.EVENT_BUS,
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  kafkaBrokers: process.env.KAFKA_BROKERS?.split(",").map((b) => b.trim()).filter(Boolean),
  kafkaTopic: process.env.KAFKA_TOPIC,
});

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

  // P9: start the scheduled disposal-eligibility scan. Guarded by the same env
  // checks so tests/CI never spawn the background timer (START_WORKER=0 disables).
  startDisposalScan(deps);
  console.log("ZorDMS disposal scan started");
}
