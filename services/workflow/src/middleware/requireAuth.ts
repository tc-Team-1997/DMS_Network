/**
 * Local requireAuth middleware for the workflow service.
 *
 * The workflow service is a backend microservice behind the gateway. It verifies
 * the JWT signature via @zordms/auth's verifyToken, then reads the full decoded
 * payload (including the `permissions` claim) directly from the JWT body section.
 *
 * Permissions are embedded in the token as a `permissions` claim (string[]).
 * The gateway stamps these when it proxies requests; tests mint tokens directly
 * with signToken({ sub, username, permissions: [...] }, secret) — the extra field
 * is included by jwt.sign even though the TypeScript type doesn't declare it.
 *
 * Note: we do NOT do a DB user lookup here. The workflow service's SQLite DB has
 * no user/roles tables — the gateway is the single auth gatekeeper.
 */
import type { Request, Response, NextFunction } from "express";
import { verifyToken } from "@zordms/auth";
import type { AuthUser } from "@zordms/types";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      authUser?: AuthUser;
    }
  }
}

/** Decode the JWT payload section without re-verifying the signature. */
function decodePayload(token: string): Record<string, unknown> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return {};
    const raw = Buffer.from(parts[1], "base64url").toString("utf-8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const { config } = req.app.locals.deps as { config: { jwtSecret: string } };
  try {
    // Verify signature and get sub/username.
    const payload = verifyToken(token, config.jwtSecret);

    // Read the full JWT body to pick up the `permissions` claim and any other
    // claims embedded by the gateway or by test token minting.
    const full = decodePayload(token);
    const permissions: string[] = Array.isArray(full.permissions)
      ? (full.permissions as string[])
      : [];

    req.authUser = {
      id: payload.sub,
      username: payload.username,
      roles: [],
      permissions,
    };
    next();
  } catch {
    res.status(401).json({ error: "unauthorized" });
  }
}
