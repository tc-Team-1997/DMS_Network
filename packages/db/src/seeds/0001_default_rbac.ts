import type { Knex } from "knex";
import bcrypt from "bcryptjs";
import { newId } from "../id.js";

// Canonical permission catalog — the UNION of every permission the app checks
// (React route gates + screen action guards + backend requirePermission calls).
// The gateway is the sole issuer of JWT claims, so this catalog is authoritative.
const PERMISSIONS: Array<[string, string]> = [
  // Identity / admin
  ["user:create", "Create users"],
  ["user:update", "Update users"],
  ["user:read", "View users"],
  ["role:assign", "Assign roles"],
  ["security:read", "View security & access control"],
  ["admin:access", "Access admin actions"],
  ["admin:read", "View administration"],
  // Documents
  ["document:capture", "Capture documents"],
  ["document:index", "Index documents"],
  ["document:read", "View documents"],
  ["document:approve", "Approve documents"],
  ["document:reject", "Reject documents"],
  ["document:delete", "Delete documents"],
  ["document:catalog", "Run auto-catalog"],
  ["document:map", "Run directory mapping"],
  ["annotation:write", "Create/redact annotations"],
  ["folder:read", "View folders"],
  ["folder:create", "Create folders"],
  // Dashboard / discovery
  ["dashboard:read", "View dashboard"],
  ["search:read", "Use enterprise search"],
  ["lifecycle:read", "View document lifecycle"],
  ["customer:read", "View Customer 360"],
  // Workflow / cases
  ["workflow:read", "View workflows"],
  ["workflow:act", "Act on workflows"],
  ["workflow:escalate", "Escalate workflows"],
  ["workflow:hold", "Hold workflows"],
  ["case:read", "View cases"],
  ["case:create", "Create cases"],
  ["case:manage", "Manage cases"],
  // AI / IDP
  ["ai:read", "View AI engine"],
  ["ai:write", "Run AI processing"],
  ["review:read", "View human-review queue"],
  ["review:write", "Claim/resolve reviews"],
  // Alerts
  ["alerts:read", "View alerts"],
  ["alert:read", "View alerts"],
  ["alert:manage", "Manage alerts"],
  ["alert_rule:manage", "Manage alert rules"],
  ["email_template:read", "View email templates"],
  ["email_template:manage", "Create and edit email templates"],
  // Records / compliance
  ["records:read", "View records management"],
  ["legal_hold:place", "Place legal holds"],
  ["compliance:read", "View compliance & audit"],
  // Branch / cross-branch
  ["branch:read", "View branch network"],
  ["crossbranch:read", "Read across branches"],
  // Integration
  ["integration:read", "View integrations"],
  ["integration:manage", "Manage integrations"],
  // Document-type registry administration
  ["doctype:write", "Manage document types and per-type metadata field schemas"],
];

const ALL = PERMISSIONS.map(([k]) => k);
const READS = ALL.filter((k) => k.endsWith(":read"));

const ROLES: Record<string, string[]> = {
  // Chief Documentation Officer — every permission.
  CDO: ALL,
  // Supervisor — user administration + read-only oversight everywhere.
  Supervisor: [
    "user:create", "user:update", "user:read", "role:assign",
    "security:read", "admin:access", "admin:read", "integration:manage",
    "doctype:write", "email_template:manage",
    ...READS,
  ],
  // Maker — capture / index / submit.
  Maker: [
    "document:capture", "document:index", "document:read", "document:catalog",
    "document:map", "annotation:write", "folder:read", "folder:create",
    "workflow:act", "ai:write",
    "dashboard:read", "search:read", "document:read", "workflow:read",
    "case:read", "case:create", "ai:read", "review:read", "alerts:read",
    "alert:read", "customer:read", "lifecycle:read",
  ],
  // Checker — approve / reject / escalate.
  Checker: [
    "document:approve", "document:reject", "document:read",
    "workflow:act", "workflow:escalate", "workflow:hold", "case:manage",
    "dashboard:read", "search:read", "workflow:read", "case:read",
    "alerts:read", "alert:read", "customer:read", "review:read", "compliance:read",
  ],
  // Indexer — indexing + AI assist.
  Indexer: [
    "document:index", "document:read", "document:catalog", "document:map",
    "annotation:write", "folder:read", "ai:read", "ai:write",
    "review:read", "review:write", "dashboard:read", "search:read",
  ],
  // Viewer — read-only.
  Viewer: [
    "document:read", "folder:read", "dashboard:read", "search:read",
    "customer:read", "lifecycle:read", "alerts:read", "alert:read",
  ],
  // Auditor — compliance + cross-branch read.
  Auditor: [
    "document:read", "compliance:read", "crossbranch:read", "records:read",
    "lifecycle:read", "branch:read", "customer:read", "security:read",
    "admin:read", "integration:read", "dashboard:read", "search:read",
    "alerts:read", "alert:read",
  ],
};

