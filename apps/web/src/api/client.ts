/**
 * client.ts — low-level token store + simple API helper.
 *
 * The base path for each service is defined in config.ts (SVC map) and
 * driven by VITE_SVC_* env vars.  Call sites pass full paths like
 * "/svc/gateway/auth/login" — no base is prepended here so that existing
 * call sites remain unchanged.
 */
import { SVC } from "../config.js";

// Re-export SVC so legacy imports from client.ts still compile.
export { SVC };

const TOKEN_KEY = "zordms_token";

export function getToken(): string | null { return localStorage.getItem(TOKEN_KEY); }
export function setToken(t: string): void { localStorage.setItem(TOKEN_KEY, t); }
export function clearToken(): void { localStorage.removeItem(TOKEN_KEY); }

/**
 * Global session-expiry signal. When any authenticated API call comes back 401
 * (token expired / revoked), we clear the token and broadcast this event. The
 * AuthProvider listens and shows the "session expired" screen — instead of each
 * page rendering a broken layout or a raw error banner.
 *
 * The login endpoint is exempt (a 401 there is just bad credentials, handled by
 * the login form), so callers pass `auth: true` only for authenticated calls.
 */
export const SESSION_EXPIRED_EVENT = "zordms:session-expired";

export function notifySessionExpired(): void {
  clearToken();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
  }
}

/** True for paths that authenticate the user (a 401 here is bad creds, not an
 *  expired session). */
function isAuthEndpoint(path: string): boolean {
  return /\/auth\/(login|token)\b/.test(path);
}

/** Centralised 401 handling: any authenticated request that 401s triggers the
 *  global session-expired flow. */
export function handleUnauthorized(status: number, path: string): void {
  if (status === 401 && !isAuthEndpoint(path)) notifySessionExpired();
}

async function req(method: string, path: string, body?: unknown): Promise<any> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) {
    handleUnauthorized(res.status, path);
    throw Object.assign(new Error("request_failed"), { status: res.status, body: await res.json().catch(() => ({})) });
  }
  return res.json();
}

export const api = {
  get: (p: string) => req("GET", p),
  post: (p: string, b?: unknown) => req("POST", p, b),
};
