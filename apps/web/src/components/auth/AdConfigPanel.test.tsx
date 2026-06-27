import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { AdConfigPanel } from "./AdConfigPanel.js";

const CFG = {
  ldap: {
    enabled: false, displayName: "BOBL Active Directory", url: "", bindDN: "",
    searchBase: "", searchFilter: "(sAMAccountName={{username}})", groupAttr: "memberOf",
    groupRoleMap: {}, hasBindCredentials: false,
  },
  envManaged: false,
};

function makeFetch(envManaged = false) {
  return vi.fn((url: string, options?: RequestInit) => {
    const u = String(url);
    const method = (options?.method ?? "GET").toUpperCase();
    if (u.endsWith("/auth/ad-config") && method === "PUT") {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ldap: { enabled: true, hasBindCredentials: true } }) });
    }
    if (u.endsWith("/auth/ad-config")) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ...CFG, envManaged }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  });
}

beforeEach(() => {
  globalThis.fetch = makeFetch() as unknown as typeof fetch;
  globalThis.localStorage?.setItem?.("zordms_token", "t");
});

describe("AdConfigPanel", () => {
  it("loads and renders the AD form", async () => {
    render(<AdConfigPanel canWrite />);
    await waitFor(() => expect(screen.getByText("Active Directory (LDAP)")).toBeInTheDocument());
    expect(screen.getByPlaceholderText("ldaps://ad.bobl.bt:636")).toBeInTheDocument();
    expect(screen.getByText(/superuser.*always signs in locally/i)).toBeInTheDocument();
  });

  it("saves the configuration via PUT", async () => {
    render(<AdConfigPanel canWrite />);
    await waitFor(() => expect(screen.getByText("Save AD configuration")).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText("ldaps://ad.bobl.bt:636"), { target: { value: "ldaps://ad.test:636" } });
    await act(async () => { fireEvent.click(screen.getByText("Save AD configuration")); });
    await waitFor(() => {
      const put = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.some(
        (c: unknown[]) => String(c[0]).endsWith("/auth/ad-config") && (c[1] as RequestInit)?.method === "PUT",
      );
      expect(put).toBe(true);
    });
    await waitFor(() => expect(screen.getByText(/configuration saved/i)).toBeInTheDocument());
  });

  it("locks the form when AD is env-managed", async () => {
    globalThis.fetch = makeFetch(true) as unknown as typeof fetch;
    render(<AdConfigPanel canWrite />);
    await waitFor(() => expect(screen.getByText(/pinned by environment/i)).toBeInTheDocument());
    expect(screen.queryByText("Save AD configuration")).not.toBeInTheDocument();
  });
});
