import React, { createContext, useContext, useState, useCallback } from "react";
import type { AuthUser } from "@zordms/types";
import { api, getToken, setToken, clearToken } from "../api/client.js";

interface AuthState {
  user: AuthUser | null;
  login: (username: string, password: string, totp?: string) => Promise<void>;
  logout: () => void;
}

const Ctx = createContext<AuthState | undefined>(undefined);

/** Rebuild the AuthUser from a (still-valid) JWT so a page refresh keeps the
 *  session. The gateway embeds roles/permissions/branch as claims. */
function userFromToken(token: string | null): AuthUser | null {
  if (!token) return null;
  try {
    const [, payload] = token.split(".");
    const claims = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    if (claims.exp && claims.exp * 1000 < Date.now()) { clearToken(); return null; }
    return {
      id: String(claims.sub),
      username: String(claims.username),
      roles: claims.roles ?? [],
      permissions: claims.permissions ?? [],
      branch: claims.branch,
      region: claims.region,
    };
  } catch {
    clearToken();
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // Initialise from a persisted token so refresh doesn't bounce to /login.
  const [user, setUser] = useState<AuthUser | null>(() => userFromToken(getToken()));

  const login = useCallback(async (username: string, password: string, totp?: string) => {
    const res = await api.post("/auth/login", { username, password, totp });
    setToken(res.token);
    setUser(res.user);
  }, []);

  const logout = useCallback(() => { clearToken(); setUser(null); }, []);

  return <Ctx.Provider value={{ user, login, logout }}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used within AuthProvider");
  return c;
}
