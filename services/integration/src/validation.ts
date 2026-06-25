import type { Response } from "express";
import { z } from "zod";

/**
 * P10: Zod boundary validation for the integration service.
 *
 * Mutating routes (POST/PUT/PATCH/DELETE) and key query params parse their
 * inputs through these schemas. On failure the handler returns
 * 400 { error: "validation_error", issues: [...] } and the parsed/typed value
 * is used downstream.
 */

/** Shape of a single validation issue surfaced to the caller. */
export interface ValidationIssue {
  path: string;
  message: string;
  code: string;
}

/**
 * Parse `data` with `schema`. On success returns the typed value. On failure
 * writes the 400 validation_error response and returns undefined, so callers do
 * `const v = parseOr400(...); if (!v) return;`.
 */
export function parseOr400<T extends z.ZodTypeAny>(
  schema: T,
  data: unknown,
  res: Response,
): z.infer<T> | undefined {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const issues: ValidationIssue[] = result.error.issues.map((i) => ({
    path: i.path.join("."),
    message: i.message,
    code: i.code,
  }));
  res.status(400).json({ error: "validation_error", issues });
  return undefined;
}

/* ----------------------------- Outbound webhooks ----------------------------- */

export const AuthMethod = z.enum(["hmac", "bearer", "none"]);

/** POST /outbound — register an outbound webhook subscription. */
export const CreateOutboundWebhookSchema = z
  .object({
    url: z.string().url(),
    events: z.array(z.string().min(1)).min(1),
    auth_method: AuthMethod.default("hmac"),
    secret: z.string().min(1).optional(),
  })
  .strict();
export type CreateOutboundWebhook = z.infer<typeof CreateOutboundWebhookSchema>;

/** POST /outbound/test — dispatch a test event to matching subscriptions. */
export const TestOutboundSchema = z
  .object({
    event: z.string().min(1),
    payload: z.record(z.unknown()).optional(),
  })
  .strict();
export type TestOutbound = z.infer<typeof TestOutboundSchema>;

/** PUT /integration/systems/:id/inbound-secret — set/rotate the inbound HMAC secret. */
export const SetInboundSecretSchema = z
  .object({
    secret: z.string().min(8),
  })
  .strict();
export type SetInboundSecret = z.infer<typeof SetInboundSecretSchema>;

/* ----------------------------- Inbound webhooks ------------------------------ */
/*
 * These document the HMAC-signed inbound contract. Signature verification on the
 * raw body happens first; body shape is validated only after the signature is
 * trusted, so a bad signature still returns 401 (not 400).
 */

/** CBS customer-updated inbound payload. */
export const CbsCustomerUpdatedSchema = z
  .object({
    cid: z.string().min(1),
    name: z.string().optional(),
    branch: z.string().optional(),
  })
  .passthrough();
export type CbsCustomerUpdated = z.infer<typeof CbsCustomerUpdatedSchema>;

/** LOS loan-application inbound payload. */
export const LosLoanApplicationSchema = z
  .object({
    applicationId: z.string().min(1),
    cid: z.string().min(1),
    amount: z.number().nonnegative(),
  })
  .passthrough();
export type LosLoanApplication = z.infer<typeof LosLoanApplicationSchema>;

/** KYC verification-result inbound payload. */
export const KycVerificationResultSchema = z
  .object({
    cid: z.string().min(1),
    decision: z.enum(["PASS", "FAIL", "REVIEW"]),
  })
  .passthrough();
export type KycVerificationResult = z.infer<typeof KycVerificationResultSchema>;

/** Map an inbound event name to the schema that validates its payload. */
export const InboundSchemaForEvent: Record<string, z.ZodTypeAny> = {
  "cbs.customer.updated": CbsCustomerUpdatedSchema,
  "los.loan.created": LosLoanApplicationSchema,
  "kyc.result": KycVerificationResultSchema,
};

/* ------------------------------- Query params -------------------------------- */

/** GET /integration/logs query params (limit is a key, bounded param). */
export const LogsQuerySchema = z.object({
  system: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
});
export type LogsQuery = z.infer<typeof LogsQuerySchema>;
