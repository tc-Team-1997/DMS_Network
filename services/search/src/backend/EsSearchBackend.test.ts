import { describe, it, expect } from "vitest";
import { EsSearchBackend } from "./EsSearchBackend.js";

describe("EsSearchBackend (Phase-2 stub)", () => {
  const es = new EsSearchBackend();

  it("reports the es backend name", () => {
    expect(es.name).toBe("es");
  });

  it("throws es_backend_not_enabled until Phase 2 wires a client", async () => {
    await expect(es.search({ text: "x", mode: "fulltext" }, { crossBranch: true })).rejects.toThrow(/es_backend_not_enabled/);
    await expect(es.index({} as any)).rejects.toThrow(/es_backend_not_enabled/);
  });
});
