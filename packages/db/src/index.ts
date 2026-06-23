import knexLib, { type Knex } from "knex";
import { loadConfig, type AppConfig } from "@zordms/config";
import { buildKnexConfig } from "./knexConfig.js";

export { buildKnexConfig };

let instance: Knex | undefined;

export function getKnex(db: AppConfig["db"] = loadConfig().db): Knex {
  if (!instance) instance = knexLib(buildKnexConfig(db));
  return instance;
}

export async function destroyKnex(): Promise<void> {
  if (instance) { await instance.destroy(); instance = undefined; }
}

export { buildServiceKnex } from "./serviceKnex.js";
