/**
 * Admin-managed Active Directory (LDAP) configuration, persisted in the
 * gateway's own `gateway_settings` table so operators can enable + configure AD
 * from the Administration UI — config-driven, no code/env change.
 *
 * Precedence: env vars (AUTH_LDAP_ENABLED / LDAP_*) still win when set, so a
 * locked-down deployment can pin config via env; otherwise the DB record drives
 * it. `bindCredentials` is write-only (never returned to the client).
 */
import type { Knex } from "knex";
import type { AuthConfig, LdapConfig } from "./authConfig.js";

const KEY = "auth_ldap";

/** Admin-editable subset of LdapConfig (the secret is set separately/write-only). */
export interface AdConfigInput {
  enabled?: boolean;
  displayName?: string;
  url?: string;
  bindDN?: string;
  bindCredentials?: string;
  searchBase?: string;
  searchFilter?: string;
  groupAttr?: string;
  groupRoleMap?: Record<string, string>;
}

/** Read the stored AD overrides (or null if none / table absent). */
export async function readAdConfig(knex: Knex): Promise<Partial<LdapConfig> | null> {
  try {
    if (!(await knex.schema.hasTable("gateway_settings"))) return null;
    const row = await knex("gateway_settings").where({ key: KEY }).first();
    if (!row) return null;
    return JSON.parse(row.value) as Partial<LdapConfig>;
  } catch {
    return null;
  }
}

/** Upsert AD overrides; merges over any existing record. */
export async function writeAdConfig(knex: Knex, patch: AdConfigInput, updatedBy?: string): Promise<Partial<LdapConfig>> {
  const current = (await readAdConfig(knex)) ?? {};
  const next: Partial<LdapConfig> = { ...current };
  for (const k of ["enabled", "displayName", "url", "bindDN", "searchBase", "searchFilter", "groupAttr", "groupRoleMap"] as const) {
    if (patch[k] !== undefined) (next as Record<string, unknown>)[k] = patch[k];
  }
  // Secret: only overwrite when a non-empty value is supplied.
  if (patch.bindCredentials !== undefined && patch.bindCredentials !== "") {
    next.bindCredentials = patch.bindCredentials;
  }
  const existing = await knex("gateway_settings").where({ key: KEY }).first();
  const value = JSON.stringify(next);
  if (existing) {
    await knex("gateway_settings").where({ key: KEY }).update({ value, updated_by: updatedBy ?? null, updated_at: knex.fn.now() });
  } else {
    await knex("gateway_settings").insert({ key: KEY, value, updated_by: updatedBy ?? null });
  }
  return next;
}

/**
 * Produce the effective AuthConfig by overlaying the DB AD record on top of the
 * env-loaded base — but ONLY for fields the env did not explicitly set. Env
 * always wins so a pinned deployment is never overridden by the UI.
 */
export function mergeAdConfig(base: AuthConfig, db: Partial<LdapConfig> | null, env: NodeJS.ProcessEnv = process.env): AuthConfig {
  if (!db) return base;
  const ldap: LdapConfig = { ...base.ldap };
  const mutable = ldap as unknown as Record<string, unknown>;
  const setFromDb = <K extends keyof LdapConfig>(field: K, envKey: string) => {
    if (env[envKey] === undefined && db[field] !== undefined) {
      mutable[field as string] = db[field] as unknown;
    }
  };
  setFromDb("enabled", "AUTH_LDAP_ENABLED");
  setFromDb("displayName", "LDAP_DISPLAY_NAME");
  setFromDb("url", "LDAP_URL");
  setFromDb("bindDN", "LDAP_BIND_DN");
  setFromDb("bindCredentials", "LDAP_BIND_CREDENTIALS");
  setFromDb("searchBase", "LDAP_SEARCH_BASE");
  setFromDb("searchFilter", "LDAP_SEARCH_FILTER");
  setFromDb("groupAttr", "LDAP_GROUP_ATTR");
  setFromDb("groupRoleMap", "LDAP_GROUP_ROLE_MAP");
  return { ...base, ldap };
}

/** Public (secret-stripped) view of the effective AD config for the admin UI. */
export function publicAdConfig(ldap: LdapConfig): Omit<LdapConfig, "bindCredentials"> & { hasBindCredentials: boolean } {
  const { bindCredentials, ...rest } = ldap;
  return { ...rest, hasBindCredentials: Boolean(bindCredentials) };
}
