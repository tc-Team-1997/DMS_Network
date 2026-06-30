import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MasterSetup } from "./MasterSetup.js";

vi.mock("../auth/AuthContext.js", () => ({
  useAuth: () => ({
    user: { id: 1, username: "admin", roles: ["CDO"], permissions: ["admin:access"] },
    logout: () => {},
  }),
}));
vi.mock("../api/client.js", () => ({ getToken: () => "t", handleUnauthorized: () => {} }));

const DEPTS = [
  { id: "d1", code: "OPS", name: "Operations", parentId: null, head: null, branch: null, status: "Active", createdAt: "2026-06-30" },
  { id: "d2", code: "RETAIL", name: "Retail Banking", parentId: null, head: "pema", branch: "THM-HQ", status: "Active", createdAt: "2026-06-30" },
];

function renderPage() {
  return render(<MemoryRouter><MasterSetup /></MemoryRouter>);
}

describe("Master Setup screen", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("lists departments from the API", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ departments: DEPTS }) }) as any;
    renderPage();
    await waitFor(() => expect(screen.getByText("Operations")).toBeInTheDocument());
    expect(screen.getByText("Retail Banking")).toBeInTheDocument();
  });

  it("POSTs a new department", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ departments: DEPTS }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ department: { id: "d3", code: "TRADE", name: "Trade Finance", parentId: null, head: null, branch: null, status: "Active", createdAt: "" } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ departments: DEPTS }) });
    globalThis.fetch = fetchMock as any;

    renderPage();
    await waitFor(() => expect(screen.getByText("Operations")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("code"), { target: { value: "TRADE" } });
    fireEvent.change(screen.getByLabelText("name"), { target: { value: "Trade Finance" } });
    fireEvent.click(screen.getByText("Add department"));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
      expect(post).toBeTruthy();
      expect(String(post![0])).toContain("/departments");
      const body = JSON.parse(post![1].body);
      expect(body.code).toBe("TRADE");
      expect(body.name).toBe("Trade Finance");
    });
  });
});
