import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Reports } from "./Reports.js";

vi.mock("../auth/AuthContext.js", () => ({
  useAuth: () => ({
    user: { id: 1, username: "admin", roles: ["CDO"], permissions: ["admin:access"] },
    logout: () => {},
  }),
}));
vi.mock("../api/client.js", () => ({ getToken: () => "t", handleUnauthorized: () => {} }));

const SOURCES = [
  { source: "documents", groupable: ["doc_type", "branch", "status"], numeric: ["confidence"] },
  { source: "jobs", groupable: ["type", "status"], numeric: ["attempts"] },
];
const LIBRARY = [
  { id: "d1", name: "By type", description: null, source: "documents", groupBy: ["doc_type"], measures: [{ fn: "count", alias: "count" }], filters: {}, createdBy: "system", createdAt: "2026-06-29" },
];
const RUN = { columns: ["doc_type", "count"], rows: [{ doc_type: "BT_CID_4G", count: 7 }, { doc_type: "BT_PASSPORT", count: 8 }] };

function routeBody(url: string) {
  if (url.includes("/reports/sources")) return { sources: SOURCES };
  if (url.includes("/reports/library")) return { reports: LIBRARY };
  if (url.includes("/reports/run")) return RUN;
  return {};
}

function renderPage() {
  return render(<MemoryRouter><Reports /></MemoryRouter>);
}

describe("Reports screen", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("loads sources + library; runs a report and renders the result table", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string) => ({ ok: true, json: async () => routeBody(url) }));
    globalThis.fetch = fetchMock as any;

    renderPage();
    // library row from API
    await waitFor(() => expect(screen.getByText("By type")).toBeInTheDocument());
    // source columns rendered as checkboxes
    await waitFor(() => expect(screen.getByLabelText("group by doc_type")).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText("group by doc_type"));
    fireEvent.click(screen.getByRole("button", { name: "Run" })); // builder button (saved-row buttons are "run <name>")

    await waitFor(() => {
      const runCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("/reports/run"));
      expect(runCall).toBeTruthy();
      expect(JSON.parse(runCall![1].body).group_by).toContain("doc_type");
    });
    // result table renders backend rows
    await waitFor(() => expect(screen.getByText("BT_CID_4G")).toBeInTheDocument());
  });

  it("saves a report definition (POST /reports/library)", async () => {
    const fetchMock = vi.fn().mockImplementation(async (url: string, opts: any) => {
      if (String(url).includes("/reports/library") && opts?.method === "POST") return { ok: true, json: async () => ({ report: LIBRARY[0] }) };
      return { ok: true, json: async () => routeBody(String(url)) };
    });
    globalThis.fetch = fetchMock as any;

    renderPage();
    await waitFor(() => expect(screen.getByLabelText("group by branch")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("report name"), { target: { value: "My report" } });
    fireEvent.click(screen.getByLabelText("save report"));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => String(c[0]).includes("/reports/library") && c[1]?.method === "POST");
      expect(post).toBeTruthy();
      expect(JSON.parse(post![1].body).name).toBe("My report");
    });
  });
});
