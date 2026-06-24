import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { DocumentLifecycle } from "./DocumentLifecycle.js";

/* ─── ResizeObserver polyfill (recharts needs it in jsdom) ─── */
beforeAll(() => {
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class ResizeObserver {
      observe()    { /* noop */ }
      unobserve()  { /* noop */ }
      disconnect() { /* noop */ }
    } as unknown as typeof ResizeObserver;
  }
});

vi.mock("react-router-dom", () => ({
  useParams: () => ({ docId: "9" }),
}));

vi.mock("../auth/AuthContext.js", () => ({
  useAuth: () => ({
    user: {
      id: 1,
      username: "admin",
      roles: ["CDO"],
      permissions: ["document:read", "lifecycle:read"],
    },
    logout: () => {},
  }),
}));

const MOCK_TRACE = {
  document_id: 9,
  doc_no: "L9",
  doc_type: "LETTER",
  stages: [
    { stage: "capture", at: "2026-06-01T08:00:00Z", actor: "admin", complete: true },
    { stage: "index", at: "2026-06-02T09:00:00Z", actor: "admin", complete: true },
    { stage: "workflow", at: null, actor: undefined, complete: false },
    { stage: "archive", at: null, actor: undefined, complete: false },
    { stage: "disposal", at: null, actor: undefined, complete: false },
  ],
  versions: [
    {
      version_no: 1,
      file_hash_sha256: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
      created_by: "admin",
      created_at: "2026-06-01T08:00:00Z",
    },
  ],
  funnel: { capture: 5, index: 4, workflow: 2, archive: 1, disposal: 0 },
};

describe("DocumentLifecycle screen", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn((url: string) => {
      if (String(url).includes("/lifecycle/9")) {
        return Promise.resolve({ ok: true, json: async () => ({ trace: MOCK_TRACE }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ documents: [] }) });
    }) as any;
  });

  it("renders the document type after loading", async () => {
    render(<DocumentLifecycle />);
    await waitFor(() => {
      const matches = screen.getAllByText(/LETTER/);
      expect(matches.length).toBeGreaterThan(0);
    });
  });

  it("renders the document number", async () => {
    render(<DocumentLifecycle />);
    await waitFor(() => {
      const matches = screen.getAllByText("L9");
      expect(matches.length).toBeGreaterThan(0);
    });
  });

  it("renders stage names in the trace", async () => {
    render(<DocumentLifecycle />);
    await waitFor(() => {
      const captures = screen.getAllByText(/Capture/i);
      expect(captures.length).toBeGreaterThan(0);
    });
  });

  it("shows version v1 label after switching to Versions tab", async () => {
    render(<DocumentLifecycle />);
    // Wait for trace to load
    await waitFor(() => {
      const matches = screen.getAllByText(/LETTER/);
      expect(matches.length).toBeGreaterThan(0);
    });
    // Click the Version Control tab
    const versionTab = screen.getByRole("button", { name: /version control/i });
    versionTab.click();
    await waitFor(() => {
      const v1 = screen.getAllByText(/v1/i);
      expect(v1.length).toBeGreaterThan(0);
    });
  });

  it("renders the pipeline funnel numbers", async () => {
    render(<DocumentLifecycle />);
    await waitFor(() => {
      // funnel capture=5 should appear in the pipeline bar area
      const fives = screen.getAllByText("5");
      expect(fives.length).toBeGreaterThan(0);
    });
  });

  it("calls the lifecycle endpoint with the docId from route params", async () => {
    render(<DocumentLifecycle />);
    await waitFor(() => {
      const matches = screen.getAllByText(/LETTER/);
      expect(matches.length).toBeGreaterThan(0);
    });
    const calls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => String(c[0])
    );
    expect(calls.some((u) => u.includes("/lifecycle/9"))).toBe(true);
  });
});
