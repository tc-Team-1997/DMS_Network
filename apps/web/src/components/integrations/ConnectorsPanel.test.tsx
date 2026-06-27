import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { ConnectorsPanel } from "./ConnectorsPanel.js";

const SYSTEMS = {
  systems: [
    { system: "cbs", base_url: null, enabled: true, status: "up", recentErrors: 0 },
    { system: "los", base_url: "https://los.internal", enabled: true, status: "down", recentErrors: 2 },
  ],
};

function makeFetch() {
  return vi.fn((url: string, options?: RequestInit) => {
    const u = String(url);
    const method = (options?.method ?? "GET").toUpperCase();
    if (u.includes("/integration/systems") && u.endsWith("/test")) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ system: "cbs", mode: "mock", baseUrl: null, ok: false, status: 501, error: "unhandled_mock_op" }) });
    }
    if (u.match(/\/integration\/systems\/[^/]+$/) && method === "PUT") {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ system: "cbs", base_url: "https://bancs.test", auth_type: "hmac", enabled: true, hasSecret: true }) });
    }
    if (u.endsWith("/integration/systems")) {
      return Promise.resolve({ ok: true, status: 200, json: async () => SYSTEMS });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  });
}

beforeEach(() => {
  globalThis.fetch = makeFetch() as unknown as typeof fetch;
  globalThis.localStorage?.setItem?.("zordms_token", "t");
});

describe("ConnectorsPanel", () => {
  it("lists connectors with endpoint + status", async () => {
    render(<ConnectorsPanel canWrite />);
    await waitFor(() => expect(screen.getByText("cbs")).toBeInTheDocument());
    expect(screen.getByText("los")).toBeInTheDocument();
    expect(screen.getByText("https://los.internal")).toBeInTheDocument();
    expect(screen.getAllByText("mock").length).toBeGreaterThan(0); // cbs has no base_url
  });

  it("tests a connector and reports mode", async () => {
    render(<ConnectorsPanel canWrite />);
    await waitFor(() => expect(screen.getByText("cbs")).toBeInTheDocument());
    await act(async () => { fireEvent.click(screen.getAllByText("Test")[0]); });
    await waitFor(() => expect(screen.getByText(/mock \(no endpoint configured\)/)).toBeInTheDocument());
  });

  it("opens the configure modal and saves via PUT", async () => {
    render(<ConnectorsPanel canWrite />);
    await waitFor(() => expect(screen.getByText("cbs")).toBeInTheDocument());
    await act(async () => { fireEvent.click(screen.getAllByText("Configure")[0]); });
    expect(screen.getByText(/Configure "cbs"/)).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText(/bancs.bank.internal/), { target: { value: "https://bancs.test" } });
    await act(async () => { fireEvent.click(screen.getByText("Save connector")); });
    await waitFor(() => {
      const put = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.some(
        (c: unknown[]) => /\/integration\/systems\/cbs$/.test(String(c[0])) && (c[1] as RequestInit)?.method === "PUT",
      );
      expect(put).toBe(true);
    });
  });

  it("hides Configure when not writable", async () => {
    render(<ConnectorsPanel canWrite={false} />);
    await waitFor(() => expect(screen.getByText("cbs")).toBeInTheDocument());
    expect(screen.queryByText("Configure")).not.toBeInTheDocument();
    expect(screen.getAllByText("Test").length).toBeGreaterThan(0); // test still available
  });
});
