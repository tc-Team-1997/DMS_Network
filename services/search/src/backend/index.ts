import type { Knex } from "knex";
import type { AppConfig } from "@zordms/config";

import type { SearchBackend } from "./SearchBackend.js";
import { SqlSearchBackend } from "./SqlSearchBackend.js";
import { EsSearchBackend } from "./EsSearchBackend.js";

export function selectBackend(_config: AppConfig, knex: Knex): SearchBackend {
  if (process.env.SEARCH_BACKEND === "es") return new EsSearchBackend();
  return new SqlSearchBackend(knex);
}

export { SqlSearchBackend, EsSearchBackend };
