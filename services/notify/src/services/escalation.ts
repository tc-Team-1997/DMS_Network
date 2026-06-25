import type { Knex } from "knex";
import type { Recipient } from "../engine/ruleEngine.js";

export interface ResolvedRecipient { channel: "email" | "sms"; address: string; userId?: string; }

/**
 * Resolve abstract notification targets (RBAC role, group, username, or an
 * external contact) into concrete delivery addresses.
 *
 * User-store access: this matches the existing notify pattern — notify is
 * DB-per-service and carries its own RBAC tables (users / roles / user_roles),
 * populated by the same seed/migration shape as the gateway users API. We
 * therefore resolve against the LOCAL knex `users` store (the same store
 * escalation already used) rather than introducing a new outbound HTTP/auth
 * path to the gateway.
 *
 * Behaviour:
 *  - `external`  → SMS address, taken verbatim.
 *  - `user`      → that user's email (skipped + warned if no email on file).
 *  - `role`/`group` → every Active member of the named RBAC role/group, by email.
 *  - Duplicate addresses (same channel + address) are de-duplicated.
 *  - Active members with a missing/blank email are skipped with a warning.
 */
export async function resolveRecipients(
  recipients: Recipient[],
  deps: { knex: Knex },
): Promise<ResolvedRecipient[]> {
  const out: ResolvedRecipient[] = [];
  const seen = new Set<string>();

  const push = (r: ResolvedRecipient): void => {
    const key = `${r.channel}:${r.address.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(r);
  };

  const hasUserRoles = await deps.knex.schema.hasTable("user_roles");

  for (const r of recipients) {
    if (r.kind === "external") {
      if (r.value) push({ channel: "sms", address: r.value });
      continue;
    }

    if (r.kind === "user") {
      const u = await deps.knex("users").where({ username: r.value }).first();
      if (u?.email) {
        push({ channel: "email", address: u.email, userId: u.id });
      } else {
        console.warn(`[notify resolve] user "${r.value}" has no email on file — skipped`);
      }
      continue;
    }

    // role | group → every Active member of the named RBAC role/group
    if (!hasUserRoles) {
      console.warn(`[notify resolve] no user_roles table — cannot resolve ${r.kind} "${r.value}"`);
      continue;
    }
    const members = await deps.knex("users as u")
      .join("user_roles as ur", "ur.user_id", "u.id")
      .join("roles as ro", "ro.id", "ur.role_id")
      .where("ro.name", r.value)
      .andWhere("u.status", "Active")
      .select("u.id as id", "u.email as email", "u.username as username");
    if (members.length === 0) {
      console.warn(`[notify resolve] ${r.kind} "${r.value}" has no active members`);
    }
    for (const m of members) {
      if (m.email) {
        push({ channel: "email", address: m.email, userId: m.id });
      } else {
        console.warn(`[notify resolve] user "${m.username}" in ${r.kind} "${r.value}" has no email — skipped`);
      }
    }
  }

  return out;
}

/** @deprecated kept for back-compat; prefer {@link resolveRecipients}. */
export const resolveEscalationRecipients = resolveRecipients;
