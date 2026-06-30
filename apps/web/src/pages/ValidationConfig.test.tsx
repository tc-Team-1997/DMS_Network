import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ValidationConfig } from "./ValidationConfig.js";

vi.mock("../auth/AuthContext.js", () => ({
  useAuth: () => ({
    user: { id: 1, username: "admin", roles: ["CDO"], permissions: ["admin:access"] },
    logout: () => {},
  }),
}));
vi.mock("../api/client.js", () => ({ getToken: () => "t", handleUnauthorized: () => {} }));

const RULES = [
  { id: "r1", docType: "BT_CID_4G", fieldKey: "cid_no", ruleType: "regex", params: { pattern: "^[0-9]{11}$" }, severity: "error", message: null, enabled: true, createdBy: "system", createdAt: "2026-06-29" },
];

function renderPage() {
  return render(<MemoryRouter><ValidationConfig /></MemoryRouter>);
}

describe("Validation Configuration screen", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("lists rules from the API", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ rules: RULES }) }) as any;
    renderPage();
    await waitFor(() => expect(screen.getByText("cid_no")).toBeInTheDocument());
    expect(screen.getByText("BT_CID_4G")).toBeInTheDocument();
  });

  it("POSTs a new rule with JSON-parsed params", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rules: RULES }) })          // initial list
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rule: { ...RULES[0], id: "r2" } }) }) // POST
      .mockResolvedValueOnce({ ok: true, json: async () => ({ rules: RULES }) });         // refresh
    globalThis.fetch = fetchMock as any;

    renderPage();
    await waitFor(() => expect(screen.getByText("cid_no")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("field_key"), { target: { value: "amount" } });
    fireEvent.change(screen.getByLabelText("rule_type"), { target: { value: "range" } });
    fireEvent.change(screen.getByLabelText("params"), { target: { value: '{"min":0,"max":1000000}' } });
    fireEvent.click(screen.getByText("Add rule"));

    await waitFor(() => {
      const post = fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
      expect(post).toBeTruthy();
      const body = JSON.parse(post![1].body);
      expect(body.field_key).toBe("amount");
      expect(body.rule_type).toBe("range");
      expect(body.params).toEqual({ min: 0, max: 1000000 }); // parsed object, not string
    });
  });

  it("rejects malformed params JSON with an inline error (no POST)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ rules: RULES }) });
    globalThis.fetch = fetchMock as any;
    renderPage();
    await waitFor(() => expect(screen.getByText("cid_no")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("field_key"), { target: { value: "x" } });
    fireEvent.change(screen.getByLabelText("params"), { target: { value: "{not json" } });
    fireEvent.click(screen.getByText("Add rule"));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/valid JSON/i));
    expect(fetchMock.mock.calls.some((c) => c[1]?.method === "POST")).toBe(false);
  });
});
