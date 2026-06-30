/**
 * rolesApi.ts — Roles management (§4.11 / SC-16) client.
 *
 * Wires the gateway roles endpoints (built this session):
 *   GET    /roles
 *   POST   /roles
 *   DELETE /roles/:id
 * System roles are protected server-side (409 on delete).
 */
import { http, SVC } from "./http.js";

const BASE = SVC.gateway;

export interface Role {
  id: string;
  name: string;
  description: string | null;
  system: boolean;
  permissions: string[];
  userCount: number;
}

export async function listRoles(): Promise<Role[]> {
  return (await http.get<{ roles: Role[] }>(`${BASE}/roles`)).roles ?? [];
}

export async function createRole(body: { name: string; description?: string; permissions?: string[] }): Promise<Role> {
  return (await http.post<{ role: Role }>(`${BASE}/roles`, body)).role;
}

export async function deleteRole(id: string): Promise<void> {
  await http.delete(`${BASE}/roles/${encodeURIComponent(id)}`);
}

export const rolesApi = { listRoles, createRole, deleteRole };
