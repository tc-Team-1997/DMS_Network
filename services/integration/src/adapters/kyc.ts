import type { Connector } from "../connectors/types.js";
import type { ConnectorResult } from "@zordms/types";

export interface KycSubject { cid: string; documentType: string; documentNo: string; }
export interface KycVerdict { match: boolean; score: number; decision: string; }

export function kycVerify(connector: Connector, subject: KycSubject): Promise<ConnectorResult<KycVerdict>> {
  return connector.call<KycVerdict>("verify", subject);
}

// Health probe (live HTTP connector hits GET /health).
export function kycPing(connector: Connector): Promise<ConnectorResult<unknown>> {
  return connector.call("ping", {});
}
