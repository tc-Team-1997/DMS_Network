import { describe, it, expect, vi } from "vitest";
import { ElasticsearchBackend, INDEX_MAPPING } from "./ElasticsearchBackend.js";
import type { ElasticsearchClientLike, EsSearchResponse } from "./ElasticsearchBackend.js";
import type { SearchDoc } from "@zordms/types";

function baseDoc(over: Partial<SearchDoc> = {}): SearchDoc {
  return {
    doc_id: "D1",
    ocr_text: "loan application form",
    metadata_text: "thimphu loan",
    doc_type: "LETTER",
    branch: "Thimphu",
    status: "Active",
    risk_band: "low",
    legal_hold: false,
    expiry_status: "none",
    uploaded_by: "admin",
    indexed_at: "2026-06-23T00:00:00.000Z",
    ...over,
  };
}

/** Build a fake ES client that records calls and returns a canned search body. */
function fakeClient(searchBody?: EsSearchResponse) {
  const calls: Record<string, unknown[]> = {
    index: [], bulk: [], delete: [], search: [], ping: [],
    "indices.exists": [], "indices.create": [], "indices.delete": [],
  };
  const body: EsSearchResponse =
    searchBody ?? { hits: { total: { value: 0 }, hits: [] }, aggregations: {} };
  const client: ElasticsearchClientLike = {
    ping: async () => { calls.ping.push({}); return {}; },
    index: async (a) => { calls.index.push(a); return { result: "created" }; },
    bulk: async (a) => { calls.bulk.push(a); return { errors: false, items: [] }; },
    delete: async (a) => { calls.delete.push(a); return { result: "deleted" }; },
    search: async (a) => { calls.search.push(a); return body; },
    indices: {
      exists: async (a) => { calls["indices.exists"].push(a); return false; },
      create: async (a) => { calls["indices.create"].push(a); return { acknowledged: true }; },
      delete: async (a) => { calls["indices.delete"].push(a); return { acknowledged: true }; },
    },
  };
  return { client, calls };
}

describe("ElasticsearchBackend.index", () => {
  it("upserts the document with id = doc_id and the mapped fields", async () => {
    const { client, calls } = fakeClient();
    const be = new ElasticsearchBackend({ index: "zordms-documents", client });
    await be.index(baseDoc());
    expect(calls.index).toHaveLength(1);
    const args = calls.index[0] as any;
    expect(args.index).toBe("zordms-documents");
    expect(args.id).toBe("D1");
    expect(args.refresh).toBe(true);
    expect(args.document).toMatchObject({
      doc_id: "D1", doc_type: "LETTER", branch: "Thimphu", status: "Active", risk_band: "low",
      legal_hold: false, ocr_text: "loan application form",
    });
  });

  it("applies defaults for nullish optional fields", async () => {
    const { client, calls } = fakeClient();
    const be = new ElasticsearchBackend({ index: "i", client });
    await be.index(baseDoc({ ocr_text: undefined, risk_band: undefined, expiry_status: undefined } as any));
    const doc = (calls.index[0] as any).document;
    expect(doc.ocr_text).toBe("");
    expect(doc.risk_band).toBe("low");
    expect(doc.expiry_status).toBe("none");
  });
});

describe("ElasticsearchBackend.ensureIndex", () => {
  it("creates the index with the explicit mapping when missing", async () => {
    const { client, calls } = fakeClient();
    const be = new ElasticsearchBackend({ index: "zordms-documents", client });
    await be.ensureIndex();
    expect(calls["indices.create"]).toHaveLength(1);
    const args = calls["indices.create"][0] as any;
    expect(args.mappings).toEqual(INDEX_MAPPING);
    // keyword fields for facets, text for full-text
    expect((INDEX_MAPPING as any).properties.doc_type.type).toBe("keyword");
    expect((INDEX_MAPPING as any).properties.ocr_text.type).toBe("text");
  });

  it("does not create when the index already exists", async () => {
    const { client, calls } = fakeClient();
    client.indices.exists = async () => true;
    const be = new ElasticsearchBackend({ index: "i", client });
    await be.ensureIndex();
    expect(calls["indices.create"]).toHaveLength(0);
  });
});

