import type { Knex } from "knex";
import { hashPassword } from "@zordms/auth";
import { newId } from "@zordms/db";

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

// Rich integration_config rows — natural key is `system` (UNIQUE in migration).
// base_url uses Bhutan-bank internal hostnames on the BFS intranet (10.40.x.x range).
// auth_type matches the values checked by the webhook/connector layer.
//
// `secret` is the INBOUND HMAC secret used to verify signed webhooks that these
// systems POST to /webhooks/<system>/*. The seeded values below are LOCAL/DEV
// ONLY — they exist so the signed inbound chain can be demonstrated end-to-end
// out of the box. Rotate per environment via PUT /integration/systems/:id/inbound-secret.
// Signing recipe: signature header `x-zordms-signature: sha256=<hex>` where
// <hex> = HMAC-SHA256(secret, RAW request body bytes).
const RICH_SYSTEMS: Array<{
  system: string;
  base_url: string;
  auth_type: string;
  enabled: boolean;
  secret?: string;
}> = [
  // Core Banking System — TCS BaNCS hosted on BFS datacenter
  {
    system: "cbs",
    base_url: "https://bancs.bfs.internal:8443/api/v2",
    auth_type: "hmac",
    enabled: true,
    // LOCAL/DEV inbound HMAC secret — replace per environment.
    secret: "cbs-local-inbound-secret",
  },
  // Loan Origination System
  {
    system: "los",
    base_url: "https://los.bfs.internal/api/v1",
    auth_type: "hmac",
    enabled: true,
    // LOCAL/DEV inbound HMAC secret — replace per environment.
    secret: "los-local-inbound-secret",
  },
  // KYC / AML verification engine (Jumio on-prem relay)
  {
    system: "kyc",
    base_url: "https://kyc-engine.bfs.internal:9443/verify",
    auth_type: "hmac",
    enabled: true,
    // LOCAL/DEV inbound HMAC secret — replace per environment.
    secret: "kyc-local-inbound-secret",
  },
  // Active Directory / LDAP identity bridge
  {
    system: "active_directory",
    base_url: "ldaps://ad.bfs.internal:636",
    auth_type: "basic",
    enabled: true,
  },
  // Internal notification bus (RabbitMQ HTTP management API used as push target)
  {
    system: "notification_bus",
    base_url: "https://mq.bfs.internal:15671/api",
    auth_type: "bearer",
    enabled: true,
  },
  // Document object store — AWS S3-compatible (MinIO on BFS on-prem)
  {
    system: "s3",
    base_url: "https://minio.bfs.internal:9000",
    auth_type: "hmac",
    enabled: true,
  },
  // Legacy systems (enabled:false = disabled, shown as grey dots in UI)
  {
    system: "erp",
    base_url: "https://erp.bfs.internal/odata/v4",
    auth_type: "bearer",
    enabled: false,
  },
  {
    system: "crm",
    base_url: "https://crm.bfs.internal/api",
    auth_type: "bearer",
    enabled: true,
  },
  {
    system: "contact_center",
    base_url: "https://cc.bfs.internal:8080/ccaas",
    auth_type: "bearer",
    enabled: true,
  },
  // Mobile banking (mBOB — Mobile Bank of Bhutan)
  {
    system: "mbob",
    base_url: "https://mbob-gateway.bfs.internal/integration",
    auth_type: "hmac",
    enabled: true,
  },
  // Government portal (GoBOB — Government of Bhutan online services)
  {
    system: "gobob",
    base_url: "https://api.gobhutan.gov.bt/dms-relay/v1",
    auth_type: "hmac",
    enabled: true,
  },
  // Internet banking portal
  {
    system: "internet_banking",
    base_url: "https://ibank.bfs.internal/ib-api/v2",
    auth_type: "hmac",
    enabled: true,
  },
  // e-Signature provider (digital signing of approvals) — REST.
  {
    system: "esign",
    base_url: "https://esign.bfs.internal/api/v1",
    auth_type: "bearer",
    enabled: true,
  },
];

