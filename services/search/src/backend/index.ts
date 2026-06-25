import type { Knex } from "knex";
import type { AppConfig } from "@zordms/config";

import type { SearchBackend } from "./SearchBackend.js";
import { SqlSearchBackend } from "./SqlSearchBackend.js";
import { EsSearchBackend } from "./EsSearchBackend.js";
import { ElasticsearchBackend } from "./ElasticsearchBackend.js";

function esRequested(config: AppConfig): boolean {
  const backend = process.env.SEARCH_BACKEND ?? config.search?.backend;
  return backend === "es" || backend === "elasticsearch";
}

/**
 * Synchronous selection (kept for callers/tests that don't need the live ping).
 * Returns an ElasticsearchBackend when SEARCH_BACKEND=elasticsearch|es, else SQL.
 * NOTE: prefer `selectBackendWithFallback` at boot — it pings ES and falls back
 * to SQL when ES is unreachable so the service still boots.
 */
export function selectBackend(config: AppConfig, knex: Knex): SearchBackend {
  if (esRequested(config)) {
    return new ElasticsearchBackend({
      node: config.search?.esNode ?? process.env.ELASTICSEARCH_NODE ?? process.env.ES_NODE ?? "http://localhost:9200",
      index: config.search?.esIndex ?? process.env.ELASTICSEARCH_INDEX ?? process.env.ES_INDEX ?? "zordms-documents",
    });
  }
  return new SqlSearchBackend(knex);
}

/**
 * Boot-time selection with GRACEFUL FALLBACK.
 * When ES is requested: build the client, ping it, and ensure the index exists.
 * If the client cannot be constructed OR the ping fails, log a clear warning and
 * fall back to the SQL backend so dev/local never breaks.
 */
export async function selectBackendWithFallback(
  config: AppConfig,
  knex: Knex,
  log: (msg: string) => void = console.warn,
): Promise<SearchBackend> {
  if (!esRequested(config)) {
    return new SqlSearchBackend(knex);
  }

  const node = config.search?.esNode ?? process.env.ELASTICSEARCH_NODE ?? process.env.ES_NODE ?? "http://localhost:9200";
  const index = config.search?.esIndex ?? process.env.ELASTICSEARCH_INDEX ?? process.env.ES_INDEX ?? "zordms-documents";

  try {
    const es = new ElasticsearchBackend({ node, index });
    await es.ping();
    await es.ensureIndex();
    log(`[search] Elasticsearch backend ready at ${node} (index "${index}").`);
    return es;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    log(
      `[search] Elasticsearch UNREACHABLE at ${node} (${reason}). Falling back to SQL backend so the service still boots.`,
    );
    return new SqlSearchBackend(knex);
  }
}

export { SqlSearchBackend, EsSearchBackend, ElasticsearchBackend };
