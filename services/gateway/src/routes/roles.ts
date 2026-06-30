import { Router } from "express";
import type { Knex } from "knex";
import { newId } from "@zordms/db";
import { requireAuth } from "../middleware/requireAuth.js";
import { requirePermission } from "../middleware/requirePermission.js";
import { writeAudit } from "../middleware/audit.js";
import { validate } from "../middleware/validate.js";
import { CreateRoleBodySchema, UpdateRoleBodySchema, type CreateRoleBody, type UpdateRoleBody } from "../schemas.js";

/**
 * §4.11 Master Data — Roles management. Reads/writes the existing RBAC tables
 * (roles / permissions / role_permissions / user_roles) — no new schema. Reads
 * need admin:read; mutations need role:assign. System roles (CDO, Supervisor, …)
 * are protected from edit/delete so RBAC can't be broken from this surface.
 */
async function roleView(knex: Knex, role: Record<string, unknown>) {
  const roleId = String(role.id);
  const permissions = await knex("role_permissions as rp")
    .join("permissions as p", "p.id", "rp.permission_id")
    .where("rp.role_id", roleId)
    .pluck("p.key");
  const cnt = (await knex("user_roles").where({ role_id: roleId }).count<{ c: number }[]>("user_id as c"))[0].c;
  return {
    id: String(role.id),
    name: String(role.name),
    description: (role.description as string) ?? null,
    system: Boolean(role.system),
    permissions,
    userCount: Number(cnt),
  };
}

async function setRolePermissions(knex: Knex, roleId: string, keys: string[]): Promise<void> {
  await knex("role_permissions").where({ role_id: roleId }).del();
  if (keys.length) {
    const perms = await knex("permissions").whereIn("key", keys).select("id");
    for (const p of perms) await knex("role_permissions").insert({ role_id: roleId, permission_id: p.id });
  }
}

export function rolesRouter(): Router {
  const r = Router();
  r.use(requireAuth);

  r.get("/", requirePermission("admin:read"), async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    const roles = await knex("roles").select("*").orderBy("name", "asc");
    res.json({ roles: await Promise.all(roles.map((role) => roleView(knex, role))) });
  });

  r.get("/:id", requirePermission("admin:read"), async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    const role = await knex("roles").where({ id: req.params.id }).first();
    if (!role) { res.status(404).json({ error: "not_found" }); return; }
    res.json({ role: await roleView(knex, role) });
  });

  r.post("/", requirePermission("role:assign"), validate(CreateRoleBodySchema), async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    const body = req.body as CreateRoleBody;
    const exists = await knex("roles").where({ name: body.name }).first();
    if (exists) { res.status(409).json({ error: "role_exists" }); return; }
    const id = newId();
    await knex("roles").insert({ id, name: body.name, description: body.description ?? null, system: false });
    await setRolePermissions(knex, id, body.permissions ?? []);
    await writeAudit(knex, { actor_id: req.authUser!.id, actor_username: req.authUser!.username, action: "ROLE_CREATE", entity: "role", entity_id: id });
    res.status(201).json({ role: await roleView(knex, (await knex("roles").where({ id }).first())!) });
  });

  r.put("/:id", requirePermission("role:assign"), validate(UpdateRoleBodySchema), async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    const body = req.body as UpdateRoleBody;
    const role = await knex("roles").where({ id: req.params.id }).first();
    if (!role) { res.status(404).json({ error: "not_found" }); return; }
    if (role.system) { res.status(409).json({ error: "system_role_protected" }); return; }
    if (body.description !== undefined) await knex("roles").where({ id: role.id }).update({ description: body.description });
    if (body.permissions !== undefined) await setRolePermissions(knex, role.id, body.permissions);
    await writeAudit(knex, { actor_id: req.authUser!.id, actor_username: req.authUser!.username, action: "ROLE_UPDATE", entity: "role", entity_id: role.id });
    res.json({ role: await roleView(knex, (await knex("roles").where({ id: role.id }).first())!) });
  });

  r.delete("/:id", requirePermission("role:assign"), async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    const role = await knex("roles").where({ id: req.params.id }).first();
    if (!role) { res.status(404).json({ error: "not_found" }); return; }
    if (role.system) { res.status(409).json({ error: "system_role_protected" }); return; }
    await knex("role_permissions").where({ role_id: role.id }).del();
    await knex("user_roles").where({ role_id: role.id }).del();
    await knex("roles").where({ id: role.id }).del();
    await writeAudit(knex, { actor_id: req.authUser!.id, actor_username: req.authUser!.username, action: "ROLE_DELETE", entity: "role", entity_id: role.id });
    res.json({ deleted: true });
  });

  return r;
}
