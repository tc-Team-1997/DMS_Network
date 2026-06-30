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
  mbob: {
    "kyc.fetch": { ok: true, status: 200, data: { cid: "C2001", docType: "CID", channel: "mBoB", capturedAt: "2026-06-29T00:00:00Z" } },
  },
  gobob: {
    "ekyc.fetch": { ok: true, status: 200, data: { cid: "C2002", identityVerified: true, source: "GoBoB" } },
  },
  internet_banking: {
    "statement.fetch": { ok: true, status: 200, data: { accountNo: "0101000123456", statementId: "ST-9001" } },
  },
  crm: {
    "customer.view": { ok: true, status: 200, data: { cid: "C1000", view360Url: "/customer-360?cid=C1000" } },
  },
  erp: {
    "document.fetch": { ok: true, status: 200, data: { docId: "ERP-DOC-1", type: "HR" } },
  },
  contact_center: {
    "document.push": { ok: true, status: 200, data: { ticketId: "CC-7001", delivered: true } },
  },
  esign: {
    "sign.request": { ok: true, status: 201, data: { envelopeId: "ENV-9001", status: "SENT" } },
    "sign.status": { ok: true, status: 200, data: { envelopeId: "ENV-9001", status: "COMPLETED" } },
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

// P7: op -> HTTP method/path maps per system. Each connector exposes a `ping`
// health op where the upstream has one (CBS/LOS) so management can probe liveness.
export const OP_MAPS: Record<string, Record<string, { method: string; path: string }>> = {
  cbs: {
    "customer.lookup": { method: "POST", path: "/customers/lookup" },
    "kyc.sync": { method: "POST", path: "/kyc/sync" },
    "ping": { method: "GET", path: "/health" },
  },
  los: {
    "loan.push": { method: "POST", path: "/loans" },
    "loan.status": { method: "POST", path: "/loans/status" },
    "ping": { method: "GET", path: "/health" },
  },
  kyc: {
    "verify": { method: "POST", path: "/verify" },
    "ping": { method: "GET", path: "/health" },
  },
  mbob: {
    "kyc.fetch": { method: "POST", path: "/kyc/uploads" },
    "ping": { method: "GET", path: "/health" },
  },
  gobob: {
    "ekyc.fetch": { method: "POST", path: "/ekyc" },
    "ping": { method: "GET", path: "/health" },
  },
  internet_banking: {
    "statement.fetch": { method: "POST", path: "/statements" },
    "ping": { method: "GET", path: "/health" },
  },
  crm: {
    "customer.view": { method: "POST", path: "/customers/view" },
    "ping": { method: "GET", path: "/health" },
  },
  erp: {
    "document.fetch": { method: "POST", path: "/documents/fetch" },
    "ping": { method: "GET", path: "/health" },
  },
  contact_center: {
    "document.push": { method: "POST", path: "/documents" },
    "ping": { method: "GET", path: "/health" },
  },
  esign: {
    "sign.request": { method: "POST", path: "/signatures" },
    "sign.status": { method: "POST", path: "/signatures/status" },
    "ping": { method: "GET", path: "/health" },
  },
};

export const BASE_URL_ENV: Record<string, string> = {
  cbs: "CBS_BASE_URL",
  los: "LOS_BASE_URL",
  kyc: "KYC_BASE_URL",
  mbob: "MBOB_BASE_URL",
  gobob: "GOBOB_BASE_URL",
  internet_banking: "INTERNET_BANKING_BASE_URL",
  crm: "CRM_BASE_URL",
  erp: "ERP_BASE_URL",
  contact_center: "CONTACT_CENTER_BASE_URL",
  esign: "ESIGN_BASE_URL",
};

// Returns the live base URL for a system from env, or undefined to use the mock.
export function liveBaseUrl(system: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const key = BASE_URL_ENV[system];
  const val = key ? env[key] : undefined;
  return val && val.trim() ? val.trim() : undefined;
}

export interface ConnectorSelectOptions {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}

/**
 * P7: Live-or-mock connector selection.
 *
 * When `<SYSTEM>_BASE_URL` is set in the environment, returns a logging-wrapped
 * HTTP connector pointed at that base URL (real upstream); otherwise falls back
 * to the canned MOCK connector so the hub stays fully functional offline.
 */
export function selectConnector(system: string, ctx: ConnectorContext, opts: ConnectorSelectOptions = {}): Connector {
  const baseUrl = liveBaseUrl(system, opts.env);
  if (baseUrl) {
    const opMap = OP_MAPS[system] ?? {};
    return withLogging(
      new HttpConnector({ system, baseUrl, opMap, fetchImpl: opts.fetchImpl }),
      ctx.knex,
    );
  }
  return buildConnector(system, ctx);
}
