import type { Knex } from "knex";
import { hashPassword } from "@zordms/auth";
import { newId } from "@zordms/db";

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

// ── Alert rules ──────────────────────────────────────────────────────────────
// Each rule has a unique `name` used as the idempotency key.
const SAMPLE_RULES: Array<{
  name: string;
  trigger: string;
  params_json: string;
  channels: string;
  escalation_target: string | null;
  scope: string | null;
  enabled: boolean;
  created_by: string;
}> = [
  {
    name: "KYC/ID expiry — 60/30/7/0 day campaign",
    trigger: "document.expiring",
    params_json: JSON.stringify({ tiers: ["T-60", "T-30", "T-07", "T-00"], catalog: "KYC/Identity" }),
    channels: JSON.stringify(["email", "sms", "whatsapp", "inapp"]),
    escalation_target: null,
    scope: null,
    enabled: true,
    created_by: "system",
  },
  {
    name: "Workflow SLA breach escalation",
    trigger: "workflow.escalated",
    params_json: JSON.stringify({ sla_hours: 24 }),
    channels: JSON.stringify(["email", "teams", "inapp"]),
    escalation_target: "Supervisor",
    scope: null,
    enabled: true,
    created_by: "system",
  },
  {
    name: "OCR confidence below threshold",
    trigger: "ocr.low_confidence",
    params_json: JSON.stringify({ threshold: 0.72, requeue: true }),
    channels: JSON.stringify(["inapp", "email"]),
    escalation_target: "Indexer",
    scope: "ocr_pipeline",
    enabled: true,
    created_by: "system",
  },
  {
    name: "AML high-risk flag on new account",
    trigger: "aml.high_risk",
    params_json: JSON.stringify({ risk_score_min: 0.80, freeze_account: false }),
    channels: JSON.stringify(["email", "sms", "teams", "inapp"]),
    escalation_target: "Supervisor",
    scope: "AML/Compliance",
    enabled: true,
    created_by: "system",
  },
  {
    name: "Regulatory filing deadline — 3/1 day reminder",
    trigger: "document.expiring",
    params_json: JSON.stringify({ tiers: ["T-03", "T-01"], catalog: "Regulatory/Filing" }),
    channels: JSON.stringify(["email", "inapp"]),
    escalation_target: "CDO",
    scope: "Regulatory/Filing",
    enabled: true,
    created_by: "system",
  },
  {
    name: "Document approval overdue — Checker idle > 48 h",
    trigger: "workflow.approval_overdue",
    params_json: JSON.stringify({ idle_hours: 48, doc_types: ["Loan Agreement", "Mortgage Deed", "LC Application"] }),
    channels: JSON.stringify(["email", "teams", "inapp"]),
    escalation_target: "Supervisor",
    scope: null,
    enabled: true,
    created_by: "system",
  },
];

