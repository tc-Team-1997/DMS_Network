import type { Knex } from "knex";

export interface Authz { roles: string[]; permissions: string[]; }

export async function resolveUserAuthz(knex: Knex, userId: number): Promise<Authz> {
  const roleRows = await knex("user_roles as ur")
    .join("roles as r", "r.id", "ur.role_id")
    .where("ur.user_id", userId)
    .select("r.id as id", "r.name as name");

  const roleIds = roleRows.map((r) => r.id);
  const roles = roleRows.map((r) => r.name);

  let permissions: string[] = [];
  if (roleIds.length) {
    const permRows = await knex("role_permissions as rp")
      .join("permissions as p", "p.id", "rp.permission_id")
      .whereIn("rp.role_id", roleIds)
      .distinct("p.key as key");
    permissions = permRows.map((p) => p.key);
  }
  return { roles, permissions };
}

export function can(authz: { permissions: string[] }, required: string): boolean {
  return authz.permissions.includes(required);
}

export function canAll(authz: { permissions: string[] }, required: string[]): boolean {
  if (required.length === 0) return false;
  return required.every((r) => authz.permissions.includes(r));
}
