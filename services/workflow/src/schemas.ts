import { z } from "zod";
import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";

// Register .openapi() helpers on zod. Safe to call once at module load.
extendZodWithOpenApi(z);

// ---------------------------------------------------------------------------
// P10 — Zod boundary schemas for the workflow service's mutating routes.
//
// These are the single source of truth for:
//   1. runtime request validation (parse → 400 validation_error on failure)
//   2. the generated OpenAPI 3.1 document (schemas.ts registers component schemas)
// ---------------------------------------------------------------------------

// A workflow action — must match engine/transitions.ts WorkflowAction.
export const WorkflowActionEnum = z
  .enum(["approve", "reject", "escalate", "hold"])
  .openapi("WorkflowAction");

// Queue status values accepted by GET /workflows?status=
export const QueueStatusEnum = z
  .enum(["Pending", "Claimed", "Approved", "Rejected", "Escalated", "OnHold"])
  .openapi("QueueStatus");

// ---- POST /templates ------------------------------------------------------
export const CreateTemplateBody = z
  .object({
    name: z.string().min(1).max(200),
    doc_type: z.string().max(100).optional(),
    // steps_json is a JSON-encoded array compiled by compileTemplate(); we
    // validate it is a non-empty string here and let the compiler validate shape.
    steps_json: z.string().min(1),
  })
  .strict()
  .openapi("CreateTemplateBody");
export type CreateTemplateBody = z.infer<typeof CreateTemplateBody>;

// ---- POST /workflows ------------------------------------------------------
export const CreateWorkflowBody = z
  .object({
    title: z.string().min(1).max(300),
    template_id: z.string().min(1),
    doc_id: z.string().min(1).optional(),
    priority: z.enum(["Low", "Normal", "High", "Urgent"]).optional(),
    assigned_to: z.string().min(1).optional(),
    doc_confidence: z.number().min(0).max(1).optional(),
    // created_by is accepted for backwards-compat but actor identity is taken
    // from the verified JWT downstream; we still validate the type.
    created_by: z.string().min(1).optional(),
    branch: z.string().min(1).optional(),
  })
  .strict()
  .openapi("CreateWorkflowBody");
export type CreateWorkflowBody = z.infer<typeof CreateWorkflowBody>;

// ---- POST /workflows/:id/act ---------------------------------------------
export const WorkflowIdParam = z
  .object({ id: z.string().min(1) })
  .openapi("WorkflowIdParam");
export type WorkflowIdParam = z.infer<typeof WorkflowIdParam>;

export const ActBody = z
  .object({
    action: WorkflowActionEnum,
    comment: z.string().max(2000).optional(),
  })
  .strict()
  .openapi("ActBody");
export type ActBody = z.infer<typeof ActBody>;

// ---- GET /workflows?status= (key query param) -----------------------------
export const ListWorkflowsQuery = z
  .object({
    status: QueueStatusEnum.optional(),
  })
  .openapi("ListWorkflowsQuery");
export type ListWorkflowsQuery = z.infer<typeof ListWorkflowsQuery>;

// ---- Shared error response ------------------------------------------------
export const ValidationErrorResponse = z
  .object({
    error: z.literal("validation_error"),
    issues: z.array(z.any()),
  })
  .openapi("ValidationErrorResponse");

export const ErrorResponse = z
  .object({ error: z.string() })
  .openapi("ErrorResponse");

// ---------------------------------------------------------------------------
// Express middleware helpers — parse a request part and respond 400 on failure.
// ---------------------------------------------------------------------------
import type { Request, Response, NextFunction } from "express";

type Part = "body" | "params" | "query";

export function validate(schema: z.ZodTypeAny, part: Part = "body") {
  return (req: Request, res: Response, next: NextFunction): void => {
    const bag = req as unknown as Record<string, unknown>;
    const result = schema.safeParse(bag[part]);
    if (!result.success) {
      res.status(400).json({ error: "validation_error", issues: result.error.issues });
      return;
    }
    // Use the parsed/coerced value downstream. req.query is a getter-only
    // accessor on some express versions, so guard the assignment.
    try {
      bag[part] = result.data;
    } catch {
      // query is read-only in express 5; stash parsed value instead.
      bag[`validated_${part}`] = result.data;
    }
    next();
  };
}
