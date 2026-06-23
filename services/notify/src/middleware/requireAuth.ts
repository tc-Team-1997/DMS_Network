import type { Request, Response, NextFunction } from "express";
import { verifyToken, resolveUserAuthz } from "@zordms/auth";
import type { AuthUser } from "@zordms/types";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express { interface Request { authUser?: AuthUser; } }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) { res.status(401).json({ error: "unauthorized" }); return; }
  const { knex, config } = req.app.locals.deps;
  try {
    const payload = verifyToken(token, config.jwtSecret);
    const user = await knex("users").where({ id: payload.sub }).first();
    if (!user || user.status !== "Active") { res.status(401).json({ error: "unauthorized" }); return; }
    const authz = await resolveUserAuthz(knex, user.id);
    req.authUser = { id: user.id, username: user.username, roles: authz.roles, permissions: authz.permissions, branch: user.branch, region: user.region };
    next();
  } catch {
    res.status(401).json({ error: "unauthorized" });
  }
}
