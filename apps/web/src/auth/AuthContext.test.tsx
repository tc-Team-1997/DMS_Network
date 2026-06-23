import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { AuthProvider, useAuth } from "./AuthContext.js";

function Probe() {
  const { user, login } = useAuth();
  return <button onClick={() => login("admin", "admin123")}>{user ? user.username : "anon"}</button>;
}

describe("AuthContext", () => {
  beforeEach(() => { localStorage.clear(); });
  it("sets the user after a successful login", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ token: "t", user: { id: 1, username: "admin", roles: ["CDO"], permissions: ["user:create"] } }),
    }) as any;
    render(<AuthProvider><Probe /></AuthProvider>);
    screen.getByText("anon").click();
    await waitFor(() => expect(screen.getByText("admin")).toBeInTheDocument());
    expect(localStorage.getItem("zordms_token")).toBe("t");
  });
});
