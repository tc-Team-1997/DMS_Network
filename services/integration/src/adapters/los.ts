import type { Connector } from "../connectors/types.js";
import type { ConnectorResult } from "@zordms/types";

export interface LoanPush { applicationId: string; cid: string; amount: number; }
export interface LoanRef { loanId: string; state: string; }

export function losPushLoan(connector: Connector, loan: LoanPush): Promise<ConnectorResult<LoanRef>> {
  return connector.call<LoanRef>("loan.push", loan);
}

export function losLoanStatus(connector: Connector, loanId: string): Promise<ConnectorResult<LoanRef>> {
  return connector.call<LoanRef>("loan.status", { loanId });
}

// Health probe (live HTTP connector hits GET /health).
export function losPing(connector: Connector): Promise<ConnectorResult<unknown>> {
  return connector.call("ping", {});
}
