/**
 * Zod schemas for the notify service — boundary validation for mutating routes.
 *
 * These schemas validate request body/params/query at the HTTP boundary. On
 * failure the route returns 400 { error: "validation_error", issues: [...] }.
 * Parsed/typed values are used downstream.
 *
 * Registered with @asteasolutions/zod-to-openapi via OpenApiZod so the same
 * definitions drive the OpenAPI document (see openapi.ts).
 */
import { z } from "zod";
import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";

// Augment the shared zod instance so `.openapi(...)` is available on every
// schema. Idempotent — safe to call at module load.
extendZodWithOpenApi(z);

const CHANNEL_KEYS = ["email", "sms", "whatsapp", "teams", "inapp"] as const;

// --- Reusable field schemas ----------------------------------------------

export const ChannelKeySchema = z
  .enum(CHANNEL_KEYS)
  .openapi("ChannelKey", { description: "Delivery channel for a notification." });

export const IdParamSchema = z
  .object({
    id: z.string().min(1).openapi({ description: "Resource identifier (UUID)." }),
  })
  .openapi("IdParam");

// --- Alerts ---------------------------------------------------------------

export const AlertListQuerySchema = z
  .object({
    level: z.enum(["info", "warning", "critical"]).optional(),
    unread: z.enum(["true", "false"]).optional(),
  })
  .openapi("AlertListQuery");

export const EscalateBodySchema = z
  .object({
    target: z
      .string()
      .trim()
      .min(1, "target is required")
      .openapi({ description: "Role name to escalate the alert to." }),
  })
  .openapi("EscalateBody");

// --- Alert rules ----------------------------------------------------------

export const CreateRuleBodySchema = z
  .object({
    name: z.string().trim().min(1, "name is required").openapi({ description: "Human-readable rule name." }),
    trigger: z
      .string()
      .trim()
      .min(1, "trigger is required")
      .openapi({ description: "Domain event type that triggers the rule, e.g. document.expiring." }),
    params: z.record(z.string(), z.unknown()).optional().openapi({ description: "Trigger-specific parameters." }),
    channels: z.array(ChannelKeySchema).optional().openapi({ description: "Channels to dispatch on." }),
    escalationTarget: z.string().nullish().openapi({ description: "Role to escalate to." }),
    scope: z.string().nullish().openapi({ description: "Branch scope; rule fires only for this branch." }),
  })
  .openapi("CreateRuleBody");

export const UpdateRuleBodySchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    trigger: z.string().trim().min(1).optional(),
    params: z.record(z.string(), z.unknown()).optional(),
    channels: z.array(ChannelKeySchema).optional(),
    escalationTarget: z.string().nullish(),
    scope: z.string().nullish(),
    enabled: z.boolean().optional(),
  })
  .openapi("UpdateRuleBody");

// --- Shared response schemas ---------------------------------------------

export const ValidationErrorSchema = z
  .object({
    error: z.literal("validation_error"),
    issues: z.array(z.unknown()),
  })
  .openapi("ValidationError");

export const ErrorSchema = z
  .object({
    error: z.string(),
    required: z.string().optional(),
  })
  .openapi("Error");

export const OkSchema = z.object({ ok: z.boolean() }).openapi("Ok");

export const AlertSchema = z
  .object({
    id: z.string(),
    level: z.string(),
    title: z.string(),
    meta: z.string().optional(),
    is_read: z.boolean(),
    rule_id: z.string().nullable().optional(),
    branch: z.string().nullable().optional(),
  })
  .openapi("Alert");

export const RuleSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    trigger: z.string(),
    params: z.record(z.string(), z.unknown()),
    channels: z.array(z.string()),
    escalationTarget: z.string().nullable().optional(),
    scope: z.string().nullable().optional(),
    enabled: z.boolean(),
  })
  .openapi("Rule");

export type CreateRuleBody = z.infer<typeof CreateRuleBodySchema>;
export type UpdateRuleBody = z.infer<typeof UpdateRuleBodySchema>;
export type EscalateBody = z.infer<typeof EscalateBodySchema>;
export type AlertListQuery = z.infer<typeof AlertListQuerySchema>;

export { z };
