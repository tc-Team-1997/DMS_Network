import type { Connector, ConnectorContext } from "./types.js";
import { MockConnector } from "./mock.js";
import { HttpConnector, type HttpConnectorOptions } from "./http.js";
import { withLogging } from "./logger.js";

// Canned mock responses per system so the hub is fully functional with NO external
// systems present (mirrors the Python service's mock-fallback). Real deployments
// override via integration_config + buildHttpConnector.
const MOCK_RESPONSES: Record<string, Record<string, { ok: boolean; status: number; data?: unknown }>> = {
  cbs: {
    "customer.lookup": { ok: true, status: 200, data: { cid: "C1000", name: "Dorji Wangchuk", branch: "Thimphu", segment: "RETAIL" } },
    "kyc.sync": { ok: true, status: 200, data: { cid: "C1000", kycStatus: "VERIFIED", syncedAt: "2026-06-23T00:00:00Z" } },
  },
  los: {
    "loan.push": { ok: true, status: 201, data: { loanId: "L5000", state: "RECEIVED" } },
    "loan.status": { ok: true, status: 200, data: { loanId: "L5000", state: "UNDER_REVIEW" } },
  },
  kyc: {
    "verify": { ok: true, status: 200, data: { match: true, score: 0.97, decision: "PASS" } },
  },
};

export function buildConnector(system: string, ctx: ConnectorContext): Connector {
  const responses = MOCK_RESPONSES[system] ?? {};
  return withLogging(new MockConnector(system, responses), ctx.knex);
}

// Used when integration_config supplies a real base_url for a system.
export function buildHttpConnector(opts: HttpConnectorOptions, ctx: ConnectorContext): Connector {
  return withLogging(new HttpConnector(opts), ctx.knex);
}
