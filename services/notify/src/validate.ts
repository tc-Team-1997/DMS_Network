/**
 * Zod boundary-validation helpers for Express routes.
 *
 * `validateBody` / `validateParams` / `validateQuery` parse the relevant part
 * of the request with a zod schema. On success the parsed (typed, coerced)
 * value REPLACES the raw input so downstream handlers use validated data. On
 * failure the request short-circuits with:
 *   400 { error: "validation_error", issues: [...] }
 */
import type { RequestHandler } from "express";
import type { ZodType } from "zod";

function fail(res: Parameters<RequestHandler>[1], err: { issues: unknown[] }): void {
  res.status(400).json({ error: "validation_error", issues: err.issues });
}

export function validateBody(schema: ZodType): RequestHandler {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) return fail(res, result.error);
    req.body = result.data;
    next();
  };
}

export function validateParams(schema: ZodType): RequestHandler {
  return (req, res, next) => {
    const result = schema.safeParse(req.params);
    if (!result.success) return fail(res, result.error);
    // req.params is read-only on some Express typings; mutate in place.
    Object.assign(req.params, result.data);
    next();
  };
}

export function validateQuery(schema: ZodType): RequestHandler {
  return (req, res, next) => {
    const result = schema.safeParse(req.query);
    if (!result.success) return fail(res, result.error);
    Object.assign(req.query as Record<string, unknown>, result.data);
    next();
  };
}
