/**
 * config.ts — ZorDMS web app runtime configuration
 *
 * All service base paths are read from Vite env vars so that staging /
 * production deployments can override them without a code change.
 *
 * Set the vars in .env.local (gitignored) or via CI secrets.  The proxy
 * defaults (e.g. "/svc/gateway") work out of the box with the Vite dev
 * proxy configured in vite.config.ts.
 *
 * Usage:
 *   import { SVC } from "../config.js";
 *   const docs = await http.get(`${SVC.core}/documents`);
 */

/** Service base-URL map.  Import this wherever you build API paths. */
export const SVC = {
  /** Gateway service  — auth, users, authz, health  (:4000) */
  gateway:     import.meta.env.VITE_SVC_GATEWAY     ?? "/svc/gateway",
  /** Core service     — documents, repository, indexing (:4001) */
  core:        import.meta.env.VITE_SVC_CORE        ?? "/svc/core",
  /** Workflow service — workflows, cases, review    (:4002) */
  workflow:    import.meta.env.VITE_SVC_WORKFLOW     ?? "/svc/workflow",
  /** Notify service  — alerts, notifications        (:4003) */
  notify:      import.meta.env.VITE_SVC_NOTIFY       ?? "/svc/notify",
  /** Search service  — enterprise search / semantic (:4004) */
  search:      import.meta.env.VITE_SVC_SEARCH       ?? "/svc/search",
  /**
   * Integration svc — connectors, hub              (:4005)
   * Key is `integrate` to match the legacy SVC.integrate usage in existing API files.
   * Env var: VITE_SVC_INTEGRATION (note: the env var spells it out for clarity).
   */
  integrate: import.meta.env.VITE_SVC_INTEGRATION  ?? "/svc/integrate",
  /** AI service      — OCR, NLP, classification     (:8000) */
  ai:          import.meta.env.VITE_SVC_AI           ?? "/svc/ai",
  /**
   * Auth base — empty string by default so that `/auth/login` resolves
   * through the legacy proxy rule in vite.config.ts unchanged.
   * Override with e.g. VITE_SVC_AUTH="https://auth.example.com" in prod.
   */
  auth:        import.meta.env.VITE_SVC_AUTH         ?? "",
} as const;

export type SvcKey = keyof typeof SVC;
