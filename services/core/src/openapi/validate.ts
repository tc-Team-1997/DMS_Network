/**
 * P10 — zod boundary-validation middleware.
 *
 * `validateBody(schema)` parses `req.body` with the given zod schema. On failure
 * it short-circuits with `400 { error: "validation_error", issues: [...] }`. On
 * success it REPLACES `req.body` with the parsed/typed value so handlers read the
 * coerced, trusted data downstream.
 *
 * `validateQuery(schema)` does the same for `req.query` (assigning to a typed
 * `req.validatedQuery` since express 4 `req.query` is read-write but we keep the
 * original for compatibility).
 */
import type { Request, Response, NextFunction, RequestHandler } from "express";
import type { ZodType, ZodError } from "zod";

export interface ValidationIssue {
  path: (string | number)[];
  message: string;
  code?: string;
}

export function zodIssues(err: ZodError): ValidationIssue[] {
  return err.issues.map((i) => ({
    path: i.path as (string | number)[],
    message: i.message,
    code: i.code,
  }));
}

function reject(res: Response, err: ZodError): void {
  res.status(400).json({ error: "validation_error", issues: zodIssues(err) });
}

/** Validate (and replace) req.body with the parsed value. */
export function validateBody<T>(schema: ZodType<T>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      reject(res, result.error);
      return;
    }
    req.body = result.data;
    next();
  };
}

/** Validate req.query; parsed value is stashed on req.validatedQuery. */
export function validateQuery<T>(schema: ZodType<T>): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      reject(res, result.error);
      return;
    }
    (req as Request & { validatedQuery?: unknown }).validatedQuery = result.data;
    next();
  };
}
