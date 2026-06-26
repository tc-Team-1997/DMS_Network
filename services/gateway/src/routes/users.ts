import { Router } from "express";
import type { Knex } from "knex";
import { hashPassword } from "@zordms/auth";
import { newId } from "@zordms/db";
import { requireAuth } from "../middleware/requireAuth.js";
import { requirePermission } from "../middleware/requirePermission.js";
import { writeAudit } from "../middleware/audit.js";
import { validate } from "../middleware/validate.js";
import {
  CreateUserBodySchema,
  type CreateUserBody,
  SetUserRolesBodySchema,
  type SetUserRolesBody,
  UserIdParamsSchema,
} from "../schemas.js";

async function setUserRoles(knex: Knex, userId: string, roleNames: string[]): Promise<void> {
  await knex("user_roles").where({ user_id: userId }).del();
  const roles = await knex("roles").whereIn("name", roleNames).select("id");
  for (const r of roles) await knex("user_roles").insert({ user_id: userId, role_id: r.id });
}

export function usersRouter(): Router {
  const r = Router();
  r.use(requireAuth);

  r.get("/", requirePermission("user:read"), async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    const users = await knex("users").select("id", "username", "full_name", "email", "branch", "region", "status", "mfa_enabled");
    // Attach each user's role names so pickers can assign to a person directly.
    const links = await knex("user_roles as ur").join("roles as ro", "ro.id", "ur.role_id").select("ur.user_id as user_id", "ro.name as role");
    const rolesByUser = new Map<string, string[]>();
    for (const l of links as Array<{ user_id: string; role: string }>) {
      const arr = rolesByUser.get(l.user_id) ?? [];
      arr.push(l.role);
      rolesByUser.set(l.user_id, arr);
    }
    res.json({ users: (users as Array<{ id: string }>).map((u) => ({ ...u, roles: rolesByUser.get(u.id) ?? [] })) });
  });

  // List all role names (for assignment / escalation pickers). Read-only, no
  // sensitive data — gated on user:read like the user list.
  r.get("/roles", requirePermission("user:read"), async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    const rows = await knex("roles").select("name", "description").orderBy("name");
    res.json({ roles: rows });
  });

  r.post("/", requirePermission("user:create"), validate(CreateUserBodySchema), async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    const body = req.body as CreateUserBody;

    const exists = await knex("users").where({ username: body.username }).first();
    if (exists) { res.status(409).json({ error: "username_taken" }); return; }

    const userId = newId();
    await knex("users").insert({
      id: userId,
      username: body.username,
      password_hash: await hashPassword(body.password),
      full_name: body.full_name, email: body.email, branch: body.branch, region: body.region,
      status: "Active", created_by: req.authUser!.username,
    });
    await setUserRoles(knex, userId, body.roles ?? []);
    await writeAudit(knex, { actor_id: req.authUser!.id, actor_username: req.authUser!.username, action: "USER_CREATE", entity: "user", entity_id: userId });
    res.status(201).json({ user: { id: userId, username: body.username, roles: body.roles ?? [] } });
  });

  r.post(
    "/:id/roles",
    requirePermission("role:assign"),
    validate(UserIdParamsSchema, "params"),
    validate(SetUserRolesBodySchema),
    async (req, res) => {
      const { knex } = req.app.locals.deps as { knex: Knex };
      const userId = req.params.id;
      const body = req.body as SetUserRolesBody;
      await setUserRoles(knex, userId, body.roles);
      await writeAudit(knex, { actor_id: req.authUser!.id, actor_username: req.authUser!.username, action: "USER_ROLES", entity: "user", entity_id: userId });
      res.json({ ok: true });
    },
  );

  r.post("/:id/lock", requirePermission("user:update"), validate(UserIdParamsSchema, "params"), async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    const userId = req.params.id;
    const user = await knex("users").where({ id: userId }).first();
    if (!user) { res.status(404).json({ error: "not_found" }); return; }
    const status = user.status === "Locked" ? "Active" : "Locked";
    await knex("users").where({ id: userId }).update({ status });
    await writeAudit(knex, { actor_id: req.authUser!.id, actor_username: req.authUser!.username, action: "USER_LOCK", entity: "user", entity_id: userId, details: status });
    res.json({ ok: true, status });
  });

  return r;
}
