import type { Knex } from "knex";
import type { Recipient } from "../engine/ruleEngine.js";

export interface ResolvedRecipient { channel: "email" | "sms"; address: string; userId?: number; }

export async function resolveEscalationRecipients(recipients: Recipient[], deps: { knex: Knex }): Promise<ResolvedRecipient[]> {
  const out: ResolvedRecipient[] = [];
  for (const r of recipients) {
    if (r.kind === "external") {
      out.push({ channel: "sms", address: r.value });
      continue;
    }
    if (r.kind === "user") {
      const u = await deps.knex("users").where({ username: r.value }).first();
      if (u?.email) out.push({ channel: "email", address: u.email, userId: u.id });
      continue;
    }
    // role: every active member of the RBAC role
    if (await deps.knex.schema.hasTable("user_roles")) {
      const members = await deps.knex("users as u")
        .join("user_roles as ur", "ur.user_id", "u.id")
        .join("roles as ro", "ro.id", "ur.role_id")
        .where("ro.name", r.value)
        .andWhere("u.status", "Active")
        .select("u.id as id", "u.email as email");
      for (const m of members) {
        if (m.email) out.push({ channel: "email", address: m.email, userId: m.id });
      }
    }
  }
  return out;
}