// 15 realistic integration log entries covering success (200), rate-limit (429),
// and error (500/503) cases across the key systems.
// Timestamps are spread across the past 48 hours for a believable activity graph.
// Natural key: integration_logs has no unique constraint — guard by checking row count
// so logs are only inserted when the table is empty (re-seed safe).
const SEED_LOGS: Array<{
  system: string;
  endpoint: string;
  method: string;
  status: number;
  latency_ms: number;
  direction: string;
  success: boolean;
  error: string | null;
  created_at: string;
}> = [
  // CBS — customer lookup (success)
  {
    system: "cbs",
    endpoint: "/api/v2/customers/CID-20240001",
    method: "GET",
    status: 200,
    latency_ms: 84,
    direction: "outbound",
    success: true,
    error: null,
    created_at: "2026-06-23 08:02:11",
  },
  // CBS — account balance query (success)
  {
    system: "cbs",
    endpoint: "/api/v2/accounts/ACC-BT-009812/balance",
    method: "GET",
    status: 200,
    latency_ms: 61,
    direction: "outbound",
    success: true,
    error: null,
    created_at: "2026-06-23 08:45:33",
  },
  // CBS — customer update pushed inbound via webhook
  {
    system: "cbs",
    endpoint: "cbs.customer.updated",
    method: "POST",
    status: 202,
    latency_ms: 12,
    direction: "inbound",
    success: true,
    error: null,
    created_at: "2026-06-23 09:10:05",
  },
  // CBS — rate-limit hit during batch reconciliation
  {
    system: "cbs",
    endpoint: "/api/v2/transactions/batch",
    method: "POST",
    status: 429,
    latency_ms: 23,
    direction: "outbound",
    success: false,
    error: "http_429_rate_limited",
    created_at: "2026-06-23 10:30:00",
  },
  // LOS — new loan application submitted
  {
    system: "los",
    endpoint: "/api/v1/applications",
    method: "POST",
    status: 201,
    latency_ms: 195,
    direction: "outbound",
    success: true,
    error: null,
    created_at: "2026-06-23 09:00:00",
  },
  // LOS — loan status inquiry (success)
  {
    system: "los",
    endpoint: "/api/v1/applications/APP-2026-04471/status",
    method: "GET",
    status: 200,
    latency_ms: 77,
    direction: "outbound",
    success: true,
    error: null,
    created_at: "2026-06-23 11:15:42",
  },
  // LOS — service temporarily unavailable (BaNCS batch window)
  {
    system: "los",
    endpoint: "/api/v1/applications/APP-2026-04472/disburse",
    method: "POST",
    status: 503,
    latency_ms: 5001,
    direction: "outbound",
    success: false,
    error: "http_503_service_unavailable",
    created_at: "2026-06-23 02:30:00",
  },
  // KYC — identity verification request (success, PASS)
  {
    system: "kyc",
    endpoint: "/verify/identity",
    method: "POST",
    status: 200,
    latency_ms: 340,
    direction: "outbound",
    success: true,
    error: null,
    created_at: "2026-06-23 09:05:22",
  },
  // KYC — result delivered inbound via webhook
  {
    system: "kyc",
    endpoint: "kyc.result",
    method: "POST",
    status: 202,
    latency_ms: 9,
    direction: "inbound",
    success: true,
    error: null,
    created_at: "2026-06-23 09:06:14",
  },
  // KYC — internal error on document scan endpoint
  {
    system: "kyc",
    endpoint: "/verify/document-scan",
    method: "POST",
    status: 500,
    latency_ms: 210,
    direction: "outbound",
    success: false,
    error: "http_500_internal_server_error",
    created_at: "2026-06-23 14:22:09",
  },
  // Active Directory — user attribute sync (success)
  {
    system: "active_directory",
    endpoint: "/ldap/users/sonam.dorji@bfs.internal",
    method: "GET",
    status: 200,
    latency_ms: 18,
    direction: "outbound",
    success: true,
    error: null,
    created_at: "2026-06-23 07:59:50",
  },
  // Notification Bus — document-ready event published (success)
  {
    system: "notification_bus",
    endpoint: "/api/exchanges/dms.events/publish",
    method: "POST",
    status: 200,
    latency_ms: 22,
    direction: "outbound",
    success: true,
    error: null,
    created_at: "2026-06-23 12:01:37",
  },
  // Notification Bus — push with bad credentials (401)
  {
    system: "notification_bus",
    endpoint: "/api/exchanges/dms.events/publish",
    method: "POST",
    status: 401,
    latency_ms: 14,
    direction: "outbound",
    success: false,
    error: "http_401_unauthorized",
    created_at: "2026-06-23 12:00:55",
  },
  // S3 — document upload (presigned PUT, success)
  {
    system: "s3",
    endpoint: "/dms-docs/2026/06/23/LOAN-DOC-APP-2026-04471.pdf",
    method: "PUT",
    status: 200,
    latency_ms: 512,
    direction: "outbound",
    success: true,
    error: null,
    created_at: "2026-06-23 09:02:41",
  },
  // S3 — presigned GET for document retrieval (success)
  {
    system: "s3",
    endpoint: "/dms-docs/2026/06/22/KYC-PASSPORT-CID-20240001.jpg",
    method: "GET",
    status: 200,
    latency_ms: 278,
    direction: "outbound",
    success: true,
    error: null,
    created_at: "2026-06-23 13:45:00",
  },
];