export async function seed(knex: Knex): Promise<void> {
  // permissions — upsert by key, generating UUIDs for new rows
  const permIdMap: Record<string, string> = {};
  for (const [key, description] of PERMISSIONS) {
    const exists = await knex("permissions").where({ key }).first();
    if (exists) {
      permIdMap[key] = exists.id;
    } else {
      const id = newId();
      await knex("permissions").insert({ id, key, description });
      permIdMap[key] = id;
    }
  }

  // roles + role_permissions — upsert by name, generating UUIDs for new rows
  for (const [name, perms] of Object.entries(ROLES)) {
    let role = await knex("roles").where({ name }).first();
    if (!role) {
      const id = newId();
      await knex("roles").insert({ id, name, description: `${name} role`, system: true });
      role = await knex("roles").where({ name }).first();
    }
    for (const key of perms) {
      const permId = permIdMap[key];
      if (permId) {
        const link = await knex("role_permissions").where({ role_id: role.id, permission_id: permId }).first();
        if (!link) await knex("role_permissions").insert({ role_id: role.id, permission_id: permId });
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
      password_hash: bcrypt.hashSync("admin123", 10),
      full_name: "System Administrator",
      email: "admin@bobl.bt",
      status: "Active",
      created_by: "system",
    });
    const cdo = await knex("roles").where({ name: "CDO" }).first();
    await knex("user_roles").insert({ user_id: adminId, role_id: cdo.id });
  }

  // Named ZorFinoTech staff accounts — idempotent (upsert by username).
  // Password is the shared bootstrap secret "Welcome2123"; rotate in prod.
  const STAFF: Array<{ username: string; full_name: string; email: string; role: string }> = [
    { username: "pema",             full_name: "Pema",             email: "pema@zorfinotech.com",             role: "CDO" },
    { username: "jigme",            full_name: "Jigme",            email: "jigme@zorfinotech.com",            role: "Supervisor" },
    { username: "amit.katoch",      full_name: "Amit Katoch",      email: "amit.katoch@zorfinotech.com",      role: "Supervisor" },
    { username: "basant.neupane",   full_name: "Basant Neupane",   email: "basant.neupane@zorfinotech.com",   role: "CDO" },
    { username: "taniya.chaudhary", full_name: "Taniya Chaudhary", email: "taniya.chaudhary@zorfinotech.com", role: "Checker" },
  ];
  for (const s of STAFF) {
    let user = await knex("users").where({ username: s.username }).first();
    if (!user) {
      const id = newId();
      await knex("users").insert({
        id,
        username: s.username,
        password_hash: bcrypt.hashSync("Welcome2123", 10),
        full_name: s.full_name,
        email: s.email,
        status: "Active",
        created_by: "system",
      });
      user = await knex("users").where({ id }).first();
    }
    const role = await knex("roles").where({ name: s.role }).first();
    if (role) {
      const link = await knex("user_roles").where({ user_id: user.id, role_id: role.id }).first();
      if (!link) await knex("user_roles").insert({ user_id: user.id, role_id: role.id });
    }
  }
}
