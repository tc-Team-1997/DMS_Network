import type { Knex } from "knex";
import { hashPassword } from "@zordms/auth";
import { newId } from "@zordms/db";

// New permissions introduced by the Core DMS service
const CORE_PERMISSIONS: Array<[string, string]> = [
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
  ["folder:create", "Create repository folders"],
  ["folder:read", "Browse repository folders"],
  ["document:catalog", "Run auto-catalog"],
  ["document:map", "Run directory mapping"],
  ["annotation:write", "Create annotations/redactions/stamps"],
];

const ALL_PERM_KEYS = CORE_PERMISSIONS.map(([k]) => k);

const ROLES: Record<string, string[]> = {
  CDO: ALL_PERM_KEYS,
  Supervisor: ["user:create", "user:update", "user:read", "role:assign", "document:read", "admin:access", "folder:create", "folder:read", "document:catalog", "document:map"],
  Maker: ["document:capture", "document:index", "document:read", "workflow:act", "folder:read", "annotation:write"],
  Checker: ["document:approve", "document:reject", "document:read", "workflow:act", "folder:read"],
  Indexer: ["document:index", "document:read", "document:catalog", "document:map", "folder:read"],
  Viewer: ["document:read", "folder:read"],
  Auditor: ["document:read", "compliance:read", "crossbranch:read", "folder:read"],
};

export async function seed(knex: Knex): Promise<void> {
  // Ensure RBAC tables exist (users, roles, permissions, etc.)
  // This seed is idempotent
  for (const [key, description] of CORE_PERMISSIONS) {
    const exists = await knex("permissions").where({ key }).first();
    if (!exists) await knex("permissions").insert({ id: newId(), key, description });
  }

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

  // Bootstrap admin only if no users
  const userCount = Number((await knex("users").count<{ c: number }[]>("id as c"))[0].c);
  if (userCount === 0) {
    const password_hash = await hashPassword("admin123");
    const adminId = newId();
    await knex("users").insert({
      id: adminId,
      username: "admin",
      password_hash,
      full_name: "System Administrator",
      status: "Active",
      created_by: "system",
    });
    const adminUser = await knex("users").where({ username: "admin" }).first();
    const cdo = await knex("roles").where({ name: "CDO" }).first();
    await knex("user_roles").insert({ user_id: adminUser.id, role_id: cdo.id });
  }
}
