import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { createRequire } from "node:module";

// Derive the app version from the actual package.json (single source of truth).
const pkg = createRequire(import.meta.url)("./package.json") as { version: string };

/**
 * ZorDMS v4.2 Dev Proxy Scheme
 * ─────────────────────────────────────────────────────────────────────
 * All proxied under /svc/<service> so screen agents call a stable path
 * regardless of which port each microservice lives on.
 *
 * Base paths (use with http helper from src/api/http.ts):
 *   /svc/gateway   -> http://localhost:4000  gateway  (auth/users/authz/health)
 *   /svc/core      -> http://localhost:4001  core     (documents/repository/indexing/records)
 *   /svc/workflow  -> http://localhost:4002  workflow (workflows/cases/review/lifecycle)
 *   /svc/notify    -> http://localhost:4003  notify   (alerts/notifications/events)
 *   /svc/search    -> http://localhost:4004  search   (enterprise search / semantic)
 *   /svc/integrate -> http://localhost:4005  integration (connectors/hub)
 *   /svc/ai        -> http://localhost:8000  ai       (OCR/NLP/classification)
 *
 * Legacy direct paths (kept for backwards compat with existing code):
 *   /auth, /users, /authz, /health -> http://localhost:4000
 * ─────────────────────────────────────────────────────────────────────
 */
export default defineConfig({
  plugins: [react()],

  // Injected as a compile-time global; read in the UI as __APP_VERSION__.
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },

  server: {
    proxy: {
      // ── Canonical /svc/* scheme ──────────────────────────────────
      "/svc/gateway": {
        target: "http://localhost:4000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/svc\/gateway/, ""),
      },
      "/svc/core": {
        target: "http://localhost:4001",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/svc\/core/, ""),
      },
      "/svc/workflow": {
        target: "http://localhost:4002",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/svc\/workflow/, ""),
      },
      "/svc/notify": {
        target: "http://localhost:4003",
        changeOrigin: true,
        ws: true,
        rewrite: (path) => path.replace(/^\/svc\/notify/, ""),
      },
      "/svc/search": {
        target: "http://localhost:4004",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/svc\/search/, ""),
      },
      "/svc/integrate": {
        target: "http://localhost:4005",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/svc\/integrate/, ""),
      },
      "/svc/ai": {
        target: "http://localhost:8000",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/svc\/ai/, ""),
      },

      // ── Legacy direct paths (kept for existing code) ─────────────
      "/auth":   { target: "http://localhost:4000", changeOrigin: true },
      "/users":  { target: "http://localhost:4000", changeOrigin: true },
      "/authz":  { target: "http://localhost:4000", changeOrigin: true },
      "/health": { target: "http://localhost:4000", changeOrigin: true },
    },
  },

  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    environmentOptions: { jsdom: { url: "http://localhost" } },
  },
});
