import http from "node:http";
import { createApp } from "./app.js";
import { getServiceKnex } from "./db.js";
import { loadConfig } from "@zordms/config";
import { buildRegistry } from "./channels/registry.js";
import { InMemoryBus } from "./bus/fake.js";
import { RealtimeHub } from "./realtime/hub.js";
import { attachConsumer } from "./services/consumer.js";

const config = loadConfig();
const knex = getServiceKnex();
await knex.migrate.latest();
await knex.seed.run();

const hub = new RealtimeHub();
const bus = new InMemoryBus();
const registry = await buildRegistry({ knex, config, hub });
const app = createApp({ knex, config, registry, bus, hub });

attachConsumer({ knex, registry, hub, bus });

const port = Number(process.env.NOTIFY_PORT ?? 4003);
const httpServer = http.createServer(app);
hub.attach(httpServer);
httpServer.listen(port, () => console.log(`ZorDMS notify on :${port}`));
