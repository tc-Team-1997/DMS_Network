import { describe, it, expect, vi, beforeEach } from "vitest";
import { repositoryViewerApi } from "./repositoryViewerApi.js";

vi.mock("./client.js", () => ({ getToken: () => "t", handleUnauthorized: () => {} }));

describe("repositoryViewerApi.exportDocuments (SC-02)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // jsdom lacks URL.createObjectURL / blob download plumbing — stub them.
    (URL as any).createObjectURL = vi.fn(() => "blob:x");
    (URL as any).revokeObjectURL = vi.fn();
  });

  it("GETs /documents/export with non-empty filters and triggers a download", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(["id,title\n1,x"]) });
    globalThis.fetch = fetchMock as any;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    await repositoryViewerApi.exportDocuments({ status: "Active", type: "" });

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("/documents/export");
    expect(url).toContain("status=Active");
    expect(url).not.toContain("type="); // empty filters dropped
    expect(clickSpy).toHaveBeenCalled();
  });

  it("throws on a non-ok response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: false, status: 403 }) as any;
    await expect(repositoryViewerApi.exportDocuments({})).rejects.toThrow(/403/);
  });
});