describe("ElasticsearchBackend.search query building", () => {
  it("builds multi_match + term filters and applies branch scope for a scoped viewer", async () => {
    const { client, calls } = fakeClient();
    const be = new ElasticsearchBackend({ index: "i", client });
    await be.search(
      { text: "loan", mode: "fulltext", filters: { doc_type: "LETTER", status: "Active", risk_band: "low" }, page: 2, pageSize: 10 },
      { branch: "Thimphu", crossBranch: false },
    );
    const args = calls.search[0] as any;
    expect(args.from).toBe(10);   // (page 2 - 1) * 10
    expect(args.size).toBe(10);
    const bool = args.query.bool;
    expect(bool.must[0].multi_match.fields).toEqual(["ocr_text", "metadata_text", "doc_type"]);
    expect(bool.must[0].multi_match.query).toBe("loan");
    // branch scope present because crossBranch=false
    expect(bool.filter).toEqual(expect.arrayContaining([
      { term: { branch: "Thimphu" } },
      { term: { doc_type: "LETTER" } },
      { term: { status: "Active" } },
      { term: { risk_band: "low" } },
    ]));
    // facet aggregations requested for every dimension
    expect(Object.keys(args.aggs).sort()).toEqual(["branch", "doc_type", "risk_band", "status"]);
    expect(args.highlight.fields.ocr_text).toBeDefined();
  });

  it("does NOT add a branch term filter for a cross-branch viewer", async () => {
    const { client, calls } = fakeClient();
    const be = new ElasticsearchBackend({ index: "i", client });
    await be.search({ text: "x", mode: "fulltext" }, { branch: "Thimphu", crossBranch: true });
    const bool = (calls.search[0] as any).query.bool;
    expect(bool.filter.some((f: any) => f.term?.branch)).toBe(false);
  });

  it("uses match_all when text is empty (facets-only / browse)", async () => {
    const { client, calls } = fakeClient();
    const be = new ElasticsearchBackend({ index: "i", client });
    await be.search({ text: "", mode: "fulltext" }, { crossBranch: true });
    const bool = (calls.search[0] as any).query.bool;
    expect(bool.must[0].match_all).toBeDefined();
  });
});

describe("ElasticsearchBackend.search hit + facet parsing", () => {
  it("maps ES hits (with highlight snippet) and parses facets from aggregations", async () => {
    const body: EsSearchResponse = {
      hits: {
        total: { value: 2 },
        hits: [
          {
            _id: "D1", _score: 5.5,
            _source: { doc_id: "D1", doc_type: "LETTER", branch: "Thimphu", status: "Active", ocr_text: "full ocr text", indexed_at: "2026-06-01T00:00:00.000Z" },
            highlight: { ocr_text: ["a <em>loan</em> snippet"] },
          },
          {
            _id: "D2", _score: 1.0,
            _source: { doc_id: "D2", doc_type: "FORM", branch: "Paro", status: "Pending", ocr_text: "other", indexed_at: "2026-06-02T00:00:00.000Z" },
          },
        ],
      },
      aggregations: {
        doc_type: { buckets: [{ key: "LETTER", doc_count: 1 }, { key: "FORM", doc_count: 1 }] },
        status: { buckets: [{ key: "Active", doc_count: 1 }] },
        branch: { buckets: [{ key: "Thimphu", doc_count: 1 }] },
        risk_band: { buckets: [{ key: "low", doc_count: 2 }] },
      },
    };
    const { client } = fakeClient(body);
    const be = new ElasticsearchBackend({ index: "i", client });
    const res = await be.search({ text: "loan", mode: "fulltext" }, { crossBranch: true });

    expect(res.total).toBe(2);
    expect(res.hits).toHaveLength(2);
    expect(res.hits[0]).toMatchObject({ doc_id: "D1", doc_type: "LETTER", branch: "Thimphu", status: "Active", score: 5.5 });
    // snippet comes from the highlight when present
    expect(res.hits[0].snippet).toBe("a <em>loan</em> snippet");
    // hit without highlight falls back to source text
    expect(res.hits[1].snippet).toBe("other");

    // same { value, count } shape as the SQL backend, keyed by dimension
    expect(res.facets).toBeDefined();
    expect(res.facets!.doc_type).toEqual([{ value: "LETTER", count: 1 }, { value: "FORM", count: 1 }]);
    expect(res.facets!.risk_band).toEqual([{ value: "low", count: 2 }]);
    expect(res.facets!.branch).toEqual([{ value: "Thimphu", count: 1 }]);
  });
});

describe("ElasticsearchBackend.reindexAll / bulkIndex / delete", () => {
  it("reindexAll recreates the index then bulk loads docs", async () => {
    const { client, calls } = fakeClient();
    const be = new ElasticsearchBackend({ index: "zordms-documents", client });
    const n = await be.reindexAll([baseDoc({ doc_id: "A" }), baseDoc({ doc_id: "B" })]);
    expect(n).toBe(2);
    expect(calls["indices.delete"]).toHaveLength(1);
    expect(calls["indices.create"]).toHaveLength(1);
    expect(calls.bulk).toHaveLength(1);
    const ops = (calls.bulk[0] as any).operations;
    // index action + document per doc = 4 entries for 2 docs
    expect(ops).toHaveLength(4);
    expect(ops[0]).toEqual({ index: { _index: "zordms-documents", _id: "A" } });
  });

  it("delete removes by id with refresh", async () => {
    const { client, calls } = fakeClient();
    const be = new ElasticsearchBackend({ index: "i", client });
    await be.delete("D9");
    expect(calls.delete[0]).toMatchObject({ index: "i", id: "D9", refresh: true });
  });
});

describe("ElasticsearchBackend.ping", () => {
  it("resolves true when the cluster responds", async () => {
    const { client } = fakeClient();
    const be = new ElasticsearchBackend({ index: "i", client });
    await expect(be.ping()).resolves.toBe(true);
  });

  it("rejects when ping fails", async () => {
    const { client } = fakeClient();
    client.ping = async () => { throw new Error("ECONNREFUSED"); };
    const be = new ElasticsearchBackend({ index: "i", client });
    await expect(be.ping()).rejects.toThrow(/ECONNREFUSED/);
  });
});
