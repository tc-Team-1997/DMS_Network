import type { Knex } from "knex";
import type { AppConfig } from "@zordms/config";

import type { SearchBackend } from "./SearchBackend.js";
import { SqlSearchBackend } from "./SqlSearchBackend.js";
import { EsSearchBackend } from "./EsSearchBackend.js";

export function selectBackend(config: AppConfig, knex: Knex): SearchBackend {
  // Check process.env.SEARCH_BACKEND at runtime first, then config (allows env override in tests)
  const backend = process.env.SEARCH_BACKEND ?? config.search?.backend;
  if (backend === "es" || backend === "elasticsearch") {
    return new EsSearchBackend({
      node: config.search?.esNode ?? process.env.ES_NODE ?? "http://localhost:9200",
      index: config.search?.esIndex ?? process.env.ES_INDEX ?? "zordms-documents",
    });
  }
  return new SqlSearchBackend(knex);
}

export { SqlSearchBackend, EsSearchBackend };
