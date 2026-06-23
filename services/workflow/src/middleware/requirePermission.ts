import type { Request, Response, NextFunction } from "express";
import { can } from "@zordms/auth";

export function requirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.authUser) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    if (!can({ permissions: req.authUser.permissions }, permission)) {
      res.status(403).json({ error: "forbidden", required: permission });
      return;
    }
    next();
  };
}
