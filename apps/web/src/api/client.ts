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

async function req(method: string, path: string, body?: unknown): Promise<any> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw Object.assign(new Error("request_failed"), { status: res.status, body: await res.json().catch(() => ({})) });
  return res.json();
}

export const api = {
  get: (p: string) => req("GET", p),
  post: (p: string, b?: unknown) => req("POST", p, b),
};
