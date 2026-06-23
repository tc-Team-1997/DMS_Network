import type { Knex } from "knex";
import { hashPassword } from "@zordms/auth";

const BASE_PERMISSIONS: Array<[string, string]> = [
  ["user:create", "Create users"],
  ["user:update", "Update users"],
  ["user:read", "View users"],
  ["role:assign", "Assign roles"],
  ["document:read", "View documents"],
  ["admin:access", "Access admin"],
  ["integration:read", "View integrations, request logs, and system status"],
  ["integration:manage", "Configure connectors and outbound webhooks"],
];

const ROLES: Record<string, string[]> = {
  CDO: BASE_PERMISSIONS.map(([k]) => k),
  Supervisor: ["user:create", "user:update", "user:read", "role:assign", "document:read", "admin:access", "integration:read"],
  Auditor: ["document:read", "integration:read"],
};

const SYSTEMS: Array<{ system: string; auth_type: string }> = [
  { system: "cbs", auth_type: "hmac" },
  { system: "los", auth_type: "hmac" },
  { system: "kyc", auth_type: "hmac" },
  { system: "erp", auth_type: "bearer" },
  { system: "crm", auth_type: "bearer" },
  { system: "contact_center", auth_type: "bearer" },
  { system: "mbob", auth_type: "hmac" },
  { system: "gobob", auth_type: "hmac" },
  { system: "internet_banking", auth_type: "hmac" },
];

export async function seed(knex: Knex): Promise<void> {
  // permissions (idempotent)
  for (const [key, description] of BASE_PERMISSIONS) {
    const exists = await knex("permissions").where({ key }).first();
    if (!exists) await knex("permissions").insert({ key, description });
  }

  // roles + role_permissions (idempotent)
  for (const [name, perms] of Object.entries(ROLES)) {
    let role = await knex("roles").where({ name }).first();
    if (!role) {
      await knex("roles").insert({ name, description: `${name} role`, system: true });
      role = await knex("roles").where({ name }).first();
    }
    for (const key of perms) {
      const perm = await knex("permissions").where({ key }).first();
      if (perm) {
        const link = await knex("role_permissions").where({ role_id: role.id, permission_id: perm.id }).first();
        if (!link) await knex("role_permissions").insert({ role_id: role.id, permission_id: perm.id });
      }
    }
  }

  // bootstrap admin user if no users exist
  const userCount = Number((await knex("users").count<{ c: number }[]>("id as c"))[0].c);
  if (userCount === 0) {
    await knex("users").insert({
      username: "admin",
      password_hash: await hashPassword("admin123"),
      full_name: "System Administrator",
      status: "Active",
      created_by: "system",
    });
    const adminUser = await knex("users").where({ username: "admin" }).first();
    const cdo = await knex("roles").where({ name: "CDO" }).first();
    if (adminUser && cdo) {
      await knex("user_roles").insert({ user_id: adminUser.id, role_id: cdo.id });
    }
  }

  // baseline connected-system config (idempotent; base_url/secret null → MOCK fallback)
  for (const s of SYSTEMS) {
    const exists = await knex("integration_config").where({ system: s.system }).first();
    if (!exists) await knex("integration_config").insert({ system: s.system, auth_type: s.auth_type, enabled: true });
  }
}
