import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import knexLib from "knex";
import { buildServiceKnex } from "@zordms/db";
import { SqlSearchBackend } from "./SqlSearchBackend.js";
import { selectBackend } from "./index.js";
import { loadConfig } from "@zordms/config";
import type { SearchDoc } from "@zordms/types";

const migrationsDir = new URL("../migrations", import.meta.url).pathname;
const db = { client: "sqlite3" as const, host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "" };
const knex = buildServiceKnex({ migrationsDir, db });
const backend = new SqlSearchBackend(knex);

function doc(over: Partial<SearchDoc>): SearchDoc {
  return {
    doc_id: "D1", ocr_text: "Loan application for Dorji", metadata_text: "Customer Dorji, Thimphu",
    doc_type: "BOB_LOAN_APPLICATION", branch: "Thimphu", status: "indexed", risk_band: "low",
    legal_hold: false, expiry_status: "none", uploaded_by: "maker1", indexed_at: "2026-06-23T00:00:00Z", ...over,
  };
}

beforeAll(async () => { await knex.migrate.latest(); });
afterAll(async () => { await knex.destroy(); });
beforeEach(async () => { await knex("search_index").del(); });

describe("SqlSearchBackend", () => {
  it("indexes and finds a document by full text, scoped to crossbranch", async () => {
    await backend.index(doc({}));
    const res = await backend.search({ text: "dorji", mode: "fulltext" }, { crossBranch: true });
    expect(res.total).toBe(1);
    expect(res.hits[0].doc_id).toBe("D1");
    expect(res.hits[0].score).toBeGreaterThan(0);
    expect(res.tookMs).toBeGreaterThanOrEqual(0);
  });

  it("re-indexing the same doc_id upserts rather than duplicating", async () => {
    await backend.index(doc({}));
    await backend.index(doc({ status: "approved" }));
    const all = await knex("search_index").where({ doc_id: "D1" });
    expect(all.length).toBe(1);
    expect(all[0].status).toBe("approved");
  });

  it("scopes out other branches when crossBranch is false", async () => {
    await backend.index(doc({ doc_id: "D1", branch: "Thimphu" }));
    await backend.index(doc({ doc_id: "D2", branch: "Paro" }));
    const res = await backend.search({ text: "dorji", mode: "fulltext" }, { crossBranch: false, branch: "Paro" });
    expect(res.hits.map((h) => h.doc_id)).toEqual(["D2"]);
  });

  it("applies facet filters and returns facet counts", async () => {
    await backend.index(doc({ doc_id: "D1", doc_type: "BOB_LOAN_APPLICATION" }));
    await backend.index(doc({ doc_id: "D2", doc_type: "BT_CID_4G", ocr_text: "Dorji CID" }));
    const res = await backend.search({ text: "dorji", mode: "fulltext", filters: { doc_type: "BT_CID_4G" } }, { crossBranch: true });
    expect(res.hits.map((h) => h.doc_id)).toEqual(["D2"]);
    expect(res.facets!.doc_type.length).toBeGreaterThan(0);
  });

  it("filters by indexed_at date range (date_from/date_to)", async () => {
    await backend.index(doc({ doc_id: "OLD", ocr_text: "shared term", indexed_at: "2026-01-10T00:00:00Z" }));
    await backend.index(doc({ doc_id: "MID", ocr_text: "shared term", indexed_at: "2026-06-15T09:00:00Z" }));
    await backend.index(doc({ doc_id: "NEW", ocr_text: "shared term", indexed_at: "2026-09-20T00:00:00Z" }));
    const res = await backend.search(
      { text: "shared", mode: "fulltext", filters: { date_from: "2026-06-01", date_to: "2026-06-30" } },
      { crossBranch: true },
    );
    expect(res.hits.map((h) => h.doc_id)).toEqual(["MID"]);
    expect(res.total).toBe(1);
  });

  it("date_to is inclusive of the whole day (end-of-day boundary)", async () => {
    // A document indexed later on the `to` day must still match a bare-day bound.
    await backend.index(doc({ doc_id: "LATE", ocr_text: "shared term", indexed_at: "2026-06-27T18:30:00Z" }));
    const res = await backend.search(
      { text: "shared", mode: "fulltext", filters: { date_from: "2026-06-27", date_to: "2026-06-27" } },
      { crossBranch: true },
    );
    expect(res.hits.map((h) => h.doc_id)).toEqual(["LATE"]);
  });

  it("paginates results", async () => {
    for (let i = 0; i < 25; i++) await backend.index(doc({ doc_id: `D${i}`, ocr_text: "shared term" }));
    const page1 = await backend.search({ text: "shared", mode: "fulltext", page: 1, pageSize: 10 }, { crossBranch: true });
    expect(page1.hits.length).toBe(10);
    expect(page1.total).toBe(25);
    const page3 = await backend.search({ text: "shared", mode: "fulltext", page: 3, pageSize: 10 }, { crossBranch: true });
    expect(page3.hits.length).toBe(5);
  });

  it("deletes a document from the index", async () => {
    await backend.index(doc({}));
    await backend.delete("D1");
    const res = await backend.search({ text: "dorji", mode: "fulltext" }, { crossBranch: true });
    expect(res.total).toBe(0);
  });

  it("reindexAll replaces the whole index", async () => {
    await backend.index(doc({ doc_id: "OLD" }));
    const n = await backend.reindexAll([doc({ doc_id: "N1" }), doc({ doc_id: "N2" })]);
    expect(n).toBe(2);
    const rows = await knex("search_index").pluck("doc_id");
    expect(rows.sort()).toEqual(["N1", "N2"]);
  });
});

describe("selectBackend", () => {
  it("returns the SQL backend by default", () => {
    delete process.env.SEARCH_BACKEND;
    expect(selectBackend(loadConfig({} as NodeJS.ProcessEnv), knex).name).toBe("sql");
  });
  it("returns the ES backend when SEARCH_BACKEND=es", () => {
    process.env.SEARCH_BACKEND = "es";
    expect(selectBackend(loadConfig({} as NodeJS.ProcessEnv), knex).name).toBe("es");
    delete process.env.SEARCH_BACKEND;
  });
});
