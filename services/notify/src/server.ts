import http from "node:http";
import { createApp } from "./app.js";
import { getServiceKnex } from "./db.js";
import { loadConfig } from "@zordms/config";
import { buildRegistry } from "./channels/registry.js";
import { InMemoryBus } from "./bus/fake.js";
import { RealtimeHub } from "./realtime/hub.js";
import { attachConsumer } from "./services/consumer.js";
import { runExpiryScan } from "./jobs/expiryScan.js";

const config = loadConfig();
const knex = getServiceKnex();
await knex.migrate.latest();
await knex.seed.run();

const hub = new RealtimeHub();
hub.setJwtSecret(config.jwtSecret);
const bus = new InMemoryBus();
const registry = await buildRegistry({ knex, config, hub });
const app = createApp({ knex, config, registry, bus, hub });

attachConsumer({ knex, registry, hub, bus });

// Daily expiry scan: fetch documents nearing expiry from the core table and fire events.
// TODO: Replace with BullMQ repeatable job when the queue is available.
async function runDailyExpiryScan(): Promise<void> {
  try {
    const docs = await knex("documents")
      .whereNotNull("expiry_date")
      .select("id as docId", "doc_type as docType", "expiry_date as expiryDate", "branch")
      .then((rows: Array<{ docId: string; docType: string; expiryDate: string; branch?: string }>) => rows);
    const { scheduled } = await runExpiryScan({ knex, bus }, docs);
    if (scheduled > 0) console.log(`[notify] expiry scan fired ${scheduled} alert(s)`);
  } catch (err) {
    console.error("[notify] expiry scan failed", err);
  }
}

// Run once at boot, then every 24 hours
void runDailyExpiryScan();
setInterval(() => { void runDailyExpiryScan(); }, 24 * 60 * 60 * 1000);

const port = Number(process.env.NOTIFY_PORT ?? 4003);
const httpServer = http.createServer(app);
hub.attach(httpServer);
httpServer.listen(port, () => console.log(`ZorDMS notify on :${port}`));
