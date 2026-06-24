/**
 * Customer360 API module — typed wrappers for /svc/core/customers
 */
import { http, SVC } from "./http.js";

export interface KycRequirement {
  key: string;
  label: string;
  satisfied: boolean;
}

export interface CustomerProfile {
  cid: string;
  documents: {
    id: number;
    doc_no?: string;
    doc_type: string;
    status: string;
    created_at?: string;
  }[];
  kyc: {
    requirements: KycRequirement[];
    completeness: number;
    status: "Complete" | "Partial" | "Missing";
    escalated: boolean;
  };
  portfolio: { doc_type: string; count: number }[];
  timeline: { ts: string; action: string; entity_id?: string; details?: string }[];
}

export async function fetchCustomerProfile(cid: string): Promise<CustomerProfile> {
  const data = await http.get<{ profile: CustomerProfile }>(`${SVC.core}/customers/${cid}`);
  return data.profile;
}
