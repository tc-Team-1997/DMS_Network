import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import { buildServiceKnex } from "@zordms/db";
import { loadConfig } from "@zordms/config";
import { createApp } from "./app.js";
import { ChannelRegistry } from "./channels/registry.js";
import { InMemoryBus } from "./bus/fake.js";
import { RealtimeHub } from "./realtime/hub.js";

const migrationsDir = new URL("./migrations", import.meta.url).pathname;
const seedsDir = new URL("./seeds", import.meta.url).pathname;
const db = { client: "sqlite3" as const, host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "" };
const knex = buildServiceKnex({ migrationsDir, seedsDir, db });
const app = createApp({
  knex,
  config: loadConfig({ JWT_SECRET: "t" } as NodeJS.ProcessEnv),
  registry: new ChannelRegistry(),
  bus: new InMemoryBus(),
  hub: new RealtimeHub(),
});

beforeAll(async () => { await knex.migrate.latest(); });
afterAll(async () => { await knex.destroy(); });

describe("notify health", () => {
  it("GET /health returns ok for the notify service", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.service).toBe("notify");
  });
});
