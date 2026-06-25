import type { Request, Response, NextFunction } from "express";
import type { ZodType } from "zod";

/**
 * Boundary validation middleware. Parses the named request part with a zod
 * schema and, on failure, returns `400 { error: "validation_error", issues }`.
 * On success the parsed/typed value REPLACES the raw input so handlers consume
 * trusted, coerced data downstream.
 */
type Part = "body" | "params" | "query";

function issuesFrom(error: { issues: Array<{ path: PropertyKey[]; message: string; code?: string }> }) {
  return error.issues.map((i) => ({
    path: i.path.map((p) => (typeof p === "symbol" ? String(p) : p)),
    message: i.message,
    code: i.code,
  }));
}

export function validate(schema: ZodType, part: Part = "body") {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[part]);
    if (!result.success) {
      res.status(400).json({ error: "validation_error", issues: issuesFrom(result.error) });
      return;
    }
    // query/params getters can be read-only on some express versions; assign
    // defensively. body is always writable.
    try {
      (req as unknown as Record<Part, unknown>)[part] = result.data;
    } catch {
      Object.defineProperty(req, part, { value: result.data, configurable: true });
    }
    next();
  };
}
