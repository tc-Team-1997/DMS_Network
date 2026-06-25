import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AuthProvider } from "../auth/AuthContext.js";
import { Login } from "./Login.js";

// react-router's useNavigate is mocked so we can assert client-side redirects
// (the #token handoff navigates to /dashboard).
const navigateMock = vi.fn();
vi.mock("react-router-dom", async (orig) => {
  const actual = await orig<typeof import("react-router-dom")>();
  return { ...actual, useNavigate: () => navigateMock };
});

/** Build a fetch mock whose behaviour is keyed by request URL. */
function mockFetch(handlers: Record<string, () => any>) {
  return vi.fn((url: string) => {
    for (const [key, fn] of Object.entries(handlers)) {
      if (url.includes(key)) return Promise.resolve({ ok: true, json: async () => fn() });
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  }) as any;
}

function renderLogin() {
  return render(<MemoryRouter><AuthProvider><Login /></AuthProvider></MemoryRouter>);
}

describe("Login", () => {
  beforeEach(() => {
    localStorage.clear();
    navigateMock.mockReset();
    window.location.hash = "";
  });

  it("renders split-screen with carousel and signs in (local)", async () => {
    globalThis.fetch = mockFetch({
      "/auth/config": () => ({ local: true, providers: [] }),
      "/auth/login": () => ({ token: "t", user: { id: 1, username: "admin", roles: ["CDO"], permissions: [] } }),
    });
    renderLogin();
    expect(screen.getByRole("heading", { name: /Sign in/i })).toBeInTheDocument();
    expect(screen.getByText(/Capture, classify, index\./i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Username/i), { target: { value: "admin" } });
    fireEvent.change(screen.getByLabelText(/Password/i), { target: { value: "admin123" } });
    fireEvent.click(screen.getByRole("button", { name: /^Sign in$/i }));
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith("/auth/login", expect.anything()));
  });

  it("renders only the local form when no SSO providers are enabled", async () => {
    globalThis.fetch = mockFetch({ "/auth/config": () => ({ local: true, providers: [] }) });
    renderLogin();
    // Let the /auth/config fetch resolve.
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(screen.queryByText(/or continue with/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Sign in with/i })).not.toBeInTheDocument();
    // Local form is intact.
    expect(screen.getByLabelText(/Username/i)).toBeInTheDocument();
  });

  it("renders a button per enabled provider (OIDC + LDAP) plus the local form", async () => {
    globalThis.fetch = mockFetch({
      "/auth/config": () => ({
        local: true,
        providers: [
          { id: "oidc", enabled: true, displayName: "Single Sign-On", loginUrl: "/auth/oidc/login" },
          { id: "ldap", enabled: true, displayName: "Active Directory", loginUrl: "/auth/ldap/login" },
        ],
      }),
    });
    renderLogin();
    expect(await screen.findByText(/or continue with/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sign in with Single Sign-On/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Sign in with Active Directory/i })).toBeInTheDocument();
    // Local form still present.
    expect(screen.getByLabelText(/Username/i)).toBeInTheDocument();
  });

  it("navigates the window to the loginUrl when an OIDC button is clicked", async () => {
    globalThis.fetch = mockFetch({
      "/auth/config": () => ({
        local: true,
        providers: [{ id: "oidc", enabled: true, displayName: "Single Sign-On", loginUrl: "/auth/oidc/login" }],
      }),
    });
    const assign = vi.fn();
    const orig = window.location;
    Object.defineProperty(window, "location", { value: { ...orig, assign, hash: "" }, writable: true });
    try {
      renderLogin();
      fireEvent.click(await screen.findByRole("button", { name: /Sign in with Single Sign-On/i }));
      expect(assign).toHaveBeenCalledWith("/auth/oidc/login");
    } finally {
      Object.defineProperty(window, "location", { value: orig, writable: true });
    }
  });

  it("stores the token and navigates to /dashboard on a #token handoff", async () => {
    globalThis.fetch = mockFetch({ "/auth/config": () => ({ local: true, providers: [] }) });
    // A JWT-shaped token; AuthContext rebuilds the user from claims.
    const claims = { sub: 7, username: "sso.user", roles: ["Viewer"], permissions: [], exp: Math.floor(Date.now() / 1000) + 3600 };
    const jwt = `h.${btoa(JSON.stringify(claims))}.s`;
    const orig = window.location;
    Object.defineProperty(window, "location", {
      value: { ...orig, hash: `#token=${jwt}`, pathname: "/login", search: "", assign: vi.fn() },
      writable: true,
    });
    try {
      renderLogin();
      await waitFor(() => expect(navigateMock).toHaveBeenCalledWith("/dashboard", { replace: true }));
      expect(localStorage.getItem("zordms_token")).toBe(jwt);
    } finally {
      Object.defineProperty(window, "location", { value: orig, writable: true });
    }
  });
});
