// Integration-specific types defined locally since they are not yet in @zordms/types.
// When @zordms/types adds these, import from there instead.

export type IntegrationDirection = "outbound" | "inbound";

export interface IntegrationLog {
  id: number;
  system: string;
  endpoint: string;
  method: string;
  status: number;
  latency_ms: number;
  direction: IntegrationDirection;
  success: boolean;
  error?: string | null;
  created_at?: string;
}

export interface IntegrationConfigRow {
  id: number;
  system: string;
  base_url?: string | null;
  auth_type: "none" | "bearer" | "hmac" | "basic";
  secret?: string | null;
  enabled: boolean;
  created_at?: string;
}

export interface OutboundWebhook {
  id: number;
  url: string;
  events: string[];
  auth_method: "hmac" | "none";
  enabled: boolean;
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

export interface ConnectorResult<T = unknown> {
  ok: boolean;
  status: number;
  data?: T;
  error?: string;
  mock?: boolean;
}

export const INTEGRATION_EVENTS = [
  "cbs.customer.updated",
  "los.loan.created",
  "kyc.result",
] as const;

export type IntegrationEvent = (typeof INTEGRATION_EVENTS)[number];

export function isConnectorResult(x: unknown): x is ConnectorResult {
  const r = x as ConnectorResult;
  return !!r && typeof r.ok === "boolean" && typeof r.status === "number";
}
