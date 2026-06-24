import { describe, it, expect } from "vitest";
import { EsSearchBackend } from "./EsSearchBackend.js";
import type { EsClient } from "./EsSearchBackend.js";

function fakeClient(): EsClient & { store: any[] } {
  const store: any[] = [];
  return {
    store,
    index: async (args: any) => { store.push({ ...args.document, _id: args.id }); return { result: "created" }; },
    search: async (_args: any) => ({
      hits: {
        hits: store.map((d, i) => ({
          _id: d._id ?? d.doc_id,
          _score: 10 - i,
          _source: d,
          highlight: { ocr_text: [d.ocr_text ?? ""] },
        })),
      },
    }),
    delete: async (_args: any) => ({ result: "deleted" }),
    indices: {
      delete: async () => ({ acknowledged: true }),
      create: async () => ({ acknowledged: true }),
    },
  };
}

describe("EsSearchBackend (Phase-2 stub — no client)", () => {
  const es = new EsSearchBackend();

  it("reports the es backend name", () => {
    expect(es.name).toBe("es");
  });

  it("throws es_backend_not_enabled until a client is provided", async () => {
    await expect(es.search({ text: "x", mode: "fulltext" }, { crossBranch: true })).rejects.toThrow(/es_backend_not_enabled/);
    await expect(es.index({} as any)).rejects.toThrow(/es_backend_not_enabled/);
  });
});

describe("EsSearchBackend (injected fake client)", () => {
  it("indexes documents and returns scored hits", async () => {
    const client = fakeClient();
    const be = new EsSearchBackend({ index: "zordms-documents", client });
    await be.index({ doc_id: "1", doc_type: "LETTER", branch: "THI001", status: "Active", ocr_text: "loan application", metadata_text: "", risk_band: "low", legal_hold: false, expiry_status: "none", uploaded_by: "admin", indexed_at: new Date().toISOString() });
    await be.index({ doc_id: "2", doc_type: "SAR_REPORT", branch: "THI001", status: "Active", ocr_text: "suspicious activity", metadata_text: "", risk_band: "high", legal_hold: false, expiry_status: "none", uploaded_by: "admin", indexed_at: new Date().toISOString() });
    const results = await be.search({ text: "loan", mode: "fulltext" }, { crossBranch: true });
    expect(results.hits.length).toBeGreaterThanOrEqual(1);
  });

  it("clear recreates the index", async () => {
    const client = fakeClient();
    const be = new EsSearchBackend({ index: "zordms-documents", client });
    await expect(be.clear()).resolves.toBeUndefined();
  });

  it("bulkIndex and reindexAll work end-to-end", async () => {
    const client = fakeClient();
    const be = new EsSearchBackend({ index: "zordms-documents", client });
    const docs = [
      { doc_id: "a", doc_type: "LETTER", branch: "THI001", status: "Active", ocr_text: "hello", metadata_text: "", risk_band: "low", legal_hold: false, expiry_status: "none", uploaded_by: "admin", indexed_at: new Date().toISOString() },
      { doc_id: "b", doc_type: "FORM", branch: "PAR002", status: "Active", ocr_text: "world", metadata_text: "", risk_band: "low", legal_hold: false, expiry_status: "none", uploaded_by: "admin", indexed_at: new Date().toISOString() },
    ];
    const count = await be.reindexAll(docs);
    expect(count).toBe(2);
  });
});
