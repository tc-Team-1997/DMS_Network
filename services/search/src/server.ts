import { createApp } from "./app.js";
import { getServiceKnex } from "./db.js";
import { loadConfig } from "@zordms/config";
import { selectBackendWithFallback } from "./backend/index.js";
import { startIndexConsumer } from "./consumer/indexConsumer.js";
import { reindexFromCorpus } from "./reindex.js";

const config = loadConfig();
const knex = getServiceKnex();
await knex.migrate.latest();
await knex.seed.run();

// Build the backend with a graceful fallback: if ES is requested but unreachable
// at boot, we log a warning and fall back to SQL so the service still boots.
const backend = await selectBackendWithFallback(config, knex);

// Boot-time backfill: when the Elasticsearch backend is active, stream the
// existing search corpus into ES so an empty cluster is populated from the SQL
// search_index data the seeds already loaded.
if (backend.name === "es") {
  try {
    const { indexed } = await reindexFromCorpus(knex, backend);
    console.log(`[search] backfilled ${indexed} documents into Elasticsearch`);
  } catch (e) {
    console.error("[search] boot-time ES backfill failed", e);
  }
}

const app = createApp({ knex, config, backend });
await startIndexConsumer({ knex, backend }).catch((e) => console.error("consumer start failed", e));
const port = Number(process.env.SEARCH_PORT ?? 4004);
app.listen(port, () => console.log(`ZorDMS search (${backend.name}) on :${port}`));