// Outbound webhooks — guard by URL natural key (URL + events combo is unique enough).
const SEED_WEBHOOKS: Array<{
  url: string;
  events: string;
  auth_method: string;
  secret: string | null;
  enabled: boolean;
}> = [
  // Core banking reconciliation sink — receives document-ingested events
  {
    url: "https://bancs.bfs.internal:8443/dms-callbacks/document-ingested",
    events: "document.ingested,document.approved,document.rejected",
    auth_method: "hmac",
    secret: "whsec_cbs_outbound_prod",
    enabled: true,
  },
  // LOS notification sink — loan document ready events
  {
    url: "https://los.bfs.internal/api/v1/webhooks/dms",
    events: "document.approved,kyc.result",
    auth_method: "hmac",
    secret: "whsec_los_outbound_prod",
    enabled: true,
  },
];

export async function seed(knex: Knex): Promise<void> {
  // permissions (idempotent — guard on natural key `key`)
  for (const [key, description] of BASE_PERMISSIONS) {
    const exists = await knex("permissions").where({ key }).first();
    if (!exists) await knex("permissions").insert({ id: newId(), key, description });
  }

  // roles + role_permissions (idempotent — guard on `name`)
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

  // bootstrap admin user if no users exist
  const userCount = Number((await knex("users").count<{ c: number }[]>("id as c"))[0].c);
  if (userCount === 0) {
    await knex("users").insert({
      id: newId(),
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

  // integration_config — rich rows with base_url and auth_type.
  // Idempotent: guard on `system` which is UNIQUE in the migration.
  // Rows that already exist (from a prior seed run) are left unchanged so
  // operator-set secrets and base_url overrides survive re-seeding.
  for (const s of RICH_SYSTEMS) {
    const exists = await knex("integration_config").where({ system: s.system }).first();
    if (!exists) {
      await knex("integration_config").insert({
        id: newId(),
        system: s.system,
        base_url: s.base_url,
        auth_type: s.auth_type,
        enabled: s.enabled,
        // Seed the LOCAL/DEV inbound HMAC secret when one is defined so the
        // signed inbound webhook chain works out of the box (consumed:true).
        secret: s.secret ?? null,
      });
    }
  }

  // integration_logs — only seed when the table is empty so re-seeding is safe
  // (logs accumulate at runtime; we never want to duplicate these fixtures).
  const logCount = Number((await knex("integration_logs").count<{ c: number }[]>("id as c"))[0].c);
  if (logCount === 0) {
    await knex("integration_logs").insert(SEED_LOGS.map((log) => ({ id: newId(), ...log })));
  }

  // outbound_webhooks — guard on `url` natural key (one row per target URL).
  for (const wh of SEED_WEBHOOKS) {
    const exists = await knex("outbound_webhooks").where({ url: wh.url }).first();
    if (!exists) {
      await knex("outbound_webhooks").insert({
        id: newId(),
        url: wh.url,
        events: wh.events,
        auth_method: wh.auth_method,
        secret: wh.secret,
        enabled: wh.enabled,
      });
    }
  }
}
