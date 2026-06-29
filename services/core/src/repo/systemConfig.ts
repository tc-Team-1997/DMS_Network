import type { Knex } from "knex";
import { newId } from "@zordms/db";

/**
 * Repository for the system_config key/value store (§4.13).
 * `value` is persisted JSON-encoded; callers see the decoded value.
 */

export interface ConfigEntry {
  key: string;
  value: unknown;
  category: string | null;
  description: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
}

function rowToEntry(row: Record<string, unknown>): ConfigEntry {
  let value: unknown = null;
  try {
    value = JSON.parse(String(row.value));
  } catch {
    // Tolerate a legacy/plain string value rather than throwing on read.
    value = row.value ?? null;
  }
  return {
    key: String(row.key),
    value,
    category: (row.category as string) ?? null,
    description: (row.description as string) ?? null,
    updatedBy: (row.updated_by as string) ?? null,
    updatedAt: (row.updated_at as string) ?? null,
  };
}

/** List all config entries, optionally filtered by category, ordered by key. */
export async function listConfig(knex: Knex, category?: string): Promise<ConfigEntry[]> {
  let q = knex("system_config").select("*").orderBy("key", "asc");
  if (category) q = q.where({ category });
  const rows = await q;
  return rows.map(rowToEntry);
}

/** Fetch a single config entry by key, or null if absent. */
export async function getConfig(knex: Knex, key: string): Promise<ConfigEntry | null> {
  const row = await knex("system_config").where({ key }).first();
  return row ? rowToEntry(row) : null;
}

/** Upsert a config entry (insert-or-update by key) and return the new state. */
export async function setConfig(
  knex: Knex,
  input: { key: string; value: unknown; category?: string; description?: string; updatedBy?: string },
): Promise<ConfigEntry> {
  const existing = await knex("system_config").where({ key: input.key }).first();
  const patch: Record<string, unknown> = {
    value: JSON.stringify(input.value ?? null),
    updated_by: input.updatedBy ?? null,
    updated_at: new Date().toISOString(),
  };
  if (input.category !== undefined) patch.category = input.category;
  if (input.description !== undefined) patch.description = input.description;

  if (existing) {
    await knex("system_config").where({ key: input.key }).update(patch);
  } else {
    await knex("system_config").insert({
      id: newId(),
      key: input.key,
      category: input.category ?? null,
      description: input.description ?? null,
      ...patch,
    });
  }
  const row = await knex("system_config").where({ key: input.key }).first();
  return rowToEntry(row!);
}
