import type { Knex } from "knex";
import { newId } from "@zordms/db";

// bcrypt hash of "admin123" with salt rounds=10 (pre-computed to avoid bcryptjs dep in tests)
const ADMIN_PASSWORD_HASH = "$2b$10$3euPcmQFCiblsZeEu5s7p.9OVHgeHh/e3LkYBo1mW.jemjA6EsrRC";

const PERMISSIONS: Array<[string, string]> = [
  ["user:create", "Create users"],
  ["user:update", "Update users"],
  ["user:read", "View users"],
  ["role:assign", "Assign roles"],
  ["document:capture", "Capture documents"],
  ["document:index", "Index documents"],
  ["document:read", "View documents"],
  ["document:approve", "Approve documents"],
  ["document:reject", "Reject documents"],
  ["document:delete", "Delete documents"],
  ["workflow:act", "Act on workflows"],
  ["legal_hold:place", "Place legal holds"],
  ["compliance:read", "View compliance"],
  ["admin:access", "Access admin"],
  ["crossbranch:read", "Read across branches"],
];

const ROLES: Record<string, string[]> = {
  CDO: PERMISSIONS.map(([k]) => k),
  Supervisor: ["user:create", "user:update", "user:read", "role:assign", "document:read", "admin:access"],
  Maker: ["document:capture", "document:index", "document:read", "workflow:act"],
  Checker: ["document:approve", "document:reject", "document:read", "workflow:act"],
  Indexer: ["document:index", "document:read"],
  Viewer: ["document:read"],
  Auditor: ["document:read", "compliance:read", "crossbranch:read"],
};

export async function seed(knex: Knex): Promise<void> {
  // permissions
  for (const [key, description] of PERMISSIONS) {
    const exists = await knex("permissions").where({ key }).first();
    if (!exists) await knex("permissions").insert({ id: newId(), key, description });
  }
  // roles + role_permissions
  for (const [name, perms] of Object.entries(ROLES)) {
    let role = await knex("roles").where({ name }).first();
    if (!role) {
      await knex("roles").insert({ id: newId(), name, description: `${name} role`, system: true });
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
  // bootstrap admin only if no users
  const userCount = Number((await knex("users").count<{ c: number }[]>("id as c"))[0].c);
  if (userCount === 0) {
    const adminId = newId();
    await knex("users").insert({
      id: adminId,
      username: "admin",
      password_hash: ADMIN_PASSWORD_HASH,
      full_name: "System Administrator",
      email: "admin@bobl.bt",
      status: "Active",
      created_by: "system",
    });
    const adminUser = await knex("users").where({ username: "admin" }).first();
    const cdo = await knex("roles").where({ name: "CDO" }).first();
    await knex("user_roles").insert({ user_id: adminUser.id, role_id: cdo.id });
  }
}
