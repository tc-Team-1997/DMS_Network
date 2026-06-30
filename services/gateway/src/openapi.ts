import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
} from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import {
  LoginBodySchema,
  LoginResponseSchema,
  CreateUserBodySchema,
  SetUserRolesBodySchema,
  AuthzCheckBodySchema,
  AuthzCheckResponseSchema,
  ValidationErrorSchema,
  ErrorSchema,
  AuthUserSchema,
  LdapLoginBodySchema,
  OidcCallbackQuerySchema,
  AuthConfigResponseSchema,
  SsoLoginResponseSchema,
  CreateRoleBodySchema,
  UpdateRoleBodySchema,
  SecuritySettingsBodySchema,
  AdImportBodySchema,
} from "./schemas.js";

/**
 * Builds the OpenAPI 3.1 document for the gateway service from the same zod
 * schemas used for runtime boundary validation, so the contract never drifts
 * from the implementation.
 */
export function buildOpenApiDocument(): Record<string, unknown> {
  const registry = new OpenAPIRegistry();

  // Security schemes -------------------------------------------------------
  const bearerAuth = registry.registerComponent("securitySchemes", "bearerAuth", {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
    description: "End-user JWT issued by POST /auth/login.",
  });

  const internalToken = registry.registerComponent(
    "securitySchemes",
    "internalToken",
    {
      type: "apiKey",
      in: "header",
      name: "x-internal-token",
      description:
        "Shared internal service token for service-to-service / inbound integration calls.",
    },
  );

  registry.registerComponent("securitySchemes", "hmacSignature", {
    type: "apiKey",
    in: "header",
    name: "x-signature",
    description:
      "HMAC-SHA256 signature over the raw request body for inbound integration callbacks (verified alongside x-internal-token).",
  });

  // SSO token handoff: after a successful OIDC/SAML browser flow the gateway
  // redirects back to the web app with the minted JWT in the URL fragment
  // (#token=...). The SPA reads location.hash, stores the token as the bearer,
  // and clears the hash so the token never hits server logs.
  const ssoHandoff = registry.registerComponent("securitySchemes", "ssoHandoff", {
    type: "oauth2",
    description:
      "Browser SSO handoff. GET /auth/{oidc,saml}/login redirects to the IdP; the callback redirects to <webAppUrl>/login#token=<JWT>. The SPA extracts the JWT and uses it as the bearerAuth credential thereafter.",
    flows: {
      authorizationCode: {
        authorizationUrl: "/auth/oidc/login",
        tokenUrl: "/auth/oidc/callback",
        scopes: {},
      },
    },
  });

  const validationError = {
    description: "Request failed boundary validation.",
    content: { "application/json": { schema: ValidationErrorSchema } },
  };
  const unauthorized = {
    description: "Missing or invalid credentials.",
    content: { "application/json": { schema: ErrorSchema } },
  };

  // /auth/login ------------------------------------------------------------
  registry.registerPath({
    method: "post",
    path: "/auth/login",
    summary: "Authenticate a user and issue a JWT",
    tags: ["auth"],
    request: {
      body: {
        content: { "application/json": { schema: LoginBodySchema } },
      },
    },
    responses: {
      200: {
        description: "Login succeeded.",
        content: { "application/json": { schema: LoginResponseSchema } },
      },
      400: validationError,
      401: unauthorized,
      403: {
        description: "Account locked.",
        content: { "application/json": { schema: ErrorSchema } },
      },
    },
  });

  // /auth/me ---------------------------------------------------------------
  registry.registerPath({
    method: "get",
    path: "/auth/me",
    summary: "Return the authenticated user",
    tags: ["auth"],
    security: [{ [bearerAuth.name]: [] }],
    responses: {
      200: {
        description: "The current authenticated user.",
        content: {
          "application/json": {
            schema: z.object({ user: AuthUserSchema }),
          },
        },
      },
      401: unauthorized,
    },
  });

  // /users (list) ----------------------------------------------------------
  registry.registerPath({
    method: "get",
    path: "/users",
    summary: "List users",
    tags: ["users"],
    security: [{ [bearerAuth.name]: [] }],
    responses: {
      200: {
        description: "List of users.",
        content: {
          "application/json": {
            schema: z.object({ users: z.array(AuthUserSchema.partial()) }),
          },
        },
      },
      401: unauthorized,
      403: { description: "Missing user:read permission." },
    },
  });

  // /users (create) --------------------------------------------------------
  registry.registerPath({
    method: "post",
    path: "/users",
    summary: "Create a user",
    tags: ["users"],
    security: [{ [bearerAuth.name]: [] }],
    request: {
      body: { content: { "application/json": { schema: CreateUserBodySchema } } },
    },
    responses: {
      201: {
        description: "User created.",
        content: {
          "application/json": {
            schema: z.object({
              user: z.object({
                id: z.string(),
                username: z.string(),
                roles: z.array(z.string()),
              }),
            }),
          },
        },
      },
      400: validationError,
      401: unauthorized,
      403: { description: "Missing user:create permission." },
      409: {
        description: "Username already taken.",
        content: { "application/json": { schema: ErrorSchema } },
      },
    },
  });

  // /users/:id/roles -------------------------------------------------------
  registry.registerPath({
    method: "post",
    path: "/users/{id}/roles",
    summary: "Replace a user's roles",
    tags: ["users"],
    security: [{ [bearerAuth.name]: [] }],
    request: {
      params: z.object({ id: z.string() }),
      body: { content: { "application/json": { schema: SetUserRolesBodySchema } } },
    },
    responses: {
      200: {
        description: "Roles updated.",
        content: { "application/json": { schema: z.object({ ok: z.boolean() }) } },
      },
      400: validationError,
      401: unauthorized,
      403: { description: "Missing role:assign permission." },
    },
  });

  // /users/:id/lock --------------------------------------------------------
  registry.registerPath({
    method: "post",
    path: "/users/{id}/lock",
    summary: "Toggle a user's locked status",
    tags: ["users"],
    security: [{ [bearerAuth.name]: [] }],
    request: {
      params: z.object({ id: z.string() }),
    },
    responses: {
      200: {
        description: "Lock status toggled.",
        content: {
          "application/json": {
            schema: z.object({ ok: z.boolean(), status: z.string() }),
          },
        },
      },
      400: validationError,
      401: unauthorized,
      403: { description: "Missing user:update permission." },
      404: {
        description: "User not found.",
        content: { "application/json": { schema: ErrorSchema } },
      },
    },
  });

  // /roles (master data — §4.11) -------------------------------------------
  const RoleResponseSchema = z.object({
    id: z.string(), name: z.string(), description: z.string().nullable(),
    system: z.boolean(), permissions: z.array(z.string()), userCount: z.number(),
  });
  registry.registerPath({
    method: "get", path: "/roles", summary: "List roles (with permissions + user counts)", tags: ["roles"],
    security: [{ [bearerAuth.name]: [] }],
    responses: {
      200: { description: "Roles.", content: { "application/json": { schema: z.object({ roles: z.array(RoleResponseSchema) }) } } },
      401: unauthorized,
      403: { description: "Missing admin:read permission." },
    },
  });
  registry.registerPath({
    method: "get", path: "/roles/{id}", summary: "Get a role", tags: ["roles"],
    security: [{ [bearerAuth.name]: [] }],
    responses: {
      200: { description: "Role.", content: { "application/json": { schema: z.object({ role: RoleResponseSchema }) } } },
      401: unauthorized,
      403: { description: "Missing admin:read permission." },
      404: { description: "Role not found.", content: { "application/json": { schema: ErrorSchema } } },
    },
  });
  registry.registerPath({
    method: "post", path: "/roles", summary: "Create a custom role", tags: ["roles"],
    security: [{ [bearerAuth.name]: [] }],
    request: { body: { content: { "application/json": { schema: CreateRoleBodySchema } } } },
    responses: {
      201: { description: "Created.", content: { "application/json": { schema: z.object({ role: RoleResponseSchema }) } } },
      400: validationError,
      401: unauthorized,
      403: { description: "Missing role:assign permission." },
      409: { description: "Role name already exists.", content: { "application/json": { schema: ErrorSchema } } },
    },
  });
  registry.registerPath({
    method: "put", path: "/roles/{id}", summary: "Update a role (non-system only)", tags: ["roles"],
    security: [{ [bearerAuth.name]: [] }],
    request: { body: { content: { "application/json": { schema: UpdateRoleBodySchema } } } },
    responses: {
      200: { description: "Updated.", content: { "application/json": { schema: z.object({ role: RoleResponseSchema }) } } },
      400: validationError,
      401: unauthorized,
      403: { description: "Missing role:assign permission." },
      404: { description: "Role not found.", content: { "application/json": { schema: ErrorSchema } } },
      409: { description: "System role protected.", content: { "application/json": { schema: ErrorSchema } } },
    },
  });
  registry.registerPath({
    method: "delete", path: "/roles/{id}", summary: "Delete a role (non-system only)", tags: ["roles"],
    security: [{ [bearerAuth.name]: [] }],
    responses: {
      200: { description: "Deleted.", content: { "application/json": { schema: z.object({ deleted: z.boolean() }) } } },
      401: unauthorized,
      403: { description: "Missing role:assign permission." },
      404: { description: "Role not found.", content: { "application/json": { schema: ErrorSchema } } },
      409: { description: "System role protected.", content: { "application/json": { schema: ErrorSchema } } },
    },
  });

  // /security-settings (Admin → Security — §4.12) --------------------------
  const SecuritySettingsResponseSchema = z.object({
    passwordMinLength: z.number(), passwordRequireComplexity: z.boolean(), mfaRequired: z.boolean(),
    sessionTimeoutMinutes: z.number(), maxFailedLogins: z.number(), lockoutDurationMinutes: z.number(),
    updatedBy: z.string().nullable(), updatedAt: z.string().nullable(),
  });
  registry.registerPath({
    method: "get", path: "/security-settings", summary: "Read the security policy", tags: ["admin"],
    security: [{ [bearerAuth.name]: [] }],
    responses: {
      200: { description: "Security settings.", content: { "application/json": { schema: z.object({ securitySettings: SecuritySettingsResponseSchema.nullable() }) } } },
      401: unauthorized,
      403: { description: "Missing security:read permission." },
    },
  });
  registry.registerPath({
    method: "put", path: "/security-settings", summary: "Update the security policy", tags: ["admin"],
    security: [{ [bearerAuth.name]: [] }],
    request: { body: { content: { "application/json": { schema: SecuritySettingsBodySchema } } } },
    responses: {
      200: { description: "Updated.", content: { "application/json": { schema: z.object({ securitySettings: SecuritySettingsResponseSchema }) } } },
      400: validationError,
      401: unauthorized,
      403: { description: "Missing admin:access permission." },
      404: { description: "Not initialized.", content: { "application/json": { schema: ErrorSchema } } },
    },
  });

  // /admin/ad-import (Admin → AD import — §4.12) ---------------------------
  registry.registerPath({
    method: "post", path: "/admin/ad-import", summary: "Bulk-provision users from directory identities", tags: ["admin"],
    security: [{ [bearerAuth.name]: [] }],
    request: { body: { content: { "application/json": { schema: AdImportBodySchema } } } },
    responses: {
      200: {
        description: "Import summary.",
        content: {
          "application/json": {
            schema: z.object({
              summary: z.object({
                found: z.number(), created: z.number(), skipped: z.number(), failed: z.number(), dryRun: z.boolean(),
              }),
            }),
          },
        },
      },
      400: validationError,
      401: unauthorized,
      403: { description: "Missing admin:access permission." },
    },
  });

  // /authz/check -----------------------------------------------------------
  registry.registerPath({
    method: "post",
    path: "/authz/check",
    summary: "Check whether a user holds the given permissions",
    description:
      "Service-to-service permission check. Requires the internal service token (and an HMAC signature for inbound integration callers).",
    tags: ["authz"],
    security: [{ [internalToken.name]: [] }],
    request: {
      body: { content: { "application/json": { schema: AuthzCheckBodySchema } } },
    },
    responses: {
      200: {
        description: "Permission decision.",
        content: { "application/json": { schema: AuthzCheckResponseSchema } },
      },
      400: validationError,
      401: unauthorized,
    },
  });

  const providerDisabled = {
    description: "The requested SSO provider is disabled on this deployment.",
    content: { "application/json": { schema: ErrorSchema } },
  };

  // /auth/config -----------------------------------------------------------
  registry.registerPath({
    method: "get",
    path: "/auth/config",
    summary: "Public SSO/login configuration",
    description:
      "Returns whether local login is enabled and the list of enabled SSO providers so the login UI can render the right buttons. No authentication required.",
    tags: ["sso"],
    responses: {
      200: {
        description: "Login configuration.",
        content: { "application/json": { schema: AuthConfigResponseSchema } },
      },
    },
  });

  // /auth/ldap/login -------------------------------------------------------
  registry.registerPath({
    method: "post",
    path: "/auth/ldap/login",
    summary: "Authenticate against LDAP/AD and issue a JWT",
    tags: ["sso"],
    request: {
      body: { content: { "application/json": { schema: LdapLoginBodySchema } } },
    },
    responses: {
      200: {
        description: "LDAP login succeeded; JWT issued.",
        content: { "application/json": { schema: SsoLoginResponseSchema } },
      },
      400: validationError,
      401: {
        description: "Invalid LDAP credentials.",
        content: { "application/json": { schema: ErrorSchema } },
      },
      404: providerDisabled,
      500: {
        description: "LDAP backend error.",
        content: { "application/json": { schema: ErrorSchema } },
      },
    },
  });

  // /auth/oidc/login -------------------------------------------------------
  registry.registerPath({
    method: "get",
    path: "/auth/oidc/login",
    summary: "Begin the OIDC authorization-code flow",
    description:
      "Sets a short-lived signed transient cookie (state/nonce/PKCE verifier) and 302-redirects the browser to the IdP authorization endpoint.",
    tags: ["sso"],
    security: [{ [ssoHandoff.name]: [] }],
    responses: {
      302: { description: "Redirect to the IdP authorization URL." },
      404: providerDisabled,
      500: {
        description: "Failed to build the OIDC authorization request.",
        content: { "application/json": { schema: ErrorSchema } },
      },
    },
  });

  // /auth/oidc/callback ----------------------------------------------------
  registry.registerPath({
    method: "get",
    path: "/auth/oidc/callback",
    summary: "Complete the OIDC flow and hand off the JWT",
    description:
      "Verifies the transient cookie + state, exchanges the code, JIT-provisions the user and 302-redirects to <webAppUrl>/login#token=<JWT>.",
    tags: ["sso"],
    security: [{ [ssoHandoff.name]: [] }],
    request: { query: OidcCallbackQuerySchema },
    responses: {
      302: { description: "Redirect to the web app with the JWT in the URL fragment." },
      400: {
        description: "Missing/expired transient or mismatched state.",
        content: { "application/json": { schema: ErrorSchema } },
      },
      401: {
        description: "Token exchange or assertion validation failed.",
        content: { "application/json": { schema: ErrorSchema } },
      },
      404: providerDisabled,
    },
  });

  // /auth/saml/login -------------------------------------------------------
  registry.registerPath({
    method: "get",
    path: "/auth/saml/login",
    summary: "Begin the SAML SP-initiated flow",
    tags: ["sso"],
    security: [{ [ssoHandoff.name]: [] }],
    responses: {
      302: { description: "Redirect to the IdP SSO URL." },
      404: providerDisabled,
      500: {
        description: "Failed to build the SAML login URL.",
        content: { "application/json": { schema: ErrorSchema } },
      },
    },
  });

  // /auth/saml/callback (ACS) ---------------------------------------------
  registry.registerPath({
    method: "post",
    path: "/auth/saml/callback",
    summary: "SAML assertion consumer service (ACS) and JWT handoff",
    description:
      "Consumes the IdP's application/x-www-form-urlencoded SAMLResponse, validates the assertion, JIT-provisions the user and 302-redirects to <webAppUrl>/login#token=<JWT>.",
    tags: ["sso"],
    security: [{ [ssoHandoff.name]: [] }],
    request: {
      body: {
        content: {
          "application/x-www-form-urlencoded": {
            schema: z.object({ SAMLResponse: z.string(), RelayState: z.string().optional() }),
          },
        },
      },
    },
    responses: {
      302: { description: "Redirect to the web app with the JWT in the URL fragment." },
      401: {
        description: "SAML assertion validation failed.",
        content: { "application/json": { schema: ErrorSchema } },
      },
      404: providerDisabled,
    },
  });

  // /health ----------------------------------------------------------------
  registry.registerPath({
    method: "get",
    path: "/health",
    summary: "Liveness probe",
    tags: ["ops"],
    responses: {
      200: {
        description: "Service is up.",
        content: {
          "application/json": { schema: z.object({ status: z.string() }) },
        },
      },
    },
  });

  const generator = new OpenApiGeneratorV31(registry.definitions);
  return generator.generateDocument({
    openapi: "3.1.0",
    info: {
      title: "ZorDMS Gateway API",
      version: "1.0.0",
      description:
        "Authentication, user management and authorization gateway for ZorDMS.",
    },
    servers: [{ url: "/" }],
    security: [{ bearerAuth: [] }],
  }) as unknown as Record<string, unknown>;
}
