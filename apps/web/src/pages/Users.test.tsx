import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Users } from "./Users.js";

vi.mock("../auth/AuthContext.js", () => ({
  useAuth: () => ({
    user: { id: 1, username: "admin", roles: ["CDO"], permissions: ["user:read", "user:create"] },
    logout: () => {},
  }),
}));

// Mock getToken so API calls don't crash in jsdom
vi.mock("../api/client.js", () => ({ getToken: () => null, handleUnauthorized: () => {} }));

function renderUsers(search = "") {
  return render(
    <MemoryRouter initialEntries={[`/${search}`]}>
      <Users />
    </MemoryRouter>,
  );
}

describe("Users screen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists users fetched from the API", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        users: [
          { id: 1, username: "admin",  status: "Active" },
          { id: 2, username: "maker1", status: "Active" },
        ],
      }),
    }) as any;
    renderUsers();
    await waitFor(() => expect(screen.getByText("maker1")).toBeInTheDocument());
  });

  /* P1: email column is rendered */
  it("EMAIL: displays the user's email returned by the API", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        users: [
          { id: 1, username: "admin", email: "admin@bobl.bt", status: "Active" },
        ],
      }),
    }) as any;
    renderUsers();
    await waitFor(() => expect(screen.getByText("admin@bobl.bt")).toBeInTheDocument());
    expect(screen.getByText("Email")).toBeInTheDocument();
  });

  /* SVC: no hardcoded URLs */
  it("SVC: refresh calls /svc/gateway/users (not a hardcoded localhost URL)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ users: [] }),
    });
    globalThis.fetch = fetchMock as any;
    renderUsers();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const calledUrl = fetchMock.mock.calls[0]?.[0] as string;
    expect(calledUrl).toContain("/svc/gateway/users");
    expect(calledUrl).not.toContain("localhost");
  });

  /* URL-driven state */
  it("URL: no filter by default — all users are shown", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        users: [
          { id: 1, username: "admin",  status: "Active", roles: ["CDO"] },
          { id: 2, username: "maker1", status: "Active", roles: ["Maker"] },
        ],
      }),
    }) as any;
    renderUsers();
    await waitFor(() => expect(screen.getByText("admin")).toBeInTheDocument());
    expect(screen.getByText("maker1")).toBeInTheDocument();
  });

  /* Pagination */
  it("PAGER: renders pager when more than 10 users are returned", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        users: Array.from({ length: 15 }, (_, i) => ({
          id: i + 1,
          username: `user_${i + 1}`,
          status: "Active",
        })),
      }),
    }) as any;
    renderUsers();
    await waitFor(() => expect(screen.getByText(/Page 1 of 2/)).toBeInTheDocument());
  });

  it("PAGER: first page shows only 10 rows out of 15", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        users: Array.from({ length: 15 }, (_, i) => ({
          id: i + 1,
          username: `user_${String(i + 1).padStart(2, "0")}`,
          status: "Active",
        })),
      }),
    }) as any;
    renderUsers();
    await waitFor(() => expect(screen.getByText("user_01")).toBeInTheDocument());
    expect(screen.queryByText("user_11")).not.toBeInTheDocument();
  });
});
