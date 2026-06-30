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
import { signToken, resolveUserAuthz } from "@zordms/auth";
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

export async function makeTestApp(opts?: { storage?: StorageBackend }): Promise<TestHarness> {
  const knex = buildServiceKnex({
    migrationsDir,
    seedsDir,
    db: { client: "sqlite3", host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "" },
  });
  await knex.migrate.latest();
  await knex.seed.run();

  const root = await mkdtemp(join(tmpdir(), "zordms-core-"));
  const storage = opts?.storage ?? LocalStorage(root);
  const events = InMemoryEventBus();
  const config = loadConfig({ JWT_SECRET: "t" } as NodeJS.ProcessEnv);
  const app = createApp({ knex, config, storage, events });

  return {
    app, knex, storage, events,
    async tokenFor(username: string): Promise<string> {
      const u = await knex("users").where({ username }).first();
      // Resolve permissions from DB so the token carries full RBAC claims
      const authz = await resolveUserAuthz(knex, u.id);
      return signToken({
        sub: u.id,
        username: u.username,
        roles: authz.roles,
        permissions: authz.permissions,
        branch: u.branch ?? undefined,
        region: u.region ?? undefined,
      }, "t");
    },
    async cleanup() {
      await knex.destroy();
      await rm(root, { recursive: true, force: true });
    },
  };
}
