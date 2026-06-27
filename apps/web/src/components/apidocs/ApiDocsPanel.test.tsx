import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { ApiDocsPanel } from "./ApiDocsPanel.js";

const GATEWAY_SPEC = {
  openapi: "3.1.0",
  info: { title: "Gateway", version: "1.0.0", description: "Auth service" },
  paths: {
    "/auth/login": { post: { tags: ["auth"], summary: "Sign in", responses: { "200": { description: "OK" } } } },
    "/users": { get: { tags: ["users"], summary: "List users", security: [{ bearerAuth: [] }], responses: { "200": { description: "OK" } } } },
  },
};

function makeFetch() {
  return vi.fn((url: string) => {
    const u = String(url);
    if (u.includes("/svc/gateway/openapi.json")) {
      return Promise.resolve({ ok: true, status: 200, json: async () => GATEWAY_SPEC });
    }
    // other services: pretend offline
    return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
  });
}

beforeEach(() => {
  globalThis.fetch = makeFetch() as unknown as typeof fetch;
  globalThis.localStorage?.setItem?.("zordms_token", "t");
});

describe("ApiDocsPanel", () => {
  it("loads the default service spec and lists endpoints grouped by tag", async () => {
    render(<ApiDocsPanel />);
    await waitFor(() => expect(screen.getByText("/auth/login")).toBeInTheDocument());
    expect(screen.getByText("/users")).toBeInTheDocument();
    // tag group headers + the secured "auth" badge both render
    expect(screen.getAllByText("auth").length).toBeGreaterThan(0);
    expect(screen.getByText("users")).toBeInTheDocument();
  });

  it("filters endpoints by query", async () => {
    render(<ApiDocsPanel />);
    await waitFor(() => expect(screen.getByText("/auth/login")).toBeInTheDocument());
    fireEvent.change(screen.getByPlaceholderText(/Filter endpoints/), { target: { value: "users" } });
    await waitFor(() => expect(screen.queryByText("/auth/login")).not.toBeInTheDocument());
    expect(screen.getByText("/users")).toBeInTheDocument();
  });

  it("expands an operation to show responses", async () => {
    render(<ApiDocsPanel />);
    await waitFor(() => expect(screen.getByText("/auth/login")).toBeInTheDocument());
    await act(async () => { fireEvent.click(screen.getByText("/auth/login")); });
    expect(screen.getByText("Responses")).toBeInTheDocument();
  });

  it("shows an offline message when a service spec fails to load", async () => {
    render(<ApiDocsPanel />);
    await waitFor(() => expect(screen.getByText("/auth/login")).toBeInTheDocument());
    // switch to core (mocked offline)
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "core" })); });
    await waitFor(() => expect(screen.getByText(/may be offline/)).toBeInTheDocument());
  });
});
