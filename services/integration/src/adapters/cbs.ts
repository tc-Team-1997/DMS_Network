import type { Connector } from "../connectors/types.js";
import type { ConnectorResult } from "@zordms/types";

export interface CbsCustomer { cid: string; name: string; branch?: string; segment?: string; }
export interface CbsKycSyncResult { cid: string; kycStatus: string; syncedAt?: string; }

// TCS BaNCS customer lookup.
export function cbsCustomerLookup(connector: Connector, cid: string): Promise<ConnectorResult<CbsCustomer>> {
  return connector.call<CbsCustomer>("customer.lookup", { cid });
}

// TCS BaNCS KYC sync.
export function cbsKycSync(connector: Connector, cid: string): Promise<ConnectorResult<CbsKycSyncResult>> {
  return connector.call<CbsKycSyncResult>("kyc.sync", { cid });
}

// Health probe (live HTTP connector hits GET /health; mock returns unhandled).
export function cbsPing(connector: Connector): Promise<ConnectorResult<unknown>> {
  return connector.call("ping", {});
}
