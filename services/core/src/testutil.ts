import knexLib, { type Knex } from "knex";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Express } from "express";
import { buildServiceKnex } from "@zordms/db";
import { loadConfig } from "@zordms/config";
import { LocalStorage } from "./storage/local.js";
import type { StorageBackend } from "./storage/index.js";
import { InMemoryEventBus, type EventBus, type DomainEvent } from "./events/index.js";
import { signToken } from "@zordms/auth";
import { createApp } from "./app.js";

const migrationsDir = fileURLToPath(new URL("./migrations", import.meta.url));
const seedsDir = fileURLToPath(new URL("./seeds", import.meta.url));

export interface TestHarness {
  app: Express;
  knex: Knex;
  storage: StorageBackend;
  events: EventBus & { events: DomainEvent[] };
  tokenFor: (username: string) => Promise<string>;
  cleanup: () => Promise<void>;
}

export async function makeTestApp(): Promise<TestHarness> {
  const knex = buildServiceKnex({
    migrationsDir,
    seedsDir,
    db: { client: "sqlite3", host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "" },
  });
  await knex.migrate.latest();
  await knex.seed.run();

  const root = await mkdtemp(join(tmpdir(), "zordms-core-"));
  const storage = LocalStorage(root);
  const events = InMemoryEventBus();
  const config = loadConfig({ JWT_SECRET: "t" } as NodeJS.ProcessEnv);
  const app = createApp({ knex, config, storage, events });

  return {
    app, knex, storage, events,
    async tokenFor(username: string): Promise<string> {
      const u = await knex("users").where({ username }).first();
      return signToken({ sub: u.id, username }, "t");
    },
    async cleanup() {
      await knex.destroy();
      await rm(root, { recursive: true, force: true });
    },
  };
}
