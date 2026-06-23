import type { Knex } from "knex";
import type { AppConfig } from "@zordms/config";
import type { StorageBackend } from "./storage/index.js";
import type { EventBus } from "./events/index.js";

export interface CoreDeps {
  knex: Knex;
  config: AppConfig;
  storage: StorageBackend;
  events: EventBus;
}
