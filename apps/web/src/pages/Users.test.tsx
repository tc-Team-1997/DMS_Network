import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { Users } from "./Users.js";

vi.mock("../auth/AuthContext.js", () => ({
  useAuth: () => ({ user: { id: 1, username: "admin", roles: ["CDO"], permissions: ["user:read", "user:create"] }, logout: () => {} }),
}));

describe("Users screen", () => {
  it("lists users fetched from the API", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ users: [{ id: 1, username: "admin", status: "Active" }, { id: 2, username: "maker1", status: "Active" }] }),
    }) as any;
    render(<Users />);
    await waitFor(() => expect(screen.getByText("maker1")).toBeInTheDocument());
  });
});
