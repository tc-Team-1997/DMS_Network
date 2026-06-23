import React, { createContext, useContext, useState, useCallback } from "react";
import type { AuthUser } from "@zordms/types";
import { api, setToken, clearToken } from "../api/client.js";

interface AuthState {
  user: AuthUser | null;
  login: (username: string, password: string, totp?: string) => Promise<void>;
  logout: () => void;
}

const Ctx = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);

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
