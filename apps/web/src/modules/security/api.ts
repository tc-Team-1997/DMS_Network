import { z } from 'zod';
import { get } from '@/lib/http';

export const RbacMatrixSchema = z.object({
  roles: z.array(z.string()),
  permissions: z.array(z.string()),
  matrix: z.array(z.object({
    role: z.string(),
    perms: z.record(z.boolean()),
  })),
  userCounts: z.array(z.object({
    role: z.string(),
    c: z.number().int(),
  })),
});
export type RbacMatrix = z.infer<typeof RbacMatrixSchema>;

export const SessionRowSchema = z.object({
  id: z.number().int(),
  user_id: z.number().int().nullable(),
  username: z.string().nullable(),
  full_name: z.string().nullable(),
  role: z.string().nullable(),
  branch: z.string().nullable(),
  action: z.string().nullable(),
  created_at: z.string(),
});
export type SessionRow = z.infer<typeof SessionRowSchema>;

export const fetchRbac = () => get('/spa/api/security/rbac', RbacMatrixSchema);
export const fetchSessions = () =>
  get('/spa/api/security/sessions', z.array(SessionRowSchema));
