/**
 * Shared Express claims-based auth middleware for @zordms/auth.
 *
 * Downstream microservices import these helpers instead of writing their own.
 * IMPORTANT: NO database lookup — JWT claims are the source of truth for
 * downstream services in the database-per-service architecture.
 */

import type { Request, Response, NextFunction, RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { can } from "./rbac.js";

// ---------------------------------------------------------------------------
// AuthUser — the decoded identity that middleware attaches to each request
// ---------------------------------------------------------------------------

export interface AuthUser {
  id: number;
  username: string;
  roles: string[];
  permissions: string[];
  branch?: string;
  region?: string;
}

// ---------------------------------------------------------------------------
// Express Request augmentation — adds req.authUser for all routes
// ---------------------------------------------------------------------------

declare global {
  namespace Express {
    interface Request {
      authUser?: AuthUser;
    }
  }
}

// ---------------------------------------------------------------------------
// Viewer helper — branch-scope fail-closed logic
// ---------------------------------------------------------------------------

export interface ViewerScope {
  branch?: string;
  canCrossBranch: boolean;
}

export function makeViewer(req: Request): ViewerScope {
  return {
    branch: req.authUser?.branch,
    canCrossBranch:
      req.authUser?.permissions.includes("crossbranch:read") ?? false,
  };
}

// ---------------------------------------------------------------------------
// requireAuth — verifies JWT and populates req.authUser from claims
// ---------------------------------------------------------------------------

export const requireAuth: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const token = authHeader.slice(7); // strip "Bearer "
  const secret: string = req.app.locals.deps?.config?.jwtSecret ?? "";

  try {
    const raw = jwt.verify(token, secret, { algorithms: ["HS256"] });
    if (typeof raw === "string") {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const decoded = raw as jwt.JwtPayload & {
      username?: string;
      roles?: string[];
      permissions?: string[];
      branch?: string;
      region?: string;
    };

    if (decoded.sub == null || decoded.username == null) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }

    req.authUser = {
      id: Number(decoded.sub),
      username: String(decoded.username),
      roles: decoded.roles ?? [],
      permissions: decoded.permissions ?? [],
      branch: decoded.branch,
      region: decoded.region,
    };

    next();
  } catch {
    res.status(401).json({ error: "unauthorized" });
  }
};

// ---------------------------------------------------------------------------
// requirePermission — authorizes based on JWT-embedded permissions
// ---------------------------------------------------------------------------

export function requirePermission(permission: string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.authUser) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    if (!can(req.authUser, permission)) {
      res.status(403).json({ error: "forbidden", required: permission });
      return;
    }
    next();
  };
}

// ---------------------------------------------------------------------------
// asyncHandler — wraps async route handlers to forward errors to next()
// ---------------------------------------------------------------------------

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}

// ---------------------------------------------------------------------------
// errorHandler — 4-arg Express error handler; returns 500 with no stack leak
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // next must be declared even if unused — Express requires 4 args to detect error handlers
  next: NextFunction,
): void {
  res.status(500).json({ error: "internal_error" });
}
