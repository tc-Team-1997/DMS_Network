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
  id: number;
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
  id: number;
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

  getWebhooks: () =>
    http.get<{ webhooks: OutboundWebhook[] }>(`${OUTBOUND_BASE}`),

  createWebhook: (payload: CreateWebhookPayload) =>
    http.post<{ webhook: OutboundWebhook }>(`${OUTBOUND_BASE}`, payload),

  testWebhook: (event: string, payload?: unknown) =>
    http.post<{ report: unknown }>(`${OUTBOUND_BASE}/test`, { event, payload }),
};
