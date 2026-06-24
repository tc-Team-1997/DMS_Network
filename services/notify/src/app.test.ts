import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import express from "express";
import { buildServiceKnex } from "@zordms/db";
import { loadConfig } from "@zordms/config";
import { errorHandler } from "@zordms/auth";
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

// I5: Global error handler — unhandled async exceptions must return 500 JSON, not hang
describe("global error handler", () => {
  it("I5: returns 500 JSON when a route throws an unhandled error", async () => {
    // Build a bare Express app that mirrors createApp's error handler pattern,
    // mounting a crashing route BEFORE the error handler (as Express requires).
    const crashApp = express();
    crashApp.use(express.json());
    // Simulate a route that calls next(err) — the way async routes with try/catch work
    crashApp.get("/crash-test", (_req, _res, next) => {
      next(new Error("boom"));
    });
    // Register the shared error handler from @zordms/auth (same as createApp uses)
    crashApp.use(errorHandler);
    const res = await request(crashApp).get("/crash-test");
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("internal_error");
  });
});
