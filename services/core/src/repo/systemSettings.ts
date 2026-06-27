import type { Knex } from "knex";

/**
 * system_settings — typed access to admin-editable platform configuration.
 *
 * Each known key has a default so the system is fully configured out of the box;
 * the Administration screen overrides values without code/env changes. Other
 * modules read these (e.g. capture reads retention defaults, AI reads the
 * confidence threshold).
 */

export interface PlatformSettings {
  /** Default retention in years applied when a doc-type has none. */
  defaultRetentionYears: number;
  /** Branches available across the app (capture, dashboard scoping, …). */
  branches: string[];
  /** Min AI classification confidence (0–1) before a doc is flagged for review. */
  aiConfidenceThreshold: number;
  /** Auto-route captured documents into the AI-suggested folder hierarchy. */
  autoFolderRouting: boolean;
}

export const DEFAULT_SETTINGS: PlatformSettings = {
  defaultRetentionYears: 7,
  branches: ["Thimphu HQ", "Phuentsholing", "Paro", "Mongar", "Samdrup Jongkhar"],
  aiConfidenceThreshold: 0.7,
  autoFolderRouting: true,
};

const SETTINGS_KEY = "platform";

export async function getSettings(knex: Knex): Promise<PlatformSettings> {
  const row = await knex("system_settings").where({ key: SETTINGS_KEY }).first();
  if (!row) return { ...DEFAULT_SETTINGS };
  try {
    const parsed = JSON.parse(row.value) as Partial<PlatformSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export interface SettingsValidationError { errors: string[]; }

/** Validate + merge a partial update; throws { errors } on invalid input. */
export async function setSettings(
  knex: Knex,
  patch: Partial<PlatformSettings>,
  updatedBy?: string,
): Promise<PlatformSettings> {
  const errors: string[] = [];
  if (patch.defaultRetentionYears !== undefined) {
    const n = Number(patch.defaultRetentionYears);
    if (!Number.isFinite(n) || n < 0 || n > 100) errors.push("defaultRetentionYears must be 0–100");
  }
  if (patch.aiConfidenceThreshold !== undefined) {
    const n = Number(patch.aiConfidenceThreshold);
    if (!Number.isFinite(n) || n < 0 || n > 1) errors.push("aiConfidenceThreshold must be 0–1");
  }
  if (patch.branches !== undefined) {
    if (!Array.isArray(patch.branches) || patch.branches.some((b) => typeof b !== "string" || !b.trim())) {
      errors.push("branches must be a non-empty array of names");
    }
  }
  if (patch.autoFolderRouting !== undefined && typeof patch.autoFolderRouting !== "boolean") {
    errors.push("autoFolderRouting must be boolean");
  }
  if (errors.length) { const e = new Error("validation_error") as Error & SettingsValidationError; e.errors = errors; throw e; }

  const current = await getSettings(knex);
  const next: PlatformSettings = {
    ...current,
    ...patch,
    defaultRetentionYears: patch.defaultRetentionYears !== undefined ? Number(patch.defaultRetentionYears) : current.defaultRetentionYears,
    aiConfidenceThreshold: patch.aiConfidenceThreshold !== undefined ? Number(patch.aiConfidenceThreshold) : current.aiConfidenceThreshold,
    branches: patch.branches !== undefined ? patch.branches.map((b) => b.trim()).filter(Boolean) : current.branches,
  };

  const existing = await knex("system_settings").where({ key: SETTINGS_KEY }).first();
  if (existing) {
    await knex("system_settings").where({ key: SETTINGS_KEY }).update({ value: JSON.stringify(next), updated_by: updatedBy ?? null, updated_at: knex.fn.now() });
  } else {
    await knex("system_settings").insert({ key: SETTINGS_KEY, value: JSON.stringify(next), updated_by: updatedBy ?? null });
  }
  return next;
}
