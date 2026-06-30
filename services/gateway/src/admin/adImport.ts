import type { Knex } from "knex";
import { newId } from "@zordms/db";
import { writeAudit } from "../middleware/audit.js";
import { SSO_NOLOGIN_HASH, type ExternalIdentity } from "../sso/jit.js";

/**
 * §4.12 Admin — AD / bulk user import.
 *
 * Provisions local users from a set of directory identities (idempotent
 * find-or-create, IdP-group→role mapping, dry-run). Federated accounts get the
 * SSO sentinel password hash, so they can't local-login until an admin sets a
 * password — identical to SSO JIT provisioning.
 *
 * The identities come from an AdDirectory source. The tested/manual source is an
 * inline list; the live LDAP-search adapter (reusing the gateway's SSO LDAP_*
 * config) is the pluggable production source — same shape, swapped in by config.
 */
export interface AdDirectory {
  readonly name: string;
  listUsers(opts?: { groupFilter?: string }): Promise<ExternalIdentity[]>;
}

/** Inline source — identities supplied directly (manual import / tests). */
export class InlineAdDirectory implements AdDirectory {
  readonly name = "inline";
  constructor(private readonly users: ExternalIdentity[]) {}
  async listUsers(): Promise<ExternalIdentity[]> {
    return this.users;
  }
}

export interface ImportSummary {
  found: number;
  created: number;
  skipped: number;
  failed: number;
  dryRun: boolean;
}

function mappedRoles(groups: string[] | undefined, groupRoleMap: Record<string, string>): string[] {
  if (!groups?.length) return [];
  const out = new Set<string>();
  for (const g of groups) if (groupRoleMap[g]) out.add(groupRoleMap[g]);
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
 * Find-or-create each identity. Idempotent: an identity already present (by email
 * then username) is skipped. dry-run reports would-create counts without writing.
 */
export async function provisionUsers(
  knex: Knex,
  identities: ExternalIdentity[],
  opts: { defaultRole: string; groupRoleMap?: Record<string, string>; actor: string; dryRun?: boolean },
): Promise<ImportSummary> {
  let found = 0, created = 0, skipped = 0, failed = 0;
  const dryRun = !!opts.dryRun;

  for (const idn of identities) {
    found++;
    const username = idn.username?.trim() || idn.email?.trim();
    if (!username) { failed++; continue; }
    const email = idn.email?.trim() || null;

    let user = email ? await knex("users").where({ email }).first() : null;
    if (!user) user = await knex("users").where({ username }).first();
    if (user) { skipped++; continue; }

    if (dryRun) { created++; continue; } // would-create

    const id = newId();
    await knex("users").insert({
      id,
      username,
      password_hash: SSO_NOLOGIN_HASH,
      full_name: idn.displayName ?? username,
      email,
      status: "Active",
      created_by: `ad-import:${opts.actor}`,
    });
    const roles = mappedRoles(idn.groups, opts.groupRoleMap ?? {});
    await assignRolesByName(knex, id, roles.length ? roles : [opts.defaultRole]);
    await writeAudit(knex, {
      actor_username: opts.actor, action: "AD_IMPORT_PROVISION", entity: "user", entity_id: id,
      details: `roles=${(roles.length ? roles : [opts.defaultRole]).join(",")}`,
    });
    created++;
  }

  return { found, created, skipped, failed, dryRun };
}
