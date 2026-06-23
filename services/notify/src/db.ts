import { buildServiceKnex } from "@zordms/db";

const migrationsDir = new URL("./migrations", import.meta.url).pathname;
const seedsDir = new URL("./seeds", import.meta.url).pathname;

export function getServiceKnex() {
  return buildServiceKnex({ migrationsDir, seedsDir });
}
