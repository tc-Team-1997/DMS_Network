import type { Knex } from "knex";
import { hashPassword } from "@zordms/auth";

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
  ["alert:read", "View alerts and notifications"],
  ["alert:manage", "Mark-read / escalate alerts"],
  ["alert_rule:manage", "Create and edit alert rules"],
];

const ROLES: Record<string, string[]> = {
  CDO: PERMISSIONS.map(([k]) => k), // full
  Supervisor: ["user:create", "user:update", "user:read", "role:assign", "document:read", "admin:access", "alert:read", "alert:manage", "alert_rule:manage"],
  Maker: ["document:capture", "document:index", "document:read", "workflow:act", "alert:read"],
  Checker: ["document:approve", "document:reject", "document:read", "workflow:act", "alert:read"],
  Indexer: ["document:index", "document:read", "alert:read"],
  Viewer: ["document:read", "alert:read"],
  Auditor: ["document:read", "compliance:read", "crossbranch:read", "alert:read"],
};

const SAMPLE_RULES = [
  {
    name: "KYC/ID expiry — 60/30/7/0 day campaign",
    trigger: "document.expiring",
    params_json: JSON.stringify({ tiers: ["T-60", "T-30", "T-07", "T-00"], catalog: "KYC/Identity" }),
    channels: JSON.stringify(["email", "sms", "whatsapp", "inapp"]),
    escalation_target: null as string | null,
    scope: null as string | null,
    enabled: true,
    created_by: "system",
  },
  {
    name: "Workflow SLA breach escalation",
    trigger: "workflow.escalated",
    params_json: JSON.stringify({ sla_hours: 24 }),
    channels: JSON.stringify(["email", "teams", "inapp"]),
    escalation_target: "Supervisor",
    scope: null as string | null,
    enabled: true,
    created_by: "system",
  },
];

export async function seed(knex: Knex): Promise<void> {
  // permissions (idempotent)
  for (const [key, description] of PERMISSIONS) {
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

  // bootstrap admin only if no users
  const userCount = Number((await knex("users").count<{ c: number }[]>("id as c"))[0].c);
  if (userCount === 0) {
    const password_hash = await hashPassword("admin123");
    await knex("users").insert({
      username: "admin",
      password_hash,
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

  // sample rules only if empty
  const count = Number((await knex("alert_rules").count<{ c: number }[]>("id as c"))[0].c);
  if (count === 0) {
    for (const rule of SAMPLE_RULES) await knex("alert_rules").insert(rule);
  }
}
