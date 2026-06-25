// Shared JIT (Just-In-Time) identity mapping + internal JWT minting for SSO.
//
// Contract: the IdP supplies *identity only*. Authorization ALWAYS comes from
// the local RBAC tables via resolveUserAuthz — the same path local login uses —
// so a federated user gets exactly the roles/permissions the gateway's own
// tables grant them. The IdP's groups can, at most, seed roles on first login
// (and re-sync on subsequent logins) when a group->role map is configured.

import type { Knex } from "knex";
import type { AppConfig } from "@zordms/config";
import { signToken, resolveUserAuthz } from "@zordms/auth";
import { newId } from "@zordms/db";
import { writeAudit } from "../middleware/audit.js";

/**
 * Sentinel password hash for SSO-provisioned users. This is NOT a valid bcrypt
 * hash, so bcrypt.compare() (verifyPassword) can never succeed against it —
 * federated accounts therefore cannot be used for local username/password login
 * unless an admin later sets a real password.
 */
export const SSO_NOLOGIN_HASH = "!SSO-NOLOGIN";

export interface ExternalIdentity {
  email?: string;
  username?: string;
  displayName?: string;
  groups?: string[];
}

export interface JitResult {
  token: string;
  user: {
    id: string;
    username: string;
    roles: string[];
    permissions: string[];
    branch?: string | null;
    region?: string | null;
  };
  provisioned: boolean;
}

function deriveUsername(identity: ExternalIdentity): string | null {
  if (identity.username && identity.username.trim()) return identity.username.trim();
  if (identity.email && identity.email.trim()) return identity.email.trim();
  return null;
}

/** Map IdP group names to local role names via the provider's group->role map. */
function mappedRoles(groups: string[] | undefined, groupRoleMap: Record<string, string>): string[] {
  if (!groups || !groups.length) return [];
  const out = new Set<string>();
  for (const g of groups) {
    const role = groupRoleMap[g];
    if (role) out.add(role);
  }
  return [...out];
}

async function assignRolesByName(knex: Knex, userId: string, roleNames: string[]): Promise<void> {
  if (!roleNames.length) return;
  const roles = await knex("roles").whereIn("name", roleNames).select("id");
  for (const role of roles) {
    const existing = await knex("user_roles").where({ user_id: userId, role_id: role.id }).first();
    if (!existing) await knex("user_roles").insert({ user_id: userId, role_id: role.id });
  }
}

/**
 * Find-or-provision a local user from a verified external identity, then mint
 * the SAME internal JWT local login issues. Idempotent: repeated logins for the
 * same identity reuse the existing local user.
 */
export async function mapAndIssue(
  knex: Knex,
  config: AppConfig,
  identity: ExternalIdentity,
  opts: { provider: string; defaultRole: string; groupRoleMap: Record<string, string> },
): Promise<JitResult> {
  const username = deriveUsername(identity);
  if (!username) {
    throw new Error("external identity has neither username nor email");
  }
  const email = identity.email?.trim() || null;

  // Match by email first (stable IdP key), then by username.
  let user: any = null;
  if (email) user = await knex("users").where({ email }).first();
  if (!user) user = await knex("users").where({ username }).first();

  let provisioned = false;
  const idpRoles = mappedRoles(identity.groups, opts.groupRoleMap);

  if (!user) {
    const id = newId();
    await knex("users").insert({
      id,
      username,
      password_hash: SSO_NOLOGIN_HASH,
      full_name: identity.displayName ?? username,
      email,
      status: "Active",
      created_by: `sso:${opts.provider}`,
    });
    // Seed roles: IdP-group-mapped roles if any, else the configured default.
    await assignRolesByName(knex, id, idpRoles.length ? idpRoles : [opts.defaultRole]);
    user = await knex("users").where({ id }).first();
    provisioned = true;
    await writeAudit(knex, {
      actor_id: id,
      actor_username: username,
      action: "SSO_PROVISION",
      entity: "user",
      entity_id: id,
      details: opts.provider,
    });
  } else if (idpRoles.length) {
    // Existing user: re-sync any IdP-group-mapped roles (additive, idempotent).
    await assignRolesByName(knex, user.id, idpRoles);
  }

  // Authorization ALWAYS from local RBAC tables — identical to local login.
  const authz = await resolveUserAuthz(knex, user.id as any);
  const token = signToken(
    {
      sub: user.id,
      username: user.username,
      roles: authz.roles,
      permissions: authz.permissions,
      branch: user.branch ?? undefined,
      region: user.region ?? undefined,
    },
    config.jwtSecret,
  );

  await writeAudit(knex, {
    actor_id: user.id,
    actor_username: user.username,
    action: "LOGIN",
    details: `sso:${opts.provider}`,
  });

  return {
    token,
    user: {
      id: user.id,
      username: user.username,
      roles: authz.roles,
      permissions: authz.permissions,
      branch: user.branch,
      region: user.region,
    },
    provisioned,
  };
}
