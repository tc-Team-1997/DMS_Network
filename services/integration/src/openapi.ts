import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  extendZodWithOpenApi,
} from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import {
  CreateOutboundWebhookSchema,
  TestOutboundSchema,
  CbsCustomerUpdatedSchema,
  LosLoanApplicationSchema,
  KycVerificationResultSchema,
  LogsQuerySchema,
} from "./validation.js";

extendZodWithOpenApi(z);

/**
 * P10: OpenAPI 3.1 document for the integration service.
 *
 * Schemas are derived from the same zod definitions used for boundary
 * validation, so the contract and the runtime validation cannot drift.
 */

const ValidationError = z
  .object({
    error: z.literal("validation_error"),
    issues: z.array(
      z.object({
        path: z.string(),
        message: z.string(),
        code: z.string(),
      }),
    ),
  })
  .openapi("ValidationError");

const ErrorResponse = z
  .object({ error: z.string() })
  .openapi("ErrorResponse");

export function buildOpenApiDocument(): Record<string, unknown> {
  const registry = new OpenAPIRegistry();

  // ---- Security schemes -----------------------------------------------------
  const bearerAuth = registry.registerComponent("securitySchemes", "bearerAuth", {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
    description: "JWT access token for management/outbound routes.",
  });
  const internalToken = registry.registerComponent(
    "securitySchemes",
    "internalToken",
    {
      type: "apiKey",
      in: "header",
      name: "x-internal-token",
      description:
        "Shared service-to-service token (INTERNAL_SERVICE_TOKEN). Used by the hub when forwarding verified inbound events to core ingest endpoints.",
    },
  );
  const hmacSignature = registry.registerComponent(
    "securitySchemes",
    "hmacSignature",
    {
      type: "apiKey",
      in: "header",
      name: "x-zordms-signature",
      description:
        "HMAC-SHA256 signature of the raw request body, formatted 'sha256=<hex>', keyed by the per-system shared secret. Verified against the raw bytes before the body is parsed.",
    },
  );

  // ---- Reusable component schemas ------------------------------------------
  registry.register("ValidationError", ValidationError);
  registry.register("ErrorResponse", ErrorResponse);

  // ---- Health ---------------------------------------------------------------
  registry.registerPath({
    method: "get",
    path: "/health",
    summary: "Liveness probe",
    responses: {
      200: {
        description: "Service is up",
        content: {
          "application/json": {
            schema: z.object({ status: z.string(), service: z.string() }),
          },
        },
      },
    },
  });

  // ---- Inbound webhooks (HMAC-signed) --------------------------------------
  const inbound = [
    {
      path: "/webhooks/cbs/customer-updated",
      summary: "Inbound CBS customer-updated webhook (HMAC-signed)",
      schema: CbsCustomerUpdatedSchema.openapi("CbsCustomerUpdated"),
    },
    {
      path: "/webhooks/los/loan-application",
      summary: "Inbound LOS loan-application webhook (HMAC-signed)",
      schema: LosLoanApplicationSchema.openapi("LosLoanApplication"),
    },
    {
      path: "/webhooks/kyc/verification-result",
      summary: "Inbound KYC verification-result webhook (HMAC-signed)",
      schema: KycVerificationResultSchema.openapi("KycVerificationResult"),
    },
  ];
  for (const ep of inbound) {
    registry.registerPath({
      method: "post",
      path: ep.path,
      summary: ep.summary,
      description:
        "External system -> hub. The raw body is HMAC-verified (x-zordms-signature) before parsing. The verified payload is emitted on the internal bus and, where a route exists, forwarded to core ingest.",
      security: [{ [hmacSignature.name]: [] }],
      request: {
        body: {
          content: { "application/json": { schema: ep.schema } },
        },
      },
      responses: {
        202: {
          description: "Accepted",
          content: {
            "application/json": {
              schema: z.object({
                accepted: z.literal(true),
                event: z.string(),
                consumed: z.boolean().nullable(),
              }),
            },
          },
        },
        400: {
          description: "Raw body unavailable or payload failed validation",
          content: { "application/json": { schema: ValidationError } },
        },
        401: {
          description: "Missing or invalid HMAC signature",
          content: { "application/json": { schema: ErrorResponse } },
        },
      },
    });
  }

  // ---- Outbound webhook subscriptions --------------------------------------
  registry.registerPath({
    method: "post",
    path: "/outbound",
    summary: "Register an outbound webhook subscription",
    security: [{ [bearerAuth.name]: [] }],
    request: {
      body: {
        content: {
          "application/json": {
            schema: CreateOutboundWebhookSchema.openapi("CreateOutboundWebhook"),
          },
        },
      },
    },
    responses: {
      201: {
        description: "Created",
        content: {
          "application/json": {
            schema: z.object({
              webhook: z.object({
                id: z.string(),
                url: z.string(),
                events: z.array(z.string()),
                auth_method: z.string(),
              }),
            }),
          },
        },
      },
      400: {
        description: "Validation error",
        content: { "application/json": { schema: ValidationError } },
      },
      401: { description: "Missing or invalid bearer token" },
      403: { description: "Insufficient permission (integration:manage)" },
    },
  });

  registry.registerPath({
    method: "get",
    path: "/outbound",
    summary: "List outbound webhook subscriptions (secrets redacted)",
    security: [{ [bearerAuth.name]: [] }],
    responses: {
      200: {
        description: "OK",
        content: {
          "application/json": {
            schema: z.object({
              webhooks: z.array(
                z.object({
                  id: z.string(),
                  url: z.string(),
                  events: z.array(z.string()),
                  auth_method: z.string(),
                  enabled: z.boolean(),
                }),
              ),
            }),
          },
        },
      },
      401: { description: "Missing or invalid bearer token" },
    },
  });

  registry.registerPath({
    method: "post",
    path: "/outbound/test",
    summary: "Dispatch a test event to matching subscriptions",
    security: [{ [bearerAuth.name]: [] }],
    request: {
      body: {
        content: {
          "application/json": {
            schema: TestOutboundSchema.openapi("TestOutbound"),
          },
        },
      },
    },
    responses: {
      200: {
        description: "Dispatch report",
        content: {
          "application/json": {
            schema: z.object({ report: z.unknown() }),
          },
        },
      },
      400: {
        description: "Validation error",
        content: { "application/json": { schema: ValidationError } },
      },
      401: { description: "Missing or invalid bearer token" },
      403: { description: "Insufficient permission (integration:manage)" },
    },
  });

  // ---- Management -----------------------------------------------------------
  registry.registerPath({
    method: "get",
    path: "/integration/logs",
    summary: "List integration call logs",
    security: [{ [bearerAuth.name]: [] }],
    request: { query: LogsQuerySchema.openapi("LogsQuery") },
    responses: {
      200: {
        description: "OK",
        content: {
          "application/json": {
            schema: z.object({ logs: z.array(z.record(z.unknown())) }),
          },
        },
      },
      400: {
        description: "Validation error",
        content: { "application/json": { schema: ValidationError } },
      },
      401: { description: "Missing or invalid bearer token" },
    },
  });

  registry.registerPath({
    method: "get",
    path: "/integration/systems",
    summary: "List connected systems and their health",
    security: [{ [bearerAuth.name]: [] }],
    responses: {
      200: {
        description: "OK",
        content: {
          "application/json": {
            schema: z.object({ systems: z.array(z.record(z.unknown())) }),
          },
        },
      },
      401: { description: "Missing or invalid bearer token" },
    },
  });

  const generator = new OpenApiGeneratorV31(registry.definitions);
  const doc = generator.generateDocument({
    openapi: "3.1.0",
    info: {
      title: "ZorDMS Integration Service",
      version: "1.0.0",
      description:
        "Integration hub: HMAC-signed inbound webhooks (CBS/LOS/KYC), outbound webhook subscriptions, and connector/management routes. Inbound events are forwarded to core ingest with the x-internal-token service credential.",
    },
    servers: [{ url: "/" }],
  });

  // internalToken is documented as a component for the core-ingest contract even
  // though it is consumed by core, not exposed on a hub route. Reference it so
  // tooling keeps the scheme.
  void internalToken;

  return doc as unknown as Record<string, unknown>;
}
