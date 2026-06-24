import { describe, it, expect, beforeAll, afterAll } from "vitest";
import knexLib from "knex";
import { fileURLToPath } from "node:url";
import { buildServiceKnex } from "@zordms/db";
import { reindexAll } from "./reindex.js";

// Use the search service's own migration directory for a sqlite test DB
const migrationsDir = fileURLToPath(new URL("./migrations", import.meta.url));
const seedsDir = fileURLToPath(new URL("./seeds", import.meta.url));

// Build a separate core-like knex just against the identity_rbac + a minimal documents table
// Actually, reindexAll reads "documents" table — we'll create it inline in sqlite.
const knex = knexLib({
  client: "sqlite3",
  connection: { filename: ":memory:" },
  useNullAsDefault: true,
  migrations: { directory: migrationsDir },
  seeds: { directory: seedsDir },
});

beforeAll(async () => {
  // Create a minimal documents table for the reindex test
  await knex.schema.createTable("documents", (t) => {
    t.increments("id").primary();
    t.string("doc_type", 60);
    t.string("branch", 120);
    t.string("status", 20).notNullable().defaultTo("Active");
    t.string("ingest_user_id", 100);
    t.timestamp("ingest_timestamp").defaultTo(knex.fn.now());
  });
});
afterAll(async () => { await knex.destroy(); });

function memBackend() {
  const docs: any[] = [];
  return {
    indexed: docs,
    index: async (d: any) => { docs.push(d); },
    bulkIndex: async (ds: any[]) => { for (const d of ds) docs.push(d); },
    search: async () => ({ hits: [], total: 0, page: 1, pageSize: 20, tookMs: 0 }),
    delete: async () => {},
    reindexAll: async (ds: any[]) => { docs.length = 0; for (const d of ds) docs.push(d); return ds.length; },
    get name() { return "sql" as const; },
  };
}

describe("reindexAll", () => {
  it("streams every document into the backend", async () => {
    await knex("documents").insert({ doc_type: "LETTER", branch: "THI001", status: "Indexed", ingest_user_id: "admin" });
    await knex("documents").insert({ doc_type: "SAR_REPORT", branch: "THI001", status: "Indexed", ingest_user_id: "admin" });
    const be = memBackend();
    const result = await reindexAll(knex, be as any);
    expect(result.indexed).toBe(2);
    expect(be.indexed.map((d) => d.doc_type)).toEqual(expect.arrayContaining(["LETTER", "SAR_REPORT"]));
  });

  it("skips Deleted documents", async () => {
    await knex("documents").insert({ doc_type: "OLD_FORM", branch: "THI001", status: "Deleted", ingest_user_id: "admin" });
    const be = memBackend();
    const result = await reindexAll(knex, be as any);
    expect(be.indexed.every((d) => d.status !== "Deleted")).toBe(true);
    expect(result.indexed).toBe(2); // only the 2 non-deleted
  });
});
