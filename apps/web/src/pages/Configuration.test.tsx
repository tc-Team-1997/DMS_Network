import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Configuration } from "./Configuration.js";

vi.mock("../auth/AuthContext.js", () => ({
  useAuth: () => ({
    user: { id: 1, username: "admin", roles: ["CDO"], permissions: ["admin:access"] },
    logout: () => {},
  }),
}));
vi.mock("../api/client.js", () => ({ getToken: () => "t", handleUnauthorized: () => {} }));

const ENTRIES = [
  { key: "ai.classification_threshold", value: 0.92, category: "ai", description: "Min confidence", updatedBy: "system", updatedAt: "2026-06-29" },
  { key: "upload.max_file_mb", value: 50, category: "upload", description: "Max upload MB", updatedBy: "system", updatedAt: "2026-06-29" },
];

function renderPage() {
  return render(<MemoryRouter><Configuration /></MemoryRouter>);
}

describe("Configuration screen", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("lists config entries grouped, with values rendered", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ config: ENTRIES }),
    }) as any;
    renderPage();
    await waitFor(() => expect(screen.getByText("ai.classification_threshold")).toBeInTheDocument());
    expect(screen.getByText("upload.max_file_mb")).toBeInTheDocument();
    // category headings
    expect(screen.getByText(/^ai$/i)).toBeInTheDocument();
  });

  it("PUTs the edited (JSON-parsed) value on save", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ config: ENTRIES }) })          // initial list
      .mockResolvedValueOnce({ ok: true, json: async () => ({ config: { ...ENTRIES[0], value: 0.8 } }) }); // PUT
    globalThis.fetch = fetchMock as any;

    renderPage();
    await waitFor(() => expect(screen.getByText("ai.classification_threshold")).toBeInTheDocument());

    const input = screen.getByLabelText("value for ai.classification_threshold") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "0.8" } });
    fireEvent.click(screen.getByLabelText("save ai.classification_threshold"));

    await waitFor(() => {
      const putCall = fetchMock.mock.calls.find((c) => c[1]?.method === "PUT");
      expect(putCall).toBeTruthy();
      expect(putCall![0]).toContain("/config/ai.classification_threshold");
      expect(JSON.parse(putCall![1].body).value).toBe(0.8); // parsed to a number, not "0.8"
    });
  });
});
