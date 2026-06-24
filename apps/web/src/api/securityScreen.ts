/**
 * API client for Security screen.
 * Calls: /svc/gateway (gateway service at :4000) for /users and /authz
 */
import { http, SVC } from "./http.js";

const BASE = SVC.gateway;

export interface UserRow {
  id: number;
  username: string;
  full_name?: string;
  email?: string;
  branch?: string;
  region?: string;
  mfa_enabled: boolean;
  status: "Active" | "Locked";
}

export interface CreateUserPayload {
  username: string;
  password: string;
  full_name?: string;
  email?: string;
  branch?: string;
  region?: string;
  roles: string[];
}

export interface AuditLogRow {
  id: number;
  actor_username?: string;
  action: string;
  entity?: string;
  entity_id?: string;
  details?: string;
  created_at?: string;
}

export const securityApi = {
  getUsers: () =>
    http.get<{ users: UserRow[] }>(`${BASE}/users`),

  createUser: (payload: CreateUserPayload) =>
    http.post<{ user: UserRow }>(`${BASE}/users`, payload),

  assignRoles: (userId: number, roles: string[]) =>
    http.post<{ ok: boolean }>(`${BASE}/users/${userId}/roles`, { roles }),

  toggleLock: (userId: number) =>
    http.post<{ ok: boolean; status: string }>(`${BASE}/users/${userId}/lock`, {}),
};
