import { z } from "zod";
import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";

// Register .openapi() metadata helpers on zod (idempotent, safe to call once).
extendZodWithOpenApi(z);

/**
 * Boundary-validation zod schemas for the gateway service's mutating routes.
 * These are the single source of truth for both runtime validation and the
 * generated OpenAPI document.
 */

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const LoginBodySchema = z
  .object({
    username: z.string().trim().min(1, "username is required"),
    password: z.string().min(1, "password is required"),
    totp: z.string().trim().min(1).optional(),
  })
  .openapi("LoginRequest");

export type LoginBody = z.infer<typeof LoginBodySchema>;

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export const CreateUserBodySchema = z
  .object({
    username: z.string().trim().min(1, "username is required"),
    password: z.string().min(1, "password is required"),
    full_name: z.string().optional(),
    email: z.string().email().optional(),
    branch: z.string().optional(),
    region: z.string().optional(),
    roles: z.array(z.string()).default([]),
  })
  .openapi("CreateUserRequest");

export type CreateUserBody = z.infer<typeof CreateUserBodySchema>;

export const SetUserRolesBodySchema = z
  .object({
    roles: z.array(z.string()).default([]),
  })
  .openapi("SetUserRolesRequest");

export type SetUserRolesBody = z.infer<typeof SetUserRolesBodySchema>;

// :id path param for /users/:id/roles and /users/:id/lock
export const UserIdParamsSchema = z
  .object({
    id: z.string().trim().min(1, "id is required"),
  })
  .openapi("UserIdParams");

// /users/:id/lock has no body fields; allow empty object.
export const LockUserBodySchema = z.object({}).openapi("LockUserRequest");

// ---------------------------------------------------------------------------
// Roles (master data — §4.11)
// ---------------------------------------------------------------------------

export const CreateRoleBodySchema = z
  .object({
    name: z.string().trim().min(1, "name is required").max(80),
    description: z.string().max(255).optional(),
    permissions: z.array(z.string()).default([]),
  })
  .openapi("CreateRoleRequest");
export type CreateRoleBody = z.infer<typeof CreateRoleBodySchema>;

export const UpdateRoleBodySchema = z
  .object({
    description: z.string().max(255).optional(),
    permissions: z.array(z.string()).optional(),
  })
  .openapi("UpdateRoleRequest");
export type UpdateRoleBody = z.infer<typeof UpdateRoleBodySchema>;

// ---------------------------------------------------------------------------
// SSO
// ---------------------------------------------------------------------------

// POST /auth/ldap/login { username, password }
export const LdapLoginBodySchema = z
  .object({
    username: z.string().trim().min(1, "username is required"),
    password: z.string().min(1, "password is required"),
  })
  .openapi("LdapLoginRequest");

export type LdapLoginBody = z.infer<typeof LdapLoginBodySchema>;

// GET /auth/oidc/callback?code=...&state=...
export const OidcCallbackQuerySchema = z
  .object({
    code: z.string().trim().min(1, "code is required"),
    state: z.string().trim().min(1, "state is required"),
  })
  .openapi("OidcCallbackQuery");

export const AuthProviderSchema = z
  .object({
    id: z.string(),
    type: z.enum(["ldap", "oidc", "saml"]),
    label: z.string().optional(),
  })
  .openapi("AuthProvider");

export const AuthConfigResponseSchema = z
  .object({
    local: z.boolean(),
    providers: z.array(AuthProviderSchema),
  })
  .openapi("AuthConfigResponse");

// ---------------------------------------------------------------------------
// Authz
// ---------------------------------------------------------------------------

export const AuthzCheckBodySchema = z
  .object({
    userId: z.string().trim().min(1, "userId must be a non-empty string"),
    permissions: z.array(z.string(), {
      message: "permissions must be an array of strings",
    }),
  })
  .openapi("AuthzCheckRequest");

export type AuthzCheckBody = z.infer<typeof AuthzCheckBodySchema>;

// ---------------------------------------------------------------------------
// Shared response schemas
// ---------------------------------------------------------------------------

export const ValidationErrorSchema = z
  .object({
    error: z.literal("validation_error"),
    issues: z.array(
      z.object({
        path: z.array(z.union([z.string(), z.number()])),
        message: z.string(),
        code: z.string().optional(),
      }),
    ),
  })
  .openapi("ValidationError");

export const ErrorSchema = z
  .object({ error: z.string() })
  .openapi("Error");

export const AuthUserSchema = z
  .object({
    id: z.string(),
    username: z.string(),
    roles: z.array(z.string()),
    permissions: z.array(z.string()),
    branch: z.string().nullish(),
    region: z.string().nullish(),
  })
  .openapi("AuthUser");

export const LoginResponseSchema = z
  .object({
    token: z.string(),
    user: AuthUserSchema,
  })
  .openapi("LoginResponse");

export const AuthzCheckResponseSchema = z
  .object({
    allowed: z.boolean(),
    missing: z.array(z.string()),
  })
  .openapi("AuthzCheckResponse");

// SSO LDAP login returns the same {token,user} shape as local login.
export const SsoLoginResponseSchema = z
  .object({
    token: z.string(),
    user: AuthUserSchema,
  })
  .openapi("SsoLoginResponse");
