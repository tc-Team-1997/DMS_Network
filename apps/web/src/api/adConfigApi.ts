/**
 * Active Directory (LDAP) config admin API — talks to the gateway.
 * Lets an admin enable + configure BOBL AD so non-superuser staff authenticate
 * against the directory; the bind secret is write-only (never returned).
 */
import { http, SVC } from "./http.js";

export interface AdConfig {
  enabled: boolean;
  displayName: string;
  url: string;
  bindDN: string;
  searchBase: string;
  searchFilter: string;
  groupAttr: string;
  groupRoleMap: Record<string, string>;
  hasBindCredentials: boolean;
}

export interface AdConfigUpdate {
  enabled?: boolean;
  displayName?: string;
  url?: string;
  bindDN?: string;
  bindCredentials?: string; // write-only
  searchBase?: string;
  searchFilter?: string;
  groupAttr?: string;
  groupRoleMap?: Record<string, string>;
}

export const adConfigApi = {
  get: () => http.get<{ ldap: AdConfig; envManaged: boolean }>(`${SVC.gateway}/auth/ad-config`),
  put: (patch: AdConfigUpdate) => http.put<{ ldap: Partial<AdConfig> }>(`${SVC.gateway}/auth/ad-config`, patch),
};
