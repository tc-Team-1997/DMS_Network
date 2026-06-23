import type { Knex } from "knex";
import bcrypt from "bcryptjs";

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
  CDO: PERMISSIONS.map(([k]) => k), // full
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
    if (!exists) await knex("permissions").insert({ key, description });
  }
  // roles + role_permissions
  for (const [name, perms] of Object.entries(ROLES)) {
    let role = await knex("roles").where({ name }).first();
    if (!role) {
      const [id] = await knex("roles").insert({ name, description: `${name} role`, system: true }).returning("id");
      role = { id: typeof id === "object" ? (id as any).id : id };
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
    const [uid] = await knex("users").insert({
      username: "admin",
      password_hash: bcrypt.hashSync("admin123", 10),
      full_name: "System Administrator",
      status: "Active",
      created_by: "system",
    }).returning("id");
    const userId = typeof uid === "object" ? (uid as any).id : uid;
    const cdo = await knex("roles").where({ name: "CDO" }).first();
    await knex("user_roles").insert({ user_id: userId, role_id: cdo.id });
  }
}
