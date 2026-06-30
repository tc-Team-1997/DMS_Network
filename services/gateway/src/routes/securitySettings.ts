import { Router } from "express";
import type { Knex } from "knex";
import { requireAuth } from "../middleware/requireAuth.js";
import { requirePermission } from "../middleware/requirePermission.js";
import { writeAudit } from "../middleware/audit.js";
import { validate } from "../middleware/validate.js";
import { SecuritySettingsBodySchema, type SecuritySettingsBody } from "../schemas.js";

/**
 * §4.12 Admin → Security. Single-row security policy (password rules, MFA
 * enforcement, session timeout, login lockout). Read needs security:read;
 * update needs admin:access. Audited.
 */
function view(row: Record<string, unknown> | undefined) {
  if (!row) return null;
  return {
    passwordMinLength: Number(row.password_min_length),
    passwordRequireComplexity: Boolean(row.password_require_complexity),
    mfaRequired: Boolean(row.mfa_required),
    sessionTimeoutMinutes: Number(row.session_timeout_minutes),
    maxFailedLogins: Number(row.max_failed_logins),
    lockoutDurationMinutes: Number(row.lockout_duration_minutes),
    updatedBy: (row.updated_by as string) ?? null,
    updatedAt: (row.updated_at as string) ?? null,
  };
}

export function securitySettingsRouter(): Router {
  const r = Router();
  r.use(requireAuth);

  r.get("/", requirePermission("security:read"), async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    const row = await knex("security_settings").first();
    res.json({ securitySettings: view(row) });
  });

  r.put("/", requirePermission("admin:access"), validate(SecuritySettingsBodySchema), async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    const body = req.body as SecuritySettingsBody;
    const row = await knex("security_settings").first();
    if (!row) { res.status(404).json({ error: "not_initialized" }); return; }

    const update: Record<string, unknown> = { updated_by: req.authUser!.username, updated_at: new Date().toISOString() };
    if (body.password_min_length !== undefined) update.password_min_length = body.password_min_length;
    if (body.password_require_complexity !== undefined) update.password_require_complexity = body.password_require_complexity;
    if (body.mfa_required !== undefined) update.mfa_required = body.mfa_required;
    if (body.session_timeout_minutes !== undefined) update.session_timeout_minutes = body.session_timeout_minutes;
    if (body.max_failed_logins !== undefined) update.max_failed_logins = body.max_failed_logins;
    if (body.lockout_duration_minutes !== undefined) update.lockout_duration_minutes = body.lockout_duration_minutes;

    await knex("security_settings").where({ id: row.id }).update(update);
    await writeAudit(knex, {
      actor_id: req.authUser!.id, actor_username: req.authUser!.username,
      action: "SECURITY_SETTINGS_UPDATE", entity: "security_settings", entity_id: String(row.id),
    });
    res.json({ securitySettings: view(await knex("security_settings").where({ id: row.id }).first()) });
  });

  return r;
}
