/**
 * Micro-level unit tests for searchApi — URL building via the shared http
 * helper + SVC config, and the exportCsv blob path with its own fetch.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("./client.js", () => ({ getToken: () => "search-tok" }));

import { searchApi, type SearchQuery } from "./searchApi.js";

function mockFetch(resp: Partial<Response> & { json?: () => Promise<unknown>; blob?: () => Promise<Blob> }) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({}),
    ...resp,
  } as Response);
}

const Q: SearchQuery = { text: "loan", mode: "boolean", page: 1, pageSize: 10 };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("searchApi paths", () => {
  it("query() POSTs the SearchQuery to /svc/search/search", async () => {
    const spy = mockFetch({ json: async () => ({ hits: [], total: 0 }) });
    await searchApi.query(Q);
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("/svc/search/search");
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual(Q);
    expect(((init as RequestInit).headers as Record<string, string>).Authorization)
      .toBe("Bearer search-tok");
  });

  it("facets() GETs /svc/search/facets", async () => {
    const spy = mockFetch({ json: async () => ({ facets: {} }) });
    await searchApi.facets();
    expect(spy.mock.calls[0][0]).toBe("/svc/search/facets");
    expect((spy.mock.calls[0][1] as RequestInit).method).toBe("GET");
  });

  it("saveSearch() POSTs name/query/visibility to /saved", async () => {
    const spy = mockFetch({ json: async () => ({}) });
    await searchApi.saveSearch("My Q", Q, "private");
    expect(spy.mock.calls[0][0]).toBe("/svc/search/saved");
    expect(JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      name: "My Q", query: Q, visibility: "private",
    });
  });

  it("runSaved() POSTs to /saved/:id/run", async () => {
    const spy = mockFetch({ json: async () => ({ hits: [] }) });
    await searchApi.runSaved("abc");
    expect(spy.mock.calls[0][0]).toBe("/svc/search/saved/abc/run");
    expect((spy.mock.calls[0][1] as RequestInit).method).toBe("POST");
  });
});

describe("searchApi.exportCsv", () => {
  it("POSTs to /search/export.csv and returns the blob", async () => {
    const blob = new Blob(["a,b\n1,2"], { type: "text/csv" });
    const spy = mockFetch({ blob: async () => blob });
    const out = await searchApi.exportCsv(Q);
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("/svc/search/search/export.csv");
    expect((init as RequestInit).method).toBe("POST");
    expect(((init as RequestInit).headers as Record<string, string>).Authorization)
      .toBe("Bearer search-tok");
    expect(out).toBe(blob);
  });

  it("throws an error carrying status on a non-ok export", async () => {
    mockFetch({ ok: false, status: 500, blob: async () => new Blob() });
    await expect(searchApi.exportCsv(Q)).rejects.toMatchObject({
      message: "HTTP 500",
      status: 500,
    });
  });
});
