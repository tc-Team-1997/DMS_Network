import { Router } from "express";
import type { Knex } from "knex";
import { requireAuth } from "../middleware/requireAuth.js";
import { requirePermission } from "../middleware/requirePermission.js";
import { writeAudit } from "../middleware/audit.js";
import { validate } from "../middleware/validate.js";
import { AdImportBodySchema, type AdImportBody } from "../schemas.js";
import { provisionUsers } from "../admin/adImport.js";

/**
 * §4.12 Admin actions. POST /admin/ad-import bulk-provisions users from a set of
 * directory identities (admin:access). The inline `users` list is the
 * tested/manual source; the live LDAP-search source plugs in via AdDirectory.
 */
export function adminRouter(): Router {
  const r = Router();
  r.use(requireAuth);

  r.post("/ad-import", requirePermission("admin:access"), validate(AdImportBodySchema), async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    const body = req.body as AdImportBody;
    const summary = await provisionUsers(knex, body.users, {
      defaultRole: body.defaultRole ?? "Viewer",
      actor: req.authUser!.username,
      dryRun: body.dryRun,
    });
    await writeAudit(knex, {
      actor_id: req.authUser!.id,
      actor_username: req.authUser!.username,
      action: "AD_IMPORT",
      details: `found=${summary.found} created=${summary.created} skipped=${summary.skipped} failed=${summary.failed} dryRun=${summary.dryRun}`,
    });
    res.json({ summary });
  });

  return r;
}
