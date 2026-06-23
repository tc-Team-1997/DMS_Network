import type { Connector } from "../connectors/types.js";
import type { ConnectorResult } from "../types.js";

export interface KycSubject { cid: string; documentType: string; documentNo: string; }
export interface KycVerdict { match: boolean; score: number; decision: string; }

export function kycVerify(connector: Connector, subject: KycSubject): Promise<ConnectorResult<KycVerdict>> {
  return connector.call<KycVerdict>("verify", subject);
}
