/**
 * API client for IntegrationHub screen.
 * Calls: /svc/integrate (integration service at :4005)
 */
import { http, SVC } from "./http.js";

// Management routes are mounted at /integration on the integration service
const MGMT_BASE = `${SVC.integrate}/integration`;
// Outbound webhook routes are mounted at /outbound on the integration service
const OUTBOUND_BASE = `${SVC.integrate}/outbound`;

export interface IntegrationLog {
  id: string;
  system: string;
  endpoint: string;
  method: string;
  status: number;
  latency_ms: number;
  direction: "outbound" | "inbound";
  success: boolean;
  error?: string | null;
  created_at?: string;
}

export interface ConnectedSystem {
  system: string;
  base_url?: string | null;
  enabled: boolean;
  status: "up" | "down" | "mock" | "disabled";
  lastCallAt?: string | null;
  recentErrors: number;
}

export interface OutboundWebhook {
  id: string;
  url: string;
  events: string[];
  auth_method: "hmac" | "none";
  enabled: boolean;
  created_at?: string;
}

export interface CreateWebhookPayload {
  url: string;
  events: string[];
  auth_method?: "hmac" | "none";
  secret?: string;
}

export const integrationHubApi = {
  getLogs: (system?: string, limit = 50) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (system) params.set("system", system);
    return http.get<{ logs: IntegrationLog[] }>(`${MGMT_BASE}/logs?${params}`);
  },

  getSystems: () =>
    http.get<{ systems: ConnectedSystem[] }>(`${MGMT_BASE}/systems`),

  /** Admin upsert of a connector's config (base_url / auth / enabled / secret). */
  upsertConnector: (
    system: string,
    payload: { base_url?: string | null; auth_type?: "none" | "bearer" | "hmac" | "basic"; enabled?: boolean; secret?: string },
  ) =>
    http.put<{ system: string; base_url?: string | null; auth_type: string; enabled: boolean; hasSecret: boolean }>(
      `${MGMT_BASE}/systems/${encodeURIComponent(system)}`,
      payload,
    ),

  /** Test a connector — pings its health op; reports live/mock + status. */
  testConnector: (system: string) =>
    http.post<{ system: string; mode: "live" | "mock"; baseUrl: string | null; ok: boolean; status: number; error: string | null }>(
      `${MGMT_BASE}/systems/${encodeURIComponent(system)}/test`,
    ),

  getWebhooks: () =>
    http.get<{ webhooks: OutboundWebhook[] }>(`${OUTBOUND_BASE}`),

  createWebhook: (payload: CreateWebhookPayload) =>
    http.post<{ webhook: OutboundWebhook }>(`${OUTBOUND_BASE}`, payload),

  testWebhook: (event: string, payload?: unknown) =>
    http.post<{ report: unknown }>(`${OUTBOUND_BASE}/test`, { event, payload }),
};
