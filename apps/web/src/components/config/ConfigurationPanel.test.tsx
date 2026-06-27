import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { ConfigurationPanel } from "./ConfigurationPanel.js";

const SETTINGS = {
  defaultRetentionYears: 7,
  branches: ["Thimphu HQ", "Paro"],
  aiConfidenceThreshold: 0.7,
  autoFolderRouting: true,
};

function makeFetch() {
  return vi.fn((url: string, options?: RequestInit) => {
    const u = String(url);
    if (u.endsWith("/admin/settings")) {
      if ((options?.method ?? "GET") === "PUT") {
        const body = options?.body ? JSON.parse(String(options.body)) : {};
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ settings: { ...SETTINGS, ...body } }) });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ settings: SETTINGS }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  });
}

beforeEach(() => {
  globalThis.fetch = makeFetch() as unknown as typeof fetch;
  globalThis.localStorage?.setItem?.("zordms_token", "t");
});

describe("ConfigurationPanel", () => {
  it("loads and displays current settings", async () => {
    render(<ConfigurationPanel canWrite />);
    await waitFor(() => expect(screen.getByText("Platform Configuration")).toBeInTheDocument());
    expect(screen.getByDisplayValue("7")).toBeInTheDocument();
    expect(screen.getByDisplayValue("0.7")).toBeInTheDocument();
    expect((screen.getByDisplayValue(/Thimphu HQ/) as HTMLTextAreaElement).value).toContain("Paro");
  });

  it("saves a configuration update via PUT", async () => {
    render(<ConfigurationPanel canWrite />);
    await waitFor(() => expect(screen.getByText("Save configuration")).toBeInTheDocument());
    await act(async () => { fireEvent.click(screen.getByText("Save configuration")); });
    await waitFor(() => {
      const put = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.some(
        (c: unknown[]) => String(c[0]).endsWith("/admin/settings") && (c[1] as RequestInit)?.method === "PUT",
      );
      expect(put).toBe(true);
    });
    await waitFor(() => expect(screen.getByText("Configuration saved.")).toBeInTheDocument());
  });

  it("hides the save button when not writable", async () => {
    render(<ConfigurationPanel canWrite={false} />);
    await waitFor(() => expect(screen.getByText("Platform Configuration")).toBeInTheDocument());
    expect(screen.queryByText("Save configuration")).not.toBeInTheDocument();
  });
});
