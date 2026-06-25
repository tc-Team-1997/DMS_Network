/**
 * P10 — live route introspection.
 *
 * `collectMountedRoutes(app)` walks the Express application's router stack and
 * returns every mounted HTTP operation as `{ method, path }`, where `path` uses
 * OpenAPI-style templating (`/documents/{id}`), so a contract test can assert the
 * OpenAPI document documents EVERY route the service actually serves (and that the
 * spec contains no phantom paths).
 *
 * Express 4 stores the application router on `app._router` (older) or `app.router`
 * (newer minor); each entry is either a `route` (a concrete endpoint) or a mounted
 * sub-router whose mount prefix is encoded in `layer.regexp` + `layer.keys`.
 */

export interface MountedRoute {
  method: string; // upper-case HTTP verb
  path: string; // OpenAPI-style path, e.g. /documents/{id}
}

/** Recover the mount prefix for a sub-router layer from its compiled regexp. */
function decodeMountPrefix(layer: any): string {
  if (typeof layer.path === "string" && layer.path.length > 0) return layer.path;
  const src: string = layer.regexp?.source ?? "";
  const keys: string[] = (layer.keys || []).map((k: any) => String(k.name));
  // Strip the express wrappers: leading `^`, trailing `\/?(?=\/|$)` or `$`.
  let s = src
    .replace(/^\^/, "")
    .replace(/\\\/\?\(\?=\\\/\|\$\)$/, "")
    .replace(/\$$/, "");
  let i = 0;
  // Param mounts can appear as `(?:\/([^/]+?))` or bare `([^/]+?)`.
  s = s.replace(new RegExp("\\(\\?:\\\\/\\(\\[\\^/\\]\\+\\?\\)\\)", "g"), () => "/{" + (keys[i++] ?? "param") + "}");
  s = s.replace(new RegExp("\\(\\[\\^/\\]\\+\\?\\)", "g"), () => "{" + (keys[i++] ?? "param") + "}");
  s = s.replace(/\\\//g, "/"); // unescape `\/`
  return s;
}

/** Convert an express route path (`/:id/move`) to OpenAPI templating (`/{id}/move`). */
function paramToBrace(p: string): string {
  return p.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function normalize(full: string): string {
  let out = full.replace(/\/{2,}/g, "/");
  if (out.length > 1) out = out.replace(/\/$/, "");
  if (!out.startsWith("/")) out = "/" + out;
  return out;
}

export function collectMountedRoutes(app: any): MountedRoute[] {
  const router = app._router || app.router;
  const out: MountedRoute[] = [];
  if (!router?.stack) return out;

  function walk(stack: any[], prefix: string): void {
    for (const layer of stack) {
      if (layer.route) {
        const path = normalize(prefix + paramToBrace(layer.route.path));
        const methods = Object.keys(layer.route.methods).filter((m) => m !== "_all");
        for (const m of methods) out.push({ method: m.toUpperCase(), path });
      } else if (layer.name === "router" && layer.handle?.stack) {
        walk(layer.handle.stack, prefix + decodeMountPrefix(layer));
      }
    }
  }

  walk(router.stack, "");
  return out;
}

/** `${METHOD} ${path}` keys, sorted, de-duplicated — convenient for set comparison. */
export function routeKeys(routes: MountedRoute[]): string[] {
  return [...new Set(routes.map((r) => `${r.method} ${r.path}`))].sort();
}
