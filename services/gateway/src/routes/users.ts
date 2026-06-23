import { Router } from "express";
import type { Knex } from "knex";
import { hashPassword } from "@zordms/auth";
import type { CreateUserRequest } from "@zordms/types";
import { requireAuth } from "../middleware/requireAuth.js";
import { requirePermission } from "../middleware/requirePermission.js";
import { writeAudit } from "../middleware/audit.js";

async function setUserRoles(knex: Knex, userId: number, roleNames: string[]): Promise<void> {
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
    res.json({ users });
  });

  r.post("/", requirePermission("user:create"), async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    const body = req.body as CreateUserRequest;
    const exists = await knex("users").where({ username: body.username }).first();
    if (exists) { res.status(409).json({ error: "username_taken" }); return; }
    const [uid] = await knex("users").insert({
      username: body.username,
      password_hash: await hashPassword(body.password),
      full_name: body.full_name, email: body.email, branch: body.branch, region: body.region,
      status: "Active", created_by: req.authUser!.username,
    }).returning("id");
    const userId = typeof uid === "object" ? (uid as any).id : uid;
    await setUserRoles(knex, userId, body.roles ?? []);
    await writeAudit(knex, { actor_id: req.authUser!.id, actor_username: req.authUser!.username, action: "USER_CREATE", entity: "user", entity_id: String(userId) });
    res.status(201).json({ user: { id: userId, username: body.username, roles: body.roles ?? [] } });
  });

  r.post("/:id/roles", requirePermission("role:assign"), async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    await setUserRoles(knex, Number(req.params.id), (req.body.roles as string[]) ?? []);
    await writeAudit(knex, { actor_id: req.authUser!.id, actor_username: req.authUser!.username, action: "USER_ROLES", entity: "user", entity_id: req.params.id });
    res.json({ ok: true });
  });

  r.post("/:id/lock", requirePermission("user:update"), async (req, res) => {
    const { knex } = req.app.locals.deps as { knex: Knex };
    const user = await knex("users").where({ id: req.params.id }).first();
    if (!user) { res.status(404).json({ error: "not_found" }); return; }
    const status = user.status === "Locked" ? "Active" : "Locked";
    await knex("users").where({ id: user.id }).update({ status });
    await writeAudit(knex, { actor_id: req.authUser!.id, actor_username: req.authUser!.username, action: "USER_LOCK", entity: "user", entity_id: req.params.id, details: status });
    res.json({ ok: true, status });
  });

  return r;
}