// ── Alerts ────────────────────────────────────────────────────────────────────
// Realistic in-app alerts for a Bhutan bank (BNB — Bhutan National Bank).
// `branch` values match real BNB branch codes.
// `meta` is stored as a JSON string; the API serialises it as-is.
// is_read mix: ~half read, ~half unread to make the Alerts screen interesting.
const SAMPLE_ALERTS: Array<{
  level: string;
  title: string;
  meta: string;
  is_read: boolean;
  branch: string;
}> = [
  // ── Critical ──
  {
    level: "critical",
    title: "AML high-risk flag: account A/C-00437812 (Paro Branch)",
    meta: JSON.stringify({
      account: "A/C-00437812",
      customer: "Tshering Wangchuk",
      risk_score: 0.93,
      triggered_rule: "AML high-risk flag on new account",
      branch: "Paro",
      action_required: "Freeze and escalate to Compliance Officer",
    }),
    is_read: false,
    branch: "Paro",
  },
  {
    level: "critical",
    title: "KYC document expired: Citizenship ID — Dorji Namgyel (Thimphu HQ)",
    meta: JSON.stringify({
      doc_id: "KYC-2021-0884",
      customer: "Dorji Namgyel",
      doc_type: "Citizenship ID",
      expiry_date: "2026-06-20",
      days_overdue: 4,
      branch: "Thimphu HQ",
      triggered_rule: "KYC/ID expiry — 60/30/7/0 day campaign",
    }),
    is_read: false,
    branch: "Thimphu HQ",
  },
  {
    level: "critical",
    title: "Workflow SLA breached: LC Application WF-2026-0912 stalled 31 h",
    meta: JSON.stringify({
      workflow_id: "WF-2026-0912",
      doc_type: "LC Application",
      submitted_by: "Kinley Dorji",
      sla_hours: 24,
      elapsed_hours: 31,
      pending_with: "Checker — Phuntsho Gyeltshen",
      branch: "Phuntsholing",
    }),
    is_read: false,
    branch: "Phuntsholing",
  },
  // ── Warning ──
  {
    level: "warning",
    title: "OCR confidence low (68 %): Mortgage Deed scan — batch OCR-2026-0623-14",
    meta: JSON.stringify({
      batch_id: "OCR-2026-0623-14",
      doc_type: "Mortgage Deed",
      pages_affected: 3,
      avg_confidence: 0.68,
      threshold: 0.72,
      requeued: true,
      branch: "Wangdue",
    }),
    is_read: false,
    branch: "Wangdue",
  },
  {
    level: "warning",
    title: "KYC document expiring in 7 days: Passport — Sonam Peldon (Punakha)",
    meta: JSON.stringify({
      doc_id: "KYC-2023-0317",
      customer: "Sonam Peldon",
      doc_type: "Passport",
      expiry_date: "2026-07-01",
      days_remaining: 7,
      branch: "Punakha",
      triggered_rule: "KYC/ID expiry — 60/30/7/0 day campaign",
    }),
    is_read: true,
    branch: "Punakha",
  },
  {
    level: "warning",
    title: "Regulatory filing deadline in 3 days: RMA Prudential Return Q2-2026",
    meta: JSON.stringify({
      filing_id: "REG-RMA-2026-Q2",
      filing_type: "RMA Prudential Return",
      deadline: "2026-06-27",
      days_remaining: 3,
      owner: "Compliance Team",
      branch: "Thimphu HQ",
      triggered_rule: "Regulatory filing deadline — 3/1 day reminder",
    }),
    is_read: false,
    branch: "Thimphu HQ",
  },
  {
    level: "warning",
    title: "Document approval overdue 52 h: Loan Agreement LA-2026-4421 (Bumthang)",
    meta: JSON.stringify({
      workflow_id: "WF-2026-1104",
      doc_id: "LA-2026-4421",
      doc_type: "Loan Agreement",
      submitted_by: "Ugyen Tshering",
      idle_hours: 52,
      pending_with: "Checker — Karma Wangmo",
      branch: "Bumthang",
    }),
    is_read: true,
    branch: "Bumthang",
  },
  // ── Info ──
  {
    level: "info",
    title: "KYC expiry reminder (30 days): Trade Licence — Choki Enterprises (Gelephu)",
    meta: JSON.stringify({
      doc_id: "KYC-2024-1122",
      customer: "Choki Enterprises",
      doc_type: "Trade Licence",
      expiry_date: "2026-07-24",
      days_remaining: 30,
      branch: "Gelephu",
      triggered_rule: "KYC/ID expiry — 60/30/7/0 day campaign",
    }),
    is_read: true,
    branch: "Gelephu",
  },
  {
    level: "info",
    title: "New user onboarded: Tenzin Norbu — Maker role, Samdrup Jongkhar Branch",
    meta: JSON.stringify({
      username: "tenzin.norbu",
      full_name: "Tenzin Norbu",
      role: "Maker",
      branch: "Samdrup Jongkhar",
      created_by: "admin",
    }),
    is_read: true,
    branch: "Samdrup Jongkhar",
  },
  {
    level: "info",
    title: "Batch OCR completed: 47 documents processed, 45 passed (Thimphu HQ)",
    meta: JSON.stringify({
      batch_id: "OCR-2026-0622-09",
      total: 47,
      passed: 45,
      failed: 2,
      avg_confidence: 0.91,
      branch: "Thimphu HQ",
    }),
    is_read: true,
    branch: "Thimphu HQ",
  },
  // ── Success ──
  {
    level: "success",
    title: "Workflow approved: Mortgage Deed MD-2026-0087 — customer Pema Lhamo (Haa)",
    meta: JSON.stringify({
      workflow_id: "WF-2026-0998",
      doc_id: "MD-2026-0087",
      doc_type: "Mortgage Deed",
      customer: "Pema Lhamo",
      approved_by: "Checker — Dechen Wangdi",
      elapsed_hours: 6,
      branch: "Haa",
    }),
    is_read: false,
    branch: "Haa",
  },
  {
    level: "success",
    title: "AML screening cleared: A/C-00501633 — Tashi Dema (Mongar Branch)",
    meta: JSON.stringify({
      account: "A/C-00501633",
      customer: "Tashi Dema",
      risk_score: 0.12,
      screened_by: "AML Engine v3.1",
      branch: "Mongar",
      cleared_at: "2026-06-23T08:14:00Z",
    }),
    is_read: true,
    branch: "Mongar",
  },
];

export async function seed(knex: Knex): Promise<void> {
  // permissions (idempotent)
  for (const [key, description] of PERMISSIONS) {
    const exists = await knex("permissions").where({ key }).first();
    if (!exists) await knex("permissions").insert({ id: newId(), key, description });
  }

  // roles + role_permissions (idempotent)
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
    if (adminUser && cdo) {
      await knex("user_roles").insert({ user_id: adminUser.id, role_id: cdo.id });
    }
  }

  // ZorFinoTech staff — mirrored from the gateway user store so notify can
  // resolve role/user notification targets to real email addresses. Idempotent
  // (upsert by username). Shared bootstrap password "Welcome2123".
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
        password_hash: await hashPassword("Welcome2123"),
        full_name: s.full_name,
        email: s.email,
        status: "Active",
        created_by: "system",
      });
      user = await knex("users").where({ id }).first();
    } else if (!user.email) {
      await knex("users").where({ id: user.id }).update({ email: s.email });
    }
    const role = await knex("roles").where({ name: s.role }).first();
    if (role) {
      const link = await knex("user_roles").where({ user_id: user.id, role_id: role.id }).first();
      if (!link) await knex("user_roles").insert({ user_id: user.id, role_id: role.id });
    }
  }

  // alert rules — idempotent on `name` (natural key)
  for (const rule of SAMPLE_RULES) {
    const exists = await knex("alert_rules").where({ name: rule.name }).first();
    if (!exists) await knex("alert_rules").insert({ id: newId(), ...rule });
  }

  // alerts — seed only when table is empty (tests insert their own rows)
  const alertCount = Number((await knex("alerts").count<{ c: number }[]>("id as c"))[0].c);
  if (alertCount === 0) {
    for (const alert of SAMPLE_ALERTS) await knex("alerts").insert({ id: newId(), ...alert });
  }
}
