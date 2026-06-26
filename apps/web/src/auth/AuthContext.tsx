import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import type { AuthUser } from "@zordms/types";
import { api, getToken, setToken, clearToken, SESSION_EXPIRED_EVENT } from "../api/client.js";
import { SessionExpiredScreen } from "../components/SessionExpiredScreen.js";

interface AuthState {
  user: AuthUser | null;
  /** True when the session has timed out (401 / JWT exp); the global
   *  SessionExpiredScreen is shown and the user must re-authenticate. */
  sessionExpired: boolean;
  login: (username: string, password: string, totp?: string) => Promise<void>;
  /** Adopt a JWT minted elsewhere (SSO redirect handoff, or an LDAP login that
   *  returns the same internal JWT). The user is rebuilt from the token claims,
   *  exactly like a page-refresh session restore. */
  loginWithToken: (token: string, user?: AuthUser | null) => void;
  logout: () => void;
}

const Ctx = createContext<AuthState | undefined>(undefined);

/** Where to send the user after they re-authenticate (set when the session
 *  expires mid-flow). Login reads + clears it. */
const RETURN_PATH_KEY = "zordms_return_path";

function rememberReturnPath(): void {
  try {
    const here = window.location.pathname + window.location.search;
    // Never bounce back to login/root.
    if (here && !here.startsWith("/login") && here !== "/") {
      sessionStorage.setItem(RETURN_PATH_KEY, here);
    }
  } catch { /* ignore storage errors */ }
}

/** Read + clear the saved return path (called by the Login screen). */
export function takeReturnPath(): string | null {
  try {
    const v = sessionStorage.getItem(RETURN_PATH_KEY);
    if (v) sessionStorage.removeItem(RETURN_PATH_KEY);
    return v;
  } catch {
    return null;
  }
}

/** Decode JWT claims (no verification — display only). */
function decodeClaims(token: string): Record<string, unknown> | null {
  try {
    const [, payload] = token.split(".");
    return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
}

/** Rebuild the AuthUser from a (still-valid) JWT so a page refresh keeps the
 *  session. The gateway embeds roles/permissions/branch as claims. */
function userFromToken(token: string | null): AuthUser | null {
  if (!token) return null;
  const claims = decodeClaims(token);
  if (!claims) { clearToken(); return null; }
  if (claims.exp && (claims.exp as number) * 1000 < Date.now()) { clearToken(); return null; }
  return {
    id: String(claims.sub),
    username: String(claims.username),
    roles: (claims.roles as string[]) ?? [],
    permissions: (claims.permissions as string[]) ?? [],
    branch: claims.branch as string,
    region: claims.region as string,
  };
}

/** Milliseconds until the token's `exp`, or null if no/!expiring claim. */
function msUntilExpiry(token: string | null): number | null {
  if (!token) return null;
  const claims = decodeClaims(token);
  if (!claims?.exp) return null;
  return (claims.exp as number) * 1000 - Date.now();
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // Initialise from a persisted token so refresh doesn't bounce to /login.
  const [user, setUser] = useState<AuthUser | null>(() => userFromToken(getToken()));
  const [sessionExpired, setSessionExpired] = useState(false);
  const expiryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const expireSession = useCallback(() => {
    rememberReturnPath();
    clearToken();
    setUser(null);
    setSessionExpired(true);
  }, []);

  // Schedule a proactive expiry so the screen appears the moment the JWT lapses,
  // even with no API activity. Re-armed whenever the token changes.
  const armExpiryTimer = useCallback((token: string | null) => {
    if (expiryTimer.current) { clearTimeout(expiryTimer.current); expiryTimer.current = null; }
    const ms = msUntilExpiry(token);
    if (ms == null) return;
    if (ms <= 0) { expireSession(); return; }
    // Cap setTimeout to avoid overflow on very long-lived tokens.
    expiryTimer.current = setTimeout(expireSession, Math.min(ms, 2_147_483_000));
  }, [expireSession]);

  // Listen for the global 401 signal broadcast by the API layer.
  useEffect(() => {
    const onExpired = () => {
      // Remember where the user was so re-login can land them back there.
      rememberReturnPath();
      setUser(null);
      setSessionExpired(true);
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
  }, []);

  // Arm the expiry timer for the initial token, and clean up on unmount.
  useEffect(() => {
    armExpiryTimer(getToken());
    return () => { if (expiryTimer.current) clearTimeout(expiryTimer.current); };
  }, [armExpiryTimer]);

  const login = useCallback(async (username: string, password: string, totp?: string) => {
    const res = await api.post("/auth/login", { username, password, totp });
    setToken(res.token);
    setUser(res.user);
    setSessionExpired(false);
    armExpiryTimer(res.token);
  }, [armExpiryTimer]);

  const loginWithToken = useCallback((token: string, providedUser?: AuthUser | null) => {
    setToken(token);
    // Prefer an explicit user (e.g. LDAP returns `{ token, user }`); otherwise
    // derive it from the JWT claims so an OIDC/SAML fragment handoff works.
    setUser(providedUser ?? userFromToken(token));
    setSessionExpired(false);
    armExpiryTimer(token);
  }, [armExpiryTimer]);

  const logout = useCallback(() => {
    if (expiryTimer.current) { clearTimeout(expiryTimer.current); expiryTimer.current = null; }
    clearToken();
    setUser(null);
    setSessionExpired(false);
  }, []);

  // Re-authenticate from the session-expired screen: drop any state and go to
  // the login route via a full navigation (works regardless of router state).
  const reauthenticate = useCallback(() => {
    setSessionExpired(false);
    clearToken();
    window.location.assign("/login");
  }, []);

  return (
    <Ctx.Provider value={{ user, sessionExpired, login, loginWithToken, logout }}>
      {children}
      {sessionExpired && <SessionExpiredScreen onReauthenticate={reauthenticate} />}
    </Ctx.Provider>
  );
}

export function useAuth(): AuthState {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAuth must be used within AuthProvider");
  return c;
}
