/**
 * Typed HTTP helper for ZorDMS services.
 *
 * Proxy scheme (configured in vite.config.ts):
 *   /svc/gateway  -> http://localhost:4000  (auth, users, authz, health)
 *   /svc/core     -> http://localhost:4001  (documents, repository, indexing)
 *   /svc/workflow -> http://localhost:4002  (workflows, cases, review)
 *   /svc/notify   -> http://localhost:4003  (alerts, notifications)
 *   /svc/search   -> http://localhost:4004  (enterprise search)
 *   /svc/integrate-> http://localhost:4005  (integrations, connectors)
 *   /svc/ai       -> http://localhost:8000  (AI engine, OCR, NLP)
 *
 * Service base paths are now driven by VITE_SVC_* env vars (see config.ts).
 * Call sites are unchanged — just keep using full paths like "/svc/core/documents".
 *
 * Usage:
 *   import { http } from "../api/http.js";
 *   const docs = await http.get<Doc[]>("/svc/core/documents");
 *   await http.post("/svc/gateway/auth/login", { username, password });
 */
import { getToken } from "./client.js";

// Re-export SVC from the canonical config so existing imports from http.ts
// continue to work without changing call sites.
export { SVC } from "../config.js";

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status, body: payload });
  }

  // 204 No Content
  if (res.status === 204) return undefined as unknown as T;

  return res.json() as Promise<T>;
}

export const http = {
  get:    <T>(url: string)                    => request<T>("GET",    url),
  post:   <T>(url: string, body?: unknown)    => request<T>("POST",   url, body),
  put:    <T>(url: string, body?: unknown)    => request<T>("PUT",    url, body),
  patch:  <T>(url: string, body?: unknown)    => request<T>("PATCH",  url, body),
  delete: <T>(url: string)                    => request<T>("DELETE", url),
};
