/**
 * apiDocsApi — fetch each backend service's live OpenAPI 3.1 document via the
 * /svc/* proxy. The specs are public (no auth needed for discovery), but we
 * send the token anyway so the call is uniform with the rest of the app.
 */
import { http, SVC } from "./http.js";

export interface ServiceSpec {
  key: string;
  label: string;
  base: string;
}

/** The services whose OpenAPI docs are surfaced in the admin API-docs viewer. */
export const API_SERVICES: ServiceSpec[] = [
  { key: "gateway",   label: "Gateway (auth · users · RBAC)", base: SVC.gateway },
  { key: "core",      label: "Core (documents · repository · indexing)", base: SVC.core },
  { key: "workflow",  label: "Workflow (cases · review · lifecycle)", base: SVC.workflow },
  { key: "notify",    label: "Notify (alerts · templates · channels)", base: SVC.notify },
  { key: "search",    label: "Search (enterprise · semantic)", base: SVC.search },
  { key: "integrate", label: "Integration (connectors · webhooks)", base: SVC.integrate },
  { key: "ai",        label: "AI Engine (OCR · NLP · classification)", base: SVC.ai },
];

/** Minimal subset of the OpenAPI shape the viewer renders. */
export interface OpenApiDoc {
  openapi?: string;
  info?: { title?: string; version?: string; description?: string };
  servers?: Array<{ url?: string; description?: string }>;
  paths?: Record<string, Record<string, OpenApiOperation>>;
  components?: { schemas?: Record<string, unknown> };
}

export interface OpenApiOperation {
  tags?: string[];
  summary?: string;
  description?: string;
  parameters?: Array<{ name?: string; in?: string; required?: boolean; description?: string }>;
  requestBody?: { required?: boolean };
  responses?: Record<string, { description?: string }>;
  security?: Array<Record<string, unknown>>;
}

export const apiDocsApi = {
  fetchSpec: (base: string): Promise<OpenApiDoc> =>
    http.get<OpenApiDoc>(`${base}/openapi.json`),
};
