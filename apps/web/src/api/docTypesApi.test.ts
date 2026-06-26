/**
 * Micro-level unit tests for docTypesApi — URL building from SVC config,
 * header construction, multipart infer-fields, and error unwrapping.
 * fetch + getToken are mocked; no network.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("./client.js", () => ({ getToken: () => "tok-123", handleUnauthorized: () => {} }));

import { docTypesApi } from "./docTypesApi.js";

function mockFetch(resp: Partial<Response> & { json?: () => Promise<unknown> }) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({}),
    ...resp,
  } as Response);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("docTypesApi URL + headers", () => {
  it("list() GETs /svc/core/doc-types with auth + json headers", async () => {
    const spy = mockFetch({ json: async () => ({ docTypes: [], total: 0 }) });
    await docTypesApi.list();
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("/svc/core/doc-types");
    expect((init as RequestInit).method).toBe("GET");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok-123");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("create() POSTs the payload as JSON body", async () => {
    const spy = mockFetch({ status: 201, json: async () => ({ docType: {} }) });
    await docTypesApi.create({ code: "BT_X", description: "X" });
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("/svc/core/doc-types");
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ code: "BT_X", description: "X" });
  });

  it("update() URL-encodes the code in the path", async () => {
    const spy = mockFetch({ json: async () => ({ docType: {} }) });
    await docTypesApi.update("BT/SPACE Y", { description: "z" });
    expect(spy.mock.calls[0][0]).toBe(`/svc/core/doc-types/${encodeURIComponent("BT/SPACE Y")}`);
    expect((spy.mock.calls[0][1] as RequestInit).method).toBe("PUT");
  });

  it("remove() issues a DELETE", async () => {
    const spy = mockFetch({ json: async () => ({ deleted: true, code: "BT_X" }) });
    const out = await docTypesApi.remove("BT_X");
    expect((spy.mock.calls[0][1] as RequestInit).method).toBe("DELETE");
    expect(out).toEqual({ deleted: true, code: "BT_X" });
  });

  it("applyFields() POSTs to /apply-fields with both lists", async () => {
    const spy = mockFetch({ json: async () => ({ docType: {} }) });
    await docTypesApi.applyFields("BT_X", {
      mandatory_fields: [{ name: "cid", mandatory: true }],
      optional_fields: [],
    });
    expect(spy.mock.calls[0][0]).toBe("/svc/core/doc-types/BT_X/apply-fields");
    expect(JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string).mandatory_fields)
      .toEqual([{ name: "cid", mandatory: true }]);
  });

  it("inferFields() posts multipart to /svc/ai/idp/infer-fields without Content-Type", async () => {
    const spy = mockFetch({ json: async () => ({ fields: [], degraded: false }) });
    const file = new File(["x"], "sample.png", { type: "image/png" });
    await docTypesApi.inferFields(file, "passport");
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("/svc/ai/idp/infer-fields");
    const headers = (init as RequestInit).headers as Record<string, string>;
    // multipart: auth present, Content-Type omitted (browser sets boundary)
    expect(headers.Authorization).toBe("Bearer tok-123");
    expect(headers["Content-Type"]).toBeUndefined();
    expect((init as RequestInit).body).toBeInstanceOf(FormData);
    const form = (init as RequestInit).body as FormData;
    expect(form.get("doc_type_hint")).toBe("passport");
  });

  it("inferFields() omits doc_type_hint when not supplied", async () => {
    const spy = mockFetch({ json: async () => ({ fields: [], degraded: false }) });
    await docTypesApi.inferFields(new File(["x"], "s.png", { type: "image/png" }));
    const form = (spy.mock.calls[0][1] as RequestInit).body as FormData;
    expect(form.has("doc_type_hint")).toBe(false);
  });
});

describe("docTypesApi error handling", () => {
  it("throws an Error carrying status + parsed body on non-ok", async () => {
    mockFetch({ ok: false, status: 403, json: async () => ({ error: "forbidden" }) });
    await expect(docTypesApi.list()).rejects.toMatchObject({
      message: "HTTP 403",
      status: 403,
      body: { error: "forbidden" },
    });
  });

  it("tolerates a non-JSON error body (defaults body to {})", async () => {
    mockFetch({
      ok: false,
      status: 500,
      json: async () => { throw new Error("not json"); },
    });
    await expect(docTypesApi.list()).rejects.toMatchObject({ status: 500, body: {} });
  });

  it("returns undefined for 204 No Content", async () => {
    mockFetch({ status: 204, json: async () => ({}) });
    const out = await docTypesApi.remove("BT_X");
    expect(out).toBeUndefined();
  });
});
