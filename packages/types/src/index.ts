export type Permission = string; // "resource:action"

export interface Role { id: number; name: string; description?: string; system?: boolean; }

export interface User {
  id: number; username: string; full_name?: string; email?: string;
  branch?: string; region?: string; mfa_enabled: boolean; status: "Active" | "Locked";
}

export interface AuthUser {
  id: number; username: string; roles: string[]; permissions: Permission[];
  branch?: string; region?: string;
}

export interface LoginRequest { username: string; password: string; totp?: string; }
export interface LoginResponse { token: string; user: AuthUser; mfaRequired?: boolean; }

export interface CreateUserRequest {
  username: string; password: string; full_name?: string; email?: string;
  branch?: string; region?: string; roles: string[];
}

export function isAuthUser(x: unknown): x is AuthUser {
  const u = x as AuthUser;
  return !!u && typeof u.id === "number" && typeof u.username === "string"
    && Array.isArray(u.roles) && Array.isArray(u.permissions)
    && u.roles.every(r => typeof r === "string")
    && u.permissions.every(p => typeof p === "string");
}
