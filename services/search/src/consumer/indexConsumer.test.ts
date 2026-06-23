import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { buildServiceKnex } from "@zordms/db";
import { SqlSearchBackend } from "../backend/SqlSearchBackend.js";
import { handleDocumentEvent } from "./indexConsumer.js";

const migrationsDir = new URL("../migrations", import.meta.url).pathname;
const db = { client: "sqlite3" as const, host: "", port: 0, user: "", password: "", name: "", oracleConnectString: "" };
const knex = buildServiceKnex({ migrationsDir, db });
const backend = new SqlSearchBackend(knex);

beforeAll(async () => { await knex.migrate.latest(); });
afterAll(async () => { await knex.destroy(); });
beforeEach(async () => { await knex("search_index").del(); });

const payload = {
  doc_id: "DOC-7", ocr_text: "Passport for Tashi", metadata_text: "Name: Tashi",
  doc_type: "BT_PASSPORT", branch: "Thimphu", status: "indexed", risk_band: "medium",
  legal_hold: false, expiry_status: "le90", uploaded_by: "indexer1", indexed_at: "2026-06-23T10:00:00Z",
};

describe("handleDocumentEvent", () => {
  it("indexes on document.indexed", async () => {
    await handleDocumentEvent(backend, "document.indexed", payload);
    const res = await backend.search({ text: "tashi", mode: "fulltext" }, { crossBranch: true });
    expect(res.total).toBe(1);
  });

  it("re-indexes (upsert) on document.cataloged", async () => {
    await handleDocumentEvent(backend, "document.indexed", payload);
    await handleDocumentEvent(backend, "document.cataloged", { ...payload, status: "cataloged" });
    const rows = await knex("search_index").where({ doc_id: "DOC-7" });
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe("cataloged");
  });

  it("removes on document.deleted", async () => {
    await handleDocumentEvent(backend, "document.indexed", payload);
    await handleDocumentEvent(backend, "document.deleted", { doc_id: "DOC-7" });
    const res = await backend.search({ text: "tashi", mode: "fulltext" }, { crossBranch: true });
    expect(res.total).toBe(0);
  });
});
